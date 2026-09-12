import type { Hold } from './inventoryApi';

function gatewayUrl(): string {
  const url = import.meta.env.VITE_API_GATEWAY_URL;
  if (!url) throw new Error('VITE_API_GATEWAY_URL is required');
  return url.replace(/\/$/, '');
}

async function quoteFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
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
    throw new Error(body.error || `HTTP ${res.status}`);
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
  delivery_address?: string | null;
  document_id?: string | null;
  envelope_id?: string | null;
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
  input: { document_id: string; envelope_id: string }
) {
  return quoteFetch<{ quote: CheckoutQuote }>(`/${quoteId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export type { Hold };
