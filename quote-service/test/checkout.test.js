import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { schemaNameFromTenantId } from '../src/schema.js';

const TENANT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SCHEMA_A = schemaNameFromTenantId(TENANT_A);
const USER_A = '11111111-1111-1111-1111-111111111111';
const HOLD_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const HOLD_B = 'bbbbbbbb-0000-0000-0000-000000000002';

function makePool({
  holdStatus = 'held',
  heldUntil = '2099-01-01T00:00:00.000Z',
  loadIn = '08:00:00',
  loadOut = '20:00:00',
} = {}) {
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
      compact.startsWith('SELECT set_config')
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (
      compact.startsWith('CREATE TABLE') ||
      compact.startsWith('ALTER TABLE') ||
      compact.startsWith('DROP POLICY') ||
      compact.startsWith('CREATE POLICY') ||
      compact.startsWith('CREATE INDEX')
    ) {
      return { rows: [], rowCount: 0 };
    }
    if (compact.includes('FROM') && compact.includes('inventory_reservations') && compact.includes('FOR UPDATE')) {
      const ids = params[1] || [];
      const rows = ids.map((id, i) => ({
        id,
        sku_id: 's0000000-0000-0000-0000-000000000001',
        unit_id: `u0000000-0000-0000-0000-00000000000${i + 1}`,
        starts_on: '2026-09-12',
        ends_on: '2026-09-13',
        load_in_time: loadIn,
        load_out_time: loadOut,
        status: holdStatus,
        held_until: heldUntil,
        sku_name: 'SM58',
        daily_rate: 25,
        serial_number: `SN-${i + 1}`,
      }));
      return { rows, rowCount: rows.length };
    }
    if (compact.includes('FROM') && compact.includes('.customers') && compact.includes('lower(email)')) {
      return { rows: [], rowCount: 0 };
    }
    if (compact.includes('INSERT INTO') && compact.includes('.customers')) {
      return {
        rows: [
          {
            id: 'c0000000-0000-0000-0000-000000000001',
            name: params[1],
            email: params[2],
            phone: params[3],
            billing_address: params[4],
            site_address: params[5],
            user_id: null,
            created_at: '2026-09-11T00:00:00.000Z',
          },
        ],
        rowCount: 1,
      };
    }
    if (compact.includes('INSERT INTO') && compact.includes('.quotes') && !compact.includes('quote_line')) {
      return {
        rows: [
          {
            id: 'q0000000-0000-0000-0000-000000000001',
            customer_id: params[1],
            status: 'draft',
            notes: params[2],
            document_id: null,
            envelope_id: null,
            delivery_address: params[3],
            delivery_miles: params[4],
            drive_minutes: params[5],
            delivery_fee: params[6],
            subtotal: params[7],
            total: params[8],
            fulfillment: params[10],
            event_type: params[11],
            starts_on: '2026-09-12',
            ends_on: '2026-09-13',
            load_in_time: params[14],
            load_out_time: params[15],
            created_at: '2026-09-11T00:00:00.000Z',
          },
        ],
        rowCount: 1,
      };
    }
    if (compact.includes('INSERT INTO') && compact.includes('quote_line_items')) {
      return { rows: [], rowCount: 1 };
    }
    if (compact.includes('UPDATE') && compact.includes('inventory_reservations')) {
      return { rows: [], rowCount: (params[2] || []).length };
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

describe('POST /api/v1/quotes/checkout', () => {
  it('pickup quote: delivery_fee 0, holds attached, ignores body.tenant_id', async () => {
    const pool = makePool();
    const { server, url } = await listen(pool);
    const res = await fetch(`${url}/api/v1/quotes/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
        name: 'Alex Renter',
        email: 'alex@example.com',
        phone: '3035550100',
        fulfillment: 'pickup',
        event_type: 'Wedding',
        hold_ids: [HOLD_A, HOLD_B],
        delivery_fee: 0,
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.schema, SCHEMA_A);
    assert.equal(Number(body.quote.delivery_fee), 0);
    assert.equal(body.quote.fulfillment, 'pickup');
    assert.equal(body.renter_magic_link, null);
    assert.match(body.hold_ttl_note, /15 minutes/);
    assert.match(body.hold_ttl_note, /2 hours/);
    assert.match(body.hold_ttl_note, /24 hours/);
    const insert = pool.calls.find((c) => c.sql.includes('INSERT INTO') && c.sql.includes('.quotes') && !c.sql.includes('quote_line'));
    assert.equal(insert.params[0], TENANT_A);
    await new Promise((r) => server.close(r));
  });

  it('bills 8 p.m. load-in to 9 a.m. load-out as one day', async () => {
    const pool = makePool({ loadIn: '20:00:00', loadOut: '09:00:00' });
    const { server, url } = await listen(pool);
    const res = await fetch(`${url}/api/v1/quotes/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Renter',
        email: 'alex@example.com',
        fulfillment: 'pickup',
        hold_ids: [HOLD_A, HOLD_B],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(Number(body.quote.subtotal), 50);
    assert.equal(body.quote.load_in_time, '20:00');
    assert.equal(body.quote.load_out_time, '09:00');
    await new Promise((r) => server.close(r));
  });

  it('delivery quote: server computes 4-leg fee, not a client delivery_fee', async () => {
    const pool = makePool();
    const { server, url } = await listen(pool);
    const res = await fetch(`${url}/api/v1/quotes/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Renter',
        email: 'alex@example.com',
        fulfillment: 'delivery',
        delivery_address: '100 Event Rd, Denver, CO',
        one_way_miles: 10,
        one_way_minutes: 20,
        delivery_fee: 1,
        hold_ids: [HOLD_A],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(Number(body.quote.delivery_fee), 66.4);
    assert.equal(body.quote.delivery_address, '100 Event Rd, Denver, CO');
    await new Promise((r) => server.close(r));
  });

  it('rejects expired holds', async () => {
    const pool = makePool({ heldUntil: '2020-01-01T00:00:00.000Z' });
    const { server, url } = await listen(pool);
    const res = await fetch(`${url}/api/v1/quotes/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Renter',
        email: 'alex@example.com',
        fulfillment: 'pickup',
        hold_ids: [HOLD_A],
      }),
    });
    assert.equal(res.status, 409);
    await new Promise((r) => server.close(r));
  });
});
