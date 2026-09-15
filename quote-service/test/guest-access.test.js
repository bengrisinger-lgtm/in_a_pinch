import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { schemaNameFromTenantId } from '../src/schema.js';

const TENANT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SCHEMA_A = schemaNameFromTenantId(TENANT_A);
const GUEST_SID = '99999999-9999-4999-8999-999999999999';
const USER_A = '11111111-1111-1111-1111-111111111111';
const HOLD_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SKU_A = 's0000000-0000-0000-0000-000000000001';

function makePool() {
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
    if (compact.includes('FROM') && compact.includes('inventory_reservations') && compact.includes('FOR UPDATE')) {
      return {
        rows: [
          {
            id: HOLD_A,
            sku_id: SKU_A,
            unit_id: 'u0000000-0000-0000-0000-000000000001',
            starts_on: '2026-09-12',
            ends_on: '2026-09-13',
            status: 'held',
            held_until: '2099-01-01T00:00:00.000Z',
            sku_name: 'SM58',
            daily_rate: 25,
            serial_number: 'SN-1',
          },
        ],
        rowCount: 1,
      };
    }
    if (
      compact.includes('FROM') &&
      compact.includes('.inventory_skus s') &&
      compact.includes('ORDER BY s.name')
    ) {
      return {
        rows: [
          {
            id: SKU_A,
            name: 'SM58',
            category: 'Mics',
            description: null,
            daily_rate: 25,
            active: true,
            units_total: 1,
            units_available: 1,
            created_at: '2026-09-11T00:00:00.000Z',
          },
        ],
        rowCount: 1,
      };
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
      return {
        rows: [{ id: HOLD_A, held_until: '2099-01-01T00:00:15.000Z' }],
        rowCount: 1,
      };
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

function listen(identity) {
  const pool = makePool();
  const app = createApp({
    pool,
    verify: () => identity,
  });
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        pool,
        url: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

const guestIdentity = {
  tenantId: TENANT_A,
  userId: GUEST_SID,
  role: 'guest',
  email: '',
  projectId: 'p0000000-0000-0000-0000-000000000001',
  impersonatorUserId: null,
  clientIp: '127.0.0.1',
};

describe('IAP-G guest pinch-service access', () => {
  it('guest can list SKUs and checkout; created_by is null', async () => {
    const { server, url, pool } = await listen(guestIdentity);
    try {
      const skus = await fetch(`${url}/api/v1/quotes/inventory/skus`);
      assert.equal(skus.status, 200, await skus.text());

      const res = await fetch(`${url}/api/v1/quotes/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Alex Renter',
          email: 'alex@example.com',
          phone: '3035550100',
          fulfillment: 'pickup',
          event_type: 'Wedding',
          hold_ids: [HOLD_A],
        }),
      });
      const body = await res.json().catch(() => ({}));
      assert.equal(res.status, 201, JSON.stringify(body));
      const insert = pool.calls.find(
        (c) => c.sql.includes('INSERT INTO') && c.sql.includes('.quotes') && !c.sql.includes('quote_line')
      );
      assert.ok(insert);
      assert.equal(insert.params[0], TENANT_A);
      assert.equal(insert.params[9], null);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('guest can extend cart holds', async () => {
    const { server, url } = await listen(guestIdentity);
    try {
      const res = await fetch(`${url}/api/v1/quotes/inventory/holds/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hold_ids: [HOLD_A] }),
      });
      const body = await res.json().catch(() => ({}));
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.equal(body.holds[0].id, HOLD_A);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('guest cannot create SKUs or mark paid', async () => {
    const { server, url } = await listen(guestIdentity);
    try {
      const sku = await fetch(`${url}/api/v1/quotes/inventory/skus`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SM58', daily_rate: 25 }),
      });
      assert.equal(sku.status, 401);

      const cats = await fetch(`${url}/api/v1/quotes/inventory/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Microphones' }),
      });
      assert.equal(cats.status, 401);
      const catList = await fetch(`${url}/api/v1/quotes/inventory/categories`);
      assert.equal(catList.status, 401);

      const list = await fetch(`${url}/api/v1/quotes`);
      assert.equal(list.status, 401);

      const paid = await fetch(`${url}/api/v1/quotes/${HOLD_A}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid' }),
      });
      assert.equal(paid.status, 401);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('staff still lists quotes', async () => {
    const { server, url } = await listen({
      ...guestIdentity,
      userId: USER_A,
      role: 'user',
      email: 'staff@example.com',
    });
    try {
      const list = await fetch(`${url}/api/v1/quotes`);
      assert.equal(list.status, 200);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
