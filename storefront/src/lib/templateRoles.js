/** IAP hub: two kit signer roles. Labels are generic on purpose (no tenant brand). */

const SIG_TYPES = new Set(['signature', 'initials']);
const SENDER_FILL = new Set(['sender_text', 'sender_dropdown']);

export const PLACE_TEMPLATE_BLOCKS =
  'Place Customer and Staff signature blocks in the tenant console under Signatures → Templates. Checkout cannot guess a corner of the page.';

export const TEMPLATE_NEEDS_TWO_SIGNER_ROLES =
  'Checkout needs exactly two required-signer roles named Customer (or Renter) and Staff (or Employee/Company). Add both in Signatures → Templates, place a Signature block on each, Save. Do not add CC/FYI or a third signer.';

export const TEMPLATE_NEEDS_SIGNATURE_BLOCK =
  'Each of the two roles needs a Signature (or Initials) block. Click the role, click Signature, then click the page. Date and Name blocks are not enough.';

export const TEMPLATE_HAS_SENDER_FILL =
  'Remove Sender Text / Sender Dropdown blocks from this template. IAP checkout maps Customer and Staff only and cannot fill those.';

const CUSTOMER_RE = /^(customer|renter|client|lessee)$/i;
const STAFF_RE = /^(staff|employee|company|agent|lessor|dealer|owner|operator)$/i;

function signerRolesOf(template) {
  const roles = Array.isArray(template?.signer_roles) ? template.signer_roles : [];
  return roles
    .filter((r) => r && typeof r.role_label === 'string')
    .map((r) => ({
      role_label: r.role_label.trim(),
      recipient_role: r.recipient_role == null ? 'signer' : r.recipient_role,
    }))
    .filter((r) => r.role_label);
}

export function classifyIapSignerRoles(template) {
  const roles = signerRolesOf(template);
  const signers = roles.filter((r) => r.recipient_role === 'signer');
  if (roles.length !== 2 || signers.length !== 2) return null;
  const [a, b] = signers;
  const aCust = CUSTOMER_RE.test(a.role_label);
  const bCust = CUSTOMER_RE.test(b.role_label);
  const aStaff = STAFF_RE.test(a.role_label);
  const bStaff = STAFF_RE.test(b.role_label);
  if (aCust && bStaff) return { customer: a.role_label, staff: b.role_label };
  if (bCust && aStaff) return { customer: b.role_label, staff: a.role_label };
  return null;
}

function roleHasSig(blocks, label) {
  return blocks.some(
    (b) =>
      b &&
      SIG_TYPES.has(b.type) &&
      typeof b.role_label === 'string' &&
      b.role_label.trim() === label
  );
}

export function whyTemplateNotReady(template) {
  if (!template?.id) return PLACE_TEMPLATE_BLOCKS;
  const pair = classifyIapSignerRoles(template);
  if (!pair) return TEMPLATE_NEEDS_TWO_SIGNER_ROLES;
  const blocks = Array.isArray(template.blocks) ? template.blocks : [];
  if (blocks.some((b) => b && SENDER_FILL.has(b.type))) return TEMPLATE_HAS_SENDER_FILL;
  if (!roleHasSig(blocks, pair.customer) || !roleHasSig(blocks, pair.staff)) {
    return TEMPLATE_NEEDS_SIGNATURE_BLOCK;
  }
  return null;
}

export function templateIsReadyForCheckout(template) {
  return whyTemplateNotReady(template) === null;
}

export function staffDisplayName(email) {
  const raw = typeof email === 'string' ? email.trim() : '';
  if (!raw) return '';
  const local = raw.split('@')[0] || raw;
  return local.replace(/[._-]+/g, ' ').trim() || raw;
}
