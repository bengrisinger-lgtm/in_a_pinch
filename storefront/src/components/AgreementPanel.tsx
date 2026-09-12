import { useEffect, useState } from 'react';
import {
  kitErrorMessage,
  listReadyPdfs,
  sendServiceAgreement,
  uploadAgreementPdf,
  type ReadyPdf,
  type SentAgreement,
} from '../lib/agreement';

type Props = {
  quoteId: string;
  signerName: string;
  signerEmail: string;
  sending: boolean;
  error: string | null;
  sent: SentAgreement | null;
  onBusy: (busy: boolean) => void;
  onError: (msg: string | null) => void;
  onSent: (sent: SentAgreement) => void | Promise<void>;
  onContinue: () => void;
};

export default function AgreementPanel({
  quoteId,
  signerName,
  signerEmail,
  sending,
  error,
  sent,
  onBusy,
  onError,
  onSent,
  onContinue,
}: Props) {
  const [docs, setDocs] = useState<ReadyPdf[]>([]);
  const [documentId, setDocumentId] = useState('');
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [created, setCreated] = useState<SentAgreement | null>(null);

  useEffect(() => {
    let cancelled = false;
    listReadyPdfs()
      .then((list) => {
        if (cancelled) return;
        setDocs(list);
        if (list[0]) setDocumentId(list[0].id);
      })
      .catch((err) => {
        if (!cancelled) setListError(kitErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFile(file: File) {
    onError(null);
    onBusy(true);
    try {
      const id = await uploadAgreementPdf(file, setUploadStatus);
      setDocumentId(id);
      setDocs((prev) => {
        if (prev.some((d) => d.id === id)) return prev;
        return [{ id, filename: file.name, contentType: 'application/pdf', status: 'materialized' }, ...prev];
      });
      setUploadStatus(`Ready: ${file.name}`);
    } catch (err) {
      onError(kitErrorMessage(err));
      setUploadStatus(null);
    } finally {
      onBusy(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!documentId) {
      onError('Choose or upload the service-agreement PDF first.');
      return;
    }
    onError(null);
    onBusy(true);
    try {
      const result = await sendServiceAgreement({
        documentId,
        signerName,
        signerEmail,
        quoteId,
      });
      setCreated(result);
      await onSent(result);
    } catch (err) {
      onError(kitErrorMessage(err));
    } finally {
      onBusy(false);
    }
  }

  async function retryStore() {
    if (!created) return;
    onError(null);
    onBusy(true);
    try {
      await onSent(created);
    } catch (err) {
      onError(kitErrorMessage(err));
    } finally {
      onBusy(false);
    }
  }

  const shown = sent || created;

  return (
    <div>
      <h3>Service agreement</h3>
      <p className="muted">
        The renter signs on the kit signer app — not a typed name on this page. Bytes stay in
        the vault. This quote only stores the envelope UUID.
      </p>
      {shown ? (
        <div className="summary">
          <p>
            <strong>Envelope sent.</strong> Id {shown.envelopeId}
          </p>
          <p className="muted">
            {shown.inviteSent
              ? `Invite emailed to ${signerEmail}. Copy the link if they need it.`
              : `Invite email did not send (${shown.inviteFailure || 'unknown'}). Use the link.`}
          </p>
          <p>
            <a href={shown.signingUrl} target="_blank" rel="noopener noreferrer">
              Open signing link
            </a>
          </p>
          {error ? <p className="error">{error}</p> : null}
          <div className="actions">
            <span />
            {sent ? (
              <button type="button" onClick={onContinue}>
                Continue to payment
              </button>
            ) : (
              <button type="button" disabled={sending} onClick={() => void retryStore()}>
                {sending ? 'Saving…' : 'Store envelope on quote'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSend}>
          <div className="fields">
            <div className="full">
              <label htmlFor="agreement-pdf">Agreement PDF</label>
              <select
                id="agreement-pdf"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                required
              >
                {docs.length === 0 ? (
                  <option value="">No ready PDFs — upload one below</option>
                ) : (
                  docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.filename}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="full">
              <label htmlFor="agreement-file">Or upload a PDF</label>
              <input
                id="agreement-file"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void handleFile(file);
                }}
              />
              {uploadStatus ? <p className="muted">{uploadStatus}</p> : null}
            </div>
            <div>
              <label>Signer</label>
              <input value={signerName} readOnly />
            </div>
            <div>
              <label>Signer email</label>
              <input value={signerEmail} readOnly />
            </div>
          </div>
          {listError ? <p className="error">{listError}</p> : null}
          {error ? <p className="error">{error}</p> : null}
          <div className="actions">
            <span />
            <button type="submit" disabled={sending || !documentId}>
              {sending ? 'Sending…' : 'Send for signature'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
