import { useState } from 'react';
import { tenantConsoleHref } from '../lib/consoleHref';
import { addStaffProfileField, createStaffHire } from '../lib/staffApi';

type Props = { email: string };

export default function StaffHirePage({ email }: Props) {
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
  });
  const [fieldKey, setFieldKey] = useState('');
  const [fieldLabel, setFieldLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitHire(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await createStaffHire(form);
      setMessage(res.next_step);
      setForm({ first_name: '', last_name: '', email: '', phone: '' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save hire');
    } finally {
      setBusy(false);
    }
  }

  async function submitField(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addStaffProfileField({
        field_key: fieldKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        label: fieldLabel.trim(),
        field_type: fieldKey.includes('date') || fieldLabel.toLowerCase().includes('birth')
          ? 'date'
          : 'text',
      });
      setFieldKey('');
      setFieldLabel('');
      setMessage('Custom onboarding field added. New hires will see it on their first sign-in.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add field');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hub-panel crm-page">
      <p className="eyebrow">Staff hub</p>
      <h1>New hire</h1>
      <p className="muted hub-lead">
        Enter what you know before they sign up. Signed in as {email}. Staff PII stays in the
        tenant vault (staff-session API only). After saving, send an invite from the tenant
        console.
      </p>

      <form className="crm-form-grid staff-hire-form" onSubmit={submitHire}>
        <label>
          First name
          <input
            required
            value={form.first_name}
            onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
          />
        </label>
        <label>
          Last name
          <input
            required
            value={form.last_name}
            onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))}
          />
        </label>
        <label>
          Work email (invite target)
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </label>
        <label>
          Phone
          <input
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save new hire'}
        </button>
      </form>

      <p className="muted">
        Next:{' '}
        <a href={tenantConsoleHref()} rel="noopener noreferrer">
          Vault → Projects → Invite staff
        </a>{' '}
        using the same email. They must open the invite link, create their account, then complete
        onboarding on first hub visit.
      </p>

      <hr />

      <h2>Optional profile fields</h2>
      <p className="muted">
        Add columns for onboarding (e.g. <code>birthdate</code> / Birth date). Keys must be
        lowercase snake_case.
      </p>
      <form className="crm-form-grid" onSubmit={submitField}>
        <label>
          Field key
          <input
            required
            placeholder="birthdate"
            value={fieldKey}
            onChange={(e) => setFieldKey(e.target.value)}
          />
        </label>
        <label>
          Label
          <input
            required
            placeholder="Birth date"
            value={fieldLabel}
            onChange={(e) => setFieldLabel(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          Add field
        </button>
      </form>

      {message ? <p className="crm-success">{message}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
