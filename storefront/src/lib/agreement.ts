import { PlatformError, type SignTemplate } from '@securedbackend/sdk';
import { kit } from './kit';

const READY = new Set(['materialized']);
const SIG_TYPES = new Set(['signature', 'initials']);
const SENDER_FILL = new Set(['sender_text', 'sender_dropdown']);

export const PLACE_TEMPLATE_BLOCKS =
  'Place the renter signature in the tenant console under Signatures → Templates. Checkout cannot guess a corner of the page.';

export type ReadyPdf = {
  id: string;
  filename: string;
  contentType: string;
  status: string;
};

export async function hashDocumentId(docId: string): Promise<string> {
  const data = new TextEncoder().encode(docId);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function kitErrorMessage(err: unknown): string {
  if (err instanceof PlatformError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function listReadyPdfs(): Promise<ReadyPdf[]> {
  const page = await kit().documents.list({ limit: 50 });
  return page.items
    .filter(
      (d) =>
        READY.has(d.status) &&
        (d.contentType === 'application/pdf' || d.filename.toLowerCase().endsWith('.pdf'))
    )
    .map((d) => ({
      id: d.id,
      filename: d.filename,
      contentType: d.contentType,
      status: d.status,
    }));
}

export async function uploadAgreementPdf(
  file: File,
  onStatus: (msg: string) => void
): Promise<string> {
  const client = kit();
  const contentType = file.type || 'application/pdf';
  onStatus('Requesting upload URL…');
  const signed = await client.documents.requestUploadUrl({
    filename: file.name,
    contentType,
    sizeBytes: file.size,
  });
  onStatus('Uploading to storage…');
  await client.documents.putToSignedUrl(signed.uploadUrl, file, contentType);
  onStatus('Confirming upload…');
  await client.documents.confirmUpload(signed.outboxId);
  onStatus('Waiting for scan…');
  const start = Date.now();
  const max = 5 * 60 * 1000;
  while (Date.now() - start < max) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await client.documents.getUploadStatus(signed.outboxId);
    onStatus(`Scan: ${status.state}`);
    if (status.state === 'materialized' && status.documentId) return status.documentId;
    if (status.state === 'quarantined') {
      throw new Error(status.reason || 'Upload was quarantined');
    }
  }
  throw new Error('Scan timed out. Try the PDF again, or pick one already in Documents.');
}

export function renterSignerRole(template: SignTemplate): string | null {
  const roles = Array.isArray(template.signer_roles) ? template.signer_roles : [];
  const signerRoles = roles.filter((r) => !r.recipient_role || r.recipient_role === 'signer');
  if (roles.length !== 1 || signerRoles.length !== 1) return null;
  const label = signerRoles[0]?.role_label?.trim();
  return label || null;
}

export function templateIsReadyForCheckout(template: SignTemplate): boolean {
  if (!template?.id) return false;
  if (!renterSignerRole(template)) return false;
  const blocks = Array.isArray(template.blocks) ? template.blocks : [];
  if (!blocks.some((b) => SIG_TYPES.has(b.type))) return false;
  if (blocks.some((b) => SENDER_FILL.has(b.type))) return false;
  return true;
}

export type SentAgreement = {
  envelopeId: string;
  documentId: string;
  signingUrl: string;
  inviteSent: boolean;
  inviteFailure: string | null;
};

export async function sendServiceAgreement(input: {
  templateId: string;
  documentId?: string;
  signerName: string;
  signerEmail: string;
}): Promise<SentAgreement> {
  const client = kit();
  const { template } = await client.signing.getTemplate(input.templateId);
  if (!templateIsReadyForCheckout(template)) {
    throw new Error(PLACE_TEMPLATE_BLOCKS);
  }
  const roleLabel = renterSignerRole(template);
  if (!roleLabel) {
    throw new Error(PLACE_TEMPLATE_BLOCKS);
  }
  const documentId = template.document_id || input.documentId;
  if (!documentId) {
    throw new Error('This template has no PDF. Choose or upload the agreement PDF.');
  }

  const created = await client.signing.applyTemplate(template.id, {
    document_id: documentId,
    document_hash: await hashDocumentId(documentId),
    subject: 'Service agreement',
    signers: [{ name: input.signerName, email: input.signerEmail, role_label: roleLabel }],
  });
  const sent = await client.signing.send(created.envelope.id);
  const signer = sent.signers[0];
  if (!signer?.signing_url_token) {
    throw new Error('Send succeeded but returned no signer token.');
  }
  return {
    envelopeId: created.envelope.id,
    documentId,
    signingUrl: client.signing.signingUrl(signer.signing_url_token),
    inviteSent: signer.invite_sent,
    inviteFailure: signer.invite_failure_reason,
  };
}

export async function listAgreementTemplates(): Promise<SignTemplate[]> {
  const page = await kit().signing.listTemplates();
  return page.templates || [];
}

export type { SignTemplate };
