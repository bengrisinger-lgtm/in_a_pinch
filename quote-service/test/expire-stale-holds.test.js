import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expireStaleHolds, schemaNameFromTenantId } from '../src/schema.js';

const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SCHEMA = schemaNameFromTenantId(TENANT);

function mockDb({
  reservationColumns = new Set(['status', 'held_until', 'quote_id']),
} = {}) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params) {
      const s = String(sql);
      if (s.includes('information_schema.columns')) {
        const table = params[1];
        const col = params[2];
        const hit =
          table === 'inventory_reservations' && reservationColumns.has(col);
        return hit ? { rows: [{ '1': 1 }] } : { rows: [] };
      }
      calls.push({ sql: s.replace(/\s+/g, ' ').trim(), params });
      return { rows: [], rowCount: 0 };
    },
  };
  return db;
}

describe('expireStaleHolds', () => {
  it('cancels expired held rows and cancels unpaid quotes with no active holds', async () => {
    const db = mockDb();
    await expireStaleHolds(db, SCHEMA, TENANT);
    assert.equal(db.calls.length, 2);
    assert.match(db.calls[0].sql, /status = 'cancelled'/);
    assert.match(db.calls[0].sql, /held_until <= now\(\)/);
    assert.match(db.calls[1].sql, /UPDATE .*\.quotes/);
    assert.match(db.calls[1].sql, /status = 'cancelled'/);
    assert.match(db.calls[1].sql, /bool_and\(status = 'cancelled'\)/);
    assert.match(db.calls[1].sql, /status NOT IN \('paid', 'cancelled', 'refunded'\)/);
  });

  it('skips quote cancellation when quote_id column is not migrated yet', async () => {
    const db = mockDb({ reservationColumns: new Set(['status', 'held_until']) });
    await expireStaleHolds(db, SCHEMA, TENANT);
    assert.equal(db.calls.length, 1);
    assert.match(db.calls[0].sql, /inventory_reservations/);
  });

  it('does not throw on 42501 (guest catalog must keep reading SKUs)', async () => {
    const db = mockDb();
    db.query = async (sql) => {
      const s = String(sql);
      if (s.includes('information_schema.columns')) {
        return { rows: [{ '1': 1 }] };
      }
      const err = new Error('permission denied for table quotes');
      err.code = '42501';
      throw err;
    };
    await expireStaleHolds(db, SCHEMA, TENANT);
  });
});
