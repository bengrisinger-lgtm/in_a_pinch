import { FormEvent, useEffect, useMemo, useState } from 'react';
import { catalogImageSrc } from '../lib/catalogImage';
import {
  createCategory,
  patchCategory,
  deleteCategory,
  createSku,
  createUnit,
  InventoryApiError,
  listCategories,
  listSkus,
  listUnits,
  patchSku,
  patchUnit,
  uploadSkuCatalogImage,
  type InventoryCategory,
  type InventoryUnit,
  type Sku,
} from '../lib/inventoryApi';

type Props = { email: string };

/** Show new SKUs with no serials; hide SKUs whose units are all retired. */
function skuVisibleOnStock(unitsForSku: InventoryUnit[] | undefined): boolean {
  const list = unitsForSku ?? [];
  if (list.length === 0) return true;
  return list.some((u) => u.status === 'active');
}

function unitLabel(unit: InventoryUnit): string {
  return (unit.stock_code && unit.stock_code.trim()) || unit.serial_number;
}

export default function StockPage({ email }: Props) {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [units, setUnits] = useState<Record<string, InventoryUnit[]>>({});
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newCategoryPrefix, setNewCategoryPrefix] = useState('');
  const [rate, setRate] = useState('25');
  const [newDescription, setNewDescription] = useState('');
  const [descDraft, setDescDraft] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<InventoryCategory | null>(null);
  const [deleteCategoryConfirm, setDeleteCategoryConfirm] = useState('');
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [prefixDraft, setPrefixDraft] = useState<Record<string, string>>({});

  const visibleSkus = useMemo(
    () => skus.filter((sku) => skuVisibleOnStock(units[sku.id])),
    [skus, units]
  );

  async function refresh() {
    const [data, cats] = await Promise.all([listSkus(), listCategories()]);
    setSkus(data.skus);
    setCategories(cats.categories);
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

  function openCategoryManager() {
    setPrefixDraft(
      Object.fromEntries(categories.map((c) => [c.id, (c.stock_prefix ?? '').toUpperCase()]))
    );
    setCategoryManagerOpen(true);
  }

  async function saveCategoryPrefix(categoryId: string) {
    const raw = (prefixDraft[categoryId] ?? '').trim().toUpperCase();
    if (raw.length > 0 && raw.length !== 3) {
      setError('Stock prefix must be exactly 3 letters or numbers (e.g. MIC).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await patchCategory(categoryId, { stock_prefix: raw || null });
      setCategories(data.categories);
      setPrefixDraft(
        Object.fromEntries(
          data.categories.map((c) => [c.id, (c.stock_prefix ?? '').toUpperCase()])
        )
      );
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateSku(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('SKU name is required.');
      return;
    }
    if (!category.trim()) {
      setError('Pick a category from the list.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createSku({
        name: name.trim(),
        category: category.trim(),
        description: newDescription.trim() || undefined,
        daily_rate: Number(rate),
      });
      setName('');
      setCategory('');
      setNewDescription('');
      await refresh();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateCategory(e: FormEvent) {
    e.preventDefault();
    const typed = newCategory.trim();
    if (!typed) return;
    const prefix = newCategoryPrefix.trim().toUpperCase();
    if (prefix.length > 0 && prefix.length !== 3) {
      setError('Stock prefix must be exactly 3 letters or numbers (e.g. MIC).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await createCategory(typed, prefix || undefined);
      setCategories(data.categories);
      setNewCategory('');
      setNewCategoryPrefix('');
      setCategory(data.name);
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onAddSerial(skuId: string) {
    const serial = (serials[skuId] || '').trim();
    setBusy(true);
    setError(null);
    try {
      await createUnit(skuId, serial ? { serial_number: serial } : undefined);
      setSerials((prev) => ({ ...prev, [skuId]: '' }));
      await refresh();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function openDeleteCategory(cat: InventoryCategory) {
    setDeleteCategoryConfirm('');
    setDeleteCategoryTarget(cat);
  }

  function closeDeleteCategory() {
    setDeleteCategoryTarget(null);
    setDeleteCategoryConfirm('');
  }

  async function confirmDeleteCategory() {
    const cat = deleteCategoryTarget;
    if (!cat || deleteCategoryConfirm !== 'DELETE') return;
    setBusy(true);
    setError(null);
    try {
      const data = await deleteCategory(cat.id);
      setCategories(data.categories);
      if (category === cat.name) setCategory('');
      closeDeleteCategory();
      await refresh();
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeCatalogPhoto(sku: Sku) {
    if (
      !window.confirm(
        `Remove the catalog photo for “${sku.name}”? The shop will show the category placeholder until you upload a new image.`
      )
    ) {
      return;
    }
    await run(() => patchSku(sku.id, { image_url: null }).then(() => undefined));
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
        past bookings and leaves the calendar. When every serial on a SKU is retired, that SKU
        leaves this page (Find retired is coming). Each unit gets a stock code (e.g. MIC-0001) from
        its category prefix. Hide a SKU to take it off the renter catalog only. HMAC tenant comes
        from the session — never send a tenant id from this page.
      </p>
      {error ? <p className="banner error">{error}</p> : null}

      <div className="stock-category-entry">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={openCategoryManager}
        >
          Manage categories…
        </button>
        <p className="muted">
          Pick a category below when adding a SKU. Adding or removing category labels is a separate
          step — not something to do while entering stock.
        </p>
      </div>

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
          <select
            id="skuCat"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
            disabled={categories.length === 0}
          >
            <option value="">Pick a category…</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.name}>
                {cat.name}
              </option>
            ))}
          </select>
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
        <div className="stock-form-wide">
          <label htmlFor="skuDesc">Catalog description</label>
          <textarea
            id="skuDesc"
            className="stock-desc"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="What renters should know about this item (optional)."
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'end' }}>
          <button className="btn orange" type="submit" disabled={busy}>
            Add SKU
          </button>
        </div>
      </form>

      {visibleSkus.map((sku) => (
        <article key={sku.id} className="product" style={{ marginBottom: 16 }}>
          <div className="product-body">
            <div className="sku-cat-row">
              <label className="sr-only" htmlFor={`sku-cat-${sku.id}`}>
                Category for {sku.name}
              </label>
              <select
                id={`sku-cat-${sku.id}`}
                className="sku-cat-select"
                value={sku.category || ''}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value || null;
                  void run(() => patchSku(sku.id, { category: next }).then(() => undefined));
                }}
              >
                <option value="">Uncategorized</option>
                {sku.category && !categories.some((c) => c.name === sku.category) ? (
                  <option value={sku.category}>{sku.category}</option>
                ) : null}
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.name}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <h3>{sku.name}</h3>
            <p className="muted">
              {sku.units_total} active serial{sku.units_total === 1 ? '' : 's'} · $
              {Number(sku.daily_rate).toFixed(2)} / day
              {sku.active === false ? ' · Hidden from catalog' : ''}
            </p>
            <div className="stock-catalog-media">
              {catalogImageSrc(sku.image_url) ? (
                <img
                  className="stock-catalog-thumb"
                  src={catalogImageSrc(sku.image_url)!}
                  alt=""
                />
              ) : null}
              <div style={{ flex: '1 1 200px' }}>
                <label htmlFor={`sku-desc-${sku.id}`}>Catalog description</label>
                <textarea
                  id={`sku-desc-${sku.id}`}
                  className="stock-desc"
                  disabled={busy}
                  value={descDraft[sku.id] ?? sku.description ?? ''}
                  onChange={(e) =>
                    setDescDraft((prev) => ({ ...prev, [sku.id]: e.target.value }))
                  }
                  onBlur={() => {
                    const next = (descDraft[sku.id] ?? sku.description ?? '').trim();
                    const prev = (sku.description ?? '').trim();
                    if (next === prev) return;
                    void run(() =>
                      patchSku(sku.id, { description: next || null }).then(() => undefined)
                    );
                  }}
                  placeholder="Shown on the rental catalog."
                />
                <div className="stock-photo-actions">
                  <label className="btn secondary">
                    {sku.image_url ? 'Replace photo' : 'Upload catalog photo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      hidden
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        void run(() => uploadSkuCatalogImage(sku.id, file).then(() => undefined));
                      }}
                    />
                  </label>
                  {sku.image_url ? (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void removeCatalogPhoto(sku)}
                    >
                      Remove photo
                    </button>
                  ) : (
                    <span className="muted stock-photo-hint">
                      Remove photo appears after you upload one.
                    </span>
                  )}
                </div>
              </div>
            </div>
            {(units[sku.id] || [])
              .filter((unit) => unit.status === 'active')
              .map((unit) => (
              <div className="unit-row" key={unit.id}>
                <div className="unit-main">
                  {editing[unit.id] != null ? (
                    <input
                      value={editing[unit.id]}
                      onChange={(e) =>
                        setEditing((prev) => ({ ...prev, [unit.id]: e.target.value }))
                      }
                      aria-label={`Manufacturer serial for ${unitLabel(unit)}`}
                    />
                  ) : (
                    <span>
                      <strong>{unitLabel(unit)}</strong>
                      {unit.stock_code &&
                      unit.serial_number &&
                      unit.serial_number !== unit.stock_code ? (
                        <span className="muted"> · MFG {unit.serial_number}</span>
                      ) : null}
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
                      MFG serial
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Retire ${unitLabel(unit)}? It stays on past bookings and leaves the calendar. When the last serial on this SKU is retired, the SKU leaves Stock until we add Find retired.`
                        )
                      ) {
                        return;
                      }
                      void run(() => patchUnit(sku.id, unit.id, { status: 'retired' }).then(() => undefined));
                    }}
                  >
                    Retire
                  </button>
                </div>
              </div>
            ))}
            <div className="addrow stock-serial" style={{ marginTop: 12 }}>
              <input
                value={serials[sku.id] || ''}
                onChange={(e) => setSerials((prev) => ({ ...prev, [sku.id]: e.target.value }))}
                placeholder="Manufacturer serial (optional)"
              />
              <button type="button" disabled={busy} onClick={() => onAddSerial(sku.id)}>
                Add unit
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
      {skus.length > 0 && visibleSkus.length === 0 ? (
        <p className="muted">
          No active stock on this page. Fully retired SKUs are hidden until we add Find retired.
        </p>
      ) : null}

      {categoryManagerOpen ? (
        <div
          className="confirm-backdrop"
          role="presentation"
          onClick={() => setCategoryManagerOpen(false)}
        >
          <div
            className="confirm-panel category-manager-panel"
            role="dialog"
            aria-labelledby="category-manager-title"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="category-manager-title">Manage categories</h3>
            <p className="muted">
              Catalog filter labels and unit stock prefixes (MIC, SPK, …). Free typing is not allowed
              on SKUs — names must exist here first. Remove a label with × and type DELETE to
              confirm. SKUs that used that label become uncategorized.
            </p>
            <div className="category-chips">
              {categories.map((cat) => (
                <span className="category-chip" key={cat.id}>
                  {cat.name}
                  <label className="sr-only" htmlFor={`cat-prefix-${cat.id}`}>
                    Stock prefix for {cat.name}
                  </label>
                  <input
                    id={`cat-prefix-${cat.id}`}
                    className="category-prefix-input"
                    maxLength={3}
                    disabled={busy}
                    placeholder="PRF"
                    value={prefixDraft[cat.id] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
                      setPrefixDraft((prev) => ({ ...prev, [cat.id]: v }));
                    }}
                    aria-label={`Stock prefix for ${cat.name}`}
                  />
                  <button
                    type="button"
                    className="category-prefix-save"
                    disabled={busy}
                    onClick={() => void saveCategoryPrefix(cat.id)}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="category-chip-remove"
                    disabled={busy}
                    aria-label={`Remove category ${cat.name}`}
                    onClick={() => openDeleteCategory(cat)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <form className="category-add" onSubmit={onCreateCategory}>
              <label htmlFor="newCat">Add a category</label>
              <div className="addrow stock-serial">
                <input
                  id="newCat"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="Projectors"
                />
                <input
                  className="category-prefix-input"
                  maxLength={3}
                  value={newCategoryPrefix}
                  onChange={(e) =>
                    setNewCategoryPrefix(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3)
                    )
                  }
                  placeholder="PRJ"
                  aria-label="Stock prefix for new category"
                />
                <button type="submit" disabled={busy || !newCategory.trim()}>
                  Add category
                </button>
              </div>
            </form>
            <div className="confirm-actions">
              <button type="button" className="btn orange" disabled={busy} onClick={() => setCategoryManagerOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteCategoryTarget ? (
        <div className="confirm-backdrop" role="presentation" onClick={closeDeleteCategory}>
          <div
            className="confirm-panel"
            role="dialog"
            aria-labelledby="delete-cat-title"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-cat-title">Delete category “{deleteCategoryTarget.name}”?</h3>
            <p className="muted">
              SKUs using this label will become uncategorized. You can pick a new category on each
              SKU in this list. To add the name again, open Manage categories.
            </p>
            <label htmlFor="delete-cat-confirm">Type DELETE to confirm</label>
            <input
              id="delete-cat-confirm"
              className="confirm-input"
              value={deleteCategoryConfirm}
              onChange={(e) => setDeleteCategoryConfirm(e.target.value)}
              autoComplete="off"
              autoFocus
            />
            <div className="confirm-actions">
              <button type="button" className="secondary" disabled={busy} onClick={closeDeleteCategory}>
                Cancel
              </button>
              <button
                type="button"
                className="btn orange"
                disabled={busy || deleteCategoryConfirm !== 'DELETE'}
                onClick={() => void confirmDeleteCategory()}
              >
                Delete category
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
