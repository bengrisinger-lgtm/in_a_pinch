/**
 * Staff-only renter CRM (tenant schema + FORCE RLS).
 */

import { Router } from 'express';
import { ensureQuoteTables } from './schema.js';
import { wrapWithTenant } from './pool.js';
import { joinDisplayName, normalizeEmail, splitDisplayName } from './names.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 2000;
const NAME_MAX = 200;
const EMAIL_MAX = 254;
const PHONE_MAX = 40;

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

function rowToCustomer(row) {
  let first = row.first_name;
  let last = row.last_name;
  if (!first && !last && row.name) {
    const split = splitDisplayName(row.name);
    first = split.first_name;
    last = split.last_name;
  }
  const name = joinDisplayName(first, last) || row.name || '';
  return {
    id: row.id,
    name,
    first_name: first || '',
    last_name: last || '',
    email: row.email,
    phone: row.phone,
    billing_address: row.billing_address,
    site_address: row.site_address,
    user_id: row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function customerRoutes(ctx) {
  const router = Router();
  const pool = ctx.pool;
  const staff = ctx.staff;

  async function scoped(req) {
    const tenantId = hmacTenantId(req);
    const { schema } = await ensureQuoteTables(pool, tenantId);
    return { tenantId, schema, db: wrapWithTenant(pool, tenantId) };
  }

  router.post('/', staff, async (req, res) => {
    const tenantId = hmacTenantId(req);
    const first = clip(req.body?.first_name, NAME_MAX);
    const last = clip(req.body?.last_name, NAME_MAX);
    const legacyName = clip(req.body?.name, NAME_MAX);
    const email = clip(req.body?.email, EMAIL_MAX);
    const name = joinDisplayName(first || splitDisplayName(legacyName).first_name, last || splitDisplayName(legacyName).last_name) || legacyName;
    if (!name || !email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'name (or first/last) and email are required' });
    }
    const fn = first || splitDisplayName(name).first_name;
    const ln = last || splitDisplayName(name).last_name;
    try {
      const { schema, db } = await scoped(req);
      const normalized = normalizeEmail(email);
      const existing = await db.query(
        `SELECT id FROM ${schema}.customers
          WHERE tenant_id = $1 AND lower(email) = $2
          LIMIT 1`,
        [tenantId, normalized]
      );
      let rows;
      if (existing.rows[0]) {
        rows = (
          await db.query(
            `UPDATE ${schema}.customers
                SET name = $3,
                    first_name = $4,
                    last_name = $5,
                    phone = COALESCE($6, phone),
                    billing_address = COALESCE($7, billing_address),
                    site_address = COALESCE($8, site_address),
                    updated_at = now()
              WHERE id = $1 AND tenant_id = $2
            RETURNING *`,
            [
              existing.rows[0].id,
              tenantId,
              joinDisplayName(fn, ln),
              fn,
              ln,
              clip(req.body?.phone, PHONE_MAX),
              clip(req.body?.billing_address, TEXT_MAX),
              clip(req.body?.site_address, TEXT_MAX),
            ]
          )
        ).rows;
      } else {
        rows = (
          await db.query(
            `INSERT INTO ${schema}.customers
               (tenant_id, name, first_name, last_name, email, phone, billing_address, site_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
              tenantId,
              joinDisplayName(fn, ln),
              fn,
              ln,
              normalized,
              clip(req.body?.phone, PHONE_MAX),
              clip(req.body?.billing_address, TEXT_MAX),
              clip(req.body?.site_address, TEXT_MAX),
            ]
          )
        ).rows;
      }
      res.status(201).json({ customer: rowToCustomer(rows[0]), schema });
    } catch (err) {
      if (err?.code === '23505') {
        return res.status(409).json({ error: 'A customer with that email already exists' });
      }
      req.log?.error?.({ err }, 'customer create failed');
      res.status(500).json({ error: 'Failed to create customer' });
    }
  });

  router.get('/', staff, async (req, res) => {
    try {
      const { schema, db } = await scoped(req);
      const q = clip(req.query?.q, 120);
      const params = [];
      let where = '';
      if (q) {
        params.push(`%${q}%`);
        const n = params.length;
        where = `WHERE (
          lower(coalesce(last_name, '')) LIKE lower($${n})
          OR lower(coalesce(first_name, '')) LIKE lower($${n})
          OR lower(name) LIKE lower($${n})
          OR lower(email) LIKE lower($${n})
          OR regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE regexp_replace($${n}, '[^0-9]', '', 'g')
        )`;
      }
      const { rows } = await db.query(
        `SELECT *
           FROM ${schema}.customers
          ${where}
          ORDER BY lower(coalesce(nullif(trim(last_name), ''), split_part(name, ' ', 2))), lower(coalesce(nullif(trim(first_name), ''), split_part(name, ' ', 1)))
          LIMIT 500`,
        params
      );
      res.json({ customers: rows.map(rowToCustomer), schema });
    } catch (err) {
      req.log?.error?.({ err }, 'customer list failed');
      res.status(500).json({ error: 'Failed to list customers' });
    }
  });

  router.patch('/:id', staff, async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid customer id' });
    try {
      const { tenantId, schema, db } = await scoped(req);
      const { rows: found } = await db.query(
        `SELECT * FROM ${schema}.customers WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (!found.rows[0]) return res.status(404).json({ error: 'Customer not found' });
      const cur = found.rows[0];
      const first = clip(req.body?.first_name, NAME_MAX) ?? cur.first_name ?? splitDisplayName(cur.name).first_name;
      const last = clip(req.body?.last_name, NAME_MAX) ?? cur.last_name ?? splitDisplayName(cur.name).last_name;
      const emailRaw = clip(req.body?.email, EMAIL_MAX);
      const email = emailRaw ? normalizeEmail(emailRaw) : cur.email;
      if (emailRaw && !EMAIL_RE.test(emailRaw)) {
        return res.status(400).json({ error: 'Invalid email' });
      }
      const { rows } = await db.query(
        `UPDATE ${schema}.customers
            SET name = $3,
                first_name = $4,
                last_name = $5,
                email = $6,
                phone = COALESCE($7, phone),
                billing_address = COALESCE($8, billing_address),
                site_address = COALESCE($9, site_address),
                updated_at = now()
          WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
        [
          id,
          tenantId,
          joinDisplayName(first, last),
          first,
          last,
          email,
          req.body?.phone !== undefined ? clip(req.body.phone, PHONE_MAX) : cur.phone,
          req.body?.billing_address !== undefined ? clip(req.body.billing_address, TEXT_MAX) : cur.billing_address,
          req.body?.site_address !== undefined ? clip(req.body.site_address, TEXT_MAX) : cur.site_address,
        ]
      );
      res.json({ customer: rowToCustomer(rows[0]) });
    } catch (err) {
      if (err?.code === '23505') {
        return res.status(409).json({ error: 'A customer with that email already exists' });
      }
      req.log?.error?.({ err }, 'customer update failed');
      res.status(500).json({ error: 'Failed to update customer' });
    }
  });

  router.delete('/:id', staff, async (req, res) => {
    const id = req.params.id;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid customer id' });
    try {
      const { tenantId, schema, db } = await scoped(req);
      const quotes = await db.query(
        `SELECT 1 FROM ${schema}.quotes WHERE tenant_id = $1 AND customer_id = $2 LIMIT 1`,
        [tenantId, id]
      );
      if (quotes.rows.length) {
        return res.status(409).json({ error: 'Customer has orders — merge or keep the record' });
      }
      const { rowCount } = await db.query(
        `DELETE FROM ${schema}.customers WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      if (!rowCount) return res.status(404).json({ error: 'Customer not found' });
      res.json({ success: true });
    } catch (err) {
      req.log?.error?.({ err }, 'customer delete failed');
      res.status(500).json({ error: 'Failed to delete customer' });
    }
  });

  router.post('/merge', staff, async (req, res) => {
    const keepId = typeof req.body?.keep_id === 'string' ? req.body.keep_id.trim() : '';
    const mergeId = typeof req.body?.merge_id === 'string' ? req.body.merge_id.trim() : '';
    if (!UUID_RE.test(keepId) || !UUID_RE.test(mergeId) || keepId === mergeId) {
      return res.status(400).json({ error: 'keep_id and merge_id are required distinct UUIDs' });
    }
    try {
      const { tenantId, schema, db } = await scoped(req);
      const { rows: pair } = await db.query(
        `SELECT id FROM ${schema}.customers
          WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, [keepId, mergeId]]
      );
      if (pair.length !== 2) {
        return res.status(404).json({ error: 'Both customers must exist under this tenant' });
      }
      await db.query(
        `UPDATE ${schema}.quotes SET customer_id = $3, updated_at = now()
          WHERE tenant_id = $1 AND customer_id = $2`,
        [tenantId, mergeId, keepId]
      );
      await db.query(`DELETE FROM ${schema}.customers WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        mergeId,
      ]);
      const { rows } = await db.query(
        `SELECT * FROM ${schema}.customers WHERE id = $1 AND tenant_id = $2`,
        [keepId, tenantId]
      );
      res.json({ customer: rowToCustomer(rows[0]) });
    } catch (err) {
      req.log?.error?.({ err }, 'customer merge failed');
      res.status(500).json({ error: 'Failed to merge customers' });
    }
  });

  return router;
}
