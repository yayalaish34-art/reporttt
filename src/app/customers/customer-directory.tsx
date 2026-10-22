'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import type { Customer } from '@/lib/customer-service';
import {
  findCustomers,
  refreshCustomersFromCrm,
  removeCustomer,
  saveCustomer,
  type ActionResult,
} from '../actions';

type Draft = Omit<Customer, 'id' | 'updatedAt'> & { id: string | null };

const EMPTY: Draft = {
  id: null,
  kind: 'company',
  contactName: '',
  contactTitle: '',
  companyName: '',
  addressLine: '',
  city: '',
  phone: '',
  email: '',
};

export function CustomerDirectory({ customers }: { customers: Customer[] }) {
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Matches from the directory as a whole, not just the page that was sent down.
   *
   * The first screenful is rendered on the server so the list is there
   * immediately, and typing filters it locally so it stays instant. But the
   * directory is now the CRM's — tens of thousands of records — and the loaded
   * page is a thin slice of it, so a local-only filter would quietly report
   * "no customers" for someone who is in fact on file. The server is asked in
   * parallel and its matches are merged in.
   */
  const [remote, setRemote] = useState<Customer[]>([]);

  useEffect(() => {
    const needle = filter.trim();
    if (needle.length < 2) {
      setRemote([]);
      return;
    }
    // Debounced: one query per pause in typing, not one per keystroke.
    let live = true;
    const timer = setTimeout(() => {
      findCustomers(needle, 100)
        .then((rows) => { if (live) setRemote(rows); })
        .catch(() => { if (live) setRemote([]); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [filter]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return customers;
    const local = customers.filter((c) =>
      [c.companyName, c.contactName, c.contactTitle, c.city, c.phone, c.email]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
    const seen = new Set(local.map((c) => c.id));
    return [...local, ...remote.filter((c) => !seen.has(c.id))];
  }, [customers, filter, remote]);

  const submit = (form: FormData) =>
    startTransition(async () => {
      const outcome = await saveCustomer(draft?.id ?? null, form);
      setResult(outcome);
      if (outcome.ok) setDraft(null);
    });

  const remove = (customer: Customer) =>
    startTransition(async () => {
      await removeCustomer(customer.id);
      setResult({ ok: true, message: `${customer.contactName} נמחק` });
    });

  return (
    <>
      {result && (
        <div className={`notice ${result.ok ? 'ok' : 'error'}`}>
          {result.message}
          {result.issues && (
            <ul>
              {result.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {draft && <CustomerForm draft={draft} onChange={setDraft} onSubmit={submit} onCancel={() => setDraft(null)} pending={pending} />}

      <section className="card">
        <div className="card-head">
          <h2>ספר לקוחות</h2>
          <span className="hint">{customers.length ? `${customers.length} לקוחות` : 'ריק'}</span>
          <span className="spacer" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={filter}
              placeholder="סינון…"
              onChange={(e) => setFilter(e.target.value)}
              style={{ width: 200 }}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending}
              title="מושך את ספריית הלקוחות מה-CRM. רשומות קיימות מתעדכנות, לא מוכפלות."
              onClick={() =>
                startTransition(async () => setResult(await refreshCustomersFromCrm()))
              }
            >
              {pending ? 'מייבא…' : 'ייבוא מה-CRM'}
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={() => setDraft({ ...EMPTY })}>
              לקוח חדש
            </button>
          </span>
        </div>

        {visible.length === 0 ? (
          <div className="empty">
            {customers.length === 0 ? 'אין עדיין לקוחות. הוסיפו את הראשון.' : 'אין תוצאות לסינון.'}
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>סוג</th>
                  <th>שם חברה</th>
                  <th>איש קשר</th>
                  <th>תפקיד</th>
                  <th>כתובת</th>
                  <th>עיר</th>
                  <th>טלפון</th>
                  <th>דוא״ל</th>
                  <th style={{ width: 120 }} />
                </tr>
              </thead>
              <tbody>
                {visible.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <span className={`badge${customer.kind === 'private' ? '' : ' ok'}`}>
                        {customer.kind === 'private' ? 'פרטי' : 'חברה'}
                      </span>
                    </td>
                    <td>{customer.companyName || '—'}</td>
                    <td>{customer.contactName}</td>
                    <td>{customer.contactTitle || '—'}</td>
                    <td>{customer.addressLine || '—'}</td>
                    <td>{customer.city || '—'}</td>
                    <td className="mono">{customer.phone || '—'}</td>
                    <td className="mono">{customer.email || '—'}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => setDraft({ ...customer, id: customer.id })}
                      >
                        עריכה
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(`למחוק את ${customer.contactName}?`)) remove(customer);
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function CustomerForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
  pending,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSubmit: (form: FormData) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const isCompany = draft.kind === 'company';

  return (
    <section className="card">
      <div className="card-head">
        <h2>{draft.id ? 'עריכת לקוח' : 'לקוח חדש'}</h2>
      </div>
      <div className="card-body">
        <form action={onSubmit}>
          {/* The kind travels as a hidden input because the toggle is buttons, not a radio group. */}
          <input type="hidden" name="kind" value={draft.kind} />

          <div className="grid">
            <div className="field wide">
              <label>סוג לקוח</label>
              <div className="toggle">
                {(
                  [
                    ['company', 'חברה'],
                    ['private', 'לקוח פרטי'],
                  ] as const
                ).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    className={draft.kind === value ? 'active' : undefined}
                    onClick={() =>
                      onChange(
                        value === 'private'
                          ? { ...draft, kind: value, companyName: '', contactTitle: '' }
                          : { ...draft, kind: value },
                      )
                    }
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>

            <Field
              label={isCompany ? 'שם איש הקשר' : 'שם הלקוח'}
              name="contactName"
              value={draft.contactName}
              onChange={(v) => onChange({ ...draft, contactName: v })}
              required
            />
            {isCompany && (
              <>
                <Field
                  label="תפקיד"
                  name="contactTitle"
                  value={draft.contactTitle}
                  onChange={(v) => onChange({ ...draft, contactTitle: v })}
                />
                <Field
                  label="שם החברה"
                  name="companyName"
                  value={draft.companyName}
                  onChange={(v) => onChange({ ...draft, companyName: v })}
                  required
                />
              </>
            )}
            <Field label="כתובת" name="addressLine" value={draft.addressLine} onChange={(v) => onChange({ ...draft, addressLine: v })} />
            <Field label="עיר" name="city" value={draft.city} onChange={(v) => onChange({ ...draft, city: v })} />
            <Field label="טלפון" name="phone" value={draft.phone} onChange={(v) => onChange({ ...draft, phone: v })} ltr />
            <Field label="דוא״ל" name="email" value={draft.email} onChange={(v) => onChange({ ...draft, email: v })} ltr />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? 'שומר…' : 'שמירה'}
            </button>
            <button type="button" onClick={onCancel} disabled={pending}>
              ביטול
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  required,
  ltr,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  ltr?: boolean;
}) {
  return (
    <div className="field">
      <label>
        {label}
        {required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      <input
        name={name}
        value={value}
        required={required}
        className={ltr ? 'ltr' : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
