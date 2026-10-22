'use client';

import { useRef, useState, useTransition } from 'react';
import type { TemplateKind, TemplateRecord } from '@/lib/docx/template-store';
import { makeTemplateActive, uploadTemplate, type ActionResult } from '../actions';

export function TemplateManager({
  templates,
  kind,
  label,
}: {
  templates: TemplateRecord[];
  kind: TemplateKind;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = (form: FormData) =>
    startTransition(async () => {
      const outcome = await uploadTemplate(form);
      setResult(outcome);
      if (outcome.ok) formRef.current?.reset();
    });

  const activate = (id: number) =>
    startTransition(async () => {
      setResult(await makeTemplateActive(id));
    });

  return (
    <>
      {result && <div className={`notice ${result.ok ? 'ok' : 'error'}`}>{result.message}</div>}

      <section className="card">
        <div className="card-head">
          <h2>העלאת תבנית — {label}</h2>
          <span className="hint">קובץ .docx עם שדות בסוגריים מסולסלים</span>
        </div>
        <div className="card-body">
          <form ref={formRef} action={submit}>
            {/* Each survey has its own active template; uploading one must not
                unseat the other. */}
            <input type="hidden" name="kind" value={kind} />
            <div className="grid">
              <div className="field">
                <label>קובץ התבנית</label>
                <input
                  type="file"
                  name="file"
                  required
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                />
              </div>
              <div className="field">
                <label>הערה (אופציונלי)</label>
                <input name="note" placeholder="למשל: עדכון נוסח נספח ח׳" />
              </div>
            </div>
            <button type="submit" className="btn-primary" disabled={pending} style={{ marginTop: 12 }}>
              {pending ? 'מעלה…' : 'העלאה והפעלה'}
            </button>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>גרסאות — {label}</h2>
          <span className="hint">{templates.length ? `${templates.length} גרסאות` : 'אין גרסאות'}</span>
        </div>

        {templates.length === 0 ? (
          <div className="empty">לא נטענה עדיין תבנית ל{label}. העלו קובץ למעלה.</div>
        ) : (
          templates.map((template) => (
            <div className="list-row" key={template.id}>
              <div className="grow">
                <div className="title">
                  {template.name}{' '}
                  {template.isActive && <span className="badge ok">פעילה</span>}
                </div>
                <div className="meta">
                  {(template.size / 1024 / 1024).toFixed(1)} MB · נטענה {formatDate(template.uploadedAt)} ·{' '}
                  <span className="mono">{template.sha256.slice(0, 12)}</span>
                  {template.note ? ` · ${template.note}` : ''}
                </div>
              </div>
              <a className="btn btn-sm" href={`/api/templates/${template.id}`}>
                הורדה
              </a>
              {!template.isActive && (
                <button type="button" className="btn-sm" disabled={pending} onClick={() => activate(template.id)}>
                  הפעלה
                </button>
              )}
            </div>
          ))
        )}
      </section>
    </>
  );
}

/**
 * A timestamp, in Israeli local time.
 *
 * The time zone is pinned rather than left to the runtime. Without it the
 * server renders in UTC and the browser in its own zone, the two strings
 * disagree, and React abandons hydration on the mismatch — which on this
 * screen left every button dead.
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
