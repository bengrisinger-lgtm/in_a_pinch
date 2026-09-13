import { FormEvent, useEffect, useState } from 'react';
import {
  createSku,
  createUnit,
  InventoryApiError,
  listSkus,
  listUnits,
  patchSku,
  patchUnit,
  type InventoryUnit,
  type Sku,
} from '../lib/inventoryApi';

type Props = { email: string };

export default function StockPage({ email }: Props) {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [units, setUnits] = useState<Record<string, InventoryUnit[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [rate, setRate] = useState('25');
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const data = await listSkus();
    setSkus(data.skus);
    const next: Record<string, InventoryUnit[]> = {};
    await Promise.all(
      data.skus.map(async (sku) => {
        const listed = await listUnits(sku.id);
        next[sku.id] = listed.units;
      })
    );
    setUnits(next);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) setError(apiMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreateSku(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createSku({
        name: name.trim(),
        category: category.trim() || undefined,
        daily_rate: Number(rate),
      });
      setName('');
      setCategory('');
      await refresh();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onAddSerial(skuId: string) {
    const serial = (serials[skuId] || '').trim();
    if (!serial) return;
    setBusy(true);
    setError(null);
    try {
      await createUnit(skuId, { serial_number: serial });
      setSerials((prev) => ({ ...prev, [skuId]: '' }));
      await refresh();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <div className="eyebrow" style={{ color: 'var(--crab)' }}>
            Staff stock
          </div>
          <h2>Add SKUs and serials.</h2>
        </div>
        <p className="muted">{email}</p>
      </div>
      <p className="banner">
        This is this unit, not a quantity bucket. Retire a serial to rotate it out — it stays on
        past bookings and leaves the calendar. Hide a SKU to take it off the catalog. HMAC tenant
        comes from the session — never send a tenant id from this page.
      </p>
      {error ? <p className="banner error">{error}</p> : null}

      <form className="stock-form" onSubmit={onCreateSku}>
        <div>
          <label htmlFor="skuName">SKU name</label>
          <input
            id="skuName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Shure SM58 Wired"
            required
          />
        </div>
        <div>
          <label htmlFor="skuCat">Category</label>
          <input
            id="skuCat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Microphones"
          />
        </div>
        <div>
          <label htmlFor="skuRate">Daily rate</label>
          <input
            id="skuRate"
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            required
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'end' }}>
          <button className="btn orange" type="submit" disabled={busy}>
            Add SKU
          </button>
        </div>
      </form>

      {skus.map((sku) => (
        <article key={sku.id} className="product" style={{ marginBottom: 16 }}>
          <div className="product-body">
            <div className="tag">{sku.category || 'Uncategorized'}</div>
            <h3>{sku.name}</h3>
            <p className="muted">
              {sku.units_total} active serial{sku.units_total === 1 ? '' : 's'} · $
              {Number(sku.daily_rate).toFixed(2)} / day
              {sku.active === false ? ' · Hidden from catalog' : ''}
            </p>
            {(units[sku.id] || []).map((unit) => (
              <div
                className={`unit-row${unit.status !== 'active' ? ' retired' : ''}`}
                key={unit.id}
              >
                <div className="unit-main">
                  {editing[unit.id] != null ? (
                    <input
                      value={editing[unit.id]}
                      onChange={(e) =>
                        setEditing((prev) => ({ ...prev, [unit.id]: e.target.value }))
                      }
                      aria-label={`New serial for ${unit.serial_number}`}
                    />
                  ) : (
                    <span>
                      <strong>{unit.serial_number}</strong>
                      {unit.nickname ? ` · ${unit.nickname}` : ''}
                    </span>
                  )}
                  <span className="muted">{unit.status}</span>
                </div>
                <div className="unit-actions">
                  {editing[unit.id] != null ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const next = (editing[unit.id] || '').trim();
                            if (!next || next === unit.serial_number) {
                              setEditing((prev) => {
                                const copy = { ...prev };
                                delete copy[unit.id];
                                return copy;
                              });
                              return;
                            }
                            await patchUnit(sku.id, unit.id, { serial_number: next });
                            setEditing((prev) => {
                              const copy = { ...prev };
                              delete copy[unit.id];
                              return copy;
                            });
                          })
                        }
                      >
                        Save serial
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          setEditing((prev) => {
                            const copy = { ...prev };
                            delete copy[unit.id];
                            return copy;
                          })
                        }
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        setEditing((prev) => ({ ...prev, [unit.id]: unit.serial_number }))
                      }
                    >
                      Change serial
                    </button>
                  )}
                  {unit.status === 'active' ? (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Retire ${unit.serial_number}? It stays on past bookings and leaves the calendar. You can restore it later.`
                          )
                        ) {
                          return;
                        }
                        void run(() => patchUnit(sku.id, unit.id, { status: 'retired' }).then(() => undefined));
                      }}
                    >
                      Retire
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(() => patchUnit(sku.id, unit.id, { status: 'active' }).then(() => undefined))
                      }
                    >
                      Restore
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div className="addrow stock-serial" style={{ marginTop: 12 }}>
              <input
                value={serials[sku.id] || ''}
                onChange={(e) => setSerials((prev) => ({ ...prev, [sku.id]: e.target.value }))}
                placeholder="Serial number"
              />
              <button type="button" disabled={busy} onClick={() => onAddSerial(sku.id)}>
                Add serial
              </button>
            </div>
            <div className="sku-actions">
              {sku.active === false ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => run(() => patchSku(sku.id, { active: true }).then(() => undefined))}
                >
                  Show on catalog
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Hide ${sku.name} from the catalog? Serials stay on this page. Upcoming bookings must be cancelled first.`
                      )
                    ) {
                      return;
                    }
                    void run(() => patchSku(sku.id, { active: false }).then(() => undefined));
                  }}
                >
                  Hide from catalog
                </button>
              )}
            </div>
          </div>
        </article>
      ))}
      {skus.length === 0 ? <p className="muted">No SKUs yet.</p> : null}
    </section>
  );
}

function apiMessage(err: unknown): string {
  if (err instanceof InventoryApiError && err.status === 401) {
    return 'Not signed in. Refresh and sign in again.';
  }
  if (err instanceof Error) return err.message;
  return 'Request failed';
}
