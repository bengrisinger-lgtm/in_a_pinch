import type { Hold } from './inventoryApi';
import { isWrongTenantApiError, recoverConsumerTenantSession } from './kit';

function gatewayUrl(): string {
  const url = import.meta.env.VITE_API_GATEWAY_URL;
  if (!url) throw new Error('VITE_API_GATEWAY_URL is required');
  return url.replace(/\/$/, '');
}

export async function quoteFetch<T>(path: string, options: RequestInit = {}, tenantRetried = false): Promise<T> {
  const res = await fetch(`${gatewayUrl()}/api/v1/quotes${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const message = body.error || `HTTP ${res.status}`;
    if (
      !tenantRetried &&
      isWrongTenantApiError(res.status, message) &&
      (await recoverConsumerTenantSession())
    ) {
      return quoteFetch(path, options, true);
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export type CheckoutQuote = {
  id: string;
  customer_id: string;
  status: string;
  delivery_fee: number | string;
  subtotal: number | string;
  total: number | string;
  fulfillment: string | null;
  starts_on?: string;
  ends_on?: string;
  load_in_time?: string | null;
  load_out_time?: string | null;
  delivery_address?: string | null;
  document_id?: string | null;
  envelope_id?: string | null;
  payment_link_url?: string | null;
  payment_link_id?: string | null;
};

export type CheckoutInput = {
  name: string;
  email: string;
  phone?: string;
  event_type?: string;
  notes?: string;
  fulfillment: 'pickup' | 'delivery';
  delivery_address?: string;
  one_way_miles?: number;
  one_way_minutes?: number;
  hold_ids: string[];
};

export function checkout(input: CheckoutInput) {
  return quoteFetch<{
    quote: CheckoutQuote;
    customer: { id: string; name: string; email: string };
    schema: string;
    renter_magic_link: null;
    hold_ttl_note: string;
  }>('/checkout', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createPaymentLink(quoteId: string, redirectOrigin: string) {
  return quoteFetch<{ url: string; id: string | null; quote_id: string; amount_cents: number }>(
    `/${quoteId}/payment-link`,
    {
      method: 'POST',
      body: JSON.stringify({ redirect_origin: redirectOrigin }),
    }
  );
}

export type CalendarPush = {
  pushed: boolean;
  reason?: string;
  provider?: string;
  eventId?: string;
};

export function markPaid(quoteId: string) {
  return quoteFetch<{
    payment: { id: string; amount: number | string; status: string; method: string };
    quote: { id: string; status: string };
    calendar?: CalendarPush;
  }>(`/${quoteId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ method: 'staff_recorded' }),
  });
}

export function attachEnvelope(
  quoteId: string,
  input: {
    document_id: string;
    envelope_id: string;
    customer_signing_token?: string;
    staff_signing_token?: string;
  }
) {
  return quoteFetch<{ quote: CheckoutQuote }>(`/${quoteId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export type StaffQuote = CheckoutQuote & {
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string | null;
  customer_signing_token?: string | null;
  staff_signing_token?: string | null;
  held_until?: string | null;
  created_at?: string;
};

export function listQuotes(query?: string) {
  const q = query?.trim();
  return quoteFetch<{ quotes: StaffQuote[] }>(q ? `/?q=${encodeURIComponent(q)}` : '/');
}

export function getQuote(quoteId: string) {
  return quoteFetch<{ quote: StaffQuote; line_items: unknown[]; payments: unknown[] }>(
    `/${quoteId}`
  );
}

export function cancelQuote(quoteId: string) {
  return quoteFetch<{ quote: { id: string; status: string; envelope_id?: string | null } }>(
    `/${quoteId}/cancel`,
    { method: 'POST', body: JSON.stringify({}) }
  );
}

export function markAwaitingPayment(quoteId: string) {
  return quoteFetch<{ quote: { id: string; status: string } }>(`/${quoteId}/awaiting-payment`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export type { Hold };
