import { PlatformError, type SignTemplate } from '@securedbackend/sdk';
import { kit } from './kit';
import {
  classifyIapSignerRoles,
  whyTemplateNotReady,
  TEMPLATE_NEEDS_TWO_SIGNER_ROLES,
} from './templateRoles.js';
import { asTemplateList, isGenuineEmptyTemplateList, templateListShapeHint } from './templateList.js';
import { COMPANY_SIGNER } from './companySigner.js';
import { signedAgreementTitle } from './signedAgreementTitle.js';

const READY = new Set(['materialized']);

export {
  PLACE_TEMPLATE_BLOCKS,
  TEMPLATE_HAS_SENDER_FILL,
  TEMPLATE_NEEDS_SIGNATURE_BLOCK,
  TEMPLATE_NEEDS_TWO_SIGNER_ROLES,
  classifyIapSignerRoles,
  staffDisplayName,
  templateIsReadyForCheckout,
  whyTemplateNotReady,
} from './templateRoles.js';

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

export type SentAgreement = {
  envelopeId: string;
  documentId: string;
  customerSigningUrl: string;
  staffSigningUrl: string;
  customerSigningToken: string;
  staffSigningToken: string;
  customerEmail: string;
  staffEmail: string;
  customerInviteSent: boolean;
  customerInviteFailure: string | null;
  staffInviteSent: boolean;
  staffInviteFailure: string | null;
};

export async function sendServiceAgreement(input: {
  templateId: string;
  documentId?: string;
  customerName: string;
  customerEmail: string;
  staffName: string;
  staffEmail: string;
  paymentUrl?: string;
}): Promise<SentAgreement> {
  const client = kit();
  const { template } = await client.signing.getTemplate(input.templateId);
  const notReady = whyTemplateNotReady(template);
  if (notReady) {
    throw new Error(notReady);
  }
  const pair = classifyIapSignerRoles(template);
  if (!pair) {
    throw new Error(TEMPLATE_NEEDS_TWO_SIGNER_ROLES);
  }
  const customerEmail = input.customerEmail.trim();
  const staffEmail = COMPANY_SIGNER.email;
  if (!customerEmail) {
    throw new Error('Customer email is required to send the agreement.');
  }
  if (customerEmail.toLowerCase() === staffEmail.toLowerCase()) {
    throw new Error(
      'Customer and company signer must be different people. Use the renter’s email.'
    );
  }
  const documentId = template.document_id || input.documentId;
  if (!documentId) {
    throw new Error('This template has no PDF. Choose or upload the agreement PDF.');
  }

  const created = await client.signing.applyTemplate(template.id, {
    document_id: documentId,
    document_hash: await hashDocumentId(documentId),
    subject: signedAgreementTitle(input.customerName),
    message: input.paymentUrl
      ? `Please review and sign. After you sign, you will continue to payment. If you close that page, pay at ${input.paymentUrl}`
      : 'Please review and sign the Service Agreement.',
    signers: [
      {
        name: input.customerName.trim(),
        email: customerEmail,
        role_label: pair.customer,
        ...(input.paymentUrl ? { post_sign_redirect_url: input.paymentUrl } : {}),
      },
      {
        name: COMPANY_SIGNER.name,
        email: COMPANY_SIGNER.email,
        role_label: pair.staff,
      },
    ],
  });
  const sent = await client.signing.send(created.envelope.id);
  const customer = sent.signers.find((s) => s.role_label === pair.customer);
  const staff = sent.signers.find((s) => s.role_label === pair.staff);
  if (!customer?.signing_url_token || !staff?.signing_url_token) {
    throw new Error('Send succeeded but did not return both signing tokens.');
  }
  return {
    envelopeId: created.envelope.id,
    documentId,
    customerSigningUrl: client.signing.signingUrl(customer.signing_url_token),
    staffSigningUrl: client.signing.signingUrl(staff.signing_url_token),
    customerSigningToken: customer.signing_url_token,
    staffSigningToken: staff.signing_url_token,
    customerEmail,
    staffEmail,
    customerInviteSent: customer.invite_sent,
    customerInviteFailure: customer.invite_failure_reason,
    staffInviteSent: staff.invite_sent,
    staffInviteFailure: staff.invite_failure_reason,
  };
}

export async function listAgreementTemplates(): Promise<SignTemplate[]> {
  const page = await kit().signing.listTemplates();
  const list = asTemplateList(page);
  if (list.length) return list;
  if (isGenuineEmptyTemplateList(page, list)) return [];
  throw new Error(`Kit returned no templates (${templateListShapeHint(page)})`);
}

export {
  CONSUMER_AGREEMENT_UNAVAILABLE,
  pickStandardRentalTemplate,
} from './standardRentalTemplate.js';

export type { SignTemplate };
