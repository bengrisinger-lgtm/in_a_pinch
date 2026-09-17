/** Split / join display names for customer + staff records. */

export function splitDisplayName(name) {
  const s = String(name || '').trim();
  if (!s) return { first_name: '', last_name: '' };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

export function joinDisplayName(first, last) {
  return [first, last].map((x) => String(x || '').trim()).filter(Boolean).join(' ').trim();
}

export function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}
