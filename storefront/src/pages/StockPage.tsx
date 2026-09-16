import { FormEvent, useEffect, useState } from 'react';
import { catalogImageSrc } from '../lib/catalogImage';
import {
  createCategory,
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

export default function StockPage({ email }: Props) {
  const [skus, setSkus] = useState<Sku[]>([]);
  const [units, setUnits] = useState<Record<string, InventoryUnit[]>>({});
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [rate, setRate] = useState('25');
  const [newDescription, setNewDescription] = useState('');
  const [descDraft, setDescDraft] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<InventoryCategory | null>(null);
  const [deleteCategoryConfirm, setDeleteCategoryConfirm] = useState('');

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

  async function onCreateSku(e: FormEvent) {
    e.preventDefault();
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
    setBusy(true);
    setError(null);
    try {
      const data = await createCategory(typed);
      setCategories(data.categories);
      setNewCategory('');
      setCategory(data.name);
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
        past bookings and leaves the calendar. Hide a SKU to take it off the catalog. HMAC tenant
        comes from the session — never send a tenant id from this page.
      </p>
      {error ? <p className="banner error">{error}</p> : null}

      <div className="category-manager">
        <h3>Categories</h3>
        <p className="muted">
          Add names here first, then pick from the list when you add a SKU — free typing is not
          allowed. Remove a label with × — type DELETE to confirm. SKUs that used that label
          become uncategorized (pick a new category on each SKU). The shop only shows a filter
          after a SKU uses that name.
        </p>
        <div className="category-chips">
          {categories.map((cat) => (
            <span className="category-chip" key={cat.id}>
              {cat.name}
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
            <button type="submit" disabled={busy || !newCategory.trim()}>
              Add category
            </button>
          </div>
        </form>
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

      {skus.map((sku) => (
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
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Retire ${unit.serial_number}? It stays on past bookings and leaves the calendar. Retired serials are hidden here until we add Find retired items.`
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
              SKU in this list. This cannot be undone from here — you would add the name again under
              Categories.
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
