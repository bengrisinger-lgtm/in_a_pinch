import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingDays,
  isLoadOutBlocked,
  needsVenueLoadOutNote,
  occupancyDays,
  parseHm,
  timeOptions,
} from '../src/rentalPeriod.js';

describe('rentalPeriod', () => {
  it('bills Friday 3 p.m. → Saturday 2 p.m. as one day', () => {
    assert.equal(billingDays('2026-09-18', '15:00', '2026-09-19', '14:00'), 1);
    assert.equal(billingDays('2026-09-18', '15:00:00', '2026-09-19', '14:00:00'), 1);
    assert.equal(billingDays('2026-09-18T00:00:00.000Z', '15:00', '2026-09-19 00:00:00', '14:00'), 1);
    assert.equal(billingDays('2026-09-18', '08:00', '2026-09-19', '20:00'), 2);
  });

  it('bills 8 p.m. 9/14 → 9 a.m. 9/15 as one day', () => {
    assert.equal(billingDays('2026-09-14', '20:00', '2026-09-15', '09:00'), 1);
  });

  it('bills exact 24 hours as one day and 24h+ as two', () => {
    assert.equal(billingDays('2026-09-14', '20:00', '2026-09-15', '20:00'), 1);
    assert.equal(billingDays('2026-09-14', '20:00', '2026-09-15', '20:15'), 2);
  });

  it('rejects load-out not after load-in', () => {
    assert.equal(billingDays('2026-09-14', '20:00', '2026-09-14', '20:00'), null);
    assert.equal(billingDays('2026-09-14', '20:00', '2026-09-14', '08:00'), null);
  });

  it('blocks load-out 12:30 a.m.–7:00 a.m.', () => {
    assert.equal(isLoadOutBlocked('00:00'), false);
    assert.equal(isLoadOutBlocked('00:15'), false);
    assert.equal(isLoadOutBlocked('00:30'), true);
    assert.equal(isLoadOutBlocked('06:45'), true);
    assert.equal(isLoadOutBlocked('07:00'), false);
    assert.ok(!timeOptions(true).includes('00:30'));
    assert.ok(timeOptions(true).includes('00:00'));
    assert.ok(timeOptions(true).includes('07:00'));
  });

  it('flags after-midnight load-out for venue coordination', () => {
    assert.equal(needsVenueLoadOutNote('00:00'), true);
    assert.equal(needsVenueLoadOutNote('00:15'), true);
    assert.equal(needsVenueLoadOutNote('00:30'), false);
    assert.equal(needsVenueLoadOutNote('07:00'), false);
    assert.equal(needsVenueLoadOutNote('20:00'), false);
  });

  it('normalizes pg TIME strings', () => {
    assert.equal(parseHm('20:00:00'), '20:00');
    assert.equal(parseHm('09:00'), '09:00');
  });

  it('keeps occupancy as inclusive calendar days for inventory', () => {
    assert.equal(occupancyDays('2026-09-14', '2026-09-15'), 2);
  });
});
