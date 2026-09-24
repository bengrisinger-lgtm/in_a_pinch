/**
 * Option 1: platform topology — owner/admin runs quote-store DDL once at
 * startup; request paths use ensureQuoteTables(..., QUOTE_DML_ONLY) only.
 * Mirrors docs-service / integrations-service createMigrationPool pattern.
 */

import pg from 'pg';
import { ensureQuoteTables } from './schema.js';

function migrationHost() {
  let dbHost = (process.env.DB_HOST || '').trim();
  if (dbHost && !dbHost.startsWith('/') && dbHost.includes(':')) {
    dbHost = `/cloudsql/${dbHost}`;
  }
  return dbHost;
}

function requireResourcePrefix() {
  const prefix = (process.env.RESOURCE_PREFIX || '').trim();
  if (!prefix || !/^[a-z][a-z0-9_]*$/.test(prefix)) {
    throw new Error('RESOURCE_PREFIX is required for quote-store startup migration');
  }
  return prefix;
}

function createMigrationPool() {
  const prefix = requireResourcePrefix();
  const user = `${prefix}_app_admin`;
  const password = process.env.ADMIN_DB_PASSWORD || process.env.DB_PASSWORD;
  if (!password) {
    throw new Error('ADMIN_DB_PASSWORD is required for quote-store startup migration');
  }
  if (!process.env.DB_NAME) {
    throw new Error('DB_NAME is required');
  }
  return {
    pool: new pg.Pool({
      host: migrationHost(),
      user,
      password,
      database: process.env.DB_NAME,
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    }),
    ownerRole: `${prefix}_app`,
  };
}

/**
 * @returns {Promise<boolean>} true if migration ran or was skipped cleanly
 */
export async function runQuoteStoreStartupMigration(tenantId) {
  if (!tenantId) {
    console.warn('quote-store startup migration skipped: TENANT_ID unset');
    return true;
  }
  if (!process.env.ADMIN_DB_PASSWORD) {
    console.warn(
      'quote-store startup migration skipped: ADMIN_DB_PASSWORD not mounted — ' +
        'catalog paths rely on dml-only; deploy with admin secret for schema shims'
    );
    return true;
  }

  let pool;
  let ownerRole;
  try {
    ({ pool, ownerRole } = createMigrationPool());
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${ownerRole}`);
      await ensureQuoteTables(client, tenantId, { ddlMode: 'migrate', ensureIndexes: true });
      await client.query('RESET ROLE');
      console.info('quote-store startup migration complete (owner role DDL)');
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('quote-store startup migration failed:', err.message || err);
    return false;
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}
