/**
 * Cloud Run env must match production DB roles (`backend_app_runtime`, etc.).
 * Derive prefix from DB_USER when RESOURCE_PREFIX was omitted on an older deploy.
 */
export function resolveResourcePrefix() {
  const explicit = (process.env.RESOURCE_PREFIX || '').trim();
  if (explicit && /^[a-z][a-z0-9_]*$/.test(explicit)) {
    return explicit;
  }
  const dbUser = (process.env.DB_USER || '').trim();
  const fromUser = dbUser.replace(/_app_runtime$/, '');
  if (fromUser && fromUser !== dbUser && /^[a-z][a-z0-9_]*$/.test(fromUser)) {
    return fromUser;
  }
  throw new Error(
    'RESOURCE_PREFIX is required (or set DB_USER to ${prefix}_app_runtime for derivation)'
  );
}
