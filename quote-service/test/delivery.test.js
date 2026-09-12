import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryFeeFromOneWay, DELIVERY_LEGS, DELIVERY_MILE_RATE, DELIVERY_HOUR_RATE } from '../src/delivery.js';

describe('deliveryFeeFromOneWay', () => {
  it('charges four legs at $0.66/mi and $30/hr (preview formula)', () => {
    const fee = deliveryFeeFromOneWay(10, 20);
    const miles = 10 * DELIVERY_LEGS * DELIVERY_MILE_RATE;
    const hours = ((20 * DELIVERY_LEGS) / 60) * DELIVERY_HOUR_RATE;
    assert.equal(fee, Math.round((miles + hours) * 100) / 100);
    assert.equal(fee, 66.4);
  });

  it('pickup / invalid numbers do not compute a fee', () => {
    assert.equal(deliveryFeeFromOneWay(-1, 10), null);
    assert.equal(deliveryFeeFromOneWay(10, 'nope'), null);
  });
});
