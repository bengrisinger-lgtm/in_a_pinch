/** Normalize kit / sign-service template list payloads. */

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function rowsFrom(value) {
  if (Array.isArray(value)) {
    return value.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
  }
  const obj = asObject(value);
  if (obj && typeof obj.id === 'string' && obj.id) return [obj];
  return [];
}

/**
 * Accept `{ templates }`, `{ items }`, a top-level array, a JSON string,
 * or a single `{ template }` / `{ id }` object. Missing `.templates`
 * must not silently become `[]` when the kit actually returned rows.
 */
export function asTemplateList(page) {
  let data = page;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) return [];
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new Error('Template list was not JSON');
    }
  }
  if (Array.isArray(data)) return rowsFrom(data);
  const obj = asObject(data);
  if (!obj) return [];

  const nested = asObject(obj.data);
  const candidates = [
    obj.templates,
    obj.items,
    obj.Templates,
    obj.template,
    nested && nested.templates,
    nested && nested.items,
    obj.data,
  ];
  for (const candidate of candidates) {
    const list = rowsFrom(candidate);
    if (list.length) return list;
  }
  return [];
}

export function templateListShapeHint(page) {
  if (page == null) return 'empty payload';
  if (typeof page === 'string') return `string payload (${page.length} chars)`;
  if (Array.isArray(page)) return `array payload (${page.length})`;
  if (typeof page !== 'object') return `payload type ${typeof page}`;
  const keys = Object.keys(page).slice(0, 12);
  const inner = page.templates;
  const innerType = Array.isArray(inner) ? `templates[${inner.length}]` : `templates:${typeof inner}`;
  return `keys ${keys.join(', ') || '(none)'}; ${innerType}`;
}

/** True when the kit really sent zero rows, not a shape we failed to read. */
export function isGenuineEmptyTemplateList(page, list) {
  if (list.length) return false;
  if (page == null) return true;
  if (Array.isArray(page) && page.length === 0) return true;
  if (typeof page === 'object' && Array.isArray(page.templates) && page.templates.length === 0) {
    return true;
  }
  if (
    typeof page === 'object' &&
    page.templates == null &&
    Array.isArray(page.items) &&
    page.items.length === 0
  ) {
    return true;
  }
  return false;
}
