import { useEffect, useState } from 'react';
import { COMPANY_SIGNER } from '../lib/companySigner.js';
import { formatUsd } from '../lib/dates';
import { kit } from '../lib/kit';
import { cancelOrder, signingHref } from '../lib/orderActions';
import { tenantConsoleHref } from '../lib/consoleHref';
import {
  createPaymentLink,
  listQuotes,
  markAwaitingPayment,
  type StaffQuote,
} from '../lib/quoteApi';

type Props = { email: string };

export default function OrdersPage({ email }: Props) {
  const [quotes, setQuotes] = useState<StaffQuote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(hashQuoteId());
  const [query, setQuery] = useState('');

  async function refresh(search = query) {
    const data = await listQuotes(search);
    setQuotes(data.quotes);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load orders');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onHash = () => setOpenId(hashQuoteId());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const pending = quotes.filter(
      (q) =>
        q.envelope_id &&
        q.status !== 'paid' &&
        q.status !== 'cancelled' &&
        q.status !== 'awaiting_payment'
    );
    if (!pending.length) return;
    let cancelled = false;
    async function tick() {
      for (const q of pending) {
        if (!q.envelope_id) continue;
        try {
          const detail = await kit().signing.get(q.envelope_id);
          if (cancelled) return;
          if (detail.envelope.status === 'completed') {
            await markAwaitingPayment(q.id);
            if (!cancelled) await refresh();
          }
        } catch {
          // Poll is best-effort.
        }
      }
    }
    tick();
    const id = window.setInterval(tick, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [quotes]);

  async function onCancel(quote: StaffQuote) {
    const paid = quote.status === 'paid';
    if (
      !window.confirm(
        paid
          ? `Cancel and refund ${quote.customer_name || 'this renter'}? Square refunds if the charge is on Square; otherwise this releases the gear and records a staff refund.`
          : `Cancel this order for ${quote.customer_name || 'the renter'} and release the holds?`
      )
    ) {
      return;
    }
    setBusyId(quote.id);
    setError(null);
    try {
      await cancelOrder(quote.id, quote.envelope_id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel order');
    } finally {
      setBusyId(null);
    }
  }

  async function onPayLink(quote: StaffQuote) {
    setBusyId(quote.id);
    setError(null);
    try {
      const body = await createPaymentLink(quote.id, window.location.origin);
      setQuotes((prev) =>
        prev.map((q) => (q.id === quote.id ? { ...q, payment_link_url: body.url, payment_link_id: body.id } : q))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create payment link');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <div className="eyebrow" style={{ color: 'var(--crab)' }}>
            Orders
          </div>
          <h2>Reopen, cancel, or release a hold.</h2>
        </div>
        <p className="muted">{email}</p>
      </div>
      <p className="banner">
        Cart holds last 15 minutes. After the agreement is sent they last 2 hours. After both
        people sign, unpaid holds last 24 hours, then the reservation cancels so the gear is
        free. Paid bookings do not expire. Company signer is {COMPANY_SIGNER.name} (
        {COMPANY_SIGNER.email}).
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      <form
        className="orders-search"
        onSubmit={(e) => {
          e.preventDefault();
          void refresh(query);
        }}
      >
        <label htmlFor="order-search">Search by customer name</label>
        <div className="orders-search-row">
          <input
            id="order-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or email"
          />
          <button type="submit">Search</button>
        </div>
      </form>
      {loading ? <p className="muted">Loading orders…</p> : null}
      {!loading && quotes.length === 0 ? (
        <p className="muted">No orders yet. Save a quote from Rentals.</p>
      ) : null}
      <div className="orders-list">
        {quotes.map((quote) => {
          const customerUrl = signingHref(quote.customer_signing_token);
          const staffUrl = signingHref(quote.staff_signing_token);
          const open = openId === quote.id;
          const canCancel = quote.status !== 'cancelled' && quote.status !== 'refunded';
          const canPay = quote.status !== 'paid' && quote.status !== 'cancelled' && quote.status !== 'refunded';
          return (
            <article key={quote.id} className={`order-card${open ? ' open' : ''}`}>
              <button
                type="button"
                className="order-head"
                onClick={() => setOpenId(open ? null : quote.id)}
              >
                <div>
                  <strong>{quote.customer_name || 'Renter'}</strong>
                  <div className="muted">
                    {quote.customer_email || ''}
                    {quote.starts_on && quote.ends_on
                      ? ` · ${quote.starts_on} → ${quote.ends_on}`
                      : ''}
                  </div>
                </div>
                <div className="order-meta">
                  <span className={`order-status ${quote.status}`}>{labelStatus(quote.status)}</span>
                  <span>{formatUsd(Number(quote.total))}</span>
                </div>
              </button>
              {open ? (
                <div className="order-body">
                  <p className="muted">Id {quote.id}</p>
                  {quote.held_until && canCancel ? (
                    <p className="muted">
                      Hold until {new Date(quote.held_until).toLocaleString()}
                    </p>
                  ) : null}
                  {quote.envelope_id ? (
                    <p className="muted">Agreement envelope {quote.envelope_id}</p>
                  ) : (
                    <p className="muted">No agreement sent yet.</p>
                  )}
                  {canPay ? (
                    <p>
                      {quote.payment_link_url ? (
                        <>
                          <a href={quote.payment_link_url} target="_blank" rel="noopener noreferrer">
                            Customer payment link
                          </a>
                          {quote.customer_email ? (
                            <>
                              {' · '}
                              <a
                                href={`mailto:${encodeURIComponent(quote.customer_email)}?subject=${encodeURIComponent('Pay for your rental')}&body=${encodeURIComponent(quote.payment_link_url)}`}
                              >
                                Email the renter
                              </a>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busyId === quote.id}
                          onClick={() => void onPayLink(quote)}
                        >
                          Create payment link
                        </button>
                      )}
                    </p>
                  ) : null}
                  {quote.status === 'signing' || quote.status === 'awaiting_payment' ? (
                    <>
                      {customerUrl ? (
                        <p>
                          <a href={customerUrl} target="_blank" rel="noopener noreferrer">
                            Open customer signing link
                          </a>
                        </p>
                      ) : (
                        <p className="muted">
                          Customer invite was emailed
                          {quote.customer_email ? ` to ${quote.customer_email}` : ''}. This
                          order was sent before links were stored — open Vault if you need the
                          envelope.
                        </p>
                      )}
                      {staffUrl ? (
                        <p>
                          <a href={staffUrl} target="_blank" rel="noopener noreferrer">
                            Open Cadel&apos;s signing link
                          </a>
                          <span className="muted">
                            {' '}
                            ({COMPANY_SIGNER.name} · {COMPANY_SIGNER.email})
                          </span>
                        </p>
                      ) : quote.envelope_id ? (
                        <p className="muted">
                          Cadel was emailed at {COMPANY_SIGNER.email}. Open Vault to check the
                          envelope if that mail is missing.
                        </p>
                      ) : null}
                      <p>
                        <a href={vaultSignaturesHref()} rel="noopener noreferrer">
                          Open envelope in Vault
                        </a>
                      </p>
                    </>
                  ) : null}
                  <div className="actions">
                    {canCancel ? (
                      <button
                        type="button"
                        className="danger"
                        disabled={busyId === quote.id}
                        onClick={() => void onCancel(quote)}
                      >
                        {busyId === quote.id
                          ? 'Working…'
                          : quote.status === 'paid'
                            ? 'Cancel and refund'
                            : 'Cancel order and release holds'}
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function labelStatus(status: string): string {
  if (status === 'awaiting_payment') return 'Awaiting payment';
  if (status === 'signing') return 'Signing';
  if (status === 'draft') return 'Draft';
  if (status === 'paid') return 'Paid';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'refunded') return 'Refunded';
  return status;
}

function hashQuoteId(): string | null {
  const raw = window.location.hash.replace(/^#/, '');
  const q = raw.indexOf('?');
  if (q < 0) return null;
  return new URLSearchParams(raw.slice(q)).get('quote');
}

function vaultSignaturesHref(): string {
  return `${tenantConsoleHref()}#/signatures`;
}
