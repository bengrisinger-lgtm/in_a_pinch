import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  HOLD_TTL_CART_MINUTES,
  HOLD_TTL_SIGNING_MINUTES,
  HOLD_TTL_UNPAID_SIGNED_MINUTES,
  schemaNameFromTenantId,
} from '../src/schema.js';
import { createApp } from '../src/app.js';

const TENANT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SCHEMA_A = schemaNameFromTenantId(TENANT_A);
const USER_A = '11111111-1111-1111-1111-111111111111';
const QUOTE_ID = 'aaaaaaaa-0000-4000-8000-000000000099';

function makePool({ status = 'signing', paidBlock = false } = {}) {
  const calls = [];
  const quote = {
    id: QUOTE_ID,
    status,
    envelope_id: 'e0000000-0000-4000-8000-00000000000a',
    tenant_id: TENANT_A,
  };

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
      compact.startsWith('CREATE') ||
      compact.startsWith('ALTER') ||
      compact.startsWith('DROP POLICY')
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (compact.includes('FROM') && compact.includes('.quotes') && compact.includes('SELECT id, status')) {
      return { rows: [{ id: quote.id, status: quote.status, total: 50, envelope_id: quote.envelope_id }] };
    }
    if (compact.includes('FROM') && compact.includes('.payments')) {
      return { rows: [{ id: 'p1', amount: 50, method: 'staff_recorded', external_id: null }] };
    }
    if (compact.includes('UPDATE') && compact.includes('.inventory_reservations')) {
      return { rows: [{ id: 'r1', held_until: '2099-01-01T00:00:00.000Z' }], rowCount: 1 };
    }
    if (compact.includes('UPDATE') && compact.includes('.quotes') && compact.includes("status = 'cancelled'")) {
      if (paidBlock && quote.status === 'paid') {
        return { rows: [] };
      }
      quote.status = 'cancelled';
      return { rows: [{ id: quote.id, status: 'cancelled', envelope_id: quote.envelope_id }] };
    }
    if (compact.includes('INSERT INTO') && compact.includes('.payments')) {
      return {
        rows: [
          {
            id: 'p-refund',
            amount: params[2],
            status: 'refunded',
            method: params[3],
            external_id: params[4],
            created_at: '2026-09-13T00:00:00.000Z',
          },
        ],
      };
    }
    if (compact.includes('UPDATE') && compact.includes('.quotes') && compact.includes("status = 'awaiting_payment'")) {
      quote.status = 'awaiting_payment';
      return { rows: [{ id: quote.id, status: 'awaiting_payment' }] };
    }
    if (compact.includes('UPDATE') && compact.includes('.quotes') && compact.includes("status = 'refunded'")) {
      quote.status = 'refunded';
      return { rows: [{ id: quote.id, status: 'refunded' }] };
    }
    if (compact.includes('UPDATE') && compact.includes('.quotes')) {
      quote.customer_signing_token = params[4];
      quote.staff_signing_token = params[5];
      if (params[3]) quote.status = quote.status === 'draft' ? 'signing' : quote.status;
      return {
        rows: [
          {
            id: quote.id,
            status: quote.status,
            document_id: params[2],
            envelope_id: params[3],
            customer_signing_token: params[4],
            staff_signing_token: params[5],
          },
        ],
      };
    }
    return { rows: [], rowCount: 0 };
  }

  return {
    calls,
    quote,
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

function listen(pool) {
  const app = createApp({
    pool,
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
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

describe('hold TTL tiers and cancel', () => {
  it('uses 15 / 120 / 1440 minute tiers', () => {
    assert.equal(HOLD_TTL_CART_MINUTES, 15);
    assert.equal(HOLD_TTL_SIGNING_MINUTES, 120);
    assert.equal(HOLD_TTL_UNPAID_SIGNED_MINUTES, 1440);
  });

  it('cancels an unpaid quote and its holds', async () => {
    const pool = makePool({ status: 'signing' });
    const { server, url } = await listen(pool);
    const res = await fetch(`${url}/api/v1/quotes/${QUOTE_ID}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.quote.status, 'cancelled');
    assert.equal(body.schema, SCHEMA_A);
    const holdUpdate = pool.calls.find(
      (c) => c.sql.includes('UPDATE') && c.sql.includes('inventory_reservations') && c.sql.includes("status = 'cancelled'")
    );
    assert.ok(holdUpdate);
    await new Promise((r) => server.close(r));
  });

  it('refunds a paid quote and releases holds', async () => {
    const pool = makePool({ status: 'paid' });
    const refunds = [];
    const app = createApp({
      pool,
      square: {
        async refundPayment(tenantId, opts) {
          refunds.push({ tenantId, opts });
          return { refunded: false, reason: 'no_square_payment' };
        },
      },
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
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${url}/api/v1/quotes/${QUOTE_ID}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.quote.status, 'refunded');
    assert.equal(refunds[0].tenantId, TENANT_A);
    await new Promise((r) => server.close(r));
  });

  it('guest may POST awaiting-payment when quote is in signing', async () => {
    const pool = makePool({ status: 'signing' });
    const app = createApp({
      pool,
      verify: () => ({
        tenantId: TENANT_A,
        userId: '99999999-9999-4999-8999-999999999999',
        role: 'guest',
        email: '',
        projectId: 'p1',
        impersonatorUserId: null,
        clientIp: '127.0.0.1',
      }),
    });
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${url}/api/v1/quotes/${QUOTE_ID}/awaiting-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    await new Promise((r) => server.close(r));
  });

  it('extends holds 24 hours after renter signed (awaiting-payment), and does not re-extend', async () => {
    const pool = makePool({ status: 'signing' });
    const { server, url } = await listen(pool);
    const first = await fetch(`${url}/api/v1/quotes/${QUOTE_ID}/awaiting-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(first.status, 200);
    const extend = pool.calls.find(
      (c) => c.sql.includes('held_until = now()') && c.sql.includes("interval '1 minute'")
    );
    assert.equal(extend.params[2], 1440);
    const before = pool.calls.length;
    const second = await fetch(`${url}/api/v1/quotes/${QUOTE_ID}/awaiting-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(second.status, 200);
    const extraExtends = pool.calls
      .slice(before)
      .filter((c) => c.sql.includes('held_until = now()'));
    assert.equal(extraExtends.length, 0);
    await new Promise((r) => server.close(r));
  });

  it('stores signing tokens on PATCH and extends to 2 hours', async () => {
    const pool = makePool({ status: 'draft' });
    const { server, url } = await listen(pool);
    const res = await fetch(`${url}/api/v1/quotes/${QUOTE_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: 'd0000000-0000-4000-8000-00000000000a',
        envelope_id: 'e0000000-0000-4000-8000-00000000000a',
        customer_signing_token: 'cust-token',
        staff_signing_token: 'staff-token',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.quote.customer_signing_token, 'cust-token');
    assert.equal(body.quote.staff_signing_token, 'staff-token');
    const extend = pool.calls.find(
      (c) => c.sql.includes('held_until = now()') && c.sql.includes("interval '1 minute'")
    );
    assert.equal(extend.params[2], 120);
    await new Promise((r) => server.close(r));
  });
});
