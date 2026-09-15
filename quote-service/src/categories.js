/**
 * Staff-typed inventory categories. SKUs keep a category text;
 * this table is the growing drop-menu. HMAC tenant only.
 */

const NAME_MAX = 200;

export const STARTER_CATEGORIES = [
  'Microphones',
  'Speakers',
  'Projectors',
  'Lighting',
  'Mixers',
];

function clipName(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  return s.slice(0, NAME_MAX);
}

export async function upsertCategory(db, schema, tenantId, rawName) {
  const name = clipName(rawName);
  if (!name) return null;
  const existing = await db.query(
    `SELECT name FROM ${schema}.inventory_categories
      WHERE tenant_id = $1 AND lower(name) = lower($2)
      LIMIT 1`,
    [tenantId, name]
  );
  if (existing.rows[0]) return existing.rows[0].name;
  try {
    await db.query(
      `INSERT INTO ${schema}.inventory_categories (tenant_id, name)
       VALUES ($1, $2)`,
      [tenantId, name]
    );
    return name;
  } catch (err) {
    if (err?.code !== '23505') throw err;
    const again = await db.query(
      `SELECT name FROM ${schema}.inventory_categories
        WHERE tenant_id = $1 AND lower(name) = lower($2)
        LIMIT 1`,
      [tenantId, name]
    );
    return again.rows[0]?.name || name;
  }
}

export async function syncInventoryCategories(db, schema, tenantId) {
  for (const name of STARTER_CATEGORIES) {
    await upsertCategory(db, schema, tenantId, name);
  }
  const { rows } = await db.query(
    `SELECT DISTINCT category AS name
       FROM ${schema}.inventory_skus
      WHERE tenant_id = $1 AND category IS NOT NULL AND btrim(category) <> ''`,
    [tenantId]
  );
  for (const row of rows) {
    await upsertCategory(db, schema, tenantId, row.name);
  }
}

export async function listCategories(db, schema, tenantId) {
  await syncInventoryCategories(db, schema, tenantId);
  const { rows } = await db.query(
    `SELECT id, name, created_at
       FROM ${schema}.inventory_categories
      WHERE tenant_id = $1
      ORDER BY name`,
    [tenantId]
  );
  return rows;
}

export { clipName };
