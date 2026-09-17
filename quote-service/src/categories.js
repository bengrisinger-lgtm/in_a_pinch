/**
 * Staff-typed inventory categories. SKUs keep a category text;
 * this table is the growing drop-menu. HMAC tenant only.
 */

import { normalizeStockPrefix } from './stockCodes.js';

const NAME_MAX = 200;

export const STARTER_CATEGORIES = [
  'Microphones',
  'Speakers',
  'Projectors',
  'Lighting',
  'Mixers',
];

/** Default 3-char prefixes when a category has none yet (staff can change). */
export const STARTER_STOCK_PREFIXES = {
  Microphones: 'MIC',
  Speakers: 'SPK',
  Projectors: 'PRJ',
  Lighting: 'LGT',
  Mixers: 'MIX',
};

function clipName(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  return s.slice(0, NAME_MAX);
}

export async function upsertCategory(db, schema, tenantId, rawName, rawPrefix) {
  const name = clipName(rawName);
  if (!name) return null;
  const existing = await db.query(
    `SELECT name FROM ${schema}.inventory_categories
      WHERE tenant_id = $1 AND lower(name) = lower($2)
      LIMIT 1`,
    [tenantId, name]
  );
  if (existing.rows[0]) return existing.rows[0].name;
  let stockPrefix = null;
  if (rawPrefix != null && String(rawPrefix).trim() !== '') {
    stockPrefix = normalizeStockPrefix(rawPrefix);
    if (!stockPrefix) {
      const err = new Error('stock prefix must be exactly 3 letters or numbers');
      err.status = 400;
      throw err;
    }
  }
  try {
    await db.query(
      `INSERT INTO ${schema}.inventory_categories (tenant_id, name, stock_prefix)
       VALUES ($1, $2, $3)`,
      [tenantId, name, stockPrefix]
    );
    return name;
  } catch (err) {
    if (err?.code !== '23505') throw err;
    const again = await db.query(
      `SELECT name FROM ${schema}.inventory_categories
        WHERE tenant_id = $1 AND lower(name) = lower($2)
        LIMIT 1`,
      [tenantId, name]
    );
    return again.rows[0]?.name || name;
  }
}

/** Seed starter labels only — do not re-import SKU strings (keeps deleted names gone). */
export async function syncInventoryCategories(db, schema, tenantId) {
  for (const name of STARTER_CATEGORIES) {
    await upsertCategory(db, schema, tenantId, name);
    const starter = STARTER_STOCK_PREFIXES[name];
    if (starter) {
      await db.query(
        `UPDATE ${schema}.inventory_categories
            SET stock_prefix = $3
          WHERE tenant_id = $1 AND name = $2 AND stock_prefix IS NULL`,
        [tenantId, name, starter]
      );
    }
  }
}

export async function requireListedCategory(db, schema, tenantId, rawName) {
  await syncInventoryCategories(db, schema, tenantId);
  const name = clipName(rawName);
  if (!name) {
    const err = new Error('category is required');
    err.status = 400;
    throw err;
  }
  const { rows } = await db.query(
    `SELECT name FROM ${schema}.inventory_categories
      WHERE tenant_id = $1 AND lower(name) = lower($2)
      LIMIT 1`,
    [tenantId, name]
  );
  if (!rows[0]) {
    const err = new Error('Pick a category from the list. Add it under Categories first.');
    err.status = 400;
    throw err;
  }
  return rows[0].name;
}

export async function removeCategory(db, schema, tenantId, categoryId, reassignTo) {
  const current = await db.query(
    `SELECT id, name FROM ${schema}.inventory_categories
      WHERE id = $1 AND tenant_id = $2`,
    [categoryId, tenantId]
  );
  if (!current.rows[0]) {
    const err = new Error('Category not found');
    err.status = 404;
    throw err;
  }
  const oldName = current.rows[0].name;
  const { rows: countRows } = await db.query(
    `SELECT count(*)::int AS n FROM ${schema}.inventory_skus
      WHERE tenant_id = $1 AND category = $2`,
    [tenantId, oldName]
  );
  const skuCount = countRows[0]?.n || 0;
  if (skuCount > 0) {
    const next = clipName(reassignTo);
    if (next) {
      const canonical = await requireListedCategory(db, schema, tenantId, next);
      if (canonical.toLowerCase() === oldName.toLowerCase()) {
        const err = new Error('Choose a different category to reassign SKUs to.');
        err.status = 400;
        throw err;
      }
      await db.query(
        `UPDATE ${schema}.inventory_skus
            SET category = $3, updated_at = now()
          WHERE tenant_id = $1 AND category = $2`,
        [tenantId, oldName, canonical]
      );
    } else {
      await db.query(
        `UPDATE ${schema}.inventory_skus
            SET category = NULL, updated_at = now()
          WHERE tenant_id = $1 AND category = $2`,
        [tenantId, oldName]
      );
    }
  }
  await db.query(
    `DELETE FROM ${schema}.inventory_categories
      WHERE id = $1 AND tenant_id = $2`,
    [categoryId, tenantId]
  );
  return { removed: oldName };
}

export async function listCategories(db, schema, tenantId) {
  await syncInventoryCategories(db, schema, tenantId);
  const { rows } = await db.query(
    `SELECT id, name, stock_prefix, created_at
       FROM ${schema}.inventory_categories
      WHERE tenant_id = $1
      ORDER BY name`,
    [tenantId]
  );
  return rows;
}

export { clipName };
