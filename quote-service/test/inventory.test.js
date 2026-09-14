import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { schemaNameFromTenantId, HOLD_TTL_CART_MINUTES } from '../src/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TENANT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TENANT_B = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const SCHEMA_A = schemaNameFromTenantId(TENANT_A);
const SCHEMA_B = schemaNameFromTenantId(TENANT_B);
const USER_A = '11111111-1111-1111-1111-111111111111';

function isBlocking(row, now = Date.now()) {
  if (row.status === 'confirmed') return true;
  if (row.status === 'held' && row.held_until && Date.parse(row.held_until) > now) return true;
  return false;
}

function overlaps(row, starts, ends) {
  return row.starts_on <= ends && row.ends_on >= starts;
}

function makePool() {
  const calls = [];
  const skus = {};
  const units = {};
  const reservations = {};

  function record(sql, params) {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: compact, params: params || [] });
    return compact;
  }

  function schemaOf(compact) {
    const m = compact.match(/\b(t_[0-9a-f]{32})\./);
    return m ? m[1] : null;
  }

  function handle(compact, params) {
    const schema = schemaOf(compact);
    if (
      compact.startsWith('CREATE TABLE') ||
      compact.startsWith('ALTER TABLE') ||
      compact.startsWith('DROP POLICY') ||
      compact.startsWith('CREATE POLICY') ||
      compact.startsWith('CREATE INDEX') ||
      compact === 'BEGIN' ||
      compact === 'COMMIT' ||
      compact === 'ROLLBACK' ||
      compact.includes("set_config('app.tenant_id'")
    ) {
      return { rows: [] };
    }

    if (compact.includes('INSERT INTO') && compact.includes('.inventory_skus')) {
      const row = {
        id: randomUUID(),
        name: params[1],
        category: params[2],
        description: params[3],
        daily_rate: params[4],
        active: true,
        created_at: '2026-09-11T00:00:00.000Z',
        tenant_id: params[0],
      };
      skus[schema] = skus[schema] || [];
      skus[schema].push(row);
      return { rows: [row] };
    }

    if (compact.includes('FROM') && compact.includes('.inventory_skus') && compact.includes('SELECT id, name')) {
      const list = skus[schema] || [];
      const hit = list.find((s) => s.id === params[0] && s.tenant_id === params[1]);
      return { rows: hit ? [{ id: hit.id, name: hit.name }] : [] };
    }

    if (compact.includes('FROM') && compact.includes('.inventory_skus') && compact.includes('SELECT id FROM')) {
      const list = skus[schema] || [];
      const hit = list.find((s) => s.id === params[0] && s.tenant_id === params[1]);
      return { rows: hit ? [{ id: hit.id }] : [] };
    }

    if (compact.includes('FROM') && compact.includes('.inventory_skus')) {
      const list = (skus[schema] || []).map((s) => ({
        ...s,
        units_total: (units[schema] || []).filter((u) => u.sku_id === s.id && u.status === 'active').length,
      }));
      return { rows: list };
    }

    if (compact.includes('INSERT INTO') && compact.includes('.inventory_units')) {
      const row = {
        id: randomUUID(),
        sku_id: params[1],
        serial_number: params[2],
        nickname: params[3],
        status: 'active',
        notes: params[4],
        created_at: '2026-09-11T00:00:00.000Z',
        tenant_id: params[0],
      };
      units[schema] = units[schema] || [];
      if (units[schema].some((u) => u.sku_id === row.sku_id && u.serial_number === row.serial_number)) {
        const err = new Error('duplicate');
        err.code = '23505';
        throw err;
      }
      units[schema].push(row);
      return { rows: [row] };
    }

    if (compact.includes('FROM') && compact.includes('.inventory_units') && compact.includes('FOR UPDATE')) {
      const list = units[schema] || [];
      if (compact.includes('WHERE id =')) {
        const hit = list.find((u) => u.id === params[0] && u.tenant_id === params[1] && u.status === 'active');
        return { rows: hit ? [{ id: hit.id, sku_id: hit.sku_id, serial_number: hit.serial_number }] : [] };
      }
      const skuId = params[0];
      return {
        rows: list
          .filter((u) => u.sku_id === skuId && u.tenant_id === params[1] && u.status === 'active')
          .sort((a, b) => a.serial_number.localeCompare(b.serial_number))
          .map((u) => ({ id: u.id, sku_id: u.sku_id, serial_number: u.serial_number })),
      };
    }

    if (compact.includes('FROM') && compact.includes('.inventory_units') && compact.includes('count(*)')) {
      const n = (units[schema] || []).filter(
        (u) => u.sku_id === params[0] && u.tenant_id === params[1] && u.status === 'active'
      ).length;
      return { rows: [{ n }] };
    }

    if (compact.includes('FROM') && compact.includes('.inventory_units') && compact.includes('NOT EXISTS')) {
      const starts = params[2];
      const ends = params[3];
      const list = (units[schema] || []).filter(
        (u) => u.sku_id === params[0] && u.tenant_id === params[1] && u.status === 'active'
      );
      const rows = list.map((u) => {
        const clash = (reservations[schema] || []).some(
          (r) => r.unit_id === u.id && isBlocking(r) && overlaps(r, starts, ends)
        );
        return { id: u.id, serial_number: u.serial_number, nickname: u.nickname, available: !clash };
      });
      return { rows };
    }

    if (
      compact.includes('FROM') &&
      compact.includes('.inventory_units') &&
      !compact.includes('inventory_reservations')
    ) {
      const list = (units[schema] || []).filter((u) => u.sku_id === params[0] && u.tenant_id === params[1]);
      return { rows: list };
    }

    if (compact.includes('INSERT INTO') && compact.includes('.inventory_reservations')) {
      const minutes = Number(params[6]) || HOLD_TTL_CART_MINUTES;
      const row = {
        id: randomUUID(),
        unit_id: params[1],
        sku_id: params[2],
        quote_id: params[3],
        starts_on: params[4],
        ends_on: params[5],
        status: 'held',
        held_until: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
        tenant_id: params[0],
      };
      reservations[schema] = reservations[schema] || [];
      reservations[schema].push(row);
      return {
        rows: [
          {
            id: row.id,
            unit_id: row.unit_id,
            sku_id: row.sku_id,
            quote_id: row.quote_id,
            starts_on: row.starts_on,
            ends_on: row.ends_on,
            status: row.status,
            held_until: row.held_until,
            created_at: row.created_at,
          },
        ],
      };
    }

    if (compact.includes('FROM') && compact.includes('.inventory_reservations') && /SELECT (?:r\.)?id FROM/.test(compact) && !compact.includes('CURRENT_DATE')) {
      const unitId = params[0];
      const starts = params[2];
      const ends = params[3];
      const hit = (reservations[schema] || []).find(
        (r) => r.unit_id === unitId && r.tenant_id === params[1] && isBlocking(r) && overlaps(r, starts, ends)
      );
      return { rows: hit ? [{ id: hit.id }] : [] };
    }

    if (compact.includes('AS booked') && compact.includes('GROUP BY')) {
      const tenantId = params[0];
      const starts = params[1];
      const ends = params[2];
      const counts = {};
      for (const r of reservations[schema] || []) {
        if (r.tenant_id !== tenantId || !isBlocking(r) || !overlaps(r, starts, ends)) continue;
        const unit = (units[schema] || []).find((u) => u.id === r.unit_id);
        if (!unit) continue;
        counts[unit.sku_id] = counts[unit.sku_id] || new Set();
        counts[unit.sku_id].add(r.unit_id);
      }
      return {
        rows: Object.entries(counts).map(([sku_id, set]) => ({ sku_id, booked: set.size })),
      };
    }

    if (compact.includes('CURRENT_DATE') && compact.includes('.inventory_reservations')) {
      const today = new Date().toISOString().slice(0, 10);
      if (compact.includes('JOIN')) {
        const skuId = params[0];
        const tenantId = params[1];
        const unitIds = new Set(
          (units[schema] || []).filter((u) => u.sku_id === skuId).map((u) => u.id)
        );
        const hit = (reservations[schema] || []).find(
          (r) =>
            unitIds.has(r.unit_id) && r.tenant_id === tenantId && isBlocking(r) && r.ends_on >= today
        );
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      const hit = (reservations[schema] || []).find(
        (r) => r.unit_id === params[0] && r.tenant_id === params[1] && isBlocking(r) && r.ends_on >= today
      );
      return { rows: hit ? [{ id: hit.id }] : [] };
    }

    if (compact.includes('FROM') && compact.includes('.inventory_reservations') && compact.includes('JOIN')) {
      const skuId = params[0];
      const monthStart = params[2];
      const monthEnd = params[3];
      const unitIds = new Set(
        (units[schema] || []).filter((u) => u.sku_id === skuId).map((u) => u.id)
      );
      const rows = (reservations[schema] || []).filter(
        (r) =>
          unitIds.has(r.unit_id) &&
          r.tenant_id === params[1] &&
          isBlocking(r) &&
          r.starts_on <= monthEnd &&
          r.ends_on >= monthStart
      );
      return { rows };
    }

    if (compact.includes('UPDATE') && compact.includes('.inventory_skus')) {
      const tenantId = params[params.length - 1];
      const skuId = params[params.length - 2];
      const list = skus[schema] || [];
      const row = list.find((s) => s.id === skuId && s.tenant_id === tenantId);
      if (!row) return { rows: [] };
      let i = 0;
      if (compact.includes('name =')) row.name = params[i++];
      if (compact.includes('category =')) row.category = params[i++];
      if (compact.includes('daily_rate =')) row.daily_rate = params[i++];
      if (compact.includes('active =')) row.active = params[i++];
      row.updated_at = '2026-09-12T00:00:00.000Z';
      return { rows: [{ ...row }] };
    }

    if (compact.includes('UPDATE') && compact.includes('.inventory_units')) {
      const list = units[schema] || [];
      const row = list.find(
        (u) => u.id === params[0] && u.sku_id === params[1] && u.tenant_id === params[2]
      );
      if (!row) return { rows: [] };
      let i = 3;
      if (compact.includes('serial_number =')) {
        const next = params[i++];
        if (list.some((u) => u.id !== row.id && u.sku_id === row.sku_id && u.serial_number === next)) {
          const err = new Error('duplicate');
          err.code = '23505';
          throw err;
        }
        row.serial_number = next;
      }
      if (compact.includes('nickname =')) row.nickname = params[i++];
      if (compact.includes('status =')) row.status = params[i++];
      return {
        rows: [
          {
            id: row.id,
            sku_id: row.sku_id,
            serial_number: row.serial_number,
            nickname: row.nickname,
            status: row.status,
            notes: row.notes,
            created_at: row.created_at,
          },
        ],
      };
    }

    if (compact.includes('UPDATE') && compact.includes('.inventory_reservations') && compact.includes("status = 'confirmed'")) {
      const list = reservations[schema] || [];
      const row = list.find((r) => r.id === params[0] && r.tenant_id === params[1] && isBlocking(r) && r.status === 'held');
      if (!row) return { rows: [] };
      row.status = 'confirmed';
      row.held_until = null;
      return { rows: [{ id: row.id, unit_id: row.unit_id, sku_id: row.sku_id, starts_on: row.starts_on, ends_on: row.ends_on, status: 'confirmed' }] };
    }

    if (compact.includes('UPDATE') && compact.includes('.inventory_reservations') && compact.includes("status = 'cancelled'")) {
      const list = reservations[schema] || [];
      const row = list.find((r) => r.id === params[0] && r.tenant_id === params[1]);
      if (!row) return { rows: [] };
      row.status = 'cancelled';
      return { rows: [{ id: row.id, status: 'cancelled' }] };
    }

    return { rows: [] };
  }

  return {
    calls,
    reservations,
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
  serverB = http.createServer(mount(pool, TENANT_B, USER_A));
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

describe('serial inventory HMAC scope', () => {
  it('cart hold TTL is 15 minutes, not indefinite', () => {
    assert.equal(HOLD_TTL_CART_MINUTES, 15);
    const src = fs.readFileSync(path.join(__dirname, '../src/inventory.js'), 'utf8');
    assert.match(src, /now\(\) \+ \(\$7::int \* interval '1 minute'\)/);
    assert.match(src, /r\.held_until > now\(\)/);
    assert.match(
      src,
      /r\.status = 'confirmed'/,
      'BLOCKING must qualify reservation status — units.status makes unqualified status ambiguous on dated GET /skus'
    );
    assert.doesNotMatch(src, /COOKIE_SECRET|localStorage|jsonwebtoken/);
  });

  it('writes SKUs and serials into the HMAC tenant schema and ignores body.tenant_id', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: TENANT_B, name: 'SM58', daily_rate: 25 }),
    });
    assert.equal(skuRes.status, 201);
    const skuBody = await skuRes.json();
    assert.equal(skuBody.schema, SCHEMA_A);
    assert.equal(skuBody.sku.name, 'SM58');
    const skuId = skuBody.sku.id;

    const unitRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'SM58-001', nickname: 'this one' }),
    });
    assert.equal(unitRes.status, 201);
    const unitBody = await unitRes.json();
    assert.equal(unitBody.unit.serial_number, 'SM58-001');

    const other = await fetch(`${urlB}/api/v1/quotes/inventory/skus`);
    assert.equal(other.status, 200);
    const otherBody = await other.json();
    assert.equal(otherBody.schema, SCHEMA_B);
    assert.deepEqual(otherBody.skus, []);

    const insert = pool.calls.find((c) => c.sql.includes('INSERT INTO') && c.sql.includes('inventory_skus'));
    assert.equal(insert.params[0], TENANT_A);
  });

  it('holds a serial for two hours and rejects an overlapping hold', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sub', daily_rate: 80 }),
    });
    const skuId = (await skuRes.json()).sku.id;
    const u1 = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'SUB-1' }),
    });
    const unitId = (await u1.json()).unit.id;

    const hold = await fetch(`${urlA}/api/v1/quotes/inventory/holds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: unitId,
        starts_on: '2026-10-01',
        ends_on: '2026-10-03',
      }),
    });
    assert.equal(hold.status, 201);
    const holdBody = await hold.json();
    assert.equal(holdBody.hold_ttl_minutes, 15);
    assert.equal(holdBody.hold.status, 'held');
    assert.ok(holdBody.hold.held_until);

    const clash = await fetch(`${urlA}/api/v1/quotes/inventory/holds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: unitId,
        starts_on: '2026-10-02',
        ends_on: '2026-10-04',
      }),
    });
    assert.equal(clash.status, 409);

    const avail = await fetch(
      `${urlA}/api/v1/quotes/inventory/availability?sku_id=${skuId}&starts_on=2026-10-01&ends_on=2026-10-03`
    );
    assert.equal(avail.status, 200);
    const availBody = await avail.json();
    assert.equal(availBody.units_total, 1);
    assert.equal(availBody.units_available, 0);
    assert.equal(availBody.band, 'none');
  });

  it('does not let an expired hold block the serial', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Mixer', daily_rate: 40 }),
    });
    const skuId = (await skuRes.json()).sku.id;
    const u1 = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'MIX-1' }),
    });
    const unitId = (await u1.json()).unit.id;

    const schema = SCHEMA_A;
    pool.reservations[schema] = pool.reservations[schema] || [];
    pool.reservations[schema].push({
      id: randomUUID(),
      unit_id: unitId,
      sku_id: skuId,
      starts_on: '2026-11-01',
      ends_on: '2026-11-02',
      status: 'held',
      held_until: new Date(Date.now() - 60 * 1000).toISOString(),
      tenant_id: TENANT_A,
    });

    const avail = await fetch(
      `${urlA}/api/v1/quotes/inventory/availability?sku_id=${skuId}&starts_on=2026-11-01&ends_on=2026-11-02`
    );
    const body = await avail.json();
    assert.equal(body.units_available, 1);
    assert.equal(body.band, 'good');
  });

  it('lists SKUs with N of M available for a date range', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'SM58 Wired', category: 'Microphones', daily_rate: 15 }),
    });
    const skuId = (await skuRes.json()).sku.id;
    const u1 = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'SM58-A' }),
    });
    await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'SM58-B' }),
    });
    const unitId = (await u1.json()).unit.id;
    await fetch(`${urlA}/api/v1/quotes/inventory/holds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: unitId,
        starts_on: '2026-12-01',
        ends_on: '2026-12-02',
      }),
    });

    const listed = await fetch(
      `${urlA}/api/v1/quotes/inventory/skus?starts_on=2026-12-01&ends_on=2026-12-02`
    );
    assert.equal(listed.status, 200);
    const body = await listed.json();
    const row = body.skus.find((s) => s.id === skuId);
    assert.equal(row.units_total, 2);
    assert.equal(row.units_available, 1);
    assert.equal(row.band, 'low');
    assert.equal(body.hold_ttl_minutes, 15);
  });

  it('month calendar returns per-day bands for a SKU', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Speaker', daily_rate: 50 }),
    });
    const skuId = (await skuRes.json()).sku.id;
    await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'SPK-1' }),
    });
    const cal = await fetch(
      `${urlA}/api/v1/quotes/inventory/calendar?sku_id=${skuId}&year=2026&month=10`
    );
    assert.equal(cal.status, 200);
    const body = await cal.json();
    assert.equal(body.units_total, 1);
    assert.equal(body.days.length, 31);
    assert.equal(body.days[0].date, '2026-10-01');
    assert.equal(body.hold_ttl_minutes, 15);
  });
});

describe('retire and rotate serials', () => {
  it('renames a serial and ignores body.tenant_id', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Wireless', daily_rate: 30 }),
    });
    const skuId = (await skuRes.json()).sku.id;
    const u1 = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'OLD-1' }),
    });
    const unitId = (await u1.json()).unit.id;
    const patched = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units/${unitId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: TENANT_B, serial_number: 'NEW-1' }),
    });
    assert.equal(patched.status, 200);
    const body = await patched.json();
    assert.equal(body.unit.serial_number, 'NEW-1');
    assert.equal(body.unit.status, 'active');
  });

  it('retires a serial so it is not rentable, then restores it', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sub', daily_rate: 80 }),
    });
    const skuId = (await skuRes.json()).sku.id;
    const u1 = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'SUB-RETIRE' }),
    });
    const unitId = (await u1.json()).unit.id;
    const retired = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units/${unitId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'retired' }),
    });
    assert.equal(retired.status, 200);
    const listed = await fetch(`${urlA}/api/v1/quotes/inventory/skus`);
    const skuRow = (await listed.json()).skus.find((s) => s.id === skuId);
    assert.equal(skuRow.units_total, 0);
    const restored = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units/${unitId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    });
    assert.equal(restored.status, 200);
    const listed2 = await fetch(`${urlA}/api/v1/quotes/inventory/skus`);
    const skuRow2 = (await listed2.json()).skus.find((s) => s.id === skuId);
    assert.equal(skuRow2.units_total, 1);
  });

  it('does not retire a serial with an upcoming hold', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Held', daily_rate: 10 }),
    });
    const skuId = (await skuRes.json()).sku.id;
    const u1 = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'HELD-1' }),
    });
    const unitId = (await u1.json()).unit.id;
    const hold = await fetch(`${urlA}/api/v1/quotes/inventory/holds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: unitId,
        starts_on: '2026-12-01',
        ends_on: '2026-12-03',
      }),
    });
    assert.equal(hold.status, 201);
    const retired = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units/${unitId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'retired' }),
    });
    assert.equal(retired.status, 409);
  });

  it('hides a SKU from the catalog without deleting rows', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hide me', daily_rate: 5 }),
    });
    const skuId = (await skuRes.json()).sku.id;
    const hidden = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: TENANT_B, active: false }),
    });
    assert.equal(hidden.status, 200);
    const body = await hidden.json();
    assert.equal(body.sku.active, false);
    const other = await fetch(`${urlB}/api/v1/quotes/inventory/skus/${skuId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    assert.equal(other.status, 404);
  });
});
