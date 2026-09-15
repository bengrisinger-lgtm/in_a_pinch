/** Envelope / email title for a completed IAP Standard Rental Agreement. */
export function signedAgreementTitle(fullName) {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.replace(/[^\p{L}\p{N}'-]/gu, ''))
    .filter(Boolean);
  if (!parts.length) return 'Signed Service Agreement';
  if (parts.length === 1) return `${parts[0]} - Signed Service Agreement`;
  const last = parts[parts.length - 1];
  const first = parts[0];
  return `${last}_${first} - Signed Service Agreement`;
}
