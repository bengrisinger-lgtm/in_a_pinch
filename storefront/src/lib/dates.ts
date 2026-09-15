export function localIsoDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return localIsoDate(dt);
}

/** Inclusive calendar occupancy for inventory, not billed days. */
export function spanDays(startsOn: string, endsOn: string): number {
  const [sy, sm, sd] = startsOn.split('-').map(Number);
  const [ey, em, ed] = endsOn.split('-').map(Number);
  const a = new Date(sy, sm - 1, sd).getTime();
  const b = new Date(ey, em - 1, ed).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.round((b - a) / 86400000) + 1;
}

export const LOAD_IN_DEFAULT = '08:00';
export const LOAD_OUT_DEFAULT = '20:00';
export const LOAD_OUT_POLICY =
  'Load-out is not available from 12:30 a.m. to 7:00 a.m. For events that end after 12:00 a.m., you will need to coordinate a load-out time with the venue.';

const HM_RE = /^(\d{2}):(\d{2})(?::\d{2})?$/;

export function parseHm(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const m = HM_RE.exec(raw.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function minutesOfDay(hm: string): number | null {
  const parsed = parseHm(hm);
  if (!parsed) return null;
  const [hh, mm] = parsed.split(':').map(Number);
  return hh * 60 + mm;
}

export function isLoadOutBlocked(hm: string): boolean {
  const mins = minutesOfDay(hm);
  if (mins == null) return true;
  return mins >= 30 && mins < 7 * 60;
}

export function needsVenueLoadOutNote(hm: string): boolean {
  const mins = minutesOfDay(hm);
  if (mins == null) return false;
  return mins < 30;
}

export function timeOptions(forLoadOut = false): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += 15) {
    const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    if (forLoadOut && isLoadOutBlocked(hm)) continue;
    out.push(hm);
  }
  return out;
}

function tzOffsetMs(timeZone: string, instant: Date): number {
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
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
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

export function asIsoDate(raw: unknown): string | null {
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function denverMs(date: string, time: string): number | null {
  const iso = asIsoDate(date);
  if (!iso) return null;
  const hm = parseHm(time);
  if (!hm) return null;
  const [y, mo, d] = iso.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const offset = tzOffsetMs('America/Denver', new Date(asIfUtc));
  return asIfUtc - offset;
}

/** Ceil(duration / 24h). Exact 24 hours = 1 day. Null if load-out is not after load-in. */
export function billingDays(
  startsOn: string,
  loadIn: string,
  endsOn: string,
  loadOut: string
): number | null {
  const a = denverMs(startsOn, loadIn);
  const b = denverMs(endsOn, loadOut);
  if (a == null || b == null || b <= a) return null;
  return Math.max(1, Math.ceil((b - a) / 86400000 - 1e-9));
}

/** Elapsed hours for the billed window (null if invalid). */
export function rentalHours(
  startsOn: string,
  loadIn: string,
  endsOn: string,
  loadOut: string
): number | null {
  const a = denverMs(startsOn, loadIn);
  const b = denverMs(endsOn, loadOut);
  if (a == null || b == null || b <= a) return null;
  return (b - a) / 3600000;
}

export function formatPrettyTime(hm: string): string {
  const parsed = parseHm(hm);
  if (!parsed) return hm;
  const [h, m] = parsed.split(':').map(Number);
  const suffix = h >= 12 ? 'p.m.' : 'a.m.';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatPrettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function money(n: number | string): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function stockLabel(available: number | undefined, total: number, band?: string): string {
  if (available == null) {
    return `${total} unit${total === 1 ? '' : 's'} in stock`;
  }
  if (band === 'none' || available <= 0) return 'Fully booked for these dates';
  if (band === 'low') return `${available} of ${total} available`;
  return `${available} of ${total} available`;
}
