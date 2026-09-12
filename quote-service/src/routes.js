import { Router } from 'express';
import { ensureQuoteTables } from './schema.js';
import { wrapWithTenant, withTenantTransaction } from './pool.js';
import { deliveryFeeFromOneWay } from './delivery.js';
import { applyPaidQuote } from './paid.js';
import { dollarsToCents } from './square.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 2000;
const NAME_MAX = 200;
const EMAIL_MAX = 254;
const PHONE_MAX = 40;
const EVENT_TYPES = new Set([
  'Wedding',
  'Party',
  'Corporate Event',
  'Live Music',
  'Community Event',
  'Other',
]);
const FULFILLMENT = new Set(['pickup', 'delivery']);

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

function spanDays(startsOn, endsOn) {
  const a = Date.parse(`${startsOn}T00:00:00Z`);
  const b = Date.parse(`${endsOn}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
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

  router.post('/checkout', async (req, res) => {
    const tenantId = hmacTenantId(req);
    const name = clip(req.body?.name, NAME_MAX);
    const email = clip(req.body?.email, EMAIL_MAX);
    if (!name || !email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'name and email are required' });
    }
    const fulfillment = clip(req.body?.fulfillment, 32) || 'pickup';
    if (!FULFILLMENT.has(fulfillment)) {
      return res.status(400).json({ error: 'fulfillment must be pickup or delivery' });
    }
    const eventType = clip(req.body?.event_type, NAME_MAX);
    if (eventType && !EVENT_TYPES.has(eventType)) {
      return res.status(400).json({ error: 'event_type is not a known value' });
    }
    const holdIds = Array.isArray(req.body?.hold_ids)
      ? [...new Set(req.body.hold_ids.filter((id) => typeof id === 'string' && UUID_RE.test(id)))]
      : [];
    if (holdIds.length < 1) {
      return res.status(400).json({ error: 'hold_ids are required' });
    }

    let deliveryAddress = null;
    let deliveryMiles = 0;
    let driveMinutes = 0;
    let deliveryFee = 0;
    if (fulfillment === 'delivery') {
      deliveryAddress = clip(req.body?.delivery_address, TEXT_MAX);
      if (!deliveryAddress) {
        return res.status(400).json({ error: 'delivery_address is required for delivery' });
      }
      const miles = money(req.body?.one_way_miles, null);
      const minutes = money(req.body?.one_way_minutes, null);
      deliveryFee = deliveryFeeFromOneWay(miles, minutes);
      if (deliveryFee == null) {
        return res.status(400).json({
          error: 'one_way_miles and one_way_minutes must be non-negative numbers',
        });
      }
      deliveryMiles = miles * 4;
      driveMinutes = minutes * 4;
    }

    try {
      const schemaName = (
        await ensureQuoteTables(pool, tenantId)
      ).schema;
      const result = await withTenantTransaction(pool, tenantId, async (client) => {
        const holds = await client.query(
          `SELECT r.id, r.sku_id, r.unit_id, r.starts_on::text AS starts_on,
                  r.ends_on::text AS ends_on, r.status, r.held_until,
                  s.name AS sku_name, s.daily_rate, u.serial_number
             FROM ${schemaName}.inventory_reservations r
             JOIN ${schemaName}.inventory_skus s
               ON s.id = r.sku_id AND s.tenant_id = r.tenant_id
             JOIN ${schemaName}.inventory_units u
               ON u.id = r.unit_id AND u.tenant_id = r.tenant_id
            WHERE r.tenant_id = $1
              AND r.id = ANY($2::uuid[])
            FOR UPDATE OF r`,
          [tenantId, holdIds]
        );
        if (holds.rows.length !== holdIds.length) {
          const err = new Error('One or more holds were not found');
          err.status = 409;
          throw err;
        }
        const startsOn = holds.rows[0].starts_on;
        const endsOn = holds.rows[0].ends_on;
        for (const row of holds.rows) {
          if (row.status !== 'held' || !row.held_until || new Date(row.held_until) <= new Date()) {
            const err = new Error('A hold is expired or not active');
            err.status = 409;
            throw err;
          }
          if (row.starts_on !== startsOn || row.ends_on !== endsOn) {
            const err = new Error('Holds must share the same rental dates');
            err.status = 409;
            throw err;
          }
        }

        const existing = await client.query(
          `SELECT id FROM ${schemaName}.customers
            WHERE tenant_id = $1 AND lower(email) = $2
            ORDER BY created_at ASC
            LIMIT 1`,
          [tenantId, email.toLowerCase()]
        );
        let customerId = existing.rows[0]?.id;
        let customer;
        if (customerId) {
          const updated = await client.query(
            `UPDATE ${schemaName}.customers
                SET name = $3, phone = $4, site_address = $5, updated_at = now()
              WHERE id = $1 AND tenant_id = $2
            RETURNING id, name, email, phone, billing_address, site_address, user_id, created_at`,
            [
              customerId,
              tenantId,
              name,
              clip(req.body?.phone, PHONE_MAX),
              fulfillment === 'delivery' ? deliveryAddress : clip(req.body?.site_address, TEXT_MAX),
            ]
          );
          customer = updated.rows[0];
        } else {
          const inserted = await client.query(
            `INSERT INTO ${schemaName}.customers
               (tenant_id, name, email, phone, billing_address, site_address)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, name, email, phone, billing_address, site_address, user_id, created_at`,
            [
              tenantId,
              name,
              email.toLowerCase(),
              clip(req.body?.phone, PHONE_MAX),
              clip(req.body?.billing_address, TEXT_MAX),
              fulfillment === 'delivery' ? deliveryAddress : clip(req.body?.site_address, TEXT_MAX),
            ]
          );
          customer = inserted.rows[0];
          customerId = customer.id;
        }

        const nights = spanDays(startsOn, endsOn);
        const bySku = new Map();
        for (const row of holds.rows) {
          const cur = bySku.get(row.sku_id) || {
            description: row.sku_name,
            quantity: 0,
            dailyRate: Number(row.daily_rate) || 0,
          };
          cur.quantity += 1;
          bySku.set(row.sku_id, cur);
        }
        let subtotal = 0;
        const lines = [];
        let sort = 0;
        for (const line of bySku.values()) {
          const unitPrice = line.dailyRate * nights;
          subtotal += unitPrice * line.quantity;
          lines.push({
            description: line.description,
            quantity: line.quantity,
            unitPrice,
            sortOrder: sort,
          });
          sort += 1;
        }
        const total = subtotal + deliveryFee;

        const quoteIns = await client.query(
          `INSERT INTO ${schemaName}.quotes (
             tenant_id, customer_id, notes, delivery_address, delivery_miles,
             drive_minutes, delivery_fee, subtotal, total, created_by,
             fulfillment, event_type, starts_on, ends_on
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14::date)
           RETURNING id, customer_id, status, notes, document_id, envelope_id,
                     delivery_address, delivery_miles, drive_minutes, delivery_fee,
                     subtotal, total, fulfillment, event_type,
                     starts_on::text AS starts_on, ends_on::text AS ends_on, created_at`,
          [
            tenantId,
            customerId,
            clip(req.body?.notes, TEXT_MAX),
            deliveryAddress,
            fulfillment === 'delivery' ? deliveryMiles : 0,
            fulfillment === 'delivery' ? driveMinutes : 0,
            deliveryFee,
            subtotal,
            total,
            req.identity.userId,
            fulfillment,
            eventType,
            startsOn,
            endsOn,
          ]
        );
        const quote = quoteIns.rows[0];
        for (const line of lines) {
          await client.query(
            `INSERT INTO ${schemaName}.quote_line_items
               (tenant_id, quote_id, description, quantity, unit_price, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [tenantId, quote.id, line.description, line.quantity, line.unitPrice, line.sortOrder]
          );
        }
        const attached = await client.query(
          `UPDATE ${schemaName}.inventory_reservations
              SET quote_id = $1
            WHERE tenant_id = $2
              AND id = ANY($3::uuid[])
              AND status = 'held'
              AND held_until > now()`,
          [quote.id, tenantId, holdIds]
        );
        if (attached.rowCount !== holdIds.length) {
          const err = new Error('Could not attach all holds to the quote');
          err.status = 409;
          throw err;
        }
        return { customer, quote, line_items: lines, holds: holds.rows };
      });
      res.status(201).json({
        ...result,
        schema: schemaName,
        renter_magic_link: null,
        hold_ttl_note: 'Holds stay held until paid or the 2-hour TTL. Square or staff mark-paid confirms them.',
      });
    } catch (err) {
      if (err.status === 409) {
        return res.status(409).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'checkout failed');
      res.status(500).json({ error: 'Failed to save checkout' });
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

  router.patch('/:id', async (req, res) => {
    const tenantId = hmacTenantId(req);
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'id must be a UUID' });
    }
    const documentId =
      typeof req.body?.document_id === 'string' && UUID_RE.test(req.body.document_id.trim())
        ? req.body.document_id.trim()
        : null;
    const envelopeId =
      typeof req.body?.envelope_id === 'string' && UUID_RE.test(req.body.envelope_id.trim())
        ? req.body.envelope_id.trim()
        : null;
    if (!documentId && !envelopeId) {
      return res.status(400).json({ error: 'document_id or envelope_id is required' });
    }
    try {
      const { schema, db } = await scoped(req);
      const { rows } = await db.query(
        `UPDATE ${schema}.quotes
            SET document_id = COALESCE($3, document_id),
                envelope_id = COALESCE($4, envelope_id),
                updated_at = now()
          WHERE id = $1 AND tenant_id = $2
          RETURNING id, customer_id, status, document_id, envelope_id,
                    delivery_fee, subtotal, total, fulfillment, created_at`,
        [req.params.id, tenantId, documentId, envelopeId]
      );
      if (!rows[0]) {
        return res.status(404).json({ error: 'Quote not found' });
      }
      res.json({ quote: rows[0], schema });
    } catch (err) {
      req.log?.error?.({ err }, 'quote envelope attach failed');
      res.status(500).json({ error: 'Failed to store envelope' });
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

  router.post('/:id/payment-link', async (req, res) => {
    const tenantId = hmacTenantId(req);
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'id must be a UUID' });
    }
    const allowedOrigins = ctx.allowedOrigins || [];
    let redirectUrl = null;
    const origin = clip(req.body?.redirect_origin, 200);
    if (origin) {
      const trimmed = origin.replace(/\/$/, '');
      if (allowedOrigins.includes(trimmed)) {
        redirectUrl = `${trimmed}/#rentals?quote=${req.params.id}`;
      }
    }
    try {
      const { schema, db } = await scoped(req);
      const found = await db.query(
        `SELECT q.id, q.status, q.total, c.email
           FROM ${schema}.quotes q
           JOIN ${schema}.customers c
             ON c.id = q.customer_id AND c.tenant_id = q.tenant_id
          WHERE q.id = $1 AND q.tenant_id = $2`,
        [req.params.id, tenantId]
      );
      const quote = found.rows[0];
      if (!quote) {
        return res.status(404).json({ error: 'Quote not found' });
      }
      if (quote.status === 'paid') {
        return res.status(409).json({ error: 'Quote is already paid' });
      }
      const amountCents = dollarsToCents(quote.total);
      if (amountCents == null) {
        return res.status(400).json({ error: 'Quote total must be a positive amount' });
      }
      if (typeof ctx.square?.createPaymentLink !== 'function') {
        return res.status(503).json({ error: 'Square is not configured' });
      }
      const link = await ctx.square.createPaymentLink(tenantId, {
        idempotencyKey: quote.id,
        name: 'Rental booking',
        amountCents,
        redirectUrl,
        buyerEmail: quote.email,
        paymentNote: quote.id,
      });
      res.status(201).json({
        url: link.url,
        id: link.id,
        quote_id: quote.id,
        amount_cents: amountCents,
      });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'payment link failed');
      res.status(500).json({ error: 'Failed to create payment link' });
    }
  });

  router.post('/:id/payments', async (req, res) => {
    const tenantId = hmacTenantId(req);
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'id must be a UUID' });
    }
    const amount =
      req.body?.amount == null || req.body?.amount === ''
        ? null
        : money(req.body.amount, null);
    if (amount != null && amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    const status = clip(req.body?.status, 32) || 'paid';
    const method = clip(req.body?.method, 40) || 'staff_recorded';
    try {
      const schemaName = (await ensureQuoteTables(pool, tenantId)).schema;
      if (status === 'paid') {
        const result = await withTenantTransaction(pool, tenantId, async (client) => {
          const quote = await client.query(
            `SELECT id, status, total FROM ${schemaName}.quotes WHERE id = $1 AND tenant_id = $2`,
            [req.params.id, tenantId]
          );
          if (!quote.rows[0]) {
            const err = new Error('Quote not found');
            err.status = 404;
            throw err;
          }
          const payAmount = amount != null ? amount : money(quote.rows[0].total, null);
          if (payAmount == null || payAmount <= 0) {
            const err = new Error('amount must be a positive number');
            err.status = 400;
            throw err;
          }
          return applyPaidQuote(client, {
            schema: schemaName,
            tenantId,
            quoteId: req.params.id,
            amount: payAmount,
            method,
            externalId: clip(req.body?.external_id, 120),
            recordedBy: req.identity.userId,
          });
        });
        let calendar = { pushed: false, reason: 'not_configured' };
        if (typeof ctx.calendar?.pushPaidBooking === 'function') {
          try {
            const { db } = await scoped(req);
            const found = await db.query(
              `SELECT q.id, q.status, q.total, q.starts_on::text AS starts_on, q.ends_on::text AS ends_on,
                      q.fulfillment, q.delivery_address, q.event_type, q.notes, q.created_by,
                      q.calendar_event_id, q.calendar_provider, c.name AS customer_name, c.email
                 FROM ${schemaName}.quotes q
                 JOIN ${schemaName}.customers c
                   ON c.id = q.customer_id AND c.tenant_id = q.tenant_id
                WHERE q.id = $1 AND q.tenant_id = $2`,
              [req.params.id, tenantId]
            );
            const row = found.rows[0];
            if (row) {
              calendar = await ctx.calendar.pushPaidBooking({
                tenantId,
                projectId: req.identity?.projectId || null,
                userId: row.created_by || req.identity?.userId,
                quote: row,
              });
            } else {
              calendar = { pushed: false, reason: 'quote_missing' };
            }
            await db.query(
              `UPDATE ${schemaName}.quotes
                  SET calendar_event_id = COALESCE($3, calendar_event_id),
                      calendar_provider = COALESCE($4, calendar_provider),
                      calendar_push_status = $5,
                      calendar_push_error = $6,
                      calendar_pushed_at = CASE WHEN $5 = 'pushed' THEN now() ELSE calendar_pushed_at END,
                      updated_at = now()
                WHERE id = $1 AND tenant_id = $2`,
              [
                req.params.id,
                tenantId,
                calendar.pushed ? calendar.eventId : null,
                calendar.pushed ? calendar.provider : null,
                calendar.pushed ? 'pushed' : 'failed',
                calendar.pushed ? null : calendar.reason || 'push_failed',
              ]
            );
          } catch (calErr) {
            req.log?.error?.({ err: calErr }, 'calendar push after paid failed');
            calendar = { pushed: false, reason: 'push_failed' };
          }
        }
        return res.status(result.alreadyPaid ? 200 : 201).json({
          payment: result.payment,
          quote: result.quote,
          calendar,
          schema: schemaName,
        });
      }

      const { schema, db } = await scoped(req);
      if (amount == null || amount <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number' });
      }
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
      if (err.status === 400 || err.status === 404 || err.status === 409) {
        return res.status(err.status).json({ error: err.message });
      }
      req.log?.error?.({ err }, 'payment create failed');
      res.status(500).json({ error: 'Failed to record payment' });
    }
  });

  return router;
}
