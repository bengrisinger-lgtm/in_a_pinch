import { useEffect, useRef, useState } from 'react';
import {
  CONSUMER_AGREEMENT_UNAVAILABLE,
  kitErrorMessage,
  listAgreementTemplates,
  listReadyPdfs,
  pickStandardRentalTemplate,
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
  paymentUrl?: string | null;
  onEnsurePaymentUrl?: () => Promise<string>;
  sending: boolean;
  error: string | null;
  sent: SentAgreement | null;
  onBusy: (busy: boolean) => void;
  onError: (msg: string | null) => void;
  onSent: (sent: SentAgreement) => void | Promise<void>;
  onContinue: () => void;
  /** Apex shop: no template picker — send Standard Rental Agreement. Hub keeps the staff form. */
  consumer?: boolean;
};

export default function AgreementPanel({
  customerName,
  customerEmail,
  staffName,
  staffEmail,
  paymentUrl,
  onEnsurePaymentUrl,
  sending,
  error,
  sent,
  onBusy,
  onError,
  onSent,
  onContinue,
  consumer = false,
}: Props) {
  const [templates, setTemplates] = useState<SignTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [docs, setDocs] = useState<ReadyPdf[]>([]);
  const [documentId, setDocumentId] = useState('');
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState(true);
  const [created, setCreated] = useState<SentAgreement | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const autoSendStarted = useRef(false);
  const onEnsurePaymentUrlRef = useRef(onEnsurePaymentUrl);
  const onBusyRef = useRef(onBusy);
  const onErrorRef = useRef(onError);
  const onSentRef = useRef(onSent);
  onEnsurePaymentUrlRef.current = onEnsurePaymentUrl;
  onBusyRef.current = onBusy;
  onErrorRef.current = onError;
  onSentRef.current = onSent;

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
      if (!consumer) {
        try {
          pdfs = await listReadyPdfs();
          if (!cancelled) setDocs(pdfs);
        } catch {
          // PDF catalog is optional until a template has no document_id.
        }
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
  }, [consumer]);

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
      const payUrl = paymentUrl || (onEnsurePaymentUrl ? await onEnsurePaymentUrl() : '');
      if (!payUrl) {
        throw new Error('Could not create the Square payment link. Try Send again.');
      }
      const result = await sendServiceAgreement({
        templateId,
        documentId: needsPdfPicker ? documentId : undefined,
        customerName,
        customerEmail,
        staffName,
        staffEmail,
        paymentUrl: payUrl,
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

  useEffect(() => {
    if (!consumer || shown || autoSendStarted.current) return;
    if (listBusy) return;
    autoSendStarted.current = true;
    void (async () => {
      onErrorRef.current(null);
      onBusyRef.current(true);
      try {
        const pick = pickStandardRentalTemplate(templates);
        if (!pick) {
          throw new Error(CONSUMER_AGREEMENT_UNAVAILABLE);
        }
        const ensurePay = onEnsurePaymentUrlRef.current;
        const payUrl = paymentUrl || (ensurePay ? await ensurePay() : '');
        if (!payUrl) {
          throw new Error('Could not create the Square payment link. Try again.');
        }
        const result = await sendServiceAgreement({
          templateId: pick.id,
          documentId: pick.document_id || undefined,
          customerName,
          customerEmail,
          staffName,
          staffEmail,
          paymentUrl: payUrl,
        });
        setCreated(result);
        await onSentRef.current(result);
      } catch (err) {
        onErrorRef.current(kitErrorMessage(err));
      } finally {
        onBusyRef.current(false);
      }
    })();
  }, [
    consumer,
    shown,
    listBusy,
    templates,
    paymentUrl,
    customerName,
    customerEmail,
    staffName,
    staffEmail,
    retryNonce,
  ]);

  if (consumer) {
    return (
      <div>
        <h3>Service agreement</h3>
        {shown ? (
          <div className="summary">
            <p>
              <strong>We sent the Standard Rental Agreement to {shown.customerEmail}.</strong>
            </p>
            <p className="muted">
              {shown.customerInviteSent
                ? 'Open that email to sign, then continue to payment. If the email is slow, use the signing link below.'
                : `Invite email did not send (${shown.customerInviteFailure || 'unknown'}). Use the signing link below.`}
            </p>
            <p>
              <a href={shown.customerSigningUrl} target="_blank" rel="noopener noreferrer">
                Open the agreement to sign
              </a>
            </p>
            {error ? <p className="error">{error}</p> : null}
            <div className="actions">
              <span />
              <button type="button" onClick={onContinue}>
                Continue to payment
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="muted">Sending the Standard Rental Agreement…</p>
            {error ? (
              <>
                <p className="error">{error}</p>
                <div className="actions">
                  <span />
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => {
                      autoSendStarted.current = false;
                      onError(null);
                      setRetryNonce((n) => n + 1);
                    }}
                  >
                    Try again
                  </button>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <h3>Service agreement</h3>
      <p className="muted">
        Two kit signatures: Customer (the renter) and Owner (Cadel Grisinger, emailed at
        cadel@inapinchav.com). Place both blocks under Signatures → Templates. Checkout does not
        stamp a signature without the kit consent screen. Send emails the renter one invite with
        the signing link and the Square pay URL — you do not send a second payment email. You can
        reopen either link from Orders after you leave this screen.
      </p>
      {shown ? (
        <div className="summary">
          <p>
            <strong>Envelope sent.</strong> Id {shown.envelopeId}
          </p>
          <p className="muted">
            {shown.customerInviteSent
              ? `Customer invite emailed to ${shown.customerEmail}. That email includes the Square payment link — no extra send.`
              : `Customer invite did not send (${shown.customerInviteFailure || 'unknown'}). Use their signing link, then the payment link from Orders.`}
          </p>
          <p>
            <a href={shown.customerSigningUrl} target="_blank" rel="noopener noreferrer">
              Open customer signing link
            </a>
          </p>
          <p className="muted">
            {shown.staffInviteSent
              ? `Owner invite emailed to ${shown.staffEmail} (${staffName}).`
              : `Owner invite did not send (${shown.staffInviteFailure || 'unknown'}). Use Cadel’s link.`}
            {' '}
            Do not sign as Cadel unless you are Cadel — the kit records consent on that name.
          </p>
          <p>
            <a href={shown.staffSigningUrl} target="_blank" rel="noopener noreferrer">
              Open Cadel&apos;s signing link
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
              <label>Owner signer</label>
              <input value={staffName} readOnly />
            </div>
            <div>
              <label>Owner email</label>
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
