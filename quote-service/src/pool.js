/**
 * Per-query SET LOCAL app.tenant_id. Same contract as the platform
 * wrap — implemented here so this tenant app does not import platform source.
 */

export function wrapWithTenant(basePool, tenantId) {
  return {
    query: async (text, params) => {
      return withTenantTransaction(basePool, tenantId, (client) => client.query(text, params));
    },
  };
}

/** One transaction with app.tenant_id set. Use for FOR UPDATE holds. */
export async function withTenantTransaction(basePool, tenantId, fn) {
  const client = await basePool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* swallow */
    }
    throw err;
  } finally {
    client.release();
  }
}
