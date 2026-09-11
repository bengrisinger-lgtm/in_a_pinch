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

export function spanDays(startsOn: string, endsOn: string): number {
  const [sy, sm, sd] = startsOn.split('-').map(Number);
  const [ey, em, ed] = endsOn.split('-').map(Number);
  const a = new Date(sy, sm - 1, sd).getTime();
  const b = new Date(ey, em - 1, ed).getTime();
  return Math.round((b - a) / 86400000) + 1;
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
