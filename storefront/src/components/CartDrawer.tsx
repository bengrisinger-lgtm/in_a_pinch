import { useEffect, useMemo, useState } from 'react';
import type { CartLine } from '../pages/CatalogPage';
import { formatUsd } from '../lib/dates';
import { deliveryFeeFromOneWay } from '../lib/delivery';
import { COMPANY_SIGNER } from '../lib/companySigner.js';
import { kit } from '../lib/kit';
import { cancelOrder } from '../lib/orderActions';
import {
  checkout,
  createPaymentLink,
  markPaid,
  markAwaitingPayment,
  attachEnvelope,
  type CalendarPush,
  type CheckoutQuote,
} from '../lib/quoteApi';
import AgreementPanel from './AgreementPanel';
import type { SentAgreement } from '../lib/agreement';

const EVENT_TYPES = [
  'Wedding',
  'Party',
  'Corporate Event',
  'Live Music',
  'Community Event',
  'Other',
] as const;

type Props = {
  cart: CartLine[];
  startsOn: string;
  endsOn: string;
  nights: number;
  onClose: () => void;
  onRemove: (skuId: string) => void;
  onReleaseAll: () => void;
  onOrderCancelled: () => void;
};

export default function CartDrawer({
  cart,
  startsOn,
  endsOn,
  nights,
  onClose,
  onRemove,
  onReleaseAll,
  onOrderCancelled,
}: Props) {
  const [panel, setPanel] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [eventType, setEventType] = useState<(typeof EVENT_TYPES)[number]>('Wedding');
  const [fulfillment, setFulfillment] = useState<'pickup' | 'delivery'>('pickup');
  const [address, setAddress] = useState('');
  const [miles, setMiles] = useState('10');
  const [minutes, setMinutes] = useState('20');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<CheckoutQuote | null>(null);
  const [paid, setPaid] = useState(false);
  const [paying, setPaying] = useState(false);
  const [agreement, setAgreement] = useState<SentAgreement | null>(null);
  const [calendar, setCalendar] = useState<CalendarPush | null>(null);

  const subtotal = cart.reduce((sum, line) => sum + line.dailyRate * line.quantity * nights, 0);
  const ttl = cart.find((l) => l.heldUntil)?.heldUntil;
  const holdIds = cart.flatMap((line) => line.holdIds);

  const deliveryPreview = useMemo(() => {
    if (fulfillment !== 'delivery') return 0;
    return deliveryFeeFromOneWay(Number(miles), Number(minutes)) ?? 0;
  }, [fulfillment, miles, minutes]);

  const total = subtotal + deliveryPreview;

  useEffect(() => {
    if (!saved?.id || !saved.envelope_id || paid || saved.status === 'cancelled') return;
    let cancelled = false;
    async function tick() {
      try {
        const detail = await kit().signing.get(saved!.envelope_id as string);
        if (cancelled) return;
        if (detail.envelope.status === 'completed' && saved!.status !== 'awaiting_payment') {
          const body = await markAwaitingPayment(saved!.id);
          if (!cancelled) setSaved((q) => (q ? { ...q, status: body.quote.status } : q));
        }
      } catch {
        // Poll is best-effort.
      }
    }
    tick();
    const id = window.setInterval(tick, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [saved?.id, saved?.envelope_id, saved?.status, paid]);

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!holdIds.length) {
      setError('Cart holds expired or empty. Add gear again from Rentals.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = await checkout({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        event_type: eventType,
        notes: notes.trim() || undefined,
        fulfillment,
        delivery_address: fulfillment === 'delivery' ? address.trim() : undefined,
        one_way_miles: fulfillment === 'delivery' ? Number(miles) : undefined,
        one_way_minutes: fulfillment === 'delivery' ? Number(minutes) : undefined,
        hold_ids: holdIds,
      });
      let quote = body.quote;
      try {
        const pay = await createPaymentLink(quote.id, window.location.origin);
        quote = { ...quote, payment_link_url: pay.url, payment_link_id: pay.id };
      } catch {
        // Agreement can still send; staff can mint the link from Orders.
      }
      setSaved(quote);
      setPanel(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save checkout');
    } finally {
      setSaving(false);
    }
  }

  async function openSquare() {
    if (!saved) return;
    setPaying(true);
    setError(null);
    try {
      const body = await createPaymentLink(saved.id, window.location.origin);
      window.open(body.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open Square');
    } finally {
      setPaying(false);
    }
  }

  async function recordPaid() {
    if (!saved) return;
    setPaying(true);
    setError(null);
    try {
      const body = await markPaid(saved.id);
      setPaid(true);
      setCalendar(body.calendar ?? { pushed: false, reason: 'not_configured' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark paid');
    } finally {
      setPaying(false);
    }
  }

  async function onAgreementSent(sent: SentAgreement) {
    if (!saved) throw new Error('Quote missing');
    const body = await attachEnvelope(saved.id, {
      document_id: sent.documentId,
      envelope_id: sent.envelopeId,
      customer_signing_token: sent.customerSigningToken,
      staff_signing_token: sent.staffSigningToken,
    });
    setSaved(body.quote);
    setAgreement(sent);
  }

  async function onCancelOrder() {
    if (!saved) return;
    if (!window.confirm('Cancel this order and release the holds on those serials?')) return;
    setSaving(true);
    setError(null);
    try {
      await cancelOrder(saved.id, saved.envelope_id);
      onOrderCancelled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel order');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay open" onClick={onClose} role="presentation">
      <div
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="cart-title"
      >
        <button className="close" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="eyebrow" style={{ color: 'var(--crab)' }}>
          Checkout
        </div>
        <h2 id="cart-title">Your In a Pinch AV order</h2>
        <div className="steps">
          <span className={`step${panel === 1 && !saved ? ' active' : ''}`}>1. Order</span>
          <span className={`step${panel === 2 && !saved ? ' active' : ''}`}>2. Details &amp; Delivery</span>
          <span className={`step${panel === 3 ? ' active' : ''}`}>3. Agreement</span>
          <span className={`step${panel === 4 || paid ? ' active' : ''}`}>4. Payment</span>
        </div>

        {saved && panel === 3 ? (
          <>
            <AgreementPanel
              customerName={name.trim()}
              customerEmail={email.trim()}
              staffName={COMPANY_SIGNER.name}
              staffEmail={COMPANY_SIGNER.email}
              paymentUrl={saved.payment_link_url}
              onEnsurePaymentUrl={async () => {
                if (saved.payment_link_url) return saved.payment_link_url;
                const pay = await createPaymentLink(saved.id, window.location.origin);
                setSaved((q) =>
                  q ? { ...q, payment_link_url: pay.url, payment_link_id: pay.id } : q
                );
                return pay.url;
              }}
              sending={saving}
              error={error}
              sent={agreement}
              onBusy={setSaving}
              onError={setError}
              onSent={onAgreementSent}
              onContinue={() => {
                setError(null);
                setPanel(4);
              }}
            />
            <div className="actions">
              <button
                className="danger"
                type="button"
                disabled={saving}
                onClick={() => void onCancelOrder()}
              >
                Cancel order and release holds
              </button>
            </div>
          </>
        ) : null}

        {saved && (panel === 4 || paid) ? (
          <div className="summary">
            {paid ? (
              <p>
                <strong>Paid.</strong> Holds on those serials are confirmed and no longer expire.
                {calendar?.pushed ? (
                  <> Copied onto the connected calendar.</>
                ) : (
                  <>
                    {' '}
                    Calendar copy skipped
                    {calendar?.reason ? ` (${calendar.reason})` : ''}. Connect Gmail or Outlook
                    under Integrations if it should appear there — this booking stays paid.
                  </>
                )}
              </p>
            ) : (
              <p>
                <strong>Quote saved.</strong> Staff recorded {saved.fulfillment || 'pickup'} for{' '}
                {formatUsd(Number(saved.total))}.
              </p>
            )}
            <p className="muted">Id {saved.id}</p>
            {saved.envelope_id ? (
              <p className="muted">Agreement envelope {saved.envelope_id}</p>
            ) : null}
            {saved.payment_link_url && !paid ? (
              <p>
                <a href={saved.payment_link_url} target="_blank" rel="noopener noreferrer">
                  Customer payment link
                </a>
                {' · '}
                <a
                  href={`mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent('Pay for your rental')}&body=${encodeURIComponent(saved.payment_link_url)}`}
                >
                  Email the renter
                </a>
              </p>
            ) : null}
            {!paid ? (
              <>
                <p className="muted">
                  Card numbers stay on Square&apos;s page. After the renter pays, click Mark paid
                  (Square webhooks come later). Renter magic-link signup is later — do not send
                  them through platform Create Account.
                </p>
                <p className="muted">No card number on this page.</p>
                {error ? <p className="error">{error}</p> : null}
                <div className="actions">
                  <button className="back" type="button" onClick={() => setPanel(3)}>
                    Back
                  </button>
                  <button className="back" type="button" disabled={paying} onClick={openSquare}>
                    {paying ? 'Working…' : 'Open Square checkout'}
                  </button>
                  <button type="button" disabled={paying} onClick={recordPaid}>
                    Mark paid
                  </button>
                </div>
                <div className="actions">
                  <button
                    className="danger"
                    type="button"
                    disabled={saving}
                    onClick={() => void onCancelOrder()}
                  >
                    Cancel order and release holds
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">No card number was collected on this page.</p>
            )}
          </div>
        ) : null}

        {!saved && panel === 1 ? (
          <>
            {cart.length === 0 ? <p className="muted">Cart is empty.</p> : null}
            {cart.map((line) => (
              <div className="cartitem" key={line.skuId}>
                <div>
                  <strong>{line.name}</strong>
                  <div className="muted">
                    Qty {line.quantity} · {line.serials.join(', ')}
                  </div>
                  <div className="muted">
                    {startsOn} → {endsOn} · {formatUsd(line.dailyRate * line.quantity * nights)}
                  </div>
                </div>
                <button type="button" onClick={() => onRemove(line.skuId)}>
                  Remove
                </button>
              </div>
            ))}
            <div className="summary">
              <div className="row">
                <span>Rental period</span>
                <span>
                  {nights} day{nights === 1 ? '' : 's'}
                </span>
              </div>
              <div className="row total">
                <span>Subtotal</span>
                <span>{formatUsd(subtotal)}</span>
              </div>
              {ttl ? (
                <p className="muted">
                  Cart hold until {new Date(ttl).toLocaleString()} (15 minutes before they
                  sign). After send: 2 hours. After both sign, unpaid: 24 hours.
                </p>
              ) : null}
            </div>
            <div className="actions">
              <button
                className="back"
                type="button"
                disabled={cart.length === 0}
                onClick={onReleaseAll}
              >
                Release holds
              </button>
              <button type="button" disabled={cart.length === 0} onClick={() => setPanel(2)}>
                Continue
              </button>
            </div>
          </>
        ) : null}

        {!saved && panel === 2 ? (
          <form onSubmit={saveDetails}>
            <h3>Rental details</h3>
            <div className="fields">
              <div>
                <label htmlFor="renter-name">Full name</label>
                <input
                  id="renter-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
              <div>
                <label htmlFor="renter-email">Email</label>
                <input
                  id="renter-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="renter-phone">Phone</label>
                <input
                  id="renter-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
              </div>
              <div>
                <label htmlFor="event-type">Event type</label>
                <select
                  id="event-type"
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value as (typeof EVENT_TYPES)[number])}
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>Rental start</label>
                <input value={startsOn} readOnly />
              </div>
              <div>
                <label>Rental end</label>
                <input value={endsOn} readOnly />
              </div>
              <div className="full">
                <label htmlFor="fulfillment">Pickup or delivery</label>
                <select
                  id="fulfillment"
                  value={fulfillment}
                  onChange={(e) => setFulfillment(e.target.value as 'pickup' | 'delivery')}
                >
                  <option value="pickup">Pickup</option>
                  <option value="delivery">Delivery</option>
                </select>
              </div>
              {fulfillment === 'delivery' ? (
                <div className="full">
                  <label htmlFor="event-address">Event address</label>
                  <input
                    id="event-address"
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Street, city, ZIP"
                    autoComplete="street-address"
                  />
                  <div className="fields" style={{ marginTop: 11 }}>
                    <div>
                      <label htmlFor="one-way-miles">One-way miles (staff estimate)</label>
                      <input
                        id="one-way-miles"
                        type="number"
                        min={0}
                        step="0.1"
                        required
                        value={miles}
                        onChange={(e) => setMiles(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="one-way-minutes">One-way minutes</label>
                      <input
                        id="one-way-minutes"
                        type="number"
                        min={0}
                        step="1"
                        required
                        value={minutes}
                        onChange={(e) => setMinutes(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="delivery-card">
                    <b>Delivery &amp; pickup estimate</b>
                    <div className="row">
                      <span>Four legs × miles × $0.66 + drive time × $30</span>
                      <span>{formatUsd(deliveryPreview)}</span>
                    </div>
                    <p className="muted">
                      Maps/GPS later. Fee is computed on pinch-service, not from a number the
                      browser sends.
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="full">
                <label htmlFor="event-notes">Event notes</label>
                <textarea
                  id="event-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Venue, load-in time, stairs, parking"
                />
              </div>
            </div>
            <div className="summary">
              <div className="row">
                <span>Equipment</span>
                <span>{formatUsd(subtotal)}</span>
              </div>
              {fulfillment === 'delivery' ? (
                <div className="row">
                  <span>Delivery &amp; pickup</span>
                  <span>{formatUsd(deliveryPreview)}</span>
                </div>
              ) : null}
              <div className="row total">
                <span>Total</span>
                <span>{formatUsd(total)}</span>
              </div>
              <p className="muted">No card number on this page. Next is the kit agreement, then Square.</p>
            </div>
            {error ? <p className="error">{error}</p> : null}
            <div className="actions">
              <button className="back" type="button" onClick={() => setPanel(1)}>
                Back
              </button>
              <button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save quote'}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
