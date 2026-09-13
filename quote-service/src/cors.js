/**
 * CORS for a private HMAC spoke. Browsers talk to the gateway; this
 * service still sees Origin on the proxied request.
 *
 * Allow: listed origins, or same apex as X-Forwarded-Host / Host
 * (hub.{apex} → api.{apex}). Never throw — cors() Error becomes HTTP 500.
 * Do not reflect * or a foreign apex.
 */

const KNOWN_SUBDOMAIN_LABELS = new Set([
  'auth',
  'api',
  'app',
  'admin',
  'sign',
  'www',
  'hub',
  'scan',
  'loa',
]);

export function hostnameOf(value) {
  if (!value || typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw) return '';
  try {
    if (raw.includes('://')) return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
  return raw.split(':')[0].split(',')[0].trim().toLowerCase();
}

export function apexOf(hostname) {
  const h = hostnameOf(hostname);
  if (!h || !h.includes('.')) return '';
  const parts = h.split('.');
  if (parts.length >= 3 && KNOWN_SUBDOMAIN_LABELS.has(parts[0])) {
    return parts.slice(1).join('.');
  }
  return h;
}

export function originAllowed(origin, { allowedOrigins = [], forwardedHost, host } = {}) {
  if (!origin) return true;
  if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) return true;
  const originApex = apexOf(origin);
  if (!originApex) return false;
  const candidates = [forwardedHost, host, ...(allowedOrigins || [])];
  for (const c of candidates) {
    if (c && apexOf(c) === originApex) return true;
  }
  return false;
}
