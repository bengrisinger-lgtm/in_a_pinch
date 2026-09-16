/** Resolve catalog image_url from API (https or site-relative /catalog-media/…). */
export function catalogImageSrc(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  const s = imageUrl.trim();
  if (!s) return null;
  if (s.startsWith('https://')) return s;
  if (s.startsWith('/')) return `${window.location.origin}${s}`;
  return null;
}
