/**
 * Delivery & pickup fee. Four driving legs: out/back to deliver, out/back
 * to pick up. Maps/GPS later — staff (or a later Maps call) supplies
 * one-way miles and minutes. The fee is always computed here so the
 * browser cannot send a $0 delivery_fee.
 */

export const DELIVERY_MILE_RATE = 0.66;
export const DELIVERY_HOUR_RATE = 30;
export const DELIVERY_LEGS = 4;

export function deliveryFeeFromOneWay(miles, minutes) {
  const m = Number(miles);
  const min = Number(minutes);
  if (!Number.isFinite(m) || m < 0 || !Number.isFinite(min) || min < 0) {
    return null;
  }
  const totalMiles = m * DELIVERY_LEGS;
  const totalHours = (min * DELIVERY_LEGS) / 60;
  const fee = totalMiles * DELIVERY_MILE_RATE + totalHours * DELIVERY_HOUR_RATE;
  return Math.round(fee * 100) / 100;
}
