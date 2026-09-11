import { useEffect, useMemo, useState } from 'react';
import CalendarModal from '../components/CalendarModal';
import { addDaysIso, formatUsd, localIsoDate, money, spanDays, stockLabel } from '../lib/dates';
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
};

type Props = {
  email: string;
  cart: CartLine[];
  setCart: (next: CartLine[] | ((prev: CartLine[]) => CartLine[])) => void;
};

export default function CatalogPage({ email, cart, setCart }: Props) {
  const [startsOn, setStartsOn] = useState(localIsoDate());
  const [endsOn, setEndsOn] = useState(addDaysIso(localIsoDate(), 1));
  const [applied, setApplied] = useState({ startsOn: localIsoDate(), endsOn: addDaysIso(localIsoDate(), 1) });
  const [skus, setSkus] = useState<Sku[]>([]);
  const [category, setCategory] = useState('All');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busySku, setBusySku] = useState<string | null>(null);
  const [calendarSku, setCalendarSku] = useState<Sku | null>(null);

  const cartKey = cart.map((line) => line.skuId).join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await listSkus(applied.startsOn, applied.endsOn);
        if (cancelled) return;
        setSkus(data.skus.filter((s) => s.active !== false));
      } catch (err) {
        if (cancelled) return;
        setSkus([]);
        setError(apiMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applied, cartKey]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const sku of skus) {
      if (sku.category) set.add(sku.category);
    }
    return ['All', ...Array.from(set).sort()];
  }, [skus]);

  const visible = skus.filter((s) => category === 'All' || s.category === category);
  const nights = spanDays(applied.startsOn, applied.endsOn);

  async function checkDates() {
    if (endsOn < startsOn) {
      setError('End date must be on or after start date.');
      return;
    }
    if (cart.length) {
      await releaseCart();
    }
    setApplied({ startsOn, endsOn });
  }

  async function releaseCart() {
    const ids = cart.flatMap((line) => line.holdIds);
    await Promise.allSettled(ids.map((id) => cancelHold(id)));
    setCart([]);
  }

  async function addToCart(sku: Sku) {
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
        },
      ]);
      window.dispatchEvent(new Event('iap-open-cart'));
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
              Affordable speakers, microphones, mixers, lighting and projection for events around
              Denver. Dates check live serial stock — this SM58, not a generic count.
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
            <span>Select dates to see how many units are free before you add gear. Holds last 2 hours.</span>
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
          <p className="muted">Staff session · {email}</p>
        </div>

        <p className="banner">
          Signed in as staff. Add-to-cart places a 2-hour hold on those serials. Checkout details,
          kit agreement, and Square are the next slices — no card fields here.
        </p>
        {error ? <p className="banner error">{error}</p> : null}

        <div className="datebar">
          <div>
            <label htmlFor="catalogStart">Rental start</label>
            <input
              id="catalogStart"
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="catalogEnd">Rental end</label>
            <input
              id="catalogEnd"
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="btn orange" type="button" onClick={checkDates}>
              Check Dates
            </button>
          </div>
        </div>

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
          <p className="muted">No SKUs yet. Open Stock to add serials.</p>
        ) : null}

        <div className="grid">
          {visible.map((sku) => {
            const available = sku.units_available ?? 0;
            const total = sku.units_total || 0;
            const band = sku.band || (available <= 0 ? 'none' : available < total ? 'low' : 'good');
            const maxQty = Math.max(1, available);
            const rate = money(sku.daily_rate);
            const inCart = cart.some((l) => l.skuId === sku.id);
            return (
              <article key={sku.id} className="product">
                <div className="product-art">{sku.category || 'Gear'}</div>
                <div className="product-body">
                  <div className="tag">{sku.category || 'Uncategorized'}</div>
                  <h3>{sku.name}</h3>
                  <span className={`stock ${band}`}>{stockLabel(sku.units_available, total, band)}</span>
                  <div className="price">
                    {formatUsd(rate)} / day
                    {nights > 1 ? ` · ${formatUsd(rate * nights)} for ${nights} days` : ''}
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
                      disabled={available < 1 || inCart || busySku === sku.id}
                      onClick={() => addToCart(sku)}
                    >
                      {inCart ? 'In cart' : busySku === sku.id ? 'Holding…' : 'Add to cart'}
                    </button>
                  </div>
                  <div className="product-actions">
                    <button type="button" className="secondary" onClick={() => setCalendarSku(sku)}>
                      Calendar
                    </button>
                    <button type="button" className="secondary" onClick={() => (window.location.hash = '#stock')}>
                      Edit stock
                    </button>
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

      <footer id="contact">
        <p>Denver, Colorado • Audio • Video • Lighting • Equipment Rentals</p>
      </footer>

      {calendarSku ? (
        <CalendarModal sku={calendarSku} onClose={() => setCalendarSku(null)} />
      ) : null}
    </>
  );
}

function apiMessage(err: unknown): string {
  if (err instanceof InventoryApiError && err.status === 401) {
    return 'Inventory API returned 401. Staff cookie is present, but live gateway still 401s tenant spokes until HMAC cutover. Do not deploy api-gateway yet.';
  }
  if (err instanceof Error) return err.message;
  return 'Request failed';
}
