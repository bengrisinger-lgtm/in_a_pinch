import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { schemaNameFromTenantId, ensureQuoteTables } from '../src/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSrc = fs.readFileSync(path.join(__dirname, '../src/schema.js'), 'utf8');
const TENANT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TENANT_B = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const SCHEMA_A = schemaNameFromTenantId(TENANT_A);
const SCHEMA_B = schemaNameFromTenantId(TENANT_B);
const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

function makePool() {
  const calls = [];
  const customers = {};
  const quotes = {};

  function record(sql, params) {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: compact, params: params || [] });
    return compact;
  }

  function handle(compact, params) {
    const schemaMatch = compact.match(/\b(t_[0-9a-f]{32})\./);
    const schema = schemaMatch ? schemaMatch[1] : null;

    if (compact.startsWith('CREATE TABLE') || compact.startsWith('ALTER TABLE') || compact.startsWith('DROP POLICY') || compact.startsWith('CREATE POLICY')) {
      return { rows: [] };
    }
    if (compact.includes('INSERT INTO') && compact.includes('.customers')) {
      const row = {
        id: 'c0000000-0000-0000-0000-000000000001',
        name: params[1],
        first_name: params[2],
        last_name: params[3],
        email: params[4],
        phone: params[5],
        billing_address: params[6],
        site_address: params[7],
        user_id: null,
        created_at: '2026-09-10T00:00:00.000Z',
        updated_at: '2026-09-10T00:00:00.000Z',
        tenant_id: params[0],
      };
      customers[schema] = customers[schema] || [];
      customers[schema].push(row);
      return { rows: [row] };
    }
    if (compact.includes('FROM') && compact.includes('.customers') && compact.includes('SELECT id FROM')) {
      const list = customers[schema] || [];
      const hit = list.find((c) => c.id === params[0] && c.tenant_id === params[1]);
      return { rows: hit ? [{ id: hit.id }] : [] };
    }
    if (compact.includes('FROM') && compact.includes('.customers')) {
      return { rows: customers[schema] || [] };
    }
    if (compact.includes('INSERT INTO') && compact.includes('.quotes') && !compact.includes('quote_line')) {
      const row = {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        customer_id: params[1],
        status: 'draft',
        notes: params[2],
        document_id: params[10],
        envelope_id: params[11],
        delivery_address: params[3],
        delivery_miles: params[4],
        drive_minutes: params[5],
        delivery_fee: params[6],
        subtotal: params[7],
        total: params[8],
        created_at: '2026-09-10T00:00:00.000Z',
        tenant_id: params[0],
      };
      quotes[schema] = quotes[schema] || [];
      quotes[schema].push(row);
      return { rows: [row] };
    }
    if (compact.includes('INSERT INTO') && compact.includes('quote_line_items')) {
      return { rows: [] };
    }
    if (compact.startsWith('UPDATE') && compact.includes('.quotes')) {
      const list = quotes[schema] || [];
      const hit = list.find((q) => q.id === params[0] && q.tenant_id === params[1]);
      if (!hit) return { rows: [] };
      if (params[2]) hit.document_id = params[2];
      if (params[3]) hit.envelope_id = params[3];
      return { rows: [{ ...hit }] };
    }
    if (compact.includes('FROM') && compact.includes('.quotes') && compact.includes('SELECT id FROM')) {
      const list = quotes[schema] || [];
      const hit = list.find((q) => q.id === params[0] && q.tenant_id === params[1]);
      return { rows: hit ? [{ id: hit.id }] : [] };
    }
    if (compact.includes('FROM') && compact.includes('.quotes')) {
      return { rows: quotes[schema] || [] };
    }
    if (compact.includes('INSERT INTO') && compact.includes('.payments')) {
      return {
        rows: [
          {
            id: 'p0000000-0000-0000-0000-000000000001',
            amount: params[2],
            status: params[3],
            method: params[4],
            external_id: params[5],
            created_at: '2026-09-10T00:00:00.000Z',
          },
        ],
      };
    }
    return { rows: [] };
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

function identityFor(tenantId, userId) {
  return {
    tenantId,
    userId,
    role: 'admin',
    email: 'staff@example.com',
    projectId: null,
    impersonatorUserId: null,
    clientIp: '127.0.0.1',
  };
}

function mount(pool, tenantId, userId) {
  return createApp({
    pool,
    verify: () => identityFor(tenantId, userId),
    allowedOrigins: [],
  });
}

let pool;
let serverA;
let serverB;
let urlA;
let urlB;

before(async () => {
  pool = makePool();
  serverA = http.createServer(mount(pool, TENANT_A, USER_A));
  serverB = http.createServer(mount(pool, TENANT_B, USER_B));
  await Promise.all([
    new Promise((r) => serverA.listen(0, '127.0.0.1', r)),
    new Promise((r) => serverB.listen(0, '127.0.0.1', r)),
  ]);
  urlA = `http://127.0.0.1:${serverA.address().port}`;
  urlB = `http://127.0.0.1:${serverB.address().port}`;
});

after(async () => {
  await Promise.all([
    new Promise((r) => serverA.close(r)),
    new Promise((r) => serverB.close(r)),
  ]);
});

describe('quote store HMAC scope', () => {
  it('writes customers into the HMAC tenant schema and ignores body.tenant_id', async () => {
    const res = await fetch(`${urlA}/api/v1/quotes/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_B,
        name: 'Ada',
        email: 'ada@example.com',
        site_address: '100 Event Rd',
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.schema, SCHEMA_A);
    assert.equal(body.customer.email, 'ada@example.com');
    const insert = pool.calls.find((c) => c.sql.includes('INSERT INTO') && c.sql.includes('customers'));
    assert.match(insert.sql, new RegExp(`INSERT INTO ${SCHEMA_A}\\.customers`));
    assert.equal(insert.params[0], TENANT_A);
    assert.doesNotMatch(insert.sql, new RegExp(SCHEMA_B));
  });

  it("does not list another tenant's customers", async () => {
    const res = await fetch(`${urlB}/api/v1/quotes/customers`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.schema, SCHEMA_B);
    assert.deepEqual(body.customers, []);
  });

  it('creates a quote with kit UUID columns and delivery fields', async () => {
    const res = await fetch(`${urlA}/api/v1/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: 'c0000000-0000-0000-0000-000000000001',
        delivery_address: '100 Event Rd',
        delivery_miles: 12,
        drive_minutes: 20,
        delivery_fee: 80,
        document_id: 'd0000000-0000-0000-0000-000000000001',
        envelope_id: null,
        line_items: [{ description: 'Speaker', quantity: 2, unit_price: 50 }],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.schema, SCHEMA_A);
    assert.equal(Number(body.quote.subtotal), 100);
    assert.equal(Number(body.quote.total), 180);
    assert.equal(body.quote.document_id, 'd0000000-0000-0000-0000-000000000001');
    const qInsert = pool.calls.find((c) => c.sql.includes('INSERT INTO') && c.sql.includes('.quotes') && !c.sql.includes('quote_line'));
    assert.match(qInsert.sql, new RegExp(`INSERT INTO ${SCHEMA_A}\\.quotes`));
    assert.ok(qInsert.sql.includes('document_id'));
    assert.ok(qInsert.sql.includes('envelope_id'));
  });

  it('stores kit envelope UUIDs on PATCH and ignores body.tenant_id', async () => {
    const quoteId = 'aaaaaaaa-0000-4000-8000-000000000001';
    const documentId = 'd0000000-0000-4000-8000-00000000000a';
    const envelopeId = 'e0000000-0000-4000-8000-00000000000a';
    const res = await fetch(`${urlA}/api/v1/quotes/${quoteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: TENANT_B,
        document_id: documentId,
        envelope_id: envelopeId,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.schema, SCHEMA_A);
    assert.equal(body.quote.document_id, documentId);
    assert.equal(body.quote.envelope_id, envelopeId);
    const update = pool.calls.find(
      (c) =>
        c.sql.includes('UPDATE') &&
        c.sql.includes('.quotes') &&
        c.sql.includes('document_id = COALESCE')
    );
    assert.ok(update, 'PATCH quote UPDATE must be present');
    assert.match(update.sql, new RegExp(`UPDATE ${SCHEMA_A}\\.quotes`));
    assert.equal(update.params[0], quoteId);
    assert.equal(update.params[1], TENANT_A);
    assert.equal(update.params[2], documentId);
    assert.equal(update.params[3], envelopeId);
    assert.equal(update.params.includes(TENANT_B), false);
  });

  it('rejects PATCH without kit UUIDs', async () => {
    const res = await fetch(`${urlA}/api/v1/quotes/aaaaaaaa-0000-4000-8000-000000000001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: TENANT_A }),
    });
    assert.equal(res.status, 400);
  });

  it("does not attach another tenant's quote envelope", async () => {
    const res = await fetch(`${urlB}/api/v1/quotes/aaaaaaaa-0000-4000-8000-000000000001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_id: 'd0000000-0000-4000-8000-00000000000b',
        envelope_id: 'e0000000-0000-4000-8000-00000000000b',
      }),
    });
    assert.equal(res.status, 404);
  });
});

describe('ensureQuoteTables', () => {
  it('ddlMode dml-only issues no DDL', async () => {
    const calls = [];
    const db = {
      async query(sql) {
        calls.push(String(sql));
        return { rows: [] };
      },
    };
    const { schema } = await ensureQuoteTables(db, TENANT_A, { ddlMode: 'dml-only' });
    assert.equal(schema, SCHEMA_A);
    assert.ok(!calls.some((c) => /CREATE TABLE|ALTER TABLE|CREATE POLICY|CREATE INDEX/i.test(c)));
  });

  it('FORCE RLS on customers quotes line items payments in t_<hex>', async () => {
    const calls = [];
    const db = {
      async query(sql) {
        const compact = String(sql).replace(/\s+/g, ' ').trim();
        calls.push(compact);
        if (compact.includes('pg_get_userbyid')) {
          return { rows: [{ owns: true }] };
        }
        if (compact.includes('relrowsecurity')) {
          return { rows: [{ rls: false, forced: false }] };
        }
        if (compact.includes('pg_policies')) {
          return { rows: [] };
        }
        if (compact.includes('information_schema.tables')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
    const { schema } = await ensureQuoteTables(db, TENANT_A);
    assert.equal(schema, SCHEMA_A);
    const sql = calls.join('\n');
    for (const t of [
      'customers',
      'quotes',
      'quote_line_items',
      'payments',
      'staff_members',
      'staff_profiles',
      'staff_profile_field_defs',
      'inventory_skus',
      'inventory_units',
      'inventory_categories',
      'inventory_reservations',
    ]) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${SCHEMA_A}\\.${t}`));
      assert.match(sql, new RegExp(`ALTER TABLE ${SCHEMA_A}\\.${t} FORCE ROW LEVEL SECURITY`));
    }
    assert.match(sql, /UNIQUE \(tenant_id, sku_id, serial_number\)/);
    assert.match(sql, /inventory_categories_name_uidx/);
    assert.match(sql, /category = 'Microphones'/);
    assert.match(sql, /held_until TIMESTAMPTZ/);
    assert.match(sql, /calendar_event_id TEXT/);
    assert.match(sql, /customer_signing_token TEXT/);
    assert.match(sql, /staff_signing_token TEXT/);
    assert.match(sql, /payment_link_url TEXT/);
    assert.match(sql, /tenant_id UUID NOT NULL/);
    assert.doesNotMatch(sql, /quote_access_tokens/);
    assert.match(sql, /inventory_skus[\s\S]*ADD COLUMN IF NOT EXISTS updated_at/);
  });

  it('does not DROP RLS policies on every inventory request', () => {
    assert.doesNotMatch(schemaSrc, /DROP POLICY IF EXISTS tenant_isolation/);
    assert.match(schemaSrc, /42710/);
  });
});

describe('auth and source pins', () => {
  it('rejects a request with no HMAC identity', async () => {
    const app = createApp({
      pool: makePool(),
      verify: () => null,
    });
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${url}/api/v1/quotes/customers`);
    assert.equal(res.status, 401);
    await new Promise((r) => server.close(r));
  });

  it('does not import COOKIE_SECRET or live in console-service', () => {
    const idx = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
    assert.match(idx, /createServerClient/);
    assert.match(idx, /HMAC_SECRET/);
    assert.match(idx, /COOKIE_SECRET must not be mounted/);
    const routes = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
    assert.match(routes, /payment-link/);
    assert.match(routes, /router\.patch\('\/:id'/);
    assert.match(routes, /\/:id\/cancel/);
    assert.match(routes, /awaiting-payment/);
    assert.match(routes, /HOLD_TTL_SIGNING_MINUTES/);
    assert.match(routes, /calendar_event_id|pushPaidBooking/);
    assert.doesNotMatch(routes, /localStorage|jsonwebtoken|COOKIE_SECRET|TOKEN_ENCRYPTION_KEY/);
    assert.doesNotMatch(idx, /TOKEN_ENCRYPTION_KEY/);
  });
});
