export const DELIVERY_MILE_RATE = 0.66;
export const DELIVERY_HOUR_RATE = 30;
export const DELIVERY_LEGS = 4;

/** Same 4-leg formula as pinch-service `src/delivery.js`. Server is authoritative. */
export function deliveryFeeFromOneWay(miles: number, minutes: number): number | null {
  if (!Number.isFinite(miles) || miles < 0 || !Number.isFinite(minutes) || minutes < 0) {
    return null;
  }
  const totalMiles = miles * DELIVERY_LEGS;
  const totalHours = (minutes * DELIVERY_LEGS) / 60;
  return Math.round((totalMiles * DELIVERY_MILE_RATE + totalHours * DELIVERY_HOUR_RATE) * 100) / 100;
}
