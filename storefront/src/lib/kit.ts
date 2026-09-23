import { createClient, type CurrentUser, type PlatformClient } from '@securedbackend/sdk';

function gatewayUrl(): string {
  const url = import.meta.env.VITE_API_GATEWAY_URL;
  if (!url) throw new Error('VITE_API_GATEWAY_URL is required');
  return url.replace(/\/$/, '');
}

/** Public signer SPA. Invite email uses sign.{platform}; do not derive
 *  sign.{apex} from api.{apex} — that host is Application Not Found
 *  until the tenant provisions a `sign` app (same class as hub). */
function signerUrl(): string {
  const url = import.meta.env.VITE_SIGNER_URL;
  if (!url) throw new Error('VITE_SIGNER_URL is required');
  return url.replace(/\/$/, '');
}

export function authUrl(): string {
  const url = import.meta.env.VITE_AUTH_URL;
  if (!url) throw new Error('VITE_AUTH_URL is required');
  return url.replace(/\/$/, '');
}

/**
 * Apex / www are the renter shop. Hub is staff. Host decides, not role —
 * a staff cookie on inapinchav.com must not open Hub / Stock / Orders.
 * Local Vite is the staff hub so `npm run dev` keeps the login wall.
 */
export function isConsumerSurface(): boolean {
  const forced = import.meta.env.VITE_STOREFRONT_SURFACE;
  if (forced === 'consumer') return true;
  if (forced === 'staff') return false;
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return false;
  return !host.startsWith('hub.') && !host.startsWith('auth.') && !host.startsWith('api.') && !host.startsWith('sign.');
}

/** Staff home after auth. Derived from VITE_AUTH_URL, not window.location. */
export function staffHubHref(): string {
  const auth = new URL(authUrl());
  const hubHost = auth.hostname.replace(/^auth\./, 'hub.');
  return `${auth.protocol}//${hubHost}/`;
}

export function staffLoginHref(redirectHref?: string): string {
  const redirect = redirectHref || (typeof window === 'undefined' ? staffHubHref() : window.location.href);
  return `${authUrl()}/login?${new URLSearchParams({ redirect }).toString()}`;
}

function gatewayFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch.bind(globalThis)(input, { ...init, cache: 'no-store' });
}

/** Headers for browser calls to tenant APIs (quotes/inventory). Matches kit transport. */
export function tenantApiHeaders(extra?: HeadersInit, jsonBody?: boolean): HeadersInit {
  const headers = new Headers(extra);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (jsonBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const clientId = import.meta.env.VITE_SYMLAVAULT_CLIENT;
  if (typeof clientId === 'string' && clientId.trim() && !headers.has('X-SymlaVault-Client')) {
    headers.set('X-SymlaVault-Client', clientId.trim());
  }
  return headers;
}

/** Raw fetch for /api/v1/quotes/* — credentials + optional official client header. */
export function tenantQuotesFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${gatewayUrl()}/api/v1/quotes${path.startsWith('/') ? path : `/${path}`}`;
  const jsonBody = Boolean(init.body);
  return gatewayFetch(url, {
    ...init,
    credentials: 'include',
    headers: tenantApiHeaders(init.headers, jsonBody),
  });
}

type ValidateSessionBody = {
  valid?: boolean;
  role?: string;
  email?: string;
  userId?: string;
  tenantId?: string;
  projectId?: string;
  impersonatorUserId?: string | null;
  impersonator_user_id?: string | null;
};

/** Guest renters have a session id but no vault user row; /auth/me 404 while validate succeeds. */
async function currentUserFromValidate(): Promise<CurrentUser | null> {
  const res = await gatewayFetch(`${gatewayUrl()}/api/v1/auth/validate`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as ValidateSessionBody | null;
  if (!body?.valid) return null;
  const id = body.userId || '';
  const impersonatorUserId =
    body.impersonatorUserId ?? body.impersonator_user_id ?? null;
  return {
    id,
    userId: id,
    email: body.email || '',
    role: body.role || 'guest',
    tenantId: body.tenantId,
    projectId: body.projectId,
    impersonatorUserId,
  } as CurrentUser;
}

/** Prefer kit /auth/me; fall back to /auth/validate when /me 404s (guest + some staff sessions). */
export async function resolveCurrentUser(client: PlatformClient): Promise<CurrentUser | null> {
  try {
    const user = await client.auth.getCurrentUser();
    if (user) return user;
  } catch {
    /* kit uses /auth/me; guest sessions may 404 without a vault user row */
  }
  return currentUserFromValidate();
}

export function kit(): PlatformClient {
  return createClient({
    baseUrl: gatewayUrl(),
    signerBaseUrl: signerUrl(),
    fetch: gatewayFetch,
  });
}

export function isStaffUser(user: CurrentUser | null): boolean {
  if (!user) return false;
  const role = (user.role || '').toLowerCase();
  return role !== 'guest' && role !== 'app_user';
}

/** Host-branded guest cookie for apex renters (HttpOnly; gateway skips session gate). */
export async function mintGuestSession(): Promise<boolean> {
  const res = await fetch(`${gatewayUrl()}/api/v1/auth/guest`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  return res.ok;
}

export function isWrongTenantApiError(status: number, message: string | undefined): boolean {
  return status === 403 && /wrong tenant for this service/i.test(message || '');
}

/** Re-bind apex session to this host's tenant after a stale cross-tenant cookie. */
export async function recoverConsumerTenantSession(): Promise<boolean> {
  if (!isConsumerSurface()) return false;
  return mintGuestSession();
}

/**
 * Mint a guest storefront cookie when none exists. GET /api/v1/auth/guest
 * is skipped by gateway session check; Host branding binds tenant_id into
 * the new HttpOnly sid. Do not send staff to login for an empty user.
 */
export async function ensureStorefrontSession(): Promise<CurrentUser | null> {
  const client = kit();
  const existing = await resolveCurrentUser(client);
  if (existing) return existing;
  if (!(await mintGuestSession())) return null;
  return resolveCurrentUser(client);
}

export function redirectToLogin(): void {
  window.location.href = staffLoginHref(window.location.href);
}

export type { CurrentUser };
