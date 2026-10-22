'use client';

import { useRef, useState, useTransition } from 'react';
import type { SignatureRecord } from '@/lib/signature-service';
import { removeSignature, renameSignatureAction, uploadSignature, type ActionResult } from '../actions';

/**
 * The signature library.
 *
 * Labels carry the role as well as the name — "יורם גבאי — מאשר" — because the
 * source document held two separate scans of the same person's signature, one
 * per table, and telling them apart matters when picking one.
 */
export function SignatureLibrary({ signatures }: { signatures: SignatureRecord[] }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = (form: FormData) =>
    startTransition(async () => {
      const outcome = await uploadSignature(form);
      setResult(outcome);
      if (outcome.ok) formRef.current?.reset();
    });

  const rename = (id: string, current: string) => {
    const label = prompt('שם החתימה:', current);
    if (label === null || label.trim() === current) return;
    startTransition(async () => setResult(await renameSignatureAction(id, label)));
  };

  const remove = (signature: SignatureRecord) =>
    startTransition(async () => setResult(await removeSignature(signature.id)));

  return (
    <>
      {result && <div className={`notice ${result.ok ? 'ok' : 'error'}`}>{result.message}</div>}

      <section className="card">
        <div className="card-head">
          <h2>הוספת חתימה</h2>
          <span className="hint">רקע שקוף (PNG) נראה הכי טוב במסמך</span>
        </div>
        <div className="card-body">
          <form ref={formRef} action={submit}>
            <div className="grid">
              <div className="field">
                <label>שם החתימה<span style={{ color: 'var(--danger)' }}> *</span></label>
                <input name="label" required placeholder="למשל: יורם גבאי — מאשר" />
              </div>
              <div className="field">
                <label>קובץ<span style={{ color: 'var(--danger)' }}> *</span></label>
                <input type="file" name="file" required accept="image/*" />
              </div>
            </div>
            <button type="submit" className="btn-primary" disabled={pending} style={{ marginTop: 12 }}>
              {pending ? 'מעלה…' : 'הוספה'}
            </button>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>ספריית החתימות</h2>
          <span className="hint">{signatures.length ? `${signatures.length} חתימות` : 'ריקה'}</span>
        </div>

        {signatures.length === 0 ? (
          <div className="empty">
            אין חתימות. הריצו <span className="mono">npx tsx scripts/seed-signatures.ts</span> כדי לייבא
            אותן ממסמך המקור, או העלו קובץ למעלה.
          </div>
        ) : (
          signatures.map((signature) => (
            <div className="list-row" key={signature.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/signatures/${signature.id}`} alt={signature.label} className="signature-preview" />
              <div className="grow">
                <div className="title">{signature.label}</div>
                <div className="meta">
                  {signature.width}×{signature.height} · {signature.contentType}
                </div>
              </div>
              <button type="button" className="btn-sm" disabled={pending} onClick={() => rename(signature.id, signature.label)}>
                שינוי שם
              </button>
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={pending}
                onClick={() => {
                  if (confirm(`למחוק את "${signature.label}"? שורות שמשתמשות בה יודפסו ללא חתימה.`)) remove(signature);
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
