import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncQuoteStoreRuntimeGrants } from '../src/startupMigrate.js';

const TENANT = '987bcdaf-320d-46bf-bfb3-4bdcdffe1de1';
const SCHEMA = 't_987bcdaf320d46bfbfb34bdcdffe1de1';

describe('syncQuoteStoreRuntimeGrants', () => {
  it('GRANTs DML on all tables and sequences in the tenant schema', async () => {
    const calls = [];
    const db = {
      query: async (sql) => {
        calls.push(String(sql).replace(/\s+/g, ' ').trim());
        return { rows: [] };
      },
    };
    await syncQuoteStoreRuntimeGrants(db, TENANT, 'backend_app_runtime');
    assert.equal(calls.length, 2);
    assert.match(calls[0], new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${SCHEMA}" TO backend_app_runtime`));
    assert.match(calls[1], new RegExp(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${SCHEMA}" TO backend_app_runtime`));
  });

  it('refuses invalid tenant ids before GRANT', async () => {
    await assert.rejects(
      () => syncQuoteStoreRuntimeGrants({ query: async () => ({ rows: [] }) }, 'not-a-uuid', 'backend_app_runtime'),
      /Invalid tenant id/
    );
  });
});
