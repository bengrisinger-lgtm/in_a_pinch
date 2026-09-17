import { isWrongTenantApiError, recoverConsumerTenantSession } from './kit';

export type Band = 'none' | 'low' | 'good';

export type Sku = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  image_url?: string | null;
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
  stock_code?: string | null;
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

async function invFetch<T>(path: string, options: RequestInit = {}, tenantRetried = false): Promise<T> {
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
    const message = body.error || `HTTP ${res.status}`;
    if (
      !tenantRetried &&
      isWrongTenantApiError(res.status, message) &&
      (await recoverConsumerTenantSession())
    ) {
      return invFetch(path, options, true);
    }
    throw new InventoryApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export type InventoryCategory = {
  id: string;
  name: string;
  stock_prefix?: string | null;
  created_at?: string;
};

export function listCategories() {
  return invFetch<{ categories: InventoryCategory[] }>('/categories');
}

export function createCategory(name: string, stockPrefix?: string) {
  return invFetch<{ name: string; categories: InventoryCategory[] }>('/categories', {
    method: 'POST',
    body: JSON.stringify({
      name,
      ...(stockPrefix?.trim() ? { stock_prefix: stockPrefix.trim() } : {}),
    }),
  });
}

export function patchCategory(
  categoryId: string,
  input: { name?: string; stock_prefix?: string | null }
) {
  return invFetch<{ name: string; categories: InventoryCategory[] }>(`/categories/${categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function renameCategory(categoryId: string, name: string) {
  return invFetch<{ name: string; categories: InventoryCategory[] }>(`/categories/${categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function deleteCategory(categoryId: string, reassignTo?: string) {
  return invFetch<{ categories: InventoryCategory[] }>(`/categories/${categoryId}`, {
    method: 'DELETE',
    body: JSON.stringify(reassignTo ? { reassign_to: reassignTo } : {}),
  });
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
  category: string;
  description?: string;
  image_url?: string | null;
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

export function createUnit(skuId: string, input?: { serial_number?: string; nickname?: string }) {
  return invFetch<{ unit: InventoryUnit }>(`/skus/${skuId}/units`, {
    method: 'POST',
    body: JSON.stringify(input || {}),
  });
}

export function patchSku(
  skuId: string,
  input: {
    active?: boolean;
    name?: string;
    category?: string | null;
    daily_rate?: number;
    description?: string | null;
    image_url?: string | null;
  }
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

export async function uploadSkuCatalogImage(skuId: string, file: File) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const data_base64 = btoa(binary);
  return invFetch<{ sku: Sku }>(`/skus/${skuId}/catalog-image`, {
    method: 'POST',
    body: JSON.stringify({ content_type: file.type, data_base64 }),
  });
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

export function extendHolds(holdIds: string[]) {
  return invFetch<{ holds: { id: string; held_until: string }[]; hold_ttl_minutes: number }>(
    '/holds/extend',
    {
      method: 'POST',
      body: JSON.stringify({ hold_ids: holdIds }),
    }
  );
}
