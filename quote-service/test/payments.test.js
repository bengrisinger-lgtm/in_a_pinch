import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { schemaNameFromTenantId } from '../src/schema.js';

const TENANT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SCHEMA_A = schemaNameFromTenantId(TENANT_A);
const USER_A = '11111111-1111-1111-1111-111111111111';
const QUOTE_ID = 'aaaaaaaa-0000-4000-8000-000000000099';
const HOLD_A = 'aaaaaaaa-0000-0000-0000-000000000001';

function makePool({ quoteStatus = 'draft', holdStatus = 'held', heldUntil = '2099-01-01T00:00:00.000Z' } = {}) {
  const calls = [];
  function record(sql, params) {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: compact, params: params || [] });
    return compact;
  }
  function handle(compact, params) {
    if (
      compact.startsWith('BEGIN') ||
      compact.startsWith('COMMIT') ||
      compact.startsWith('ROLLBACK') ||
      compact.startsWith('SELECT set_config') ||
      compact.startsWith('CREATE TABLE') ||
      compact.startsWith('ALTER TABLE') ||
      compact.startsWith('DROP POLICY') ||
      compact.startsWith('CREATE POLICY') ||
      compact.startsWith('CREATE INDEX')
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (compact.includes('FROM') && compact.includes('.quotes q') && compact.includes('.customers')) {
      return {
        rows: [
          {
            id: QUOTE_ID,
            status: quoteStatus,
            total: 50,
            email: 'alex@example.com',
            starts_on: '2026-09-12',
            ends_on: '2026-09-13',
            fulfillment: 'pickup',
            delivery_address: null,
            event_type: 'Wedding',
            notes: null,
            created_by: USER_A,
            calendar_event_id: null,
            customer_name: 'Alex',
          },
        ],
      };
    }
    if (compact.includes('FROM') && compact.includes('.quotes') && compact.includes('FOR UPDATE')) {
      return { rows: [{ id: QUOTE_ID, status: quoteStatus, total: 50 }] };
    }
    if (compact.includes('FROM') && compact.includes('.quotes') && compact.includes('SELECT id, status, total')) {
      return { rows: [{ id: QUOTE_ID, status: quoteStatus, total: 50 }] };
    }
    if (compact.includes('FROM') && compact.includes('.inventory_reservations') && compact.includes('FOR UPDATE')) {
      return {
        rows: [{ id: HOLD_A, status: holdStatus, held_until: heldUntil }],
      };
    }
    if (compact.includes('UPDATE') && compact.includes('inventory_reservations') && compact.includes("'confirmed'")) {
      return { rows: [], rowCount: 1 };
    }
    if (compact.includes('INSERT INTO') && compact.includes('.payments')) {
      return {
        rows: [
          {
            id: 'p0000000-0000-0000-0000-000000000001',
            amount: params[2],
            status: 'paid',
            method: params[3],
            external_id: params[4],
            created_at: '2026-09-11T00:00:00.000Z',
          },
        ],
      };
    }
    if (compact.includes('UPDATE') && compact.includes('.quotes') && compact.includes("'paid'")) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }
  return {
    calls,
    async query(sql, params) {
      return handle(record(sql, params), params || []);
    },
    async connect() {
      return {
        async query(sql, params) {
          return handle(record(sql, params), params || []);
        },
        release() {},
      };
    },
  };
}

function listen(pool, square, calendar) {
  const app = createApp({
    pool,
    allowedOrigins: ['https://hub.example.com'],
    square,
    calendar,
    verify: () => ({
      tenantId: TENANT_A,
      userId: USER_A,
      role: 'user',
      email: 'staff@example.com',
      projectId: null,
      impersonatorUserId: null,
      clientIp: '127.0.0.1',
    }),
  });
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

describe('POST /api/v1/quotes/:id/payment-link', () => {
  it('creates a Square-hosted URL from the quote total, not a client amount', async () => {
    const pool = makePool();
    const created = [];
    const { server, url } = await listen(pool, {
      async createPaymentLink(tenantId, opts) {
        created.push({ tenantId, opts });
        return { url: 'https://square.link/u/abc', id: 'plink' };
      },
    });
    const res = await fetch(`${url}/api/v1/quotes/${QUOTE_ID}/payment-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 1,
        redirect_origin: 'https://hub.example.com',
        tenant_id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.url, 'https://square.link/u/abc');
    assert.equal(body.amount_cents, 5000);
    assert.equal(created[0].tenantId, TENANT_A);
    assert.equal(created[0].opts.amountCents, 5000);
    assert.equal(created[0].opts.redirectUrl, `https://hub.example.com/#rentals?quote=${QUOTE_ID}`);
    await new Promise((r) => server.close(r));
  });

  it('503 when Square is not configured', async () => {
    const { server, url } = await listen(makePool(), undefined);
    const res = await fetch(`${url}/api/v1/quotes/${QUOTE_ID}/payment-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 503);
    await new Promise((r) => server.close(r));
  });
});

describe('POST /api/v1/quotes/:id/payments mark-paid', () => {
  it('confirms attached holds and sets quote paid', async () => {
    const pool = makePool();
    const { server, url } = await listen(pool);
    const res = await fetch(`${url}/api/v1/quotes/${QUOTE_ID}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'staff_recorded' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.quote.status, 'paid');
    assert.equal(body.calendar.pushed, false);
    assert.equal(body.calendar.reason, 'not_configured');
    assert.equal(Number(body.payment.amount), 50);
    assert.ok(
      pool.calls.some(
        (c) => c.sql.includes('inventory_reservations') && c.sql.includes("'confirmed'")
      )
    );
    await new Promise((r) => server.close(r));
  });

  it('409 when a hold is expired', async () => {
    const pool = makePool({ heldUntil: '2020-01-01T00:00:00.000Z' });
    const { server, url } = await listen(pool);
    const res = await fetch(`${url}/api/v1/quotes/${QUOTE_ID}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 409);
    await new Promise((r) => server.close(r));
  });

  it('keeps the quote paid when the calendar copy fails', async () => {
    const pool = makePool();
    const { server, url } = await listen(pool, undefined, {
      async pushPaidBooking() {
        throw new Error('graph down');
      },
    });
    const res = await fetch(`${url}/api/v1/quotes/${QUOTE_ID}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'staff_recorded' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.quote.status, 'paid');
    assert.equal(body.calendar.pushed, false);
    await new Promise((r) => server.close(r));
  });

  it('copies the paid booking onto the connected calendar after pay', async () => {
    const pool = makePool();
    const pushed = [];
    const { server, url } = await listen(pool, undefined, {
      async pushPaidBooking(input) {
        pushed.push(input);
        return { pushed: true, provider: 'outlook', eventId: 'evt-99' };
      },
    });
    const res = await fetch(`${url}/api/v1/quotes/${QUOTE_ID}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'staff_recorded' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.quote.status, 'paid');
    assert.equal(body.calendar.pushed, true);
    assert.equal(body.calendar.provider, 'outlook');
    assert.equal(pushed[0].tenantId, TENANT_A);
    assert.ok(
      pool.calls.some((c) => c.sql.includes('calendar_event_id') && c.sql.startsWith('UPDATE'))
    );
    await new Promise((r) => server.close(r));
  });
});
