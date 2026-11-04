'use client';

import { FormEvent, useState } from 'react';
import { CustomerPicker } from '../reports/[id]/customer-picker';
import { api, errorText } from '@/lib/prediction/api';
import { BUILDING_LABELS } from '@/lib/prediction/labels';

type Values = Record<string, string>;

const EMPTY: Values = {
  customer_id: '',
  client_name: '',
  ordered_by: '',
  contact_phone: '',
  contact_email: '',
  project_name: '',
  address: '',
  project_number: '',
  electrical_engineer: '',
  architect: '',
  project_date: '',
  building_type: '',
  description: '',
};

function initial(project: any | undefined): Values {
  if (!project) return { ...EMPTY, project_date: new Date().toISOString().slice(0, 10) };
  return Object.fromEntries(Object.keys(EMPTY).map((key) => [key, project[key] ?? ''])) as Values;
}

/**
 * The project's details, for opening one and for correcting it later.
 *
 * The customer comes from the same directory and picker as every report in the system,
 * so it carries the CRM's id and the contact who ordered the work.
 */
export function ProjectForm({ project, onSaved }: { project?: any; onSaved: (project: any) => void }) {
  const [values, setValues] = useState<Values>(() => initial(project));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch: Values) => setValues((current) => ({ ...current, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const body = { ...values, customer_id: values.customer_id || null, project_date: values.project_date || null };
    try {
      if (project) {
        // Only what changed, so the audit log records real edits and nothing else.
        const changes = Object.fromEntries(
          Object.entries(body).filter(([key, value]) => (project[key] ?? '') !== (value ?? '')),
        );
        onSaved(await api(`/projects/${project.id}`, { method: 'PATCH', json: { ...changes, reason: 'עדכון פרטי פרויקט' } }));
      } else {
        onSaved(await api('/projects', { method: 'POST', json: body }));
      }
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="notice error">{error}</div>}

      <section className="card">
        <h2 style={{ marginBottom: 10 }}>הלקוח</h2>
        <div className="grid">
          <CustomerPicker
            onPick={(fields) => {
              const company = fields.customerType === 'company' && fields.companyName;
              set({
                customer_id: fields.customerId,
                client_name: company ? fields.companyName : fields.recipientName,
                ordered_by: [fields.recipientName, fields.recipientTitle].filter(Boolean).join(', '),
                contact_phone: fields.phone,
                contact_email: fields.email,
                // The customer's address is a starting point: the building may be elsewhere.
                address: [fields.addressLine, fields.city].filter(Boolean).join(', '),
              });
            }}
          />
          <Text label="שם לקוח" name="client_name" values={values} set={set} required hint="מי שמזמין ומשלם. ממולא מהלקוח שנבחר." />
          <Text label="מזמין העבודה" name="ordered_by" values={values} set={set} hint="איש הקשר שהזמין את החיזוי." />
          <Text label="טלפון" name="contact_phone" values={values} set={set} ltr />
          <Text label="דוא״ל" name="contact_email" values={values} set={set} ltr />
        </div>
        {values.customer_id && <p className="hint small">מקושר ללקוח ב-CRM.</p>}
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 10 }}>המבנה</h2>
        <div className="grid">
          <Text
            label="שם פרויקט"
            name="project_name"
            values={values}
            set={set}
            required
            hint="שם המבנה או האתר שעושים לו חיזוי, כפי שיופיע בשער הדוח."
          />
          <Text
            label="כתובת המבנה"
            name="address"
            values={values}
            set={set}
            hint="מולאה מכתובת הלקוח. יש לוודא שזו כתובת המבנה ולא כתובת המשרד של הלקוח."
          />
          <div className="field">
            <label>סוג מבנה</label>
            <select required value={values.building_type} onChange={(e) => set({ building_type: e.target.value })}>
              <option value="" disabled>
                בחירה
              </option>
              {Object.entries(BUILDING_LABELS).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
            <span className="hint">קובע אילו כללים רגולטוריים חלים על החדרים.</span>
          </div>
          <Text
            label="מספר פרויקט (Job Number)"
            name="project_number"
            values={values}
            set={set}
            ltr
            hint="נקבע אוטומטית מבקרת ה-Job Number בהפקת הדוח הראשון. ממלאים רק אם כבר יש מספר."
          />
          <Text label="מהנדס חשמל" name="electrical_engineer" values={values} set={set} hint="מתכנן החשמל של המבנה." />
          <Text label="אדריכל" name="architect" values={values} set={set} />
          <div className="field">
            <label>תאריך</label>
            <input type="date" value={values.project_date} onChange={(e) => set({ project_date: e.target.value })} />
          </div>
          <div className="field wide">
            <label>תיאור המבנה</label>
            <textarea
              rows={2}
              value={values.description}
              placeholder="למשל: 6 קומות משרדים מעל חניון תת-קרקעי וחדר שנאים"
              onChange={(e) => set({ description: e.target.value })}
            />
          </div>
        </div>
      </section>

      <button className="btn-primary" disabled={busy}>
        {project ? 'שמירת שינויים' : 'פתיחת פרויקט'}
      </button>
    </form>
  );
}

function Text({
  label,
  name,
  values,
  set,
  required,
  ltr,
  hint,
}: {
  label: string;
  name: string;
  values: Values;
  set: (patch: Values) => void;
  required?: boolean;
  ltr?: boolean;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className={ltr ? 'ltr' : undefined}
        required={required}
        value={values[name]}
        onChange={(e) => set({ [name]: e.target.value })}
      />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
