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

/** Run owner-role quote-store migration; ends admin pool before returning. */
export async function runQuoteStoreStartupMigration(tenantId, runtimePool) {
  if (!tenantId) {
    console.warn('quote-store startup migration skipped: TENANT_ID unset');
    return;
  }

  const needsMigrate = runtimePool
    ? await quoteStoreNeedsOwnerMigrate(runtimePool, tenantId)
    : true;

  if (!needsMigrate) {
    console.info('quote-store startup migration skipped: §1 columns already present');
    return;
  }

  if (!process.env.ADMIN_DB_PASSWORD) {
    if (needsMigrate) {
      throw new Error(
        'quote-store schema is missing §1 columns but ADMIN_DB_PASSWORD is not mounted. ' +
          'Redeploy with ADMIN_DB_PASSWORD + RESOURCE_PREFIX (see quote-service README).'
      );
    }
    console.warn(
      'quote-store startup migration skipped: ADMIN_DB_PASSWORD not mounted (schema already has §1 columns)'
    );
    return;
  }

  let pool;
  let ownerRole;
  let prefix;
  try {
    ({ pool, ownerRole, prefix } = createMigrationPool());
    const client = await pool.connect();
    try {
      try {
        await client.query(`SET ROLE ${ownerRole}`);
      } catch (setRoleErr) {
        console.warn(
          'quote-store SET ROLE owner failed; running migrate as admin',
          setRoleErr.message || setRoleErr
        );
      }
      // Column shims first; unique indexes can 23505 on legacy dupes and must not block revision.
      await ensureQuoteTables(client, tenantId, {
        ddlMode: 'migrate',
        ensureIndexes: false,
      });
      await client.query('RESET ROLE').catch(() => {});
      console.info('quote-store startup migration complete', { prefix, ownerRole });
    } finally {
      client.release();
    }
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}
