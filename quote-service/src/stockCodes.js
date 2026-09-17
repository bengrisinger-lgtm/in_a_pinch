/**
 * Tenant unit stock codes: PREFIX-0001 (3-char prefix, 4-digit sequence per prefix).
 */

export function normalizeStockPrefix(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 3) return null;
  return s;
}

export function formatStockCode(prefix, seq) {
  const n = Number(seq);
  if (!Number.isFinite(n) || n < 1 || n > 9999) {
    const err = new Error('stock sequence out of range');
    err.status = 500;
    throw err;
  }
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

/** Allocate the next code for tenant+prefix inside an open transaction (client). */
export async function allocateStockCode(client, schema, tenantId, rawPrefix) {
  const prefix = normalizeStockPrefix(rawPrefix);
  if (!prefix) {
    const err = new Error('stock prefix must be exactly 3 letters or numbers');
    err.status = 400;
    throw err;
  }
  const bump = await client.query(
    `UPDATE ${schema}.inventory_stock_sequences
        SET next_number = next_number + 1
      WHERE tenant_id = $1 AND prefix = $2
      RETURNING next_number - 1 AS n`,
    [tenantId, prefix]
  );
  if (bump.rows[0]) {
    return formatStockCode(prefix, bump.rows[0].n);
  }
  try {
    await client.query(
      `INSERT INTO ${schema}.inventory_stock_sequences (tenant_id, prefix, next_number)
       VALUES ($1, $2, 2)`,
      [tenantId, prefix]
    );
    return formatStockCode(prefix, 1);
  } catch (err) {
    if (err?.code !== '23505') throw err;
    const retry = await client.query(
      `UPDATE ${schema}.inventory_stock_sequences
          SET next_number = next_number + 1
        WHERE tenant_id = $1 AND prefix = $2
        RETURNING next_number - 1 AS n`,
      [tenantId, prefix]
    );
    if (!retry.rows[0]) throw err;
    return formatStockCode(prefix, retry.rows[0].n);
  }
}

export async function categoryStockPrefix(db, schema, tenantId, categoryName) {
  if (!categoryName) return null;
  const { rows } = await db.query(
    `SELECT stock_prefix FROM ${schema}.inventory_categories
      WHERE tenant_id = $1 AND lower(name) = lower($2)
      LIMIT 1`,
    [tenantId, categoryName]
  );
  const p = rows[0]?.stock_prefix;
  return p ? normalizeStockPrefix(p) || p : null;
}

export async function assertUniqueCategoryPrefix(db, schema, tenantId, prefix, exceptCategoryId) {
  const p = normalizeStockPrefix(prefix);
  if (!p) {
    const err = new Error('stock prefix must be exactly 3 letters or numbers');
    err.status = 400;
    throw err;
  }
  const { rows } = await db.query(
    `SELECT id, name FROM ${schema}.inventory_categories
      WHERE tenant_id = $1 AND stock_prefix IS NOT NULL AND lower(stock_prefix) = lower($2)
        AND ($3::uuid IS NULL OR id <> $3)
      LIMIT 1`,
    [tenantId, p, exceptCategoryId || null]
  );
  if (rows[0]) {
    const err = new Error(`Stock prefix ${p} is already used by category “${rows[0].name}”.`);
    err.status = 409;
    throw err;
  }
  return p;
}
