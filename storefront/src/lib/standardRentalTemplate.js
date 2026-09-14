import { templateIsReadyForCheckout } from './templateRoles.js';

const STANDARD_RENTAL_RE = /standard\s+rental\s+agreement/i;

export const CONSUMER_AGREEMENT_UNAVAILABLE =
  'The rental agreement is not ready to send. Please contact In A Pinch AV.';

/** Consumer checkout always uses Standard Rental Agreement. Ready templates only. */
export function pickStandardRentalTemplate(templates) {
  const list = Array.isArray(templates) ? templates : [];
  const ready = list.filter((t) => templateIsReadyForCheckout(t));
  return ready.find((t) => STANDARD_RENTAL_RE.test(t.name || '')) || null;
}
