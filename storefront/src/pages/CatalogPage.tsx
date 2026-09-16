import { useEffect, useMemo, useState } from 'react';
import CalendarModal from '../components/CalendarModal';
import {
  billingDays,
  formatPrettyDate,
  formatPrettyTime,
  formatUsd,
  LOAD_IN_DEFAULT,
  LOAD_OUT_DEFAULT,
  localIsoDate,
  money,
  needsVenueLoadOutNote,
  rentalHours,
  stockLabel,
  timeOptions,
} from '../lib/dates';
import { catalogImageSrc } from '../lib/catalogImage';
import {
  cancelHold,
  createHolds,
  InventoryApiError,
  listSkus,
  type Sku,
} from '../lib/inventoryApi';

export type CartLine = {
  skuId: string;
  name: string;
  dailyRate: number;
  quantity: number;
  holdIds: string[];
  serials: string[];
  heldUntil: string | null;
  startsOn: string;
  endsOn: string;
  loadIn: string;
  loadOut: string;
  /** No active hold and not enough units for the saved rental dates. */
  unavailable?: boolean;
};

type Props = {
  email: string;
  staff: boolean;
  consumer?: boolean;
  cart: CartLine[];
  setCart: (next: CartLine[] | ((prev: CartLine[]) => CartLine[])) => void;
  /** Bumped after hold release / line remove so availability reloads without unmounting. */
  catalogEpoch: number;
};

export default function CatalogPage({ email, staff, consumer = false, cart, setCart, catalogEpoch }: Props) {
  const today = localIsoDate();
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [loadIn, setLoadIn] = useState(LOAD_IN_DEFAULT);
  const [loadOut, setLoadOut] = useState(LOAD_OUT_DEFAULT);
  const [applied, setApplied] = useState({
    startsOn: today,
    endsOn: today,
    loadIn: LOAD_IN_DEFAULT,
    loadOut: LOAD_OUT_DEFAULT,
  });
  const [preview, setPreview] = useState<{ startsOn: string; endsOn: string } | null>(null);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [category, setCategory] = useState('All');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busySku, setBusySku] = useState<string | null>(null);
  const [calendarSku, setCalendarSku] = useState<Sku | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localEpoch, setLocalEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await listSkus(applied.startsOn, applied.endsOn);
        if (cancelled) return;
        const next = (Array.isArray(data.skus) ? data.skus : []).filter(
          (s) => s.active !== false && (s.units_total || 0) > 0
        );
        // Hold cancel can race a catalog GET. Keep the last good list instead of
        // flashing "No SKUs yet" when the reload comes back empty or aborted.
        setSkus((prev) => (next.length === 0 && prev.length > 0 ? prev : next));
      } catch (err) {
        if (cancelled) return;
        setError(apiMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applied.startsOn, applied.endsOn, catalogEpoch, localEpoch]);

  function reloadCatalog() {
    setLocalEpoch((n) => n + 1);
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const sku of skus) {
      if (sku.category) set.add(sku.category);
    }
    return ['All', ...Array.from(set).sort()];
  }, [skus]);

  const visible = skus.filter((s) => category === 'All' || s.category === category);
  const pricedStart = preview?.startsOn || applied.startsOn;
  const pricedEnd = preview?.endsOn || applied.endsOn;
  const billed = billingDays(pricedStart, loadIn, pricedEnd, loadOut);
  const nights = billed ?? 1;
  const hours = rentalHours(pricedStart, loadIn, pricedEnd, loadOut);
  const periodInvalid = billed == null;

  async function applyRange(nextStart: string, nextEnd: string) {
    const start = nextStart;
    const end = nextEnd < nextStart ? nextStart : nextEnd;
    let nextIn = loadIn;
    let nextOut = loadOut;
    const current = billingDays(start, nextIn, end, nextOut);
    const aligned = billingDays(start, nextIn, end, nextIn);
    if (start < end && current != null && aligned != null && current > aligned) {
      nextOut = nextIn;
      setLoadOut(nextIn);
    }
    const nextBilled = billingDays(start, nextIn, end, nextOut);
    const changed =
      start !== applied.startsOn ||
      end !== applied.endsOn ||
      nextIn !== applied.loadIn ||
      nextOut !== applied.loadOut;
    if (changed && cart.length) {
      await releaseCart();
    }
    setStartsOn(start);
    setEndsOn(end);
    setApplied({ startsOn: start, endsOn: end, loadIn: nextIn, loadOut: nextOut });
    setPreview(null);
    setPickerOpen(false);
    setCalendarSku(null);
    setError(nextBilled == null ? 'Load-out must be after load-in.' : null);
  }

  async function applyTimes(nextIn: string, nextOut: string) {
    setLoadIn(nextIn);
    setLoadOut(nextOut);
    const nextBilled = billingDays(applied.startsOn, nextIn, applied.endsOn, nextOut);
    if (nextBilled == null) {
      setError('Load-out must be after load-in.');
      return;
    }
    const changed = nextIn !== applied.loadIn || nextOut !== applied.loadOut;
    if (changed && cart.length) {
      await releaseCart();
    }
    setApplied({
      startsOn: applied.startsOn,
      endsOn: applied.endsOn,
      loadIn: nextIn,
      loadOut: nextOut,
    });
    setError(null);
  }

  function closePicker() {
    setPickerOpen(false);
    setCalendarSku(null);
    setPreview(null);
  }

  async function releaseCart() {
    const ids = cart.flatMap((line) => line.holdIds);
    await Promise.allSettled(ids.map((id) => cancelHold(id)));
    setCart([]);
  }

  async function addToCart(sku: Sku) {
    if (periodInvalid) {
      setError('Load-out must be after load-in.');
      return;
    }
    const available = sku.units_available ?? 0;
    const want = Math.min(qty[sku.id] || 1, available);
    if (want < 1) return;
    if (cart.some((line) => line.skuId === sku.id)) {
      setError('That SKU is already in the cart. Remove it to change quantity.');
      return;
    }
    setBusySku(sku.id);
    setError(null);
    try {
      const data = await createHolds({
        sku_id: sku.id,
        quantity: want,
        starts_on: applied.startsOn,
        ends_on: applied.endsOn,
        load_in_time: applied.loadIn,
        load_out_time: applied.loadOut,
      });
      setCart((prev) => [
        ...prev,
        {
          skuId: sku.id,
          name: sku.name,
          dailyRate: money(sku.daily_rate),
          quantity: data.holds.length,
          holdIds: data.holds.map((h) => h.id),
          serials: data.holds.map((h) => h.serial_number || h.unit_id),
          heldUntil: data.holds[0]?.held_until || null,
          startsOn: applied.startsOn,
          endsOn: applied.endsOn,
          loadIn: applied.loadIn,
          loadOut: applied.loadOut,
          unavailable: false,
        },
      ]);
      reloadCatalog();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusySku(null);
    }
  }

  return (
    <>
      <div className="hero">
        <div className="hero-inner">
          <div>
            <div className="eyebrow">Denver AV Equipment Rentals</div>
            <h1>AV rentals for when you're in a pinch.</h1>
            <p>
              {consumer
                ? 'Affordable speakers, microphones, mixers, lighting and projection for events around Denver. Professional gear without the giant rental-house price tag.'
                : 'Affordable speakers, microphones, mixers, lighting and projection for events around Denver. Dates check live serial stock — this SM58, not a generic count.'}
            </p>
            <a className="btn" href="#rentals">
              Browse Rentals
            </a>
          </div>
          <div className="hero-card">
            <strong>Last-minute event?</strong>
            <span>We've got you covered.</span>
            <hr />
            <strong>Check real availability.</strong>
            <span>Pick dates, open the calendar, add gear, sign the agreement, pay on Square. No account required.</span>
          </div>
        </div>
      </div>

      <section id="rentals">
        <div className="section-head">
          <div>
            <div className="eyebrow" style={{ color: 'var(--crab)' }}>
              Rental Catalog
            </div>
            <h2>Build your order.</h2>
          </div>
          <p className="muted">{staff ? `Staff session · ${email}` : 'No account required'}</p>
        </div>

        <p className="banner catalog-dates-banner">
          {staff
            ? 'Set your event load-in and load-out dates and times below. The catalog shows what is free for that window.'
            : 'Start here: pick your event load-in and load-out dates and times below. We show gear that is free for that window.'}
        </p>
        {error ? <p className="banner error">{error}</p> : null}

        <div className="datebar datebar-times">
          <button className="date-field" type="button" onClick={() => setPickerOpen(true)}>
            <span className="date-field-label">Load in</span>
            <span className="date-value">{formatPrettyDate(pricedStart)}</span>
          </button>
          <label className="date-field date-time">
            <span className="date-field-label">Time</span>
            <select
              value={loadIn}
              onChange={(e) => void applyTimes(e.target.value, loadOut)}
            >
              {timeOptions(false).map((hm) => (
                <option key={hm} value={hm}>
                  {formatPrettyTime(hm)}
                </option>
              ))}
            </select>
          </label>
          <button className="date-field" type="button" onClick={() => setPickerOpen(true)}>
            <span className="date-field-label">Load out</span>
            <span className="date-value">{formatPrettyDate(pricedEnd)}</span>
          </button>
          <label className="date-field date-time">
            <span className="date-field-label">Time</span>
            <select
              value={loadOut}
              onChange={(e) => void applyTimes(loadIn, e.target.value)}
            >
              {timeOptions(true).map((hm) => (
                <option key={hm} value={hm}>
                  {formatPrettyTime(hm)}
                </option>
              ))}
            </select>
          </label>
          <div className="datebar-action">
            <button className="btn orange" type="button" onClick={() => setPickerOpen(true)}>
              {periodInvalid
                ? 'Set times'
                : `${nights} day${nights === 1 ? '' : 's'}${
                    hours != null ? ` · ${hours % 1 === 0 ? hours : hours.toFixed(1)} hr` : ''
                  }`}
            </button>
          </div>
        </div>
        {needsVenueLoadOutNote(loadOut) ? (
          <p className="banner">
            This load-out is after midnight. Coordinate that time with the venue before you confirm.
          </p>
        ) : null}

        <div className="filters">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={cat === category ? 'filter active' : 'filter'}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {loading ? <p className="muted">Loading stock…</p> : null}
        {!loading && visible.length === 0 && !error ? (
          <p className="muted">
            {staff ? 'No SKUs yet. Open Stock to add serials.' : 'Nothing available for those dates yet.'}
          </p>
        ) : null}

        <div className="grid">
          {visible.map((sku) => {
            const available = sku.units_available ?? 0;
            const total = sku.units_total || 0;
            const band = sku.band || (available <= 0 ? 'none' : available < total ? 'low' : 'good');
            const maxQty = Math.max(1, available);
            const rate = money(sku.daily_rate);
            const inCart = cart.some((l) => l.skuId === sku.id);
            const photo = catalogImageSrc(sku.image_url);
            return (
              <article key={sku.id} className="product">
                {photo ? (
                  <img className="product-photo" src={photo} alt="" />
                ) : (
                  <div className="product-art">{sku.category || 'Gear'}</div>
                )}
                <div className="product-body">
                  <div className="tag">{sku.category || 'Uncategorized'}</div>
                  <h3>{sku.name}</h3>
                  {sku.description ? <p className="product-desc">{sku.description}</p> : null}
                  <span className={`stock ${band}`}>{stockLabel(sku.units_available, total, band)}</span>
                  <div className="price">
                    {formatUsd(rate)} / day · {formatUsd(rate * nights)} for {nights} day
                    {nights === 1 ? '' : 's'}
                  </div>
                  <div className="addrow">
                    <select
                      value={qty[sku.id] || 1}
                      onChange={(e) => setQty((prev) => ({ ...prev, [sku.id]: Number(e.target.value) }))}
                      disabled={available < 1}
                    >
                      {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={available < 1 || inCart || busySku === sku.id || periodInvalid}
                      onClick={() => addToCart(sku)}
                    >
                      {inCart ? 'In cart' : busySku === sku.id ? 'Holding…' : 'Add to cart'}
                    </button>
                  </div>
                  <div className="product-actions">
                    <button type="button" className="secondary" onClick={() => setCalendarSku(sku)}>
                      Calendar
                    </button>
                    {staff ? (
                      <button type="button" className="secondary" onClick={() => (window.location.hash = '#stock')}>
                        Edit stock
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div className="service-strip" id="services">
        <div className="service-inner">
          <div className="service-card">
            <div className="tag">Audio</div>
            <h3>Live Sound</h3>
            <p className="muted">PA systems, microphones, mixing and event sound support.</p>
          </div>
          <div className="service-card">
            <div className="tag">Visual</div>
            <h3>Projection</h3>
            <p className="muted">Projectors and presentation support for meetings and events.</p>
          </div>
          <div className="service-card">
            <div className="tag">Lighting</div>
            <h3>Event Lighting</h3>
            <p className="muted">Simple stage and atmosphere lighting for parties and productions.</p>
          </div>
        </div>
      </div>

      {pickerOpen || calendarSku ? (
        <CalendarModal
          sku={calendarSku}
          startsOn={startsOn}
          endsOn={endsOn}
          loadIn={loadIn}
          loadOut={loadOut}
          onClose={closePicker}
          onCommit={(nextStart, nextEnd) => {
            void applyRange(nextStart, nextEnd);
          }}
          onPreview={(nextStart, nextEnd) => setPreview({ startsOn: nextStart, endsOn: nextEnd })}
        />
      ) : null}
    </>
  );
}

function apiMessage(err: unknown): string {
  if (err instanceof InventoryApiError && err.status === 401) {
    return 'Could not load availability. Try again, or sign in as staff from the footer.';
  }
  if (err instanceof Error) return err.message;
  return 'Request failed';
}
