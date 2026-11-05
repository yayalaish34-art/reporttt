'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, errorText } from '@/lib/api';
import { BUILDING_LABELS, INSTRUMENT_LABELS, OCCUPANCY_LABELS, label } from '@/lib/labels';

const EMPTY = {
  document_name: '',
  authority: '',
  instrument_type: '',
  document_version: '',
  effective_date: '',
  source_url: '',
  occupancy_type: '',
  building_types: [] as string[],
  threshold: '',
  threshold_type: 'INSTANTANEOUS_MAX',
  averaging_hours: '',
  notes: '',
};

type RuleForm = typeof EMPTY;

function toForm(rule: any): RuleForm {
  return {
    ...EMPTY,
    ...Object.fromEntries(Object.keys(EMPTY).map((key) => [key, rule[key] ?? (key === 'building_types' ? [] : '')])),
    threshold: String(rule.threshold),
    averaging_hours: rule.averaging_hours != null ? String(rule.averaging_hours) : '',
  };
}

function toPayload(form: RuleForm) {
  return {
    ...form,
    instrument_type: form.instrument_type || null,
    document_version: form.document_version || null,
    effective_date: form.effective_date || null,
    source_url: form.source_url || null,
    occupancy_type: form.occupancy_type || null,
    threshold: Number(form.threshold),
    averaging_hours: form.averaging_hours === '' ? null : Number(form.averaging_hours),
  };
}

export default function RegulationPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [r, me] = await Promise.all([api('/regulation/rules'), api('/auth/me')]);
    setRules(r);
    setUser(me);
  }, []);

  useEffect(() => {
    load().catch((failure) => setError(errorText(failure)));
  }, [load]);

  const canEdit = user && (user.role === 'APPROVER' || user.role === 'ADMIN');

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await load();
    } catch (failure) {
      const missing = failure instanceof ApiError && failure.missing.length ? `: ${failure.missing.join(', ')}` : '';
      setError(errorText(failure) + missing);
    }
  }

  const update = (name: string, value: unknown) => setForm((current) => ({ ...current, [name]: value }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>כללי רגולציה</h1>
          <p className="subtitle">מקור כל סף שהחיזוי נבדק מולו</p>
        </div>
      </div>
      <div className="notice warn">
        רק כלל פעיל ומאומת משפיע על סטטוס. בלי כלל כזה החדר מסומן REGULATION_REVIEW_REQUIRED, ואי אפשר להנפיק דוח סופי. כלל
        שנערך נעצר עד לאימות מחדש.
      </div>
      {error && <div className="notice error">{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>מסמך</th>
                <th>סוג מסמך</th>
                <th>גרסה</th>
                <th>תחילה</th>
                <th>שהייה</th>
                <th>מבנים</th>
                <th>סף</th>
                <th>סוג סף</th>
                <th>מצב</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>
                    {rule.document_name}
                    {rule.notes && <div className="small muted">{rule.notes}</div>}
                    {rule.source_url && (
                      <div className="small">
                        <a href={rule.source_url} target="_blank" rel="noreferrer">
                          מקור
                        </a>
                      </div>
                    )}
                  </td>
                  <td>{label(INSTRUMENT_LABELS, rule.instrument_type)}</td>
                  <td>{rule.document_version ?? '—'}</td>
                  <td className="num">{rule.effective_date ?? '—'}</td>
                  <td>{rule.occupancy_type ? label(OCCUPANCY_LABELS, rule.occupancy_type) : 'כל סוג'}</td>
                  <td>{rule.building_types.length ? rule.building_types.map((b: string) => BUILDING_LABELS[b] ?? b).join(', ') : 'כל סוג'}</td>
                  <td className="num">
                    {rule.threshold} {rule.threshold_unit}
                  </td>
                  <td className="small">{rule.threshold_type === 'TIME_AVERAGED' ? `ממוצע ${rule.averaging_hours ?? '?'} שעות` : 'ערך מרבי'}</td>
                  <td>{rule.active ? <span className="tag ok">פעיל ומאומת</span> : <span className="tag warn">לא פעיל</span>}</td>
                  <td>
                    {canEdit && (
                      <div className="row">
                        <button
                          type="button"
                          className="btn-sm"
                          onClick={() => {
                            setEditing(rule.id);
                            setForm(toForm(rule));
                          }}
                        >
                          עריכה
                        </button>
                        <button
                          type="button"
                          className={rule.active ? 'btn-sm btn-danger' : 'btn-sm btn-primary'}
                          onClick={() => {
                            const reason = window.prompt(rule.active ? 'סיבת ההפסקה:' : 'מול איזה מסמך נבדק הכלל?');
                            if (reason) run(() => api(`/regulation/rules/${rule.id}/activation`, { method: 'POST', json: { active: !rule.active, reason } }));
                          }}
                        >
                          {rule.active ? 'הפסקה' : 'הפעלה'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canEdit && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              if (editing) await api(`/regulation/rules/${editing}`, { method: 'PATCH', json: toPayload(form) });
              else await api('/regulation/rules', { method: 'POST', json: toPayload(form) });
              setEditing(null);
              setForm(EMPTY);
            });
          }}
        >
          <h2 style={{ marginBottom: 10 }}>{editing ? 'עריכת כלל' : 'כלל חדש'}</h2>
          <div className="grid">
            <label className="field">
              שם המסמך
              <input required value={form.document_name} onChange={(e) => update('document_name', e.target.value)} />
            </label>
            <label className="field">
              רשות
              <input value={form.authority} onChange={(e) => update('authority', e.target.value)} />
            </label>
            <label className="field">
              סוג מסמך
              <select value={form.instrument_type} onChange={(e) => update('instrument_type', e.target.value)}>
                <option value="">לא נקבע</option>
                {Object.entries(INSTRUMENT_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              גרסת מסמך
              <input value={form.document_version} onChange={(e) => update('document_version', e.target.value)} />
            </label>
            <label className="field">
              תאריך תחילה
              <input type="date" value={form.effective_date} onChange={(e) => update('effective_date', e.target.value)} />
            </label>
            <label className="field">
              קישור למקור
              <input type="url" dir="ltr" value={form.source_url} onChange={(e) => update('source_url', e.target.value)} />
            </label>
            <label className="field">
              סוג שהייה
              <select value={form.occupancy_type} onChange={(e) => update('occupancy_type', e.target.value)}>
                <option value="">כל סוג</option>
                <option value="CONTINUOUS_OCCUPANCY">{OCCUPANCY_LABELS.CONTINUOUS_OCCUPANCY}</option>
                <option value="NON_CONTINUOUS_OCCUPANCY">{OCCUPANCY_LABELS.NON_CONTINUOUS_OCCUPANCY}</option>
              </select>
            </label>
            <label className="field">
              סף (mG)
              <input
                required
                type="number"
                min="0"
                step="any"
                className="num"
                value={form.threshold}
                onChange={(e) => update('threshold', e.target.value)}
              />
            </label>
            <label className="field">
              סוג סף
              <select value={form.threshold_type} onChange={(e) => update('threshold_type', e.target.value)}>
                <option value="INSTANTANEOUS_MAX">ערך מרבי</option>
                <option value="TIME_AVERAGED">ממוצע זמן</option>
              </select>
            </label>
            {form.threshold_type === 'TIME_AVERAGED' && (
              <label className="field">
                תקופת מיצוע (שעות)
                <input
                  required
                  type="number"
                  min="0"
                  step="any"
                  className="num"
                  value={form.averaging_hours}
                  onChange={(e) => update('averaging_hours', e.target.value)}
                />
              </label>
            )}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            {Object.entries(BUILDING_LABELS).map(([value, text]) => (
              <label key={value} className="small" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={form.building_types.includes(value)}
                  onChange={(e) =>
                    update(
                      'building_types',
                      e.target.checked ? [...form.building_types, value] : form.building_types.filter((b) => b !== value),
                    )
                  }
                />
                {text}
              </label>
            ))}
          </div>
          <label className="field" style={{ marginTop: 10 }}>
            הערות
            <textarea rows={2} value={form.notes} onChange={(e) => update('notes', e.target.value)} />
          </label>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn-primary">שמירה</button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setForm(EMPTY);
                }}
              >
                ביטול
              </button>
            )}
          </div>
        </form>
      )}
    </>
  );
}
