/**
 * Serial inventory + IAP booking calendar.
 * Cart holds last HOLD_TTL_CART_MINUTES then stop blocking. Confirmed (paid) does not expire.
 * Cadel's Outlook/Google calendar is a later paid-event push, not this table.
 */

import { Router } from 'express';
import {
  schemaNameFromTenantId,
  ensureQuoteTables,
  expireStaleHolds,
  extendCartHolds,
  HOLD_TTL_CART_MINUTES,
} from './schema.js';
import { wrapWithTenant, withTenantTransaction } from './pool.js';
import {
  allocateStockCode,
  assertUniqueCategoryPrefix,
  categoryStockPrefix,
  normalizeStockPrefix,
} from './stockCodes.js';
import { actorUserId } from './auth.js';
import {
  clipName,
  listCategories,
  removeCategory,
  requireListedCategory,
  upsertCategory,
} from './categories.js';
import { billingDays, isLoadOutBlocked, occupancyDays, parseHm } from './rentalPeriod.js';
import {
  normalizeStoredImageUrl,
  parseCatalogImageUpload,
  putCatalogImageObjects,
} from './catalogImage.js';

const SKU_COLUMNS =
  'id, name, category, description, image_url, daily_rate, active, created_at, updated_at';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 2000;
const NAME_MAX = 200;
const SERIAL_MAX = 80;
const DATE_MAX_SPAN_DAYS = 366;

// Always alias inventory_reservations as `r`. Unqualified `status` is
// ambiguous when this fragment is used next to inventory_units.status
// (GET /skus?starts_on=… — catalog "Failed to list skus").
const BLOCKING = `(r.status = 'confirmed' OR (r.status = 'held' AND r.held_until > now()))`;

function hmacTenantId(req) {
  return req.identity?.tenantId || null;
}

function clip(raw, max) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function money(raw, fallback = 0) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseIsoDate(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
  const s = raw.trim();
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return s;
}

function occupancySpan(startsOn, endsOn) {
  return occupancyDays(startsOn, endsOn);
}

function isoDay(year, monthIndex0, day) {
  const dt = new Date(Date.UTC(year, monthIndex0, day));
  return dt.toISOString().slice(0, 10);
}

function band(available, total) {
  if (available <= 0) return 'none';
  if (total > 0 && available < total) return 'low';
  return 'good';
}

async function scoped(pool, req) {
  const tenantId = hmacTenantId(req);
  const { schema } = await ensureQuoteTables(pool, tenantId);
  return { tenantId, schema, db: wrapWithTenant(pool, tenantId) };
}

const UNIT_STATUSES = new Set(['active', 'retired']);

/** Paid/held rows that still overlap today or later. Past bookings do not block retire. */
async function futureBlocking(db, schema, { tenantId, unitId, skuId }) {
  if (unitId) {
    const { rows } = await db.query(
      `SELECT r.id FROM ${schema}.inventory_reservations r
        WHERE r.unit_id = $1 AND r.tenant_id = $2
          AND ${BLOCKING}
          AND r.ends_on >= CURRENT_DATE
        LIMIT 1`,
      [unitId, tenantId]
    );
    return rows[0] || null;
  }
  const { rows } = await db.query(
    `SELECT r.id FROM ${schema}.inventory_reservations r
       JOIN ${schema}.inventory_units u ON u.id = r.unit_id
      WHERE u.sku_id = $1 AND r.tenant_id = $2
        AND ${BLOCKING}
        AND r.ends_on >= CURRENT_DATE
      LIMIT 1`,
    [skuId, tenantId]
  );
  return rows[0] || null;
}

export function inventoryRoutes(ctx) {
  const router = Router();
  const pool = ctx.pool;
  const staff = ctx.staff;
  if (typeof staff !== 'function') {
    throw new Error('inventoryRoutes needs staff middleware');
  }

  router.get('/categories', staff, async (req, res) => {
    try {
      const { tenantId, schema, db } = await scoped(pool, req);
      const categories = await listCategories(db, schema, tenantId);
      res.json({ categories });
    } catch (err) {
      req.log?.error?.({ err }, 'category list failed');
      res.status(500).json({ error: 'Failed to list categories' });
    }
  });

  router.post('/categories', staff, async (req, res) => {
    const name = clipName(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    try {
      const { tenantId, schema, db } = await scoped(pool, req);
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'stock_prefix')) {
        await assertUniqueCategoryPrefix(db, schema, tenantId, req.body.stock_prefix, null);
      }
      const saved = await upsertCategory(db, schema, tenantId, name, req.body?.stock_prefix);
      if (req.body?.stock_prefix != null && String(req.body.stock_prefix).trim() !== '') {
        const p = normalizeStockPrefix(req.body.stock_prefix);
        await db.query(
          `UPDATE ${schema}.inventory_categories
              SET stock_prefix = $3
            WHERE tenant_id = $1 AND lower(name) = lower($2)`,
          [tenantId, saved, p]
        );
      }
      const categories = await listCategories(db, schema, tenantId);
      res.status(201).json({ name: saved, categories });
    } catch (err) {
      if (err.status === 400 || err.status === 409) {
        return res.status(err.status).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'category create failed');
      res.status(500).json({ error: 'Failed to create category' });
    }
  });

  router.patch('/categories/:categoryId', staff, async (req, res) => {
    const categoryId = req.params.categoryId;
    if (!UUID_RE.test(categoryId)) {
      return res.status(400).json({ error: 'categoryId must be a UUID' });
    }
    const name = clipName(req.body?.name);
    const hasPrefix = Object.prototype.hasOwnProperty.call(req.body || {}, 'stock_prefix');
    if (!name && !hasPrefix) {
      return res.status(400).json({ error: 'name or stock_prefix is required' });
    }
    try {
      const { tenantId, schema, db } = await scoped(pool, req);
      const current = await db.query(
        `SELECT id, name FROM ${schema}.inventory_categories
          WHERE id = $1 AND tenant_id = $2`,
        [categoryId, tenantId]
      );
      if (!current.rows[0]) {
        return res.status(404).json({ error: 'Category not found' });
      }
      const oldName = current.rows[0].name;
      if (hasPrefix) {
        const raw = req.body.stock_prefix;
        if (raw == null || String(raw).trim() === '') {
          await db.query(
            `UPDATE ${schema}.inventory_categories
                SET stock_prefix = NULL
              WHERE id = $1 AND tenant_id = $2`,
            [categoryId, tenantId]
          );
        } else {
          const p = await assertUniqueCategoryPrefix(db, schema, tenantId, raw, categoryId);
          await db.query(
            `UPDATE ${schema}.inventory_categories
                SET stock_prefix = $3
              WHERE id = $1 AND tenant_id = $2`,
            [categoryId, tenantId, p]
          );
        }
      }
      if (name) {
        try {
          await db.query(
            `UPDATE ${schema}.inventory_categories
                SET name = $3
              WHERE id = $1 AND tenant_id = $2`,
            [categoryId, tenantId, name]
          );
        } catch (err) {
          if (err?.code === '23505') {
            return res.status(409).json({ error: 'A category with that name already exists' });
          }
          throw err;
        }
        await db.query(
          `UPDATE ${schema}.inventory_skus
              SET category = $3, updated_at = now()
            WHERE tenant_id = $1 AND category = $2`,
          [tenantId, oldName, name]
        );
      }
      const categories = await listCategories(db, schema, tenantId);
      res.json({ name: name || oldName, categories });
    } catch (err) {
      if (err.status === 400 || err.status === 409) {
        return res.status(err.status).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'category patch failed');
      res.status(500).json({ error: 'Failed to update category' });
    }
  });

  router.delete('/categories/:categoryId', staff, async (req, res) => {
    const categoryId = req.params.categoryId;
    if (!UUID_RE.test(categoryId)) {
      return res.status(400).json({ error: 'categoryId must be a UUID' });
    }
    try {
      const { tenantId, schema, db } = await scoped(pool, req);
      await removeCategory(db, schema, tenantId, categoryId, req.body?.reassign_to);
      const categories = await listCategories(db, schema, tenantId);
      res.json({ categories });
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json({ error: err.message });
      }
      if (err.status === 400) {
        return res.status(400).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'category delete failed');
      res.status(500).json({ error: 'Failed to delete category' });
    }
  });

  router.post('/skus', staff, async (req, res) => {
    const tenantId = hmacTenantId(req);
    const name = clip(req.body?.name, NAME_MAX);
    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const dailyRate = money(req.body?.daily_rate, 0);
    if (dailyRate == null) {
      return res.status(400).json({ error: 'daily_rate must be a non-negative number' });
    }
    try {
      const { schema, db } = await scoped(pool, req);
      const category = await requireListedCategory(db, schema, tenantId, req.body?.category);
      let imageUrl = null;
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'image_url')) {
        imageUrl = normalizeStoredImageUrl(req.body.image_url);
      }
      const { rows } = await db.query(
        `INSERT INTO ${schema}.inventory_skus
           (tenant_id, name, category, description, image_url, daily_rate)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, category, description, image_url, daily_rate, active, created_at`,
        [
          tenantId,
          name,
          category,
          clip(req.body?.description, TEXT_MAX),
          imageUrl,
          dailyRate,
        ]
      );
      res.status(201).json({ sku: rows[0], schema });
    } catch (err) {
      if (err.status === 400) {
        return res.status(400).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'sku create failed');
      res.status(500).json({ error: 'Failed to create sku' });
    }
  });

  router.get('/skus', async (req, res) => {
    const startsRaw = typeof req.query.starts_on === 'string' ? req.query.starts_on : '';
    const endsRaw = typeof req.query.ends_on === 'string' ? req.query.ends_on : '';
    const startsOn = parseIsoDate(startsRaw);
    const endsOn = parseIsoDate(endsRaw);
    if (startsRaw || endsRaw) {
      if (!startsOn || !endsOn) {
        return res.status(400).json({
          error: 'starts_on and ends_on (YYYY-MM-DD) are required together',
        });
      }
      if (endsOn < startsOn) {
        return res.status(400).json({ error: 'ends_on must be on or after starts_on' });
      }
      if (occupancySpan(startsOn, endsOn) > DATE_MAX_SPAN_DAYS) {
        return res.status(400).json({ error: 'date range is too long' });
      }
    }
    try {
      const { tenantId, schema, db } = await scoped(pool, req);
      await expireStaleHolds(db, schema, tenantId);
      const { rows } = await db.query(
        `SELECT s.id, s.name, s.category, s.description, s.image_url, s.daily_rate, s.active, s.created_at,
                (SELECT count(*)::int FROM ${schema}.inventory_units u
                  WHERE u.sku_id = s.id AND u.status = 'active') AS units_total
           FROM ${schema}.inventory_skus s
          ORDER BY s.name
          LIMIT 200`
      );
      if (!startsOn || !endsOn) {
        return res.json({ skus: rows, schema });
      }
      const booked = await db.query(
        `SELECT u.sku_id, count(DISTINCT r.unit_id)::int AS booked
           FROM ${schema}.inventory_reservations r
           JOIN ${schema}.inventory_units u ON u.id = r.unit_id AND u.tenant_id = r.tenant_id
          WHERE r.tenant_id = $1
            AND ${BLOCKING}
            AND r.starts_on <= $3::date AND r.ends_on >= $2::date
          GROUP BY u.sku_id`,
        [tenantId, startsOn, endsOn]
      );
      const bookedBySku = {};
      for (const row of booked.rows) {
        bookedBySku[row.sku_id] = row.booked;
      }
      const skus = rows.map((sku) => {
        const unitsTotal = sku.units_total || 0;
        const bookedCount = bookedBySku[sku.id] || 0;
        const available = Math.max(0, unitsTotal - bookedCount);
        return {
          ...sku,
          units_available: available,
          band: band(available, unitsTotal),
          starts_on: startsOn,
          ends_on: endsOn,
        };
      });
      res.json({
        skus,
        starts_on: startsOn,
        ends_on: endsOn,
        hold_ttl_minutes: HOLD_TTL_CART_MINUTES,
        schema,
      });
    } catch (err) {
      req.log?.error?.({ err }, 'sku list failed');
      const body = { error: 'Failed to list skus' };
      if (err && typeof err === 'object' && err.code) {
        body.pg_code = err.code;
      }
      res.status(500).json(body);
    }
  });

  router.post('/skus/:skuId/units', staff, async (req, res) => {
    const tenantId = hmacTenantId(req);
    const skuId = req.params.skuId;
    if (!UUID_RE.test(skuId)) {
      return res.status(400).json({ error: 'skuId must be a UUID' });
    }
    const mfgSerial = clip(req.body?.serial_number, SERIAL_MAX);
    try {
      const { schema, db } = await scoped(pool, req);
      const sku = await db.query(
        `SELECT id, category FROM ${schema}.inventory_skus WHERE id = $1 AND tenant_id = $2`,
        [skuId, tenantId]
      );
      if (!sku.rows[0]) {
        return res.status(404).json({ error: 'SKU not found' });
      }
      const prefix = await categoryStockPrefix(db, schema, tenantId, sku.rows[0].category);
      if (!prefix) {
        return res.status(400).json({
          error:
            'Set a 3-character stock prefix on this SKU’s category before adding units (Categories section).',
        });
      }
      const nickname = clip(req.body?.nickname, NAME_MAX);
      const notes = clip(req.body?.notes, TEXT_MAX);
      const unit = await withTenantTransaction(pool, tenantId, async (client) => {
        const stockCode = await allocateStockCode(client, schema, tenantId, prefix);
        const serialNumber = mfgSerial || stockCode;
        const { rows } = await client.query(
          `INSERT INTO ${schema}.inventory_units
             (tenant_id, sku_id, serial_number, stock_code, nickname, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, sku_id, serial_number, stock_code, nickname, status, notes, created_at`,
          [tenantId, skuId, serialNumber, stockCode, nickname, notes]
        );
        return rows[0];
      });
      res.status(201).json({ unit, schema });
    } catch (err) {
      if (err && err.code === '23505') {
        return res.status(409).json({
          error: mfgSerial
            ? 'serial_number already exists for this SKU'
            : 'stock code collision; retry',
        });
      }
      if (err.status === 400) {
        return res.status(400).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'unit create failed');
      res.status(500).json({ error: 'Failed to create unit' });
    }
  });

  router.get('/skus/:skuId/units', staff, async (req, res) => {
    const tenantId = hmacTenantId(req);
    const skuId = req.params.skuId;
    if (!UUID_RE.test(skuId)) {
      return res.status(400).json({ error: 'skuId must be a UUID' });
    }
    try {
      const { schema, db } = await scoped(pool, req);
      const { rows } = await db.query(
        `SELECT id, sku_id, serial_number, stock_code, nickname, status, notes, created_at
           FROM ${schema}.inventory_units
          WHERE sku_id = $1 AND tenant_id = $2
          ORDER BY COALESCE(stock_code, serial_number)`,
        [skuId, tenantId]
      );
      res.json({ units: rows, schema });
    } catch (err) {
      req.log?.error?.({ err }, 'unit list failed');
      res.status(500).json({ error: 'Failed to list units' });
    }
  });

  router.patch('/skus/:skuId', staff, async (req, res) => {
    const tenantId = hmacTenantId(req);
    const skuId = req.params.skuId;
    if (!UUID_RE.test(skuId)) {
      return res.status(400).json({ error: 'skuId must be a UUID' });
    }
    const setParts = [];
    const params = [];
    if (typeof req.body?.name === 'string') {
      const name = clip(req.body.name, NAME_MAX);
      if (!name) return res.status(400).json({ error: 'name is required' });
      params.push(name);
      setParts.push(`name = $${params.length}`);
    }
    let clearCategory = false;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'category')) {
      const raw = req.body.category;
      if (raw == null || (typeof raw === 'string' && !raw.trim())) {
        clearCategory = true;
        params.push(null);
        setParts.push(`category = $${params.length}`);
      } else {
        params.push(clipName(req.body.category));
        setParts.push(`category = $${params.length}`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'daily_rate')) {
      const dailyRate = money(req.body.daily_rate, null);
      if (dailyRate == null) {
        return res.status(400).json({ error: 'daily_rate must be a non-negative number' });
      }
      params.push(dailyRate);
      setParts.push(`daily_rate = $${params.length}`);
    }
    if (typeof req.body?.active === 'boolean') {
      params.push(req.body.active);
      setParts.push(`active = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'description')) {
      params.push(clip(req.body.description, TEXT_MAX));
      setParts.push(`description = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'image_url')) {
      params.push(normalizeStoredImageUrl(req.body.image_url));
      setParts.push(`image_url = $${params.length}`);
    }
    if (setParts.length === 0) {
      return res.status(400).json({ error: 'no fields to update' });
    }
    try {
      const { schema, db } = await scoped(pool, req);
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'category') && !clearCategory) {
        const idx = setParts.findIndex((part) => part.startsWith('category ='));
        if (idx >= 0) {
          params[idx] = await requireListedCategory(db, schema, tenantId, req.body.category);
        }
      }
      if (req.body?.active === false) {
        const clash = await futureBlocking(db, schema, { tenantId, skuId });
        if (clash) {
          return res.status(409).json({
            error: 'This SKU has a current or upcoming booking. Cancel that booking before hiding it.',
          });
        }
      }
      params.push(skuId, tenantId);
      const { rows } = await db.query(
        `UPDATE ${schema}.inventory_skus
            SET ${setParts.join(', ')}, updated_at = now()
          WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
          RETURNING ${SKU_COLUMNS}`,
        params
      );
      if (!rows[0]) {
        return res.status(404).json({ error: 'SKU not found' });
      }
      res.json({ sku: rows[0], schema });
    } catch (err) {
      if (err.status === 400) {
        return res.status(400).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'sku patch failed');
      res.status(500).json({ error: 'Failed to update sku' });
    }
  });

  router.post('/skus/:skuId/catalog-image', staff, async (req, res) => {
    const tenantId = hmacTenantId(req);
    const skuId = req.params.skuId;
    if (!UUID_RE.test(skuId)) {
      return res.status(400).json({ error: 'skuId must be a UUID' });
    }
    try {
      const { schema, db } = await scoped(pool, req);
      const sku = await db.query(
        `SELECT id FROM ${schema}.inventory_skus WHERE id = $1 AND tenant_id = $2`,
        [skuId, tenantId]
      );
      if (!sku.rows[0]) {
        return res.status(404).json({ error: 'SKU not found' });
      }
      const upload = parseCatalogImageUpload(req.body, skuId);
      const imageUrl = await putCatalogImageObjects({
        path: upload.path,
        buffer: upload.buffer,
        contentType: upload.contentType,
      });
      const { rows } = await db.query(
        `UPDATE ${schema}.inventory_skus
            SET image_url = $1, updated_at = now()
          WHERE id = $2 AND tenant_id = $3
          RETURNING ${SKU_COLUMNS}`,
        [imageUrl, skuId, tenantId]
      );
      res.json({ sku: rows[0], schema });
    } catch (err) {
      if (err.status === 400 || err.status === 503) {
        return res.status(err.status).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'catalog image upload failed');
      res.status(500).json({ error: 'Failed to upload catalog image' });
    }
  });

  router.patch('/skus/:skuId/units/:unitId', staff, async (req, res) => {
    const tenantId = hmacTenantId(req);
    const skuId = req.params.skuId;
    const unitId = req.params.unitId;
    if (!UUID_RE.test(skuId) || !UUID_RE.test(unitId)) {
      return res.status(400).json({ error: 'skuId and unitId must be UUIDs' });
    }
    const setParts = [];
    const params = [unitId, skuId, tenantId];
    if (typeof req.body?.serial_number === 'string') {
      const serial = clip(req.body.serial_number, SERIAL_MAX);
      if (!serial) return res.status(400).json({ error: 'serial_number is required' });
      params.push(serial);
      setParts.push(`serial_number = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'nickname')) {
      params.push(clip(req.body.nickname, NAME_MAX));
      setParts.push(`nickname = $${params.length}`);
    }
    if (typeof req.body?.status === 'string') {
      const status = req.body.status.trim().toLowerCase();
      if (!UNIT_STATUSES.has(status)) {
        return res.status(400).json({ error: 'status must be active or retired' });
      }
      params.push(status);
      setParts.push(`status = $${params.length}`);
    }
    if (setParts.length === 0) {
      return res.status(400).json({ error: 'no fields to update' });
    }
    try {
      const { schema, db } = await scoped(pool, req);
      if (req.body?.status && String(req.body.status).trim().toLowerCase() === 'retired') {
        const clash = await futureBlocking(db, schema, { tenantId, unitId });
        if (clash) {
          return res.status(409).json({
            error: 'This serial has a current or upcoming booking. Cancel that booking before retiring it.',
          });
        }
      }
      const { rows } = await db.query(
        `UPDATE ${schema}.inventory_units
            SET ${setParts.join(', ')}
          WHERE id = $1 AND sku_id = $2 AND tenant_id = $3
          RETURNING id, sku_id, serial_number, stock_code, nickname, status, notes, created_at`,
        params
      );
      if (!rows[0]) {
        return res.status(404).json({ error: 'Unit not found' });
      }
      res.json({ unit: rows[0], schema });
    } catch (err) {
      if (err && err.code === '23505') {
        return res.status(409).json({ error: 'serial_number already exists for this SKU' });
      }
      req.log?.error?.({ err }, 'unit patch failed');
      res.status(500).json({ error: 'Failed to update unit' });
    }
  });

  router.get('/availability', async (req, res) => {
    const tenantId = hmacTenantId(req);
    const skuId = typeof req.query.sku_id === 'string' ? req.query.sku_id : '';
    const startsOn = parseIsoDate(req.query.starts_on);
    const endsOn = parseIsoDate(req.query.ends_on);
    if (!UUID_RE.test(skuId) || !startsOn || !endsOn) {
      return res.status(400).json({ error: 'sku_id, starts_on, and ends_on (YYYY-MM-DD) are required' });
    }
    if (endsOn < startsOn) {
      return res.status(400).json({ error: 'ends_on must be on or after starts_on' });
    }
    if (occupancySpan(startsOn, endsOn) > DATE_MAX_SPAN_DAYS) {
      return res.status(400).json({ error: 'date range is too long' });
    }
    try {
      const { schema, db } = await scoped(pool, req);
      const sku = await db.query(
        `SELECT id, name FROM ${schema}.inventory_skus WHERE id = $1 AND tenant_id = $2`,
        [skuId, tenantId]
      );
      if (!sku.rows[0]) {
        return res.status(404).json({ error: 'SKU not found' });
      }
      const { rows: unitRows } = await db.query(
        `SELECT u.id, u.serial_number, u.nickname,
                NOT EXISTS (
                  SELECT 1 FROM ${schema}.inventory_reservations r
                   WHERE r.unit_id = u.id
                     AND r.tenant_id = $2
                     AND ${BLOCKING}
                     AND r.starts_on <= $4::date
                     AND r.ends_on >= $3::date
                ) AS available
           FROM ${schema}.inventory_units u
          WHERE u.sku_id = $1 AND u.tenant_id = $2 AND u.status = 'active'
          ORDER BY u.serial_number`,
        [skuId, tenantId, startsOn, endsOn]
      );
      const unitsTotal = unitRows.length;
      const unitsAvailable = unitRows.filter((u) => u.available).length;
      res.json({
        sku_id: skuId,
        name: sku.rows[0].name,
        starts_on: startsOn,
        ends_on: endsOn,
        units_total: unitsTotal,
        units_available: unitsAvailable,
        band: band(unitsAvailable, unitsTotal),
        units: unitRows,
        schema,
      });
    } catch (err) {
      req.log?.error?.({ err }, 'availability failed');
      res.status(500).json({ error: 'Failed to load availability' });
    }
  });

  router.get('/calendar', async (req, res) => {
    const tenantId = hmacTenantId(req);
    const skuId = typeof req.query.sku_id === 'string' ? req.query.sku_id : '';
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!UUID_RE.test(skuId) || !Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'sku_id and year are required' });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'month must be 1-12' });
    }
    const monthStart = isoDay(year, month - 1, 1);
    const monthEnd = isoDay(year, month, 0);
    try {
      const { schema, db } = await scoped(pool, req);
      await expireStaleHolds(db, schema, tenantId);
      const sku = await db.query(
        `SELECT id, name FROM ${schema}.inventory_skus WHERE id = $1 AND tenant_id = $2`,
        [skuId, tenantId]
      );
      if (!sku.rows[0]) {
        return res.status(404).json({ error: 'SKU not found' });
      }
      const total = await db.query(
        `SELECT count(*)::int AS n FROM ${schema}.inventory_units
          WHERE sku_id = $1 AND tenant_id = $2 AND status = 'active'`,
        [skuId, tenantId]
      );
      const unitsTotal = total.rows[0]?.n || 0;
      const booked = await db.query(
        `SELECT r.unit_id, r.starts_on::text AS starts_on, r.ends_on::text AS ends_on
           FROM ${schema}.inventory_reservations r
           JOIN ${schema}.inventory_units u ON u.id = r.unit_id
          WHERE u.sku_id = $1 AND r.tenant_id = $2
            AND (r.status = 'confirmed' OR (r.status = 'held' AND r.held_until > now()))
            AND r.starts_on <= $4::date AND r.ends_on >= $3::date`,
        [skuId, tenantId, monthStart, monthEnd]
      );
      const daysInMonth = Number(monthEnd.slice(8, 10));
      const days = [];
      for (let d = 1; d <= daysInMonth; d += 1) {
        const date = isoDay(year, month - 1, d);
        const taken = new Set();
        for (const row of booked.rows) {
          if (row.starts_on <= date && row.ends_on >= date) taken.add(row.unit_id);
        }
        const available = Math.max(0, unitsTotal - taken.size);
        days.push({
          date,
          available,
          booked: taken.size,
          band: band(available, unitsTotal),
        });
      }
      res.json({
        sku_id: skuId,
        name: sku.rows[0].name,
        year,
        month,
        units_total: unitsTotal,
        hold_ttl_minutes: HOLD_TTL_CART_MINUTES,
        days,
        schema,
      });
    } catch (err) {
      req.log?.error?.({ err }, 'calendar failed');
      res.status(500).json({ error: 'Failed to load calendar' });
    }
  });

  router.post('/holds', async (req, res) => {
    const tenantId = hmacTenantId(req);
    const startsOn = parseIsoDate(req.body?.starts_on);
    const endsOn = parseIsoDate(req.body?.ends_on);
    if (!startsOn || !endsOn) {
      return res.status(400).json({ error: 'starts_on and ends_on (YYYY-MM-DD) are required' });
    }
    if (endsOn < startsOn) {
      return res.status(400).json({ error: 'ends_on must be on or after starts_on' });
    }
    if (occupancySpan(startsOn, endsOn) > DATE_MAX_SPAN_DAYS) {
      return res.status(400).json({ error: 'date range is too long' });
    }
    const loadIn = parseHm(req.body?.load_in_time);
    const loadOut = parseHm(req.body?.load_out_time);
    if (!loadIn || !loadOut) {
      return res.status(400).json({ error: 'load_in_time and load_out_time (HH:mm) are required' });
    }
    if (isLoadOutBlocked(loadOut)) {
      return res.status(400).json({
        error: 'Load-out is not available from 12:30 a.m. to 7:00 a.m.',
      });
    }
    if (billingDays(startsOn, loadIn, endsOn, loadOut) == null) {
      return res.status(400).json({ error: 'Load-out must be after load-in' });
    }
    const quoteId =
      typeof req.body?.quote_id === 'string' && UUID_RE.test(req.body.quote_id)
        ? req.body.quote_id
        : null;
    const unitId =
      typeof req.body?.unit_id === 'string' && UUID_RE.test(req.body.unit_id)
        ? req.body.unit_id
        : null;
    const skuId =
      typeof req.body?.sku_id === 'string' && UUID_RE.test(req.body.sku_id) ? req.body.sku_id : null;
    let quantity = 1;
    if (req.body?.quantity != null) {
      quantity = Number(req.body.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
        return res.status(400).json({ error: 'quantity must be an integer 1-50' });
      }
    }
    if (!unitId && !skuId) {
      return res.status(400).json({ error: 'unit_id or sku_id is required' });
    }

    try {
      const { schema, db } = await scoped(pool, req);
      await expireStaleHolds(db, schema, tenantId);
      const created = await withTenantTransaction(pool, tenantId, async (client) => {
        let targets = [];
        if (unitId) {
          const locked = await client.query(
            `SELECT id, sku_id, serial_number, stock_code FROM ${schema}.inventory_units
              WHERE id = $1 AND tenant_id = $2 AND status = 'active'
              FOR UPDATE`,
            [unitId, tenantId]
          );
          if (!locked.rows[0]) {
            const err = new Error('Unit not found');
            err.status = 404;
            throw err;
          }
          targets = [locked.rows[0]];
        } else {
          const locked = await client.query(
            `SELECT id, sku_id, serial_number, stock_code FROM ${schema}.inventory_units
              WHERE sku_id = $1 AND tenant_id = $2 AND status = 'active'
              ORDER BY COALESCE(stock_code, serial_number)
              FOR UPDATE`,
            [skuId, tenantId]
          );
          const free = [];
          for (const unit of locked.rows) {
            const clash = await client.query(
              `SELECT r.id FROM ${schema}.inventory_reservations r
                WHERE r.unit_id = $1 AND r.tenant_id = $2
                  AND ${BLOCKING}
                  AND r.starts_on <= $4::date AND r.ends_on >= $3::date
                LIMIT 1`,
              [unit.id, tenantId, startsOn, endsOn]
            );
            if (!clash.rows[0]) free.push(unit);
            if (free.length >= quantity) break;
          }
          if (free.length < quantity) {
            const err = new Error('Not enough units available');
            err.status = 409;
            err.body = { error: 'Not enough units available', available: free.length, requested: quantity };
            throw err;
          }
          targets = free.slice(0, quantity);
        }

        const holds = [];
        for (const unit of targets) {
          const clash = await client.query(
            `SELECT r.id FROM ${schema}.inventory_reservations r
              WHERE r.unit_id = $1 AND r.tenant_id = $2
                AND ${BLOCKING}
                AND r.starts_on <= $4::date AND r.ends_on >= $3::date
              LIMIT 1`,
            [unit.id, tenantId, startsOn, endsOn]
          );
          if (clash.rows[0]) {
            const err = new Error('Unit not available for those dates');
            err.status = 409;
            err.body = { error: 'Unit not available for those dates', unit_id: unit.id };
            throw err;
          }
          const inserted = await client.query(
            `INSERT INTO ${schema}.inventory_reservations
               (tenant_id, unit_id, sku_id, quote_id, starts_on, ends_on,
                load_in_time, load_out_time, status, held_until, created_by)
             VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::time, $8::time,
                     'held', now() + ($9::int * interval '1 minute'), $10)
             RETURNING id, unit_id, sku_id, quote_id, starts_on::text AS starts_on,
                       ends_on::text AS ends_on, load_in_time::text AS load_in_time,
                       load_out_time::text AS load_out_time, status, held_until, created_at`,
            [
              tenantId,
              unit.id,
              unit.sku_id,
              quoteId,
              startsOn,
              endsOn,
              loadIn,
              loadOut,
              HOLD_TTL_CART_MINUTES,
              actorUserId(req),
            ]
          );
          holds.push({
            ...inserted.rows[0],
            serial_number: unit.stock_code || unit.serial_number,
          });
        }
        return holds;
      });
      res.status(201).json({
        holds: created,
        hold: created[0],
        hold_ttl_minutes: HOLD_TTL_CART_MINUTES,
        schema,
      });
    } catch (err) {
      if (err.status === 404) {
        return res.status(404).json({ error: err.message });
      }
      if (err.status === 409) {
        return res.status(409).json(err.body || { error: err.message });
      }
      req.log?.error?.({ err }, 'hold create failed');
      res.status(500).json({ error: 'Failed to create hold' });
    }
  });

  router.post('/holds/extend', async (req, res) => {
    const tenantId = hmacTenantId(req);
    const holdIds = Array.isArray(req.body?.hold_ids)
      ? [...new Set(req.body.hold_ids.filter((id) => typeof id === 'string' && UUID_RE.test(id)))]
      : [];
    if (holdIds.length < 1 || holdIds.length > 50) {
      return res.status(400).json({ error: 'hold_ids are required (1-50)' });
    }
    try {
      const { schema, db } = await scoped(pool, req);
      const { ids, rows } = await extendCartHolds(db, schema, tenantId, holdIds, HOLD_TTL_CART_MINUTES);
      if (rows.length !== ids.length) {
        return res.status(409).json({
          error: 'One or more holds expired or are no longer in the cart',
          holds: rows,
        });
      }
      res.json({
        holds: rows,
        hold_ttl_minutes: HOLD_TTL_CART_MINUTES,
        schema,
      });
    } catch (err) {
      if (err.status === 400) {
        return res.status(400).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'hold extend failed');
      res.status(500).json({ error: 'Failed to extend holds' });
    }
  });

  router.post('/holds/:holdId/confirm', staff, async (req, res) => {
    const tenantId = hmacTenantId(req);
    const holdId = req.params.holdId;
    if (!UUID_RE.test(holdId)) {
      return res.status(400).json({ error: 'holdId must be a UUID' });
    }
    try {
      const { schema, db } = await scoped(pool, req);
      const { rows } = await db.query(
        `UPDATE ${schema}.inventory_reservations
            SET status = 'confirmed', held_until = NULL
          WHERE id = $1 AND tenant_id = $2
            AND status = 'held' AND held_until > now()
          RETURNING id, unit_id, sku_id, starts_on::text AS starts_on,
                    ends_on::text AS ends_on, status`,
        [holdId, tenantId]
      );
      if (!rows[0]) {
        return res.status(409).json({ error: 'Hold not found, expired, or already confirmed' });
      }
      res.json({ hold: rows[0], schema });
    } catch (err) {
      req.log?.error?.({ err }, 'hold confirm failed');
      res.status(500).json({ error: 'Failed to confirm hold' });
    }
  });

  router.post('/holds/:holdId/cancel', async (req, res) => {
    const tenantId = hmacTenantId(req);
    const holdId = req.params.holdId;
    if (!UUID_RE.test(holdId)) {
      return res.status(400).json({ error: 'holdId must be a UUID' });
    }
    try {
      const { schema, db } = await scoped(pool, req);
      const { rows } = await db.query(
        `UPDATE ${schema}.inventory_reservations
            SET status = 'cancelled'
          WHERE id = $1 AND tenant_id = $2 AND status IN ('held', 'confirmed')
          RETURNING id, status`,
        [holdId, tenantId]
      );
      if (!rows[0]) {
        return res.status(404).json({ error: 'Hold not found' });
      }
      res.json({ hold: rows[0], schema });
    } catch (err) {
      req.log?.error?.({ err }, 'hold cancel failed');
      res.status(500).json({ error: 'Failed to cancel hold' });
    }
  });

  return router;
}

export { BLOCKING, HOLD_TTL_CART_MINUTES };
