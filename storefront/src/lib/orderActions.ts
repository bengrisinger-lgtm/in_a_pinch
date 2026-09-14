import { kit } from './kit';
import { cancelQuote } from './quoteApi';

/** Cancel the quote and release holds. Void the kit envelope if we have one. */
export async function cancelOrder(quoteId: string, envelopeId?: string | null) {
  const result = await cancelQuote(quoteId);
  if (envelopeId) {
    try {
      await kit().signing.void(envelopeId, 'Staff cancelled the rental order');
    } catch {
      // Holds are already released. Envelope void is best-effort.
    }
  }
  return result;
}

export function signingHref(token: string | null | undefined): string | null {
  if (!token) return null;
  return kit().signing.signingUrl(token);
}
