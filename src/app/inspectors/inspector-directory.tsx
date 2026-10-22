'use client';

import { useState, useTransition } from 'react';
import type { InspectorRecord } from '@/lib/inspector-service';
import type { SignatureRecord } from '@/lib/signature-service';
import { removeInspector, saveInspector, type ActionResult } from '../actions';

/**
 * The inspector directory.
 *
 * One row per person per permit class. The form doubles as the editor: choosing "עריכה"
 * loads a row into it rather than opening a second, near-identical form somewhere else,
 * which is how the two drift apart.
 */

const EMPTY: Omit<InspectorRecord, 'id'> = {
  name: '',
  title: 'בודק קרינה',
  permitType: 'ELF',
  permitNumber: '',
  permitValidity: '',
  signatureId: '',
};

export function InspectorDirectory({
  inspectors,
  signatures,
}: {
  inspectors: InspectorRecord[];
  signatures: SignatureRecord[];
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<InspectorRecord, 'id'>>(EMPTY);

  const set = (patch: Partial<Omit<InspectorRecord, 'id'>>) => setDraft((d) => ({ ...d, ...patch }));

  const reset = () => {
    setEditing(null);
    setDraft(EMPTY);
  };

  const submit = () =>
    startTransition(async () => {
      const outcome = await saveInspector(editing, draft);
      setResult(outcome);
      if (outcome.ok) reset();
    });

  const edit = (record: InspectorRecord) => {
    setEditing(record.id);
    setDraft({
      name: record.name,
      title: record.title,
      permitType: record.permitType,
      permitNumber: record.permitNumber,
      permitValidity: record.permitValidity,
      signatureId: record.signatureId,
    });
  };

  const remove = (record: InspectorRecord) =>
    startTransition(async () => setResult(await removeInspector(record.id)));

  return (
    <>
      {result && <div className={`notice ${result.ok ? 'ok' : 'error'}`}>{result.message}</div>}

      <section className="card">
        <div className="card-head">
          <h2>{editing ? 'עריכת בודק' : 'הוספת בודק'}</h2>
          <span className="hint">מספר ההיתר ותוקפו מועתקים מתעודת ההסמכה</span>
        </div>
        <div className="card-body">
          <div className="grid">
            <div className="field">
              <label>
                שם הבודק<span style={{ color: 'var(--danger)' }}> *</span>
              </label>
              <input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="למשל: יורם גבאי"
              />
            </div>
            <div className="field">
              <label>תפקיד</label>
              <input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
            </div>
            <div className="field">
              <label>סוג ההיתר</label>
              {/* ELF ו-RF הם שני היתרים נפרדים. מי שמחזיק בשניהם נרשם כאן פעמיים —
                  זו הסיבה שהטבלה היא שורה לאדם ולהיתר, ולא שורה לאדם. */}
              <div className="toggle">
                {(['ELF', 'RF'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={draft.permitType === type ? 'active' : undefined}
                    onClick={() => set({ permitType: type })}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>מספר ההיתר</label>
              <input
                value={draft.permitNumber}
                onChange={(e) => set({ permitNumber: e.target.value })}
                placeholder="למשל: 2031-01-4"
              />
            </div>
            <div className="field">
              <label>תוקף ההיתר</label>
              <input
                value={draft.permitValidity}
                onChange={(e) => set({ permitValidity: e.target.value })}
                placeholder="למשל: 27/3/29"
              />
            </div>
            <div className="field">
              <label>חתימה</label>
              <select value={draft.signatureId} onChange={(e) => set({ signatureId: e.target.value })}>
                <option value="">ללא חתימה</option>
                {signatures.map((signature) => (
                  <option key={signature.id} value={signature.id}>
                    {signature.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" className="btn-primary" disabled={pending} onClick={submit}>
              {pending ? 'שומר…' : editing ? 'שמירת השינויים' : 'הוספה'}
            </button>
            {editing && (
              <button type="button" className="btn" disabled={pending} onClick={reset}>
                ביטול
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>רשימת הבודקים</h2>
          <span className="hint">{inspectors.length ? `${inspectors.length} רשומות` : 'ריקה'}</span>
        </div>

        {inspectors.length === 0 ? (
          <div className="empty">אין בודקים. הוסיפו את הבודק הראשון בטופס שלמעלה.</div>
        ) : (
          inspectors.map((inspector) => (
            <div className="list-row" key={inspector.id}>
              <div className="grow">
                <div className="title">
                  {inspector.name}
                  {inspector.permitType ? ` · ${inspector.permitType}` : ''}
                </div>
                <div className="meta">
                  {[
                    inspector.title,
                    inspector.permitNumber && `היתר ${inspector.permitNumber}`,
                    inspector.permitValidity && `בתוקף עד ${inspector.permitValidity}`,
                    inspector.signatureId
                      ? signatures.find((s) => s.id === inspector.signatureId)?.label ?? 'חתימה חסרה'
                      : 'ללא חתימה',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <button type="button" className="btn-sm" disabled={pending} onClick={() => edit(inspector)}>
                עריכה
              </button>
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={pending}
                onClick={() => {
                  if (confirm(`למחוק את ${inspector.name}? דוחות קיימים לא ישתנו.`)) remove(inspector);
                }}
              >
                מחיקה
              </button>
            </div>
          ))
        )}
      </section>
    </>
  );
}
