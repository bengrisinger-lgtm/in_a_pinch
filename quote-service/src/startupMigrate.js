/**
 * Quote-store DDL at startup only (platform pattern: short-lived admin pool,
 * ended before HTTP listen — see integrations-service / sign-service index.js
 * and syml-platform/shared/db-pools.cjs createMigrationPool).
 * Request paths use ensureQuoteTables(..., QUOTE_DML_ONLY) only.
 */

import pg from 'pg';
import { ensureQuoteTables, schemaNameFromTenantId } from './schema.js';
import { resolveResourcePrefix } from './resourcePrefix.js';

function migrationHost() {
  let dbHost = (process.env.DB_HOST || '').trim();
  if (dbHost && !dbHost.startsWith('/') && dbHost.includes(':')) {
    dbHost = `/cloudsql/${dbHost}`;
  }
  return dbHost;
}

function createMigrationPool() {
  const prefix = resolveResourcePrefix();
  const user = `${prefix}_app_admin`;
  const password = process.env.ADMIN_DB_PASSWORD || process.env.DB_PASSWORD;
  if (!password) {
    throw new Error(
      'createMigrationPool: ADMIN_DB_PASSWORD or DB_PASSWORD env var is required'
    );
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
    prefix,
  };
}

async function tenantTableHasColumn(db, schemaName, tableName, columnName) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND column_name = $3
      LIMIT 1`,
    [schemaName, tableName, columnName]
  );
  return rows.length > 0;
}

/** Columns guest catalog SQL expects after §1 shims. */
export async function quoteStoreNeedsOwnerMigrate(db, tenantId) {
  const schemaName = schemaNameFromTenantId(tenantId);
  const { rows: skuTable } = await db.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = 'inventory_skus'`,
    [schemaName]
  );
  if (!skuTable.length) return false;
  const required = [
    ['inventory_reservations', 'quote_id'],
    ['inventory_reservations', 'held_until'],
    ['inventory_skus', 'description'],
    ['inventory_skus', 'image_url'],
  ];
  for (const [table, col] of required) {
    if (!(await tenantTableHasColumn(db, schemaName, table, col))) {
      return true;
    }
  }
  return false;
}

/**
 * After console-service secureTables(), IAP tables in t_* are owned by the owner
 * role. DEFAULT PRIVILEGES do not backfill existing tables — runtime needs an
 * explicit GRANT or guest/staff SELECT returns 42501 even when §1 shims exist.
 */
export async function syncQuoteStoreRuntimeGrants(db, tenantId, runtimeRole) {
  const schemaName = schemaNameFromTenantId(tenantId);
  if (!/^t_[0-9a-f]{32}$/.test(schemaName)) {
    throw new Error(`refusing grant sync for non-tenant schema ${schemaName}`);
  }
  const schema = `"${schemaName}"`;
  await db.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${runtimeRole}`
  );
  await db.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${runtimeRole}`
  );
}

/** Run owner-role quote-store migration; ends admin pool before returning. */
export async function runQuoteStoreStartupMigration(tenantId, runtimePool) {
  if (!tenantId) {
    console.warn('quote-store startup migration skipped: TENANT_ID unset');
    return;
  }

  const needsMigrate = runtimePool
    ? await quoteStoreNeedsOwnerMigrate(runtimePool, tenantId)
    : true;

  if (!process.env.ADMIN_DB_PASSWORD) {
    if (needsMigrate) {
      throw new Error(
        'quote-store schema is missing §1 columns but ADMIN_DB_PASSWORD is not mounted. ' +
          'Redeploy with ADMIN_DB_PASSWORD + RESOURCE_PREFIX (see quote-service README).'
      );
    }
    console.info('quote-store startup migration skipped: §1 columns already present');
    console.warn(
      'quote-store runtime grant sync skipped: ADMIN_DB_PASSWORD not mounted (42501 risk on owner-owned tables)'
    );
    return;
  }

  let pool;
  let ownerRole;
  let prefix;
  try {
    ({ pool, ownerRole, prefix } = createMigrationPool());
    const runtimeRole = `${prefix}_app_runtime`;
    const client = await pool.connect();
    try {
      try {
        await client.query(`SET ROLE ${ownerRole}`);
      } catch (setRoleErr) {
        console.warn(
          'quote-store SET ROLE owner failed; running owner tasks as admin',
          setRoleErr.message || setRoleErr
        );
      }
      await syncQuoteStoreRuntimeGrants(client, tenantId, runtimeRole);
      console.info('quote-store runtime grants synced', {
        prefix,
        schema: schemaNameFromTenantId(tenantId),
        runtimeRole,
      });

      if (needsMigrate) {
        // Column shims; unique indexes can 23505 on legacy dupes and must not block revision.
        await ensureQuoteTables(client, tenantId, {
          ddlMode: 'migrate',
          ensureIndexes: false,
        });
        console.info('quote-store startup migration complete', { prefix, ownerRole });
      } else {
        console.info('quote-store startup migration skipped: §1 columns already present');
      }
      await client.query('RESET ROLE').catch(() => {});
    } finally {
      client.release();
    }
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}
