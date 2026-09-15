export const CART_HOLD_MINUTES = 15;
/** Prompt this many minutes before the hold expires (15 − 2 = 13). */
export const STILL_SHOPPING_LEAD_MINUTES = 2;

export function earliestHeldUntilMs(cart, now = Date.now()) {
  void now;
  const times = (Array.isArray(cart) ? cart : [])
    .map((line) => (line && line.heldUntil ? Date.parse(line.heldUntil) : NaN))
    .filter((ms) => Number.isFinite(ms));
  if (!times.length) return null;
  return Math.min(...times);
}

export function stillShoppingDelayMs(heldUntilMs, now = Date.now()) {
  if (!Number.isFinite(heldUntilMs)) return null;
  return heldUntilMs - STILL_SHOPPING_LEAD_MINUTES * 60 * 1000 - now;
}

export function expireDelayMs(heldUntilMs, now = Date.now()) {
  if (!Number.isFinite(heldUntilMs)) return null;
  return heldUntilMs - now;
}
