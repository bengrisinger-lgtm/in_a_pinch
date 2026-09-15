import { listSkus, type Sku } from './inventoryApi';
import type { CartLine } from '../pages/CatalogPage';

export const CART_UNAVAILABLE_MSG =
  "We're sorry, but this item has been rented by another customer.";

export function markCartAvailability(lines: CartLine[], skus: Sku[]): CartLine[] {
  if (!lines.length) return lines;
  const byId = new Map(skus.map((s) => [s.id, s]));
  return lines.map((line) => {
    const sku = byId.get(line.skuId);
    const avail = sku?.units_available ?? 0;
    const unavailable = avail < line.quantity;
    return { ...line, unavailable };
  });
}

export async function refreshCartAvailability(lines: CartLine[]): Promise<CartLine[]> {
  if (!lines.length) return lines;
  const head = lines[0];
  const { skus } = await listSkus(head.startsOn, head.endsOn);
  return markCartAvailability(lines, skus);
}
