import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CART_HOLD_MINUTES,
  STILL_SHOPPING_LEAD_MINUTES,
  earliestHeldUntilMs,
  expireDelayMs,
  stillShoppingDelayMs,
} from '../src/lib/cartHoldIdle.js';

describe('cart hold idle', () => {
  it('warns at 13 minutes and expires at 15', () => {
    assert.equal(CART_HOLD_MINUTES, 15);
    assert.equal(STILL_SHOPPING_LEAD_MINUTES, 2);
    const now = Date.parse('2026-09-14T15:00:00.000Z');
    const heldUntil = now + CART_HOLD_MINUTES * 60 * 1000;
    assert.equal(stillShoppingDelayMs(heldUntil, now), 13 * 60 * 1000);
    assert.equal(expireDelayMs(heldUntil, now), 15 * 60 * 1000);
  });

  it('uses the earliest line expiry', () => {
    const a = '2026-09-14T15:10:00.000Z';
    const b = '2026-09-14T15:20:00.000Z';
    assert.equal(
      earliestHeldUntilMs([{ heldUntil: b }, { heldUntil: a }]),
      Date.parse(a)
    );
  });
});
