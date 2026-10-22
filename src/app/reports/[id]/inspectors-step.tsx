'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Author, Inspector, Report } from '@/lib/report-schema';
import type { InspectorRecord } from '@/lib/inspector-service';
import { buildAuthors, toInspector } from '@/lib/inspector-assignment';
import { addInspectorWithSignature, fetchInspectors } from '../../actions';
import { Modal } from '../../modal';

/**
 * The option that opens the "add a person" prompt rather than choosing one.
 *
 * A sentinel rather than an empty value, so it cannot collide with a real name.
 */
const ADD_NEW = '__add__';

/**
 * Choosing who carried out the survey, and who wrote up the report.
 *
 * The surveyors are picked from the directory; the writer defaults to the first of them,
 * since whoever measured a survey normally writes it up, and can be changed to anyone
 * else — including someone added here on the spot.
 *
 * An approver is deliberately not asked for. The rule it would enforce — that the person
 * who measured may not also approve — is sound, but a company with one licensed inspector
 * has nobody else to name, so the field could only ever be blank and the report could
 * never be issued. Reports written before that carry their approver row unchanged; see
 * `buildAuthors`.
 */
export function InspectorsStep({
  report,
  update,
}: {
  report: Report;
  update: (patch: Partial<Report>) => void;
}) {
  const [directory, setDirectory] = useState<InspectorRecord[] | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let live = true;
    fetchInspectors().then((records) => {
      if (live) setDirectory(records);
    });
    return () => {
      live = false;
    };
  }, []);

  const records = directory ?? [];
  const chosen = new Set(report.inspectors.map((i) => `${i.name}|${i.permitType}`));

  /** Re-derives the authors whenever the surveyors change, so the rule cannot go stale. */
  const applySurveyors = (inspectors: Inspector[]) =>
    update({ inspectors, authors: buildAuthors(records, inspectors, report.authors) });

  const toggle = (record: InspectorRecord) => {
    const key = `${record.name}|${record.permitType}`;
    applySurveyors(
      chosen.has(key)
        ? report.inspectors.filter((i) => `${i.name}|${i.permitType}` !== key)
        : [...report.inspectors, toInspector(record)],
    );
  };

  const writer = report.authors.find((a) => a.role.includes('עורך'));

  const setAuthor = (role: 'עורך' | 'מאשר', name: string) => {
    const record = records.find((r) => r.name.trim() === name.trim());
    const next: Author[] = report.authors.map((a) =>
      a.role.includes(role)
        ? { ...a, name, signatureId: record?.signatureId ?? '' }
        : a,
    );
    update({ authors: next });
  };

  return (
    <div className="grid">
      <div className="field wide">
        <label>מי ביצע את הבדיקה</label>
        {directory === null ? (
          <div className="hint">טוען…</div>
        ) : records.length === 0 ? (
          <div className="hint">
            אין בודקים במערכת. הוסיפו אותם ב<Link href="/inspectors">מסך הבודקים</Link>.
          </div>
        ) : (
          <div className="toggle" style={{ flexWrap: 'wrap' }}>
            {records.map((record) => (
              <button
                key={record.id}
                type="button"
                className={chosen.has(`${record.name}|${record.permitType}`) ? 'active' : undefined}
                onClick={() => toggle(record)}
                title={
                  record.permitNumber
                    ? `היתר ${record.permitNumber}${record.permitValidity ? `, בתוקף עד ${record.permitValidity}` : ''}`
                    : undefined
                }
              >
                {record.name}
                {record.permitType ? ` · ${record.permitType}` : ''}
              </button>
            ))}
          </div>
        )}
        <div className="hint">
          מי שמחזיק היתר ELF והיתר RF מופיע פעמיים. הדוח מדפיס רק את ההיתר שמכסה את מה שנמדד.
        </div>
      </div>

      <div className="field wide">
        <label>עורך הדו&quot;ח</label>
        <select
          value={writer?.name ?? ''}
          onChange={(e) => {
            if (e.target.value === ADD_NEW) {
              setAdding(true);
              return;
            }
            setAuthor('עורך', e.target.value);
          }}
        >
          <option value="">— בחרו —</option>
          {[...new Map(records.map((r) => [r.name, r])).values()].map((record) => (
            <option key={record.id} value={record.name}>
              {record.name}
            </option>
          ))}
          {/* Adding from here rather than only from the directory screen: the person
              who wrote the report is often not in the directory yet, and sending the
              surveyor away to add them means losing the report they are in. */}
          <option value={ADD_NEW}>+ הוספת עורך חדש…</option>
        </select>
        <div className="hint">ברירת המחדל: מי שביצע את הבדיקה</div>
      </div>

      {adding && (
        <AddInspector
          onClose={() => setAdding(false)}
          onAdded={(record) => {
            // Straight into the directory this screen is holding, so the new name is
            // selectable without a round trip — and selected, since adding it is what
            // the surveyor came here to do.
            setDirectory((current) => [...(current ?? []), record]);
            update({
              authors: report.authors.map((a) =>
                a.role.includes('עורך')
                  ? { ...a, name: record.name, signatureId: record.signatureId }
                  : a,
              ),
            });
            setAdding(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Adding a person and their signature without leaving the report.
 *
 * Both at once, because half of it is worse than neither: an author with no signature
 * prints an empty box where a mark belongs. The signature is still optional — a name
 * can be added now and the mark uploaded later from the directory screen — but it is
 * asked for here, where the person adding knows whose report it is.
 */
function AddInspector({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (record: InspectorRecord) => void;
}) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, startSave] = useTransition();

  const submit = () =>
    startSave(async () => {
      setError('');
      const form = new FormData();
      form.set('name', name);
      form.set('title', title);
      if (file) form.set('signature', file);

      const result = await addInspectorWithSignature(form);
      if (!result.ok || !result.inspector) {
        setError(result.message ?? 'ההוספה נכשלה');
        return;
      }
      onAdded(result.inspector);
    });

  return (
    <Modal title="הוספת עורך חדש" onClose={onClose} wide>
      <div className="grid">
        {error && <div className="notice error wide">{error}</div>}

        <div className="field wide">
          <label>שם מלא</label>
          <input
            autoFocus
            value={name}
            placeholder="חובה"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field wide">
          <label>תפקיד</label>
          <input
            value={title}
            placeholder="בודק קרינה"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="field wide">
          <label>חתימה</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="hint">
            תמונת החתימה, על רקע לבן. אפשר להוסיף עכשיו או מאוחר יותר במסך הבודקים.
          </span>
        </div>
      </div>

      <div className="point-actions">
        <button type="button" className="btn-sm" onClick={onClose} disabled={saving}>
          ביטול
        </button>
        <button
          type="button"
          className="btn-sm btn-primary"
          onClick={submit}
          disabled={saving || name.trim() === ''}
        >
          {saving ? 'מוסיף…' : 'הוספה'}
        </button>
      </div>
    </Modal>
  );
}