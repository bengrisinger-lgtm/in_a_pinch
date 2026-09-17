import { useEffect, useState } from 'react';
import {
  PRONOUN_OPTIONS,
  claimOnboarding,
  completeOnboarding,
  getOnboardingStatus,
  type OnboardingStatus,
} from '../lib/staffApi';

type Props = {
  email: string;
  onDone: () => void;
};

export default function StaffOnboardingPage({ email, onDone }: Props) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    home_address: '',
    preferred_pronouns: '',
    emergency_contact_first_name: '',
    emergency_contact_last_name: '',
    emergency_contact_relationship: '',
  });
  const [extra, setExtra] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await claimOnboarding(email);
      } catch {
        /* hire may already be linked */
      }
      try {
        const s = await getOnboardingStatus();
        if (cancelled) return;
        setStatus(s);
        if (s.hire) {
          setForm((f) => ({
            ...f,
            first_name: s.hire!.first_name,
            last_name: s.hire!.last_name,
            phone: s.hire!.phone || '',
          }));
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load onboarding');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await completeOnboarding({ ...form, email, extra });
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="hub-panel onboarding-page">
        <p className="muted">Loading onboarding…</p>
      </section>
    );
  }

  return (
    <section className="hub-panel onboarding-page">
      <p className="eyebrow">Staff onboarding</p>
      <h1>Complete your profile</h1>
      <p className="muted hub-lead">
        One-time setup for {email}. Hub tools stay locked until this is saved.
      </p>

      <form className="onboarding-form" onSubmit={submit}>
        <div className="crm-form-grid">
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
            Phone
            <input
              required
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
          <label className="span-2">
            Home address
            <textarea
              required
              rows={2}
              value={form.home_address}
              onChange={(e) => setForm((f) => ({ ...f, home_address: e.target.value }))}
            />
          </label>
          <label>
            Preferred pronouns
            <select
              value={form.preferred_pronouns}
              onChange={(e) => setForm((f) => ({ ...f, preferred_pronouns: e.target.value }))}
            >
              <option value="">Prefer not to say</option>
              {PRONOUN_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>

        <h2>Emergency contact</h2>
        <div className="crm-form-grid">
          <label>
            First name
            <input
              required
              value={form.emergency_contact_first_name}
              onChange={(e) =>
                setForm((f) => ({ ...f, emergency_contact_first_name: e.target.value }))
              }
            />
          </label>
          <label>
            Last name
            <input
              required
              value={form.emergency_contact_last_name}
              onChange={(e) =>
                setForm((f) => ({ ...f, emergency_contact_last_name: e.target.value }))
              }
            />
          </label>
          <label>
            Relationship
            <input
              required
              placeholder="Spouse, parent, partner…"
              value={form.emergency_contact_relationship}
              onChange={(e) =>
                setForm((f) => ({ ...f, emergency_contact_relationship: e.target.value }))
              }
            />
          </label>
        </div>

        {status?.customFields?.length ? (
          <>
            <h2>Additional information</h2>
            <div className="crm-form-grid">
              {status.customFields.map((def) => (
                <label key={def.field_key}>
                  {def.label}
                  <input
                    type={def.field_type === 'date' ? 'date' : 'text'}
                    value={extra[def.field_key] || ''}
                    onChange={(e) =>
                      setExtra((x) => ({ ...x, [def.field_key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
          </>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" disabled={busy} className="onboarding-submit">
          {busy ? 'Saving…' : 'Finish onboarding'}
        </button>
      </form>
    </section>
  );
}
