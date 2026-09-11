import { Router } from 'express';
import { schemaNameFromTenantId, ensureQuoteTables } from './schema.js';
import { wrapWithTenant } from './pool.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

function money(raw, fallback = 0) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function quoteRoutes(ctx) {
  const router = Router();
  const pool = ctx.pool;

  async function scoped(req) {
    const tenantId = hmacTenantId(req);
    const { schema } = await ensureQuoteTables(pool, tenantId);
    return { tenantId, schema, db: wrapWithTenant(pool, tenantId) };
  }

  router.post('/customers', async (req, res) => {
    const tenantId = hmacTenantId(req);
    const name = clip(req.body?.name, NAME_MAX);
    const email = clip(req.body?.email, EMAIL_MAX);
    if (!name || !email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'name and email are required' });
    }
    try {
      const { schema, db } = await scoped(req);
      const { rows } = await db.query(
        `INSERT INTO ${schema}.customers
           (tenant_id, name, email, phone, billing_address, site_address)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, email, phone, billing_address, site_address, user_id, created_at`,
        [
          tenantId,
          name,
          email.toLowerCase(),
          clip(req.body?.phone, PHONE_MAX),
          clip(req.body?.billing_address, TEXT_MAX),
          clip(req.body?.site_address, TEXT_MAX),
        ]
      );
      res.status(201).json({ customer: rows[0], schema });
    } catch (err) {
      req.log?.error?.({ err }, 'customer create failed');
      res.status(500).json({ error: 'Failed to create customer' });
    }
  });

  router.get('/customers', async (req, res) => {
    try {
      const { schema, db } = await scoped(req);
      const { rows } = await db.query(
        `SELECT id, name, email, phone, billing_address, site_address, user_id, created_at
           FROM ${schema}.customers
          ORDER BY created_at DESC
          LIMIT 100`
      );
      res.json({ customers: rows, schema });
    } catch (err) {
      req.log?.error?.({ err }, 'customer list failed');
      res.status(500).json({ error: 'Failed to list customers' });
    }
  });

  router.post('/', async (req, res) => {
    const tenantId = hmacTenantId(req);
    const customerId = typeof req.body?.customer_id === 'string' ? req.body.customer_id.trim() : '';
    if (!customerId) {
      return res.status(400).json({ error: 'customer_id is required' });
    }
    const items = Array.isArray(req.body?.line_items) ? req.body.line_items : [];
    const deliveryFee = money(req.body?.delivery_fee, 0);
    if (deliveryFee == null) {
      return res.status(400).json({ error: 'delivery_fee must be a non-negative number' });
    }
    try {
      const { schema, db } = await scoped(req);
      const found = await db.query(
        `SELECT id FROM ${schema}.customers WHERE id = $1 AND tenant_id = $2`,
        [customerId, tenantId]
      );
      if (!found.rows[0]) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      let subtotal = 0;
      const cleaned = [];
      for (let i = 0; i < items.length; i += 1) {
        const description = clip(items[i]?.description, NAME_MAX);
        const quantity = money(items[i]?.quantity, 1);
        const unitPrice = money(items[i]?.unit_price, 0);
        if (!description || quantity == null || unitPrice == null) {
          return res.status(400).json({ error: 'Each line item needs description, quantity, unit_price' });
        }
        subtotal += quantity * unitPrice;
        cleaned.push({ description, quantity, unitPrice, sortOrder: i });
      }
      const total = subtotal + deliveryFee;

      const { rows } = await db.query(
        `INSERT INTO ${schema}.quotes (
           tenant_id, customer_id, notes, delivery_address, delivery_miles,
           drive_minutes, delivery_fee, subtotal, total, created_by,
           document_id, envelope_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, customer_id, status, notes, document_id, envelope_id,
                   delivery_address, delivery_miles, drive_minutes, delivery_fee,
                   subtotal, total, created_at`,
        [
          tenantId,
          customerId,
          clip(req.body?.notes, TEXT_MAX),
          clip(req.body?.delivery_address, TEXT_MAX),
          money(req.body?.delivery_miles, null),
          money(req.body?.drive_minutes, null),
          deliveryFee,
          subtotal,
          total,
          req.identity.userId,
          typeof req.body?.document_id === 'string' ? req.body.document_id : null,
          typeof req.body?.envelope_id === 'string' ? req.body.envelope_id : null,
        ]
      );
      const quote = rows[0];
      for (const line of cleaned) {
        await db.query(
          `INSERT INTO ${schema}.quote_line_items
             (tenant_id, quote_id, description, quantity, unit_price, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenantId, quote.id, line.description, line.quantity, line.unitPrice, line.sortOrder]
        );
      }
      res.status(201).json({ quote, schema });
    } catch (err) {
      req.log?.error?.({ err }, 'quote create failed');
      res.status(500).json({ error: 'Failed to create quote' });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const { schema, db } = await scoped(req);
      const { rows } = await db.query(
        `SELECT id, customer_id, status, delivery_fee, subtotal, total,
                document_id, envelope_id, created_at
           FROM ${schema}.quotes
          ORDER BY created_at DESC
          LIMIT 100`
      );
      res.json({ quotes: rows, schema });
    } catch (err) {
      req.log?.error?.({ err }, 'quote list failed');
      res.status(500).json({ error: 'Failed to list quotes' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const { tenantId, schema, db } = await scoped(req);
      const quote = await db.query(
        `SELECT * FROM ${schema}.quotes WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId]
      );
      if (!quote.rows[0]) {
        return res.status(404).json({ error: 'Quote not found' });
      }
      const lines = await db.query(
        `SELECT id, description, quantity, unit_price, sort_order
           FROM ${schema}.quote_line_items
          WHERE quote_id = $1 AND tenant_id = $2
          ORDER BY sort_order`,
        [req.params.id, tenantId]
      );
      const pays = await db.query(
        `SELECT id, amount, status, method, external_id, created_at
           FROM ${schema}.payments
          WHERE quote_id = $1 AND tenant_id = $2
          ORDER BY created_at`,
        [req.params.id, tenantId]
      );
      res.json({
        quote: quote.rows[0],
        line_items: lines.rows,
        payments: pays.rows,
        schema,
      });
    } catch (err) {
      req.log?.error?.({ err }, 'quote get failed');
      res.status(500).json({ error: 'Failed to load quote' });
    }
  });

  router.post('/:id/payments', async (req, res) => {
    const tenantId = hmacTenantId(req);
    const amount = money(req.body?.amount, null);
    if (amount == null || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    const status = clip(req.body?.status, 32) || 'paid';
    const method = clip(req.body?.method, 40) || 'staff_recorded';
    try {
      const { schema, db } = await scoped(req);
      const quote = await db.query(
        `SELECT id FROM ${schema}.quotes WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, tenantId]
      );
      if (!quote.rows[0]) {
        return res.status(404).json({ error: 'Quote not found' });
      }
      const { rows } = await db.query(
        `INSERT INTO ${schema}.payments
           (tenant_id, quote_id, amount, status, method, external_id, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, amount, status, method, external_id, created_at`,
        [
          tenantId,
          req.params.id,
          amount,
          status,
          method,
          clip(req.body?.external_id, 120),
          req.identity.userId,
        ]
      );
      res.status(201).json({ payment: rows[0], schema });
    } catch (err) {
      req.log?.error?.({ err }, 'payment create failed');
      res.status(500).json({ error: 'Failed to record payment' });
    }
  });

  return router;
}
