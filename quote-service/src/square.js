/**
 * Square Payment Links. PAN stays on Square's hosted page.
 * Access token comes from the vault (console-service reveal) or a local
 * SQUARE_ACCESS_TOKEN fallback — never TOKEN_ENCRYPTION_KEY on this spoke.
 */

const SQUARE_VERSION = '2026-08-19';
const DEFAULT_API_BASE = 'https://connect.squareup.com';

export function dollarsToCents(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function parseSquareSecret(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      const accessToken = obj.access_token || obj.token || obj.secret;
      if (typeof accessToken !== 'string' || !accessToken.trim()) return null;
      const locationId = obj.location_id || obj.locationId || null;
      return {
        accessToken: accessToken.trim(),
        locationId: typeof locationId === 'string' && locationId.trim() ? locationId.trim() : null,
      };
    } catch {
      return null;
    }
  }
  return { accessToken: text, locationId: null };
}

export function paymentLinkBody({
  idempotencyKey,
  locationId,
  name,
  amountCents,
  currency = 'USD',
  redirectUrl,
  buyerEmail,
  paymentNote,
}) {
  const body = {
    idempotency_key: idempotencyKey,
    quick_pay: {
      name,
      location_id: locationId,
      price_money: { amount: amountCents, currency },
    },
  };
  if (paymentNote) body.payment_note = paymentNote;
  const checkout = {
    // Square-hosted page. Cards are always on. Wallets + Cash App via Checkout API.
    // ACH and PayPal/Venmo are not Payment Link methods (Web Payments SDK / PayPal).
    accepted_payment_methods: {
      apple_pay: true,
      google_pay: true,
      cash_app_pay: true,
    },
  };
  if (redirectUrl) checkout.redirect_url = redirectUrl;
  body.checkout_options = checkout;
  if (buyerEmail) body.pre_populated_data = { buyer_email: buyerEmail };
  return body;
}

async function mintIdentityToken(audience, fetchImpl) {
  const meta =
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity' +
    `?audience=${encodeURIComponent(audience)}`;
  const res = await fetchImpl(meta, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) {
    throw new Error('Could not mint service identity token');
  }
  return res.text();
}

export async function revealTenantCredential({
  consoleServiceUrl,
  tenantId,
  provider,
  fetchImpl = fetch,
  mintToken = mintIdentityToken,
}) {
  const base = String(consoleServiceUrl || '').replace(/\/$/, '');
  if (!base) {
    const err = new Error('CONSOLE_SERVICE_URL is not set');
    err.status = 503;
    throw err;
  }
  const token = await mintToken(base, fetchImpl);
  const res = await fetchImpl(`${base}/internal/tenant-credentials/${tenantId}/${provider}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  if (res.status === 404) {
    const err = new Error('Square credential not found in Credentials');
    err.status = 503;
    throw err;
  }
  if (!res.ok) {
    const err = new Error('Could not load Square credential from the vault');
    err.status = res.status === 401 || res.status === 403 ? 503 : 502;
    throw err;
  }
  const body = await res.json();
  return typeof body?.credential === 'string' ? body.credential : null;
}

export async function pickSquareLocation({ accessToken, apiBase, fetchImpl, preferredId }) {
  if (preferredId) return preferredId;
  const res = await fetchImpl(`${apiBase}/v2/locations`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Square-Version': SQUARE_VERSION,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const err = new Error('Square locations could not be loaded');
    err.status = 502;
    throw err;
  }
  const body = await res.json();
  const list = Array.isArray(body.locations) ? body.locations : [];
  const active = list.find((loc) => loc?.status === 'ACTIVE' && loc.id) || list.find((loc) => loc?.id);
  if (!active?.id) {
    const err = new Error('No Square location is available');
    err.status = 503;
    throw err;
  }
  return active.id;
}

export async function createSquarePaymentLink({
  accessToken,
  apiBase,
  fetchImpl,
  ...payload
}) {
  const res = await fetchImpl(`${apiBase}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(paymentLinkBody(payload)),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.payment_link?.url) {
    const err = new Error('Square could not create a payment link');
    err.status = 502;
    throw err;
  }
  return {
    url: body.payment_link.url,
    id: body.payment_link.id || null,
    order_id: body.payment_link.order_id || null,
  };
}

export async function findSquarePaymentByNote({
  accessToken,
  apiBase,
  fetchImpl,
  note,
}) {
  const needle = String(note || '').trim();
  if (!needle) return null;
  const res = await fetchImpl(`${apiBase}/v2/payments?limit=100&sort_order=DESC`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Square-Version': SQUARE_VERSION,
      Accept: 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error('Square payments could not be listed');
    err.status = 502;
    throw err;
  }
  const list = Array.isArray(body.payments) ? body.payments : [];
  return (
    list.find(
      (p) =>
        p &&
        p.id &&
        p.status === 'COMPLETED' &&
        (p.note === needle || (typeof p.note === 'string' && p.note.includes(needle)))
    ) || null
  );
}

export async function refundSquarePayment({
  accessToken,
  apiBase,
  fetchImpl,
  paymentId,
  amountCents,
  idempotencyKey,
  reason,
}) {
  const res = await fetchImpl(`${apiBase}/v2/refunds`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      payment_id: paymentId,
      amount_money: { amount: amountCents, currency: 'USD' },
      reason: reason || 'Rental cancelled',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.refund?.id) {
    const err = new Error(body?.errors?.[0]?.detail || 'Square could not refund this payment');
    err.status = 502;
    throw err;
  }
  return { id: body.refund.id, status: body.refund.status || null };
}

export function createSquareRuntime({
  consoleServiceUrl,
  envAccessToken,
  envLocationId,
  apiBase = DEFAULT_API_BASE,
  fetchImpl = fetch,
} = {}) {
  return {
    async getAccessToken(tenantId) {
      let raw = null;
      if (consoleServiceUrl) {
        try {
          raw = await revealTenantCredential({
            consoleServiceUrl,
            tenantId,
            provider: 'square',
            fetchImpl,
          });
        } catch (err) {
          if (!envAccessToken) throw err;
        }
      }
      if (!raw) raw = envAccessToken || null;
      const parsed = parseSquareSecret(raw);
      if (!parsed) {
        const err = new Error(
          'Square is not configured. Store a credential with provider slug square, then redeploy console-service so pinch-service can reveal it.'
        );
        err.status = 503;
        throw err;
      }
      return parsed;
    },

    async createPaymentLink(tenantId, opts) {
      const secret = await this.getAccessToken(tenantId);
      const locationId = await pickSquareLocation({
        accessToken: secret.accessToken,
        apiBase,
        fetchImpl,
        preferredId: envLocationId || secret.locationId,
      });
      return createSquarePaymentLink({
        accessToken: secret.accessToken,
        apiBase,
        fetchImpl,
        locationId,
        ...opts,
      });
    },

    async refundPayment(tenantId, opts) {
      const secret = await this.getAccessToken(tenantId);
      let paymentId = opts.paymentId || null;
      if (!paymentId && opts.note) {
        const found = await findSquarePaymentByNote({
          accessToken: secret.accessToken,
          apiBase,
          fetchImpl,
          note: opts.note,
        });
        paymentId = found?.id || null;
      }
      if (!paymentId) {
        return { refunded: false, reason: 'no_square_payment' };
      }
      const refund = await refundSquarePayment({
        accessToken: secret.accessToken,
        apiBase,
        fetchImpl,
        paymentId,
        amountCents: opts.amountCents,
        idempotencyKey: opts.idempotencyKey,
        reason: opts.reason,
      });
      return { refunded: true, id: refund.id, status: refund.status };
    },
  };
}
