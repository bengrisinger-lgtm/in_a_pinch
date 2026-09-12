import { PlatformError } from '@securedbackend/sdk';
import { kit } from './kit';

const READY = new Set(['materialized']);

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
  signingUrl: string;
  inviteSent: boolean;
  inviteFailure: string | null;
};

export async function sendServiceAgreement(input: {
  documentId: string;
  signerName: string;
  signerEmail: string;
  quoteId: string;
}): Promise<SentAgreement> {
  const client = kit();
  const created = await client.signing.create({
    document_id: input.documentId,
    document_hash: await hashDocumentId(input.documentId),
    subject: 'Service agreement',
    source_service: 'quotes',
    source_entity_id: input.quoteId,
    signers: [{ name: input.signerName, email: input.signerEmail, role_label: 'Renter' }],
    blocks: [{ signer_index: 0, page: 1, x: 72, y: 640, width: 180, height: 40 }],
  });
  const sent = await client.signing.send(created.envelope.id);
  const signer = sent.signers[0];
  if (!signer?.signing_url_token) {
    throw new Error('Send succeeded but returned no signer token.');
  }
  return {
    envelopeId: created.envelope.id,
    documentId: input.documentId,
    signingUrl: client.signing.signingUrl(signer.signing_url_token),
    inviteSent: signer.invite_sent,
    inviteFailure: signer.invite_failure_reason,
  };
}
