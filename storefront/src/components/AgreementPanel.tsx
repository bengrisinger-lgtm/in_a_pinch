import { useEffect, useState } from 'react';
import {
  kitErrorMessage,
  listAgreementTemplates,
  listReadyPdfs,
  PLACE_TEMPLATE_BLOCKS,
  sendServiceAgreement,
  templateIsReadyForCheckout,
  uploadAgreementPdf,
  whyTemplateNotReady,
  type ReadyPdf,
  type SentAgreement,
  type SignTemplate,
} from '../lib/agreement';

type Props = {
  customerName: string;
  customerEmail: string;
  staffName: string;
  staffEmail: string;
  sending: boolean;
  error: string | null;
  sent: SentAgreement | null;
  onBusy: (busy: boolean) => void;
  onError: (msg: string | null) => void;
  onSent: (sent: SentAgreement) => void | Promise<void>;
  onContinue: () => void;
};

export default function AgreementPanel({
  customerName,
  customerEmail,
  staffName,
  staffEmail,
  sending,
  error,
  sent,
  onBusy,
  onError,
  onSent,
  onContinue,
}: Props) {
  const [templates, setTemplates] = useState<SignTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [docs, setDocs] = useState<ReadyPdf[]>([]);
  const [documentId, setDocumentId] = useState('');
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState(true);
  const [created, setCreated] = useState<SentAgreement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let tpls: SignTemplate[] = [];
      let pdfs: ReadyPdf[] = [];
      try {
        tpls = await listAgreementTemplates();
        if (!cancelled) setTemplates(tpls);
      } catch (err) {
        if (!cancelled) setListError(kitErrorMessage(err));
      }
      try {
        pdfs = await listReadyPdfs();
        if (!cancelled) setDocs(pdfs);
      } catch {
        // PDF catalog is optional until a template has no document_id.
      }
      if (cancelled) return;
      const ready = tpls.find(templateIsReadyForCheckout);
      const pick = ready || tpls[0];
      if (pick) {
        setTemplateId(pick.id);
        if (pick.document_id) setDocumentId(pick.document_id);
        else if (pdfs[0]) setDocumentId(pdfs[0].id);
      } else if (pdfs[0]) {
        setDocumentId(pdfs[0].id);
      }
      setListBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = templates.find((t) => t.id === templateId) || null;
  const notReadyReason = whyTemplateNotReady(selected);
  const templateReady = notReadyReason === null;
  const needsPdfPicker = Boolean(selected && !selected.document_id);

  function onPickTemplate(id: string) {
    setTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    if (tpl?.document_id) setDocumentId(tpl.document_id);
  }

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
    if (!templateId) {
      onError(PLACE_TEMPLATE_BLOCKS);
      return;
    }
    if (notReadyReason) {
      onError(notReadyReason);
      return;
    }
    if (needsPdfPicker && !documentId) {
      onError('This template has no PDF. Choose or upload the agreement PDF.');
      return;
    }
    onError(null);
    onBusy(true);
    try {
      const result = await sendServiceAgreement({
        templateId,
        documentId: needsPdfPicker ? documentId : undefined,
        customerName,
        customerEmail,
        staffName,
        staffEmail,
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
        Two kit signatures: Customer (the renter) and Staff (you, filled from this login). Place both
        blocks under Signatures → Templates. Checkout does not stamp a signature without the kit
        consent screen. Self-checkout later uses the same Staff role for the designated company
        signer.
      </p>
      {shown ? (
        <div className="summary">
          <p>
            <strong>Envelope sent.</strong> Id {shown.envelopeId}
          </p>
          <p className="muted">
            {shown.customerInviteSent
              ? `Customer invite emailed to ${shown.customerEmail}.`
              : `Customer invite did not send (${shown.customerInviteFailure || 'unknown'}). Use their link.`}
          </p>
          <p>
            <a href={shown.customerSigningUrl} target="_blank" rel="noopener noreferrer">
              Open customer signing link
            </a>
          </p>
          <p className="muted">
            Sign now as {shown.staffEmail}. That is your Staff block — the kit still records consent.
            {shown.staffInviteSent ? '' : ` Staff invite email skipped (${shown.staffInviteFailure || 'unknown'}).`}
          </p>
          <p>
            <a href={shown.staffSigningUrl} target="_blank" rel="noopener noreferrer">
              Sign as staff now
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
              <label htmlFor="agreement-template">Agreement template</label>
              <select
                id="agreement-template"
                value={templateId}
                onChange={(e) => onPickTemplate(e.target.value)}
                required
              >
                {templates.length === 0 ? (
                  <option value="">
                    {listBusy
                      ? 'Loading templates…'
                      : listError
                        ? 'Could not load templates'
                        : 'No templates — place a signature in Signatures → Templates'}
                  </option>
                ) : (
                  templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {templateIsReadyForCheckout(t) ? '' : ' (not ready for checkout)'}
                    </option>
                  ))
                )}
              </select>
            </div>
            {needsPdfPicker ? (
              <>
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
              </>
            ) : null}
            <div>
              <label>Customer</label>
              <input value={customerName} readOnly />
            </div>
            <div>
              <label>Customer email</label>
              <input value={customerEmail} readOnly />
            </div>
            <div>
              <label>Staff signer</label>
              <input value={staffName} readOnly />
            </div>
            <div>
              <label>Staff email</label>
              <input value={staffEmail} readOnly />
            </div>
          </div>
          {listError ? <p className="error">{listError}</p> : null}
          {error ? <p className="error">{error}</p> : null}
          {notReadyReason ? <p className="muted">{notReadyReason}</p> : null}
          <div className="actions">
            <span />
            <button type="submit" disabled={sending || !templateReady}>
              {sending ? 'Sending…' : 'Send for signature'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
