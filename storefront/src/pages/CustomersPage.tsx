import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createCustomer,
  deleteCustomer,
  listCustomers,
  mergeCustomers,
  updateCustomer,
  type Customer,
} from '../lib/crmApi';

type Props = { email: string };

export default function CustomersPage({ email }: Props) {
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
  });

  const load = useCallback(async (search?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listCustomers(search);
      setRows(data.customers);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => rows, [rows]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    await load(q);
  }

  function startEdit(c: Customer) {
    setEditId(c.id);
    setForm({
      first_name: c.first_name || c.name.split(' ')[0] || '',
      last_name: c.last_name || c.name.split(' ').slice(1).join(' ') || '',
      email: c.email,
      phone: c.phone || '',
    });
  }

  async function saveEdit() {
    if (!editId) return;
    try {
      const { customer } = await updateCustomer(editId, form);
      setRows((prev) => prev.map((r) => (r.id === editId ? customer : r)));
      setEditId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const { customer } = await createCustomer(form);
      setRows((prev) => [customer, ...prev]);
      setForm({ first_name: '', last_name: '', email: '', phone: '' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Remove this customer from the list? (Blocked if they have orders.)')) return;
    try {
      await deleteCustomer(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function onMerge(targetId: string) {
    if (!mergeSource || mergeSource === targetId) {
      setMergeSource(null);
      return;
    }
    const keep = rows.find((r) => r.id === targetId);
    const drop = rows.find((r) => r.id === mergeSource);
    if (!keep || !drop) return;
    if (
      !confirm(
        `Merge "${drop.name}" into "${keep.name}"? Orders move to the kept record.`
      )
    ) {
      return;
    }
    try {
      const { customer } = await mergeCustomers(targetId, mergeSource);
      setRows((prev) =>
        prev.filter((r) => r.id !== mergeSource).map((r) => (r.id === targetId ? customer : r))
      );
      setMergeSource(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Merge failed');
    }
  }

  return (
    <section className="hub-panel crm-page">
      <p className="eyebrow">Staff hub</p>
      <h1>Customers</h1>
      <p className="muted hub-lead">
        Renter records from checkout and staff entry. Signed in as {email}. Sorted by last name.
        Search by last name, phone, or email.
      </p>

      <form className="crm-search" onSubmit={onSearch}>
        <label htmlFor="customer-q">Search</label>
        <input
          id="customer-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Last name, phone, or email"
        />
        <button type="submit">Search</button>
        <button type="button" className="secondary" onClick={() => { setQ(''); void load(); }}>
          Clear
        </button>
      </form>

      {error ? <p className="form-error">{error}</p> : null}

      <details className="crm-add">
        <summary>Add customer</summary>
        <form className="crm-form-grid" onSubmit={onCreate}>
          <input
            required
            placeholder="First name"
            value={form.first_name}
            onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
          />
          <input
            required
            placeholder="Last name"
            value={form.last_name}
            onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
          />
          <input
            required
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <input
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <button type="submit">Save</button>
        </form>
      </details>

      {mergeSource ? (
        <p className="crm-merge-hint">
          Merge mode: click the customer to <strong>keep</strong>, or{' '}
          <button type="button" className="linkish" onClick={() => setMergeSource(null)}>
            cancel
          </button>
          .
        </p>
      ) : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Last</th>
                <th>First</th>
                <th>Email</th>
                <th>Phone</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) =>
                editId === c.id ? (
                  <tr key={c.id}>
                    <td colSpan={5}>
                      <div className="crm-form-grid">
                        <input
                          value={form.first_name}
                          onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                        />
                        <input
                          value={form.last_name}
                          onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
                        />
                        <input
                          value={form.email}
                          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        />
                        <input
                          value={form.phone}
                          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                        />
                        <button type="button" onClick={() => void saveEdit()}>
                          Save
                        </button>
                        <button type="button" className="secondary" onClick={() => setEditId(null)}>
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={c.id}
                    className={mergeSource === c.id ? 'crm-merge-source' : undefined}
                    onClick={() => mergeSource && void onMerge(c.id)}
                  >
                    <td>{c.last_name || '—'}</td>
                    <td>{c.first_name || c.name}</td>
                    <td>{c.email}</td>
                    <td>{c.phone || '—'}</td>
                    <td className="crm-actions">
                      <button type="button" onClick={() => startEdit(c)}>
                        Edit
                      </button>
                      <button type="button" onClick={() => setMergeSource(c.id)}>
                        Merge…
                      </button>
                      <button type="button" className="danger" onClick={() => void onDelete(c.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
          {!sorted.length ? <p className="muted">No customers yet.</p> : null}
        </div>
      )}
    </section>
  );
}
