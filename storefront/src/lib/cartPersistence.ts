import type { CartLine } from '../pages/CatalogPage';

const STORAGE_KEY = 'iap-sticky-cart-v1';

export type PersistedCartLine = Omit<CartLine, 'holdIds' | 'heldUntil' | 'serials'> & {
  holdIds?: string[];
  heldUntil?: string | null;
  serials?: string[];
};

/** Persist cart lines without live hold ids (holds are re-created at checkout). */
export function saveStickyCart(lines: CartLine[]): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const payload: PersistedCartLine[] = lines.map(({ holdIds: _h, heldUntil: _u, serials: _s, ...rest }) => ({
      ...rest,
      holdIds: [],
      heldUntil: null,
      serials: [],
    }));
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota or private mode — cart stays in memory for this tab.
  }
}

export function loadStickyCart(): CartLine[] {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedCartLine[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((line) => ({
      ...line,
      holdIds: [],
      heldUntil: null,
      serials: [],
      unavailable: Boolean(line.unavailable),
    }));
  } catch {
    return [];
  }
}

export function clearStickyCart(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
