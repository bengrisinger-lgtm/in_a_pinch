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
  const categories = {};

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

    if (compact.includes('INSERT INTO') && compact.includes('.inventory_categories')) {
      const tenantId = params[0];
      const name = params[1];
      categories[schema] = categories[schema] || [];
      if (
        categories[schema].some(
          (c) => c.tenant_id === tenantId && String(c.name).toLowerCase() === String(name).toLowerCase()
        )
      ) {
        const err = new Error('duplicate');
        err.code = '23505';
        throw err;
      }
      const row = {
        id: randomUUID(),
        tenant_id: tenantId,
        name,
        created_at: '2026-09-14T00:00:00.000Z',
      };
      categories[schema].push(row);
      return { rows: [row] };
    }

    if (compact.includes('DELETE FROM') && compact.includes('.inventory_categories')) {
      const list = categories[schema] || [];
      const idx = list.findIndex((c) => c.id === params[0] && c.tenant_id === params[1]);
      if (idx >= 0) list.splice(idx, 1);
      return { rows: [], rowCount: idx >= 0 ? 1 : 0 };
    }

    if (compact.includes('FROM') && compact.includes('.inventory_categories')) {
      const list = categories[schema] || [];
      if (compact.includes('lower(name)')) {
        const hit = list.find(
          (c) =>
            c.tenant_id === params[0] && String(c.name).toLowerCase() === String(params[1]).toLowerCase()
        );
        return { rows: hit ? [{ name: hit.name }] : [] };
      }
      if (compact.includes('WHERE id =')) {
        const hit = list.find((c) => c.id === params[0] && c.tenant_id === params[1]);
        return { rows: hit ? [{ id: hit.id, name: hit.name }] : [] };
      }
      return {
        rows: list
          .filter((c) => c.tenant_id === params[0])
          .slice()
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      };
    }

    if (
      compact.includes('count(*)::int AS n') &&
      compact.includes('.inventory_skus') &&
      compact.includes('category =')
    ) {
      const tenantId = params[0];
      const catName = params[1];
      const n = (skus[schema] || []).filter((s) => s.tenant_id === tenantId && s.category === catName).length;
      return { rows: [{ n }] };
    }

    if (compact.includes('UPDATE') && compact.includes('.inventory_categories')) {
      const list = categories[schema] || [];
      const row = list.find((c) => c.id === params[0] && c.tenant_id === params[1]);
      if (!row) return { rows: [] };
      const next = params[2];
      if (
        list.some(
          (c) =>
            c.id !== row.id &&
            c.tenant_id === row.tenant_id &&
            String(c.name).toLowerCase() === String(next).toLowerCase()
        )
      ) {
        const err = new Error('duplicate');
        err.code = '23505';
        throw err;
      }
      row.name = next;
      return { rows: [row] };
    }

    if (
      compact.includes('UPDATE') &&
      compact.includes('.inventory_skus') &&
      compact.includes("category = 'Microphones'") &&
      compact.includes("category = 'Microphone'")
    ) {
      for (const row of skus[schema] || []) {
        if (row.category === 'Microphone') row.category = 'Microphones';
      }
      return { rows: [] };
    }

    if (
      compact.includes('UPDATE') &&
      compact.includes('.inventory_skus') &&
      compact.includes('WHERE tenant_id') &&
      compact.includes('AND category =') &&
      !compact.includes('WHERE id =')
    ) {
      const tenantId = params[0];
      const oldName = params[1];
      const next = params[2];
      for (const row of skus[schema] || []) {
        if (row.tenant_id === tenantId && row.category === oldName) row.category = next;
      }
      return { rows: [] };
    }

    if (compact.includes('SELECT DISTINCT') && compact.includes('inventory_skus')) {
      const tenantId = params[0];
      const names = new Set(
        (skus[schema] || [])
          .filter((s) => s.tenant_id === tenantId && s.category)
          .map((s) => s.category)
      );
      return { rows: [...names].map((name) => ({ name })) };
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
      const minutes = Number(params[8]) || HOLD_TTL_CART_MINUTES;
      const row = {
        id: randomUUID(),
        unit_id: params[1],
        sku_id: params[2],
        quote_id: params[3],
        starts_on: params[4],
        ends_on: params[5],
        load_in_time: params[6],
        load_out_time: params[7],
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
            load_in_time: row.load_in_time,
            load_out_time: row.load_out_time,
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

    if (compact.includes('UPDATE') && compact.includes('.inventory_reservations') && compact.includes('quote_id IS NULL')) {
      const ids = Array.isArray(params[1]) ? params[1] : [];
      const minutes = Number(params[2]) || HOLD_TTL_CART_MINUTES;
      const list = reservations[schema] || [];
      const rows = [];
      for (const id of ids) {
        const row = list.find(
          (r) =>
            r.id === id &&
            r.tenant_id === params[0] &&
            r.status === 'held' &&
            !r.quote_id &&
            isBlocking(r)
        );
        if (!row) continue;
        row.held_until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
        rows.push({ id: row.id, held_until: row.held_until });
      }
      return { rows, rowCount: rows.length };
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
    categories,
    skus,
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
    assert.match(src, /now\(\) \+ \(\$9::int \* interval '1 minute'\)/);
    assert.match(src, /r\.held_until > now\(\)/);
    assert.match(src, /\/holds\/extend/);
    assert.match(src, /extendCartHolds/);
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
      body: JSON.stringify({ tenant_id: TENANT_B, name: 'SM58', category: 'Microphones', daily_rate: 25 }),
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
      body: JSON.stringify({ name: 'Sub', category: 'Microphones', daily_rate: 80 }),
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
        load_in_time: '08:00',
        load_out_time: '20:00',
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
        load_in_time: '08:00',
        load_out_time: '20:00',
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

  it('holds by sku_id and quantity (consumer add-to-cart path)', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Podium mic', category: 'Microphones', daily_rate: 12 }),
    });
    const skuId = (await skuRes.json()).sku.id;
    await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'POD-1' }),
    });
    await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'POD-2' }),
    });

    const hold = await fetch(`${urlA}/api/v1/quotes/inventory/holds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku_id: skuId,
        quantity: 2,
        starts_on: '2026-10-05',
        ends_on: '2026-10-05',
        load_in_time: '08:00',
        load_out_time: '20:00',
      }),
    });
    const holdText = await hold.text();
    assert.equal(hold.status, 201, holdText);
    const body = JSON.parse(holdText);
    assert.equal(body.holds.length, 2);
    assert.equal(body.hold_ttl_minutes, 15);
  });

  it('extends a cart hold and restarts the 15-minute window', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Extend me', category: 'Microphones', daily_rate: 12 }),
    });
    const skuId = (await skuRes.json()).sku.id;
    const u1 = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'EXT-1' }),
    });
    const unitId = (await u1.json()).unit.id;
    const hold = await fetch(`${urlA}/api/v1/quotes/inventory/holds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: unitId,
        starts_on: '2026-11-01',
        ends_on: '2026-11-01',
        load_in_time: '08:00',
        load_out_time: '20:00',
      }),
    });
    assert.equal(hold.status, 201);
    const created = await hold.json();
    const holdId = created.hold.id;

    const extended = await fetch(`${urlA}/api/v1/quotes/inventory/holds/extend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hold_ids: [holdId] }),
    });
    const extBody = await extended.json();
    assert.equal(extended.status, 200, JSON.stringify(extBody));
    assert.equal(extBody.hold_ttl_minutes, 15);
    assert.equal(extBody.holds.length, 1);
    assert.equal(extBody.holds[0].id, holdId);
    assert.ok(extBody.holds[0].held_until);

    const missing = await fetch(`${urlA}/api/v1/quotes/inventory/holds/extend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hold_ids: ['00000000-0000-0000-0000-000000000099'] }),
    });
    assert.equal(missing.status, 409);
  });

  it('rejects a load-out between 12:30 a.m. and 7:00 a.m.', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Blocked', category: 'Microphones', daily_rate: 10 }),
    });
    const skuId = (await skuRes.json()).sku.id;
    const u1 = await fetch(`${urlA}/api/v1/quotes/inventory/skus/${skuId}/units`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'BLK-1' }),
    });
    const unitId = (await u1.json()).unit.id;
    const hold = await fetch(`${urlA}/api/v1/quotes/inventory/holds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        unit_id: unitId,
        starts_on: '2026-10-01',
        ends_on: '2026-10-02',
        load_in_time: '20:00',
        load_out_time: '01:00',
      }),
    });
    assert.equal(hold.status, 400);
    const body = await hold.json();
    assert.match(body.error, /12:30/);
  });

  it('does not let an expired hold block the serial', async () => {
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Mixer', category: 'Microphones', daily_rate: 40 }),
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
        load_in_time: '08:00',
        load_out_time: '20:00',
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
      body: JSON.stringify({ name: 'Speaker', category: 'Speakers', daily_rate: 50 }),
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
      body: JSON.stringify({ name: 'Wireless', category: 'Microphones', daily_rate: 30 }),
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
      body: JSON.stringify({ name: 'Sub', category: 'Microphones', daily_rate: 80 }),
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
      body: JSON.stringify({ name: 'Held', category: 'Microphones', daily_rate: 10 }),
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
        load_in_time: '08:00',
        load_out_time: '20:00',
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
      body: JSON.stringify({ name: 'Hide me', category: 'Microphones', daily_rate: 5 }),
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

  it('requires new SKUs to use a listed category', async () => {
    const listed = await fetch(`${urlA}/api/v1/quotes/inventory/categories`);
    assert.equal(listed.status, 200);
    const first = await listed.json();
    assert.ok(first.categories.some((c) => c.name === 'Microphones'));
    assert.ok(first.categories.some((c) => c.name === 'Speakers'));

    const added = await fetch(`${urlA}/api/v1/quotes/inventory/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Fog machines' }),
    });
    assert.equal(added.status, 201);
    const created = await added.json();
    assert.equal(created.name, 'Fog machines');
    assert.ok(created.categories.some((c) => c.name === 'Fog machines'));

    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Look Solutions Unique 2', category: 'Fog machines', daily_rate: 40 }),
    });
    assert.equal(skuRes.status, 201);
    const sku = (await skuRes.json()).sku;
    assert.equal(sku.category, 'Fog machines');

    const bad = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Mystery box', category: 'Not on the list', daily_rate: 1 }),
    });
    assert.equal(bad.status, 400);
  });

  it('renames a category on every SKU that used the old label', async () => {
    await fetch(`${urlA}/api/v1/quotes/inventory/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hazers' }),
    });
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Chauvet DJ Hurricane', category: 'Hazers', daily_rate: 15 }),
    });
    const skuId = (await skuRes.json()).sku.id;
    const listed = await fetch(`${urlA}/api/v1/quotes/inventory/categories`);
    const hazer = (await listed.json()).categories.find((c) => c.name === 'Hazers');
    assert.ok(hazer);
    const renamed = await fetch(`${urlA}/api/v1/quotes/inventory/categories/${hazer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Haze machines' }),
    });
    assert.equal(renamed.status, 200);
    const skus = await fetch(`${urlA}/api/v1/quotes/inventory/skus`);
    const row = (await skus.json()).skus.find((s) => s.id === skuId);
    assert.equal(row.category, 'Haze machines');
  });

  it('corrects Microphone to Microphones on the next inventory request', async () => {
    await fetch(`${urlA}/api/v1/quotes/inventory/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Microphone' }),
    });
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'SM58 typo', category: 'Microphone', daily_rate: 15 }),
    });
    assert.equal((await skuRes.json()).sku.category, 'Microphone');
    const listed = await fetch(`${urlA}/api/v1/quotes/inventory/skus`);
    const row = (await listed.json()).skus.find((s) => s.name === 'SM58 typo');
    assert.equal(row.category, 'Microphones');
  });

  it('deletes a category and reassigns SKUs when needed', async () => {
    const added = await fetch(`${urlA}/api/v1/quotes/inventory/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Staging' }),
    });
    assert.equal(added.status, 201);
    const staging = (await added.json()).categories.find((c) => c.name === 'Staging');
    assert.ok(staging);
    const skuRes = await fetch(`${urlA}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Spare cable', category: 'Staging', daily_rate: 3 }),
    });
    assert.equal(skuRes.status, 201);
    const skuId = (await skuRes.json()).sku.id;

    const blocked = await fetch(`${urlA}/api/v1/quotes/inventory/categories/${staging.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(blocked.status, 409);

    const removed = await fetch(`${urlA}/api/v1/quotes/inventory/categories/${staging.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reassign_to: 'Microphones' }),
    });
    const removedText = await removed.text();
    assert.equal(removed.status, 200, removedText);
    const delCall = pool.calls.find((c) => c.sql.includes('DELETE') && c.sql.includes('inventory_categories'));
    assert.ok(delCall);
    assert.equal(delCall.params[0], staging.id);
    const bucket = pool.categories[SCHEMA_A] || [];
    assert.ok(!bucket.some((c) => c.id === staging.id), `mock still has: ${bucket.map((c) => c.name).join(', ')}`);
    const cats = JSON.parse(removedText).categories;
    assert.ok(!cats.some((c) => c.id === staging.id));
    const skus = await fetch(`${urlA}/api/v1/quotes/inventory/skus`);
    const row = (await skus.json()).skus.find((s) => s.id === skuId);
    assert.equal(row.category, 'Microphones');
  });
});
