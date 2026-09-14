/**
 * Tenant console on the **same host** as the hub (`/console/`).
 * Never send a tenant-apex session to app.{platform} / auth.{platform} —
 * the cookie is scoped to the tenant apex and will not travel
 * (RECURRING-BUG-CLASSES.md §19).
 */
export function tenantConsoleHref(): string {
  const here = window.location.origin;
  return new URL('/console/index.html?as=tenant', here).href;
}
