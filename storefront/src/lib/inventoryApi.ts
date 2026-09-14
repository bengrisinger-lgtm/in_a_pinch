export type Band = 'none' | 'low' | 'good';

export type Sku = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  daily_rate: number | string;
  active: boolean;
  units_total: number;
  units_available?: number;
  band?: Band;
};

export type InventoryUnit = {
  id: string;
  sku_id: string;
  serial_number: string;
  nickname: string | null;
  status: string;
};

export type Hold = {
  id: string;
  unit_id: string;
  sku_id: string;
  starts_on: string;
  ends_on: string;
  status: string;
  held_until: string | null;
  serial_number?: string;
};

export type CalendarDay = {
  date: string;
  available: number;
  booked: number;
  band: Band;
};

export class InventoryApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'InventoryApiError';
    this.status = status;
  }
}

function gatewayUrl(): string {
  const url = import.meta.env.VITE_API_GATEWAY_URL;
  if (!url) throw new Error('VITE_API_GATEWAY_URL is required');
  return url.replace(/\/$/, '');
}

const BASE = () => `${gatewayUrl()}/api/v1/quotes/inventory`;

async function invFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE()}${path}`, {
    ...options,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new InventoryApiError(res.status, body.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function listSkus(startsOn?: string, endsOn?: string) {
  const q =
    startsOn && endsOn
      ? `?starts_on=${encodeURIComponent(startsOn)}&ends_on=${encodeURIComponent(endsOn)}`
      : '';
  return invFetch<{ skus: Sku[]; hold_ttl_hours?: number }>(`/skus${q}`);
}

export function createSku(input: {
  name: string;
  category?: string;
  description?: string;
  daily_rate: number;
}) {
  return invFetch<{ sku: Sku }>('/skus', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listUnits(skuId: string) {
  return invFetch<{ units: InventoryUnit[] }>(`/skus/${skuId}/units`);
}

export function createUnit(skuId: string, input: { serial_number: string; nickname?: string }) {
  return invFetch<{ unit: InventoryUnit }>(`/skus/${skuId}/units`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function patchSku(
  skuId: string,
  input: { active?: boolean; name?: string; category?: string | null; daily_rate?: number }
) {
  return invFetch<{ sku: Sku }>(`/skus/${skuId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function patchUnit(
  skuId: string,
  unitId: string,
  input: { serial_number?: string; nickname?: string | null; status?: 'active' | 'retired' }
) {
  return invFetch<{ unit: InventoryUnit }>(`/skus/${skuId}/units/${unitId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function loadCalendar(skuId: string, year: number, month: number) {
  const q = `?sku_id=${encodeURIComponent(skuId)}&year=${year}&month=${month}`;
  return invFetch<{
    sku_id: string;
    name: string;
    year: number;
    month: number;
    units_total: number;
    hold_ttl_hours: number;
    days: CalendarDay[];
  }>(`/calendar${q}`);
}

export function createHolds(input: {
  sku_id: string;
  quantity: number;
  starts_on: string;
  ends_on: string;
  load_in_time: string;
  load_out_time: string;
}) {
  return invFetch<{ holds: Hold[]; hold_ttl_hours: number }>('/holds', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function cancelHold(holdId: string) {
  return invFetch<{ hold: { id: string; status: string } }>(`/holds/${holdId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
