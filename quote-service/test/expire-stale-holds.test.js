import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { expireStaleHolds, schemaNameFromTenantId } from '../src/schema.js';

const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SCHEMA = schemaNameFromTenantId(TENANT);

describe('expireStaleHolds', () => {
  it('cancels expired held rows and cancels unpaid quotes with no active holds', async () => {
    const calls = [];
    const db = {
      async query(sql, params) {
        calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        return { rows: [], rowCount: 0 };
      },
    };
    await expireStaleHolds(db, SCHEMA, TENANT);
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /status = 'cancelled'/);
    assert.match(calls[0].sql, /held_until <= now\(\)/);
    assert.match(calls[1].sql, /UPDATE .*\.quotes/);
    assert.match(calls[1].sql, /status = 'cancelled'/);
    assert.match(calls[1].sql, /bool_and\(status = 'cancelled'\)/);
    assert.match(calls[1].sql, /status NOT IN \('paid', 'cancelled', 'refunded'\)/);
  });
});
