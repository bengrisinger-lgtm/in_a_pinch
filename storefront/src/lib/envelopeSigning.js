const CUSTOMER_RE = /^(customer|renter|client|lessee)$/i;

/** True when the renter/customer kit signer has signed (staff may still be pending). */
export function renterHasSigned(detail, customerEmail) {
  const signers = (detail.signers || []).filter(
    (s) => s.recipient_role !== 'cc' && s.recipient_role !== 'fyi'
  );
  const byRole = signers.find((s) => CUSTOMER_RE.test(String(s.role_label || '').trim()));
  if (byRole) return byRole.status === 'signed';
  if (customerEmail) {
    const want = String(customerEmail).trim().toLowerCase();
    const byEmail = signers.find((s) => String(s.email).trim().toLowerCase() === want);
    if (byEmail) return byEmail.status === 'signed';
  }
  return false;
}
