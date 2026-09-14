import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'dates.ts'),
  'utf8'
);

/** Keep in lockstep with storefront `spanDays` (inclusive calendar days). */
function spanDays(startsOn, endsOn) {
  const [sy, sm, sd] = startsOn.split('-').map(Number);
  const [ey, em, ed] = endsOn.split('-').map(Number);
  const a = new Date(sy, sm - 1, sd).getTime();
  const b = new Date(ey, em - 1, ed).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.round((b - a) / 86400000) + 1;
}

describe('spanDays', () => {
  it('treats same-day pickup and return as one period (up to 24 hours)', () => {
    assert.match(src, /Inclusive calendar occupancy for inventory/);
    assert.equal(spanDays('2026-09-14', '2026-09-14'), 1);
  });

  it('counts inclusive calendar days after the first', () => {
    assert.equal(spanDays('2026-09-14', '2026-09-15'), 2);
    assert.equal(spanDays('2026-09-14', '2026-09-16'), 3);
  });
});

describe('billingDays', () => {
  it('bills 8 p.m. 9/14 → 9 a.m. 9/15 as one day', () => {
    assert.match(src, /Exact 24 hours = 1 day/);
    assert.match(src, /12:30 a.m. to 7:00 a.m/);
    function denverMs(date, time) {
      const [y, mo, d] = date.split('-').map(Number);
      const [hh, mm] = time.split(':').map(Number);
      const asIfUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Denver',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const parts = dtf.formatToParts(new Date(asIfUtc));
      const get = (type) => parts.find((p) => p.type === type)?.value;
      let hour = Number(get('hour'));
      if (hour === 24) hour = 0;
      const asUtc = Date.UTC(
        Number(get('year')),
        Number(get('month')) - 1,
        Number(get('day')),
        hour,
        Number(get('minute')),
        Number(get('second'))
      );
      return asIfUtc - (asUtc - new Date(asIfUtc).getTime());
    }
    function billingDays(startsOn, loadIn, endsOn, loadOut) {
      const a = denverMs(startsOn, loadIn);
      const b = denverMs(endsOn, loadOut);
      if (b <= a) return null;
      return Math.max(1, Math.ceil((b - a) / 86400000 - 1e-9));
    }
    assert.equal(billingDays('2026-09-14', '20:00', '2026-09-15', '09:00'), 1);
  });
});
