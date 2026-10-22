'use client';

import { useId, useState } from 'react';
import type { AsbestosReport, FindingRow } from '@/lib/asbestos-schema';
import { CONDITION_OPTIONS, ELEMENT_OPTIONS, PLACEMENT_OPTIONS } from '@/lib/asbestos-schema';
import { newFindingRow, totalArea } from '@/lib/asbestos-rules';
import { BuildingPhotos } from './editor';

/**
 * The findings of a prose opinion, recorded as facts rather than as sentences.
 *
 * A finding used to be a sentence typed into a box — "3 צינורות ביוב עשויים אסבסט בתוך
 * קירות הבניין כל אחד 9 מטרים סה״כ 27 מטרים". That sentence has a fixed grammar, and
 * retyping it per job is where wording drifts: the same finding reads four ways across
 * four reports, and a reader cannot tell whether the differences mean anything.
 *
 * So the surveyor answers what, how many, where, what size and what condition, and the
 * sentence is composed from those when the document is produced.
 *
 * The composed sentence is deliberately not shown here. It does not exist until the
 * document is produced, so the box stood empty through the whole of writing the survey —
 * a field that is blank every time it is looked at teaches the surveyor to ignore it.
 *
 * Folding cards rather than a table: eight fields per finding is a table nobody can read
 * on the phone these are filled in on, and the finding being written is the only one
 * worth having open.
 */
export function FindingsStep({
  reportId,
  report,
  update,
  onStructuralChange,
}: {
  reportId: string;
  report: AsbestosReport;
  update: (patch: Partial<AsbestosReport>) => void;
  /** Adding or removing a finding is worth storing at once. */
  onStructuralChange: () => void;
}) {
  const [open, setOpen] = useState(0);

  const set = (index: number, patch: Partial<FindingRow>) =>
    update({ findings: report.findings.map((f, i) => (i === index ? { ...f, ...patch } : f)) });

  const add = () => {
    update({ findings: [...report.findings, newFindingRow()] });
    setOpen(report.findings.length);
    onStructuralChange();
  };

  const remove = (index: number) => {
    update({ findings: report.findings.filter((_, i) => i !== index) });
    onStructuralChange();
  };

  return (
    <div>
      <div className="protocols-bare-actions">
        <button type="button" className="btn-primary btn-sm" onClick={add}>
          הוספת ממצא
        </button>
      </div>

      {report.findings.length === 0 && (
        <div className="empty" style={{ padding: '20px 12px' }}>
          אין עדיין ממצאים. כל ממצא מודפס כשורה בסעיף ״ממצאי הבדיקה״.
        </div>
      )}

      {report.findings.map((finding, i) => {
        const isOpen = open === i;
        // The heading names the finding by what it is, so a folded list reads as a list
        // of findings rather than of numbers.
        const heading =
          [finding.quantity.trim(), finding.element.trim()].filter(Boolean).join(' ') ||
          finding.text.trim() ||
          `ממצא ${i + 1}`;

        return (
          <div className="card" key={i} style={{ marginTop: 12 }}>
            <div className="card-head">
              <button
                type="button"
                className="card-toggle"
                onClick={() => setOpen(isOpen ? -1 : i)}
                aria-expanded={isOpen}
              >
                <span className="card-caret" aria-hidden="true">
                  {isOpen ? '▾' : '◂'}
                </span>
                <h2>{heading}</h2>
              </button>
              <button
                type="button"
                className="btn-danger btn-sm"
                onClick={() => remove(i)}
                title="מחיקת הממצא"
              >
                ✕
              </button>
            </div>

            {isOpen && (
              <div className="card-body">
                <div className="grid">
                  <Combo
                    label="האלמנט"
                    value={finding.element}
                    options={ELEMENT_OPTIONS}
                    placeholder="צינורות ביוב"
                    onChange={(v) => set(i, { element: v })}
                  />
                  <Plain
                    label="כמות"
                    value={finding.quantity}
                    placeholder="3"
                    ltr
                    onChange={(v) => set(i, { quantity: v })}
                  />
                  <Combo
                    label="מיקום"
                    value={finding.placement}
                    options={PLACEMENT_OPTIONS}
                    placeholder="בתוך קירות הבניין"
                    onChange={(v) => set(i, { placement: v })}
                  />
                  <Plain
                    label="מידות"
                    value={finding.dimensions}
                    placeholder="כל אחד 9 מטרים"
                    onChange={(v) => set(i, { dimensions: v })}
                  />
                  <Combo
                    label="מצב"
                    value={finding.condition}
                    options={CONDITION_OPTIONS}
                    placeholder="תקין"
                    onChange={(v) => set(i, { condition: v })}
                  />
                  <Plain
                    label="שטח [מ״ר]"
                    value={finding.area}
                    placeholder="27"
                    ltr
                    onChange={(v) => set(i, { area: v })}
                  />

                  <div className="field">
                    <label>קבור או בתוך קיר</label>
                    {/* What pulls the soil sentence into the summary. */}
                    <select
                      value={finding.buried}
                      onChange={(e) => set(i, { buried: e.target.value as FindingRow['buried'] })}
                    >
                      <option value="לא">לא</option>
                      <option value="כן">כן</option>
                    </select>
                  </div>
                </div>

                {/* התמונה נלקחת ברגע שבוחנים את הממצא, ולכן הכפתור כאן ולא בשלב
                    נפרד. בטופס הרציף הממצאים מודפסים כרשימת תבליטים, ולכן התמונות
                    עצמן נכנסות לנספח שבסוף — עם שם האלמנט ככיתוב, כדי שהקורא ידע
                    לאיזה ממצא כל תמונה שייכת. */}
                <BuildingPhotos
                  reportId={reportId}
                  report={report}
                  index={i}
                  attachAs="findingIndex"
                  photos={finding.photos}
                  setPhotos={(photos) =>
                    update({
                      findings: report.findings.map((f, n) =>
                        n === i ? { ...f, photos } : f,
                      ),
                    })
                  }
                  captionFallback={finding.element}
                  onStructuralChange={onStructuralChange}
                />
              </div>
            )}
          </div>
        );
      })}

      <p className="hint" style={{ marginTop: 12 }}>
        סה״כ שטח: <strong>{totalArea(report) || '—'}</strong> — מחושב מהממצאים ומודפס בסיכום.
      </p>
    </div>
  );
}

/**
 * A short list of the usual answers, with a box for anything they do not cover.
 *
 * This was a `<datalist>` first, which was the right intent and the wrong control: on a
 * phone it renders as a plain text box whose suggestions appear only once something has
 * been typed, so the surveyor saw an empty field and no sign that a list existed at all.
 * The options might as well not have been there.
 *
 * Now the answers are visible and tapped, and the "אחר" box beneath them takes whatever
 * the list does not carry — an asbestos flue nobody thought to list, a placement worded
 * for this particular building. Both write the same single string, so nothing downstream
 * knows or cares which route an answer arrived by.
 *
 * The same shape as the buildings step's rows, deliberately: two screens in one report
 * asking the same kind of question should not answer it two different ways.
 */
function Combo({
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const groupName = useId();
  const chosen = options.find((o) => o === value.trim());
  // Anything that is not one of the listed answers is the surveyor's own wording, and
  // belongs in the box rather than being silently dropped.
  const other = chosen ? '' : value;

  return (
    <div className="field wide needed" data-filled={value.trim() !== '' ? 'true' : 'false'}>
      <label>{label}</label>
      <div className="check-list">
        {options.map((option) => (
          <label key={option} className="check-item">
            <input
              type="radio"
              name={groupName}
              checked={chosen === option}
              // Tapping the chosen one again clears it: an answer given by mistake has
              // to be un-answerable, and radios alone offer no way back to blank.
              onChange={() => onChange(chosen === option ? '' : option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
      <input
        value={other}
        placeholder={placeholder ? `אחר… (למשל ${placeholder})` : 'אחר…'}
        style={{ marginTop: 4 }}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Plain({
  label,
  value,
  placeholder,
  ltr,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  /** Numbers read left-to-right even in an RTL document. */
  ltr?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field needed" data-filled={value.trim() !== '' ? 'true' : 'false'}>
      <label>{label}</label>
      <input
        value={value}
        className={ltr ? 'ltr' : undefined}
        inputMode={ltr ? 'decimal' : undefined}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
