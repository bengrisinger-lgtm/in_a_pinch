/**
 * IAP rental period: Denver wall-clock load-in / load-out.
 * One billed day is up to 24 hours. Inventory occupancy still uses the
 * calendar dates (starts_on / ends_on). Do not trust a client-supplied day count.
 *
 * Load-out is not offered 12:30 a.m.–7:00 a.m.
 * After-midnight load-out (12:00–12:29 a.m.) needs venue coordination.
 */

export const IAP_TIME_ZONE = 'America/Denver';
export const LOAD_IN_DEFAULT = '08:00';
export const LOAD_OUT_DEFAULT = '20:00';
export const LOAD_OUT_POLICY =
  'Load-out is not available from 12:30 a.m. to 7:00 a.m. For events that end after 12:00 a.m., you will need to coordinate a load-out time with the venue.';

const HM_RE = /^(\d{2}):(\d{2})(?::\d{2})?$/;

export function parseHm(raw) {
  if (typeof raw !== 'string') return null;
  const m = HM_RE.exec(raw.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function minutesOfDay(hm) {
  const parsed = parseHm(hm);
  if (!parsed) return null;
  const [hh, mm] = parsed.split(':').map(Number);
  return hh * 60 + mm;
}

/** 12:30 a.m. inclusive through 6:59 a.m. */
export function isLoadOutBlocked(hm) {
  const mins = minutesOfDay(hm);
  if (mins == null) return true;
  return mins >= 30 && mins < 7 * 60;
}

/** Allowed after-midnight window: 12:00–12:29 a.m. */
export function needsVenueLoadOutNote(hm) {
  const mins = minutesOfDay(hm);
  if (mins == null) return false;
  return mins < 30;
}

export function timeOptions(forLoadOut = false) {
  const out = [];
  for (let m = 0; m < 24 * 60; m += 15) {
    const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    if (forLoadOut && isLoadOutBlocked(hm)) continue;
    out.push(hm);
  }
  return out;
}

function tzOffsetMs(timeZone, instant) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
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
  return asUtc - instant.getTime();
}

/** UTC millis for a Denver local date + HH:mm. */
export function denverMs(date, time) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const hm = parseHm(time);
  if (!hm) return null;
  const [y, mo, d] = date.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const offset = tzOffsetMs(IAP_TIME_ZONE, new Date(asIfUtc));
  return asIfUtc - offset;
}

/**
 * Billed days: ceil(duration / 24h), minimum 1.
 * Exact 24 hours is 1 day. Returns null if load-out is not after load-in.
 */
export function billingDays(startsOn, loadIn, endsOn, loadOut) {
  const a = denverMs(startsOn, loadIn);
  const b = denverMs(endsOn, loadOut);
  if (a == null || b == null || b <= a) return null;
  const dayMs = 86400000;
  return Math.max(1, Math.ceil((b - a) / dayMs - 1e-9));
}

/** Inclusive calendar occupancy (inventory), not the billed day count. */
export function occupancyDays(startsOn, endsOn) {
  const a = Date.parse(`${startsOn}T00:00:00Z`);
  const b = Date.parse(`${endsOn}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.round((b - a) / 86400000) + 1;
}
