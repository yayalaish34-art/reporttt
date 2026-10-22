'use client';

import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { CustomerPicker } from '../../reports/[id]/customer-picker';
import {
  draftAsbestosSummaryLines,
  finishAsbestosReport,
  persistAsbestosReportDraft,
  removeAsbestosPhoto,
  uploadAsbestosPhoto,
} from '../actions';
import type { BuildingRow, AsbestosReport } from '@/lib/asbestos-schema';
import { ASBESTOS_KINDS } from '@/lib/asbestos-schema';
import {
  BUILDING_OPTIONS,
  INSTRUCTION_OPTIONS,
  joinInstructions,
  newBuildingRow,
  realFindings,
  splitInstructions,
  totalArea,
} from '@/lib/asbestos-rules';
import { asbestosBuildingsMissing, asbestosDetailsMissing } from '@/lib/report-complete';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { DictateButton } from './dictate-button';
import { FindingsStep } from './findings-step';
import { CameraCapture, useCameraSupported } from '../../camera-capture';
import { useCaptionPrompt } from '../../caption-prompt';
import { Wizard } from '../../wizard';
import { useAutosave } from '../../use-autosave';
import { SaveIndicator } from '../../save-indicator';
import { downloadDocument } from '../../download-document';

/**
 * The asbestos opinion editor.
 *
 * The report is a חוות דעת given in place of court testimony, so most of the
 * document is fixed wording that must not be touched. What varies is what the
 * surveyor marked in yellow in the source: who ordered it, which building, what
 * the building is like, what was found, and the photographs.
 *
 * The address is asked once. It is printed six times in six grammatical forms,
 * and the mapper shapes it — asking six times, which is what the highlighted
 * template literally implies, would be absurd.
 */
export function AsbestosEditor({ id, initial }: { id: string; initial: AsbestosReport }) {
  const [report, setReport] = useState(initial);
  const [saving, startSave] = useTransition();
  const [issues, setIssues] = useState<string[]>([]);

  const update = (patch: Partial<AsbestosReport>) => setReport((r) => ({ ...r, ...patch }));


  /**
   * Stores the opinion as it is written, so nothing depends on reaching the last step.
   *
   * The draft action rather than `persistAsbestosReport`: a survey in progress has
   * findings not yet measured, and the strict validation is there to stop such a
   * report being *issued*, not to stop it being kept.
   */
  const autosave = useAutosave(
    report,
    useCallback(async (current: AsbestosReport) => {
      const result = await persistAsbestosReportDraft(id, current);
      // The asbestos action reports an `error`; the autosave speaks `message`.
      return result.ok
        ? { ok: true as const }
        : { ok: false as const, message: result.error ?? 'שמירה נכשלה' };
    }, [id]),
  );

  /**
   * Ends the survey: saves it, builds the document, files it on the customer's card.
   *
   * One button rather than two — see `finishReport` in the radiation actions — and it
   * hands over the Word file as well as filing it. Filing is what the office reads, but
   * the surveyor who just finished writing the opinion is usually the one who needs the
   * document in hand, and making them go back to the list to fetch it was a step for the
   * sake of tidiness.
   */
  const finish = () =>
    startSave(async () => {
      const result = await finishAsbestosReport(id, report);
      setIssues(result.ok && !result.error ? [] : result.issues ?? (result.error ? [result.error] : []));
      if (!result.ok) return;
      // The saved report is what the endpoint renders, so this runs after the save has
      // returned — downloading first would produce the copy from before the last edit.
      // Awaited in full before leaving: see `downloadDocument` for the report that never
      // arrived because the page left for the list while it was still being produced.
      try {
        await downloadDocument(`/api/asbestos/${id}/docx`);
      } catch (err) {
        setIssues([err instanceof Error ? err.message : 'הורדת הדוח נכשלה']);
        return;
      }
      window.location.href = '/asbestos';
    });

  const finishActions = (
    <button type="button" className="btn-primary wizard-next" onClick={finish} disabled={saving}>
      {saving ? 'מסיים…' : 'סיום'}
    </button>
  );

  return (
    <>
      {issues.length > 0 && (
        <div className="notice error">
          <strong>הדוח לא נשמר:</strong>
          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <Wizard
        finish={finishActions}
        onStepChange={autosave.saveNow}
        status={<SaveIndicator state={autosave.state} />}
        steps={[
          /*
           * The photo step opens first, because what a surveyor arrives to do is take
           * pictures of the building. Required fields come after: typing an address is
           * what happens once the subject has been photographed, not before. No blocker
           * — a report is sometimes written off photographs already in the gallery, so
           * this step may legitimately be skipped.
           */
          {
            title: 'תמונות',
            hint: 'מצלמים כעת מול המבנה — יודפסו בנספח הדוח',
            content: (
              <AsbestosPhotos
                reportId={id}
                report={report}
                update={update}
                onStructuralChange={autosave.saveNow}
              />
            ),
          },
          {
            title: 'מזמין ומבנה',
            hint: 'מי הזמין את הסקר ואיזה מבנה נסקר',
            /**
             * The address is required to leave this step, not merely noted as missing.
             *
             * It is printed in six places in the document and it also names the file,
             * the subject line and the entry on the customer's card. A survey written
             * without one does not produce a report with one blank field; it produces
             * one with a hole on every page, and the surveyor finds out at the end.
             */
            blocker: (() => {
              const gaps = asbestosDetailsMissing(report);
              return gaps ? `חסר כדי להמשיך: ${gaps}` : undefined;
            })(),
            content: (
              <div>
                <div className="grid">
                  <CustomerPicker
                    onPick={(fields) =>
                      update({
                        customerId: fields.customerId,
                        customerType: fields.customerType,
                        recipientName: fields.recipientName,
                        companyName: fields.customerType === 'company' ? fields.companyName : '',
                        phone: fields.phone,
                        email: fields.email,
                        // The commissioning company is normally the customer, so it is
                        // filled from the directory — and stays editable, because the
                        // two are not always the same.
                        clientName:
                          fields.customerType === 'company'
                            ? fields.companyName || fields.recipientName
                            : fields.recipientName,
                      })
                    }
                  />

                  <Text
                    label="מזמין הסקר"
                    placeholder="חובה"
                    value={report.clientName}
                    onChange={(v) => update({ clientName: v })}
                    wide
                    hint="מודפס בשער ובסעיף נושא חוות הדעת"
                  />

                  {/* ── הכתובת נשאלת פעם אחת ──
                      במסמך היא מופיעה שש פעמים ובשלוש צורות דקדוקיות שונות
                      (״מבנה מרחוב…״, ״בביקור במבנה מרחוב…״, ״בבניין מרחוב…״).
                      המיפוי מרכיב את הצורות מהתשובה הזו. */}
                  <Text
                    label="כתובת המבנה"
                    // The example is the placeholder: it says the field is empty, says
                    // what belongs in it, and disappears the moment anything is typed —
                    // which a stored "—" did none of.
                    placeholder="וייסבורג 11, תל אביב"
                    value={report.siteAddress}
                    onChange={(v) => update({ siteAddress: v })}
                    wide
                    hint='חובה. ללא המילה "רחוב" — מודפס בשישה מקומות בדוח.'
                  />

                  <div className="field">
                    <label>סוג האסבסט</label>
                    <select
                      value={report.asbestosKind}
                      onChange={(e) => update({ asbestosKind: e.target.value })}
                    >
                      {ASBESTOS_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    <span className="hint">מודפס בשער: ״סקר אסבסט {report.asbestosKind}״</span>
                  </div>

                  <Text
                    label="תאריך הדוח"
                    value={report.reportDate}
                    onChange={(v) => update({ reportDate: v })}
                    hint="כפי שיודפס בשער — למשל: אוגוסט 2026"
                  />

                  <Area
                    label="תיאור המקום"
                    value={report.siteDescription}
                    onChange={(v) => update({ siteDescription: v })}
                    hint="למשל: בניין מגורים בן 3 קומות ו-2 כניסות בלב שכונת מגורים בתל אביב."
                    dictate="siteDescription"
                  />
                  <Area
                    label="סביבת המבנה"
                    value={report.surroundings}
                    onChange={(v) => update({ surroundings: v })}
                    hint='למשל: בין הבניין הנ"ל למבנים הסמוכים בין 6 מטרים ל-20 מטרים.'
                    dictate="surroundings"
                  />
                </div>
              </div>
            ),
          },
          /*
           * The tabled opinion assesses buildings; the prose one lists findings. Only the
           * step that belongs to this report's shape is offered — a wizard that asked for
           * both would be asking half its questions about a document it is not producing.
           */
          ...(report.layout === 'tables'
            ? [
                {
                  title: 'מבנים',
                  hint: 'טבלה לכל מבנה שנסקר — 13 שדות',
                  /* Required to move on — see `asbestosBuildingsMissing`. The
                     thirteen rows themselves may stand unanswered; only the name is
                     demanded, because the printed table is headed with it. */
                  blocker: asbestosBuildingsMissing(report) ?? undefined,
                  content: (
                    <BuildingsStep
                      reportId={id}
                      report={report}
                      update={update}
                      onStructuralChange={autosave.saveNow}
                    />
                  ),
                },
              ]
            : []),
          {
            title: report.layout === 'tables' ? 'סיכום והנחיות' : 'ממצאים',
            hint:
              report.layout === 'tables'
                ? 'מנוסח מהטבלאות — ניתן לערוך'
                : 'האלמנטים העשויים אסבסט שנמצאו בסקר',
            blocker:
              report.layout === 'tables'
                ? report.summaryBullets.length === 0
                  ? 'יש לנסח את הסיכום כדי להמשיך.'
                  : undefined
                : realFindings(report).length === 0
                  ? 'יש לרשום לפחות ממצא אחד כדי להמשיך.'
                  : undefined,
            content:
              // The tabled form's closing lines are drafted from the building tables —
              // every fact they state is already there. The prose form records the facts
              // of each finding instead, and composes its sentence at production.
              report.layout === 'tables' ? (
                <SummaryStep report={report} update={update} onDrafted={autosave.saveNow} />
              ) : (
                <FindingsStep
                  reportId={id}
                  report={report}
                  update={update}
                  onStructuralChange={autosave.saveNow}
                />
              ),
          },
          {
            title: 'סיכום',
            hint: 'משפטי הסיכום, שמירה והפקה',
            content: (
              <div>
                <div className="grid">
                  {/* שני המשפטים מודפסים רק כשהם רלוונטיים — ראו את המיפוי.
                      הם ניתנים לעריכה כי חוות דעת אינה טופס. */}
                  {report.findings.some((f) => f.buried === 'כן') && (
                    <Area
                      label="משפט האסבסט בקרקע"
                      value={report.buriedSentence}
                      onChange={(v) => update({ buriedSentence: v })}
                      hint="מודפס כי סומן ממצא קבור או בתוך קיר"
                    />
                  )}
                  {realFindings(report).length > 0 && (
                    <Area
                      label="משפט הפינוי לפני הריסה"
                      value={report.removalSentence}
                      onChange={(v) => update({ removalSentence: v })}
                    />
                  )}
                </div>
                <AsbestosSummary report={report} />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}


/**
 * What the opinion will say, before it is produced.
 *
 * The last step is the only one that sees the whole survey, and producing a file
 * to find out what is missing is a slow way to check.
 */
function AsbestosSummary({ report }: { report: AsbestosReport }) {
  const findings = realFindings(report);
  // Every picture the report carries, wherever it was attached. Previously only the
  // report-level list was counted, which stayed empty — a counter that always said
  // "—" taught the surveyor to ignore it. See `BuildingPhotos` and `AsbestosPhotos`.
  const photoCount =
    report.photos.length +
    report.buildings.reduce((n, b) => n + b.photos.length, 0) +
    report.findings.reduce((n, f) => n + f.photos.length, 0);
  const rows: Array<[string, string]> = [
    ['מזמין הסקר', report.clientName.trim() || '—'],
    ['כתובת המבנה', report.siteAddress.trim() || '—'],
    ['סוג האסבסט', report.asbestosKind],
    ['ממצאים', findings.length === 0 ? '—' : String(findings.length)],
    ['סה״כ שטח', totalArea(report) || '—'],
    ['תמונות', photoCount === 0 ? '—' : String(photoCount)],
  ];

  const missing = [
    // Empty is empty. These used to also test for "—", the placeholder a new report was
    // seeded with; nothing stores that any more, and a surveyor who genuinely types a
    // dash should not have it read as no answer.
    report.clientName.trim() === '' ? 'מזמין הסקר' : null,
    report.siteAddress.trim() === '' ? 'כתובת המבנה' : null,
    findings.length === 0 ? 'ממצאים' : null,
    report.siteDescription.trim() === '' ? 'תיאור המקום' : null,
  ].filter(Boolean) as string[];

  return (
    <div>
      {missing.length > 0 && (
        <div className="notice warn">חסר בדוח: {missing.join(' · ')}. אפשר להפיק בכל מקרה.</div>
      )}
      <dl className="summary">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  ltr,
  wide,
  hint,
  optional,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ltr?: boolean;
  wide?: boolean;
  hint?: string;
  /** Left out of the step's field count — a line that may legitimately stay empty. */
  optional?: boolean;
  /**
   * Shown in the empty box.
   *
   * Where a field is required this carries "חובה", so the demand sits inside the box the
   * surveyor is looking at rather than in a parenthetical on the label above it — and it
   * disappears the moment anything is typed, which a label cannot do.
   */
  placeholder?: string;
}) {
  // `needed` is what the phone stylesheet draws the waiting-mark from, and
  // `data-filled` is what the step header counts — see the radon editor.
  const needed = !optional;
  return (
    <div
      className={`field${wide ? ' wide' : ''}${needed ? ' needed' : ''}`}
      data-filled={needed ? (value.trim() !== '' ? 'true' : 'false') : undefined}
    >
      <label>{label}</label>
      <input
        className={ltr ? 'ltr' : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** A multi-line field, for the passages that are prose rather than a value. */
function Area({
  label,
  value,
  onChange,
  hint,
  dictate,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  /**
   * Offers a record button for this field, transcribed into it.
   *
   * Only the descriptive fields carry one — they are the sentences a surveyor is worst
   * placed to type, standing outside with a meter in one hand.
   */
  dictate?: 'siteDescription' | 'surroundings';
}) {
  return (
    <div className="field wide">
      <label>{label}</label>
      <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
      {dictate && (
        <DictateButton
          field={dictate}
          // Appended, not replaced: a half-typed sentence finished by speaking means
          // both, and losing the typed half would be a nasty surprise.
          onText={(text) => onChange(value.trim() ? `${value.trim()} ${text}` : text)}
        />
      )}
    </div>
  );
}


/**
 * The closing "סיכום והנחיות לביצוע" of the tabled opinion.
 *
 * This step used to be a table where the surveyor typed the closing lines by hand,
 * one row at a time. Every fact those lines state — which buildings carry asbestos
 * cement, in what condition, which remedial actions apply — was already sitting in
 * the building tables one step earlier, so the step asked the same questions twice
 * and let the two answers drift apart inside a document given in place of court
 * testimony. Now the lines are drafted from the tables.
 *
 * Drafted, not decided. The text lands in an editable box and the surveyor signs
 * what is finally there: a model may group the buildings and phrase the actions,
 * but it does not get the last word in an expert opinion. Re-drafting is offered
 * and warns first, because it discards edits.
 */
function SummaryStep({
  report,
  update,
  onDrafted,
}: {
  report: AsbestosReport;
  update: (patch: Partial<AsbestosReport>) => void;
  /** A drafted or edited summary is worth storing at once. */
  onDrafted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const buildings = report.buildings.filter((b) => b.name.trim() !== '');
  const drafted = report.summaryBullets.length > 0;

  const draft = () => {
    if (drafted && !confirm('לנסח מחדש? הניסוח הנוכחי — כולל עריכות שנעשו בו — יוחלף.')) return;
    setError('');
    startTransition(async () => {
      const result = await draftAsbestosSummaryLines(report);
      if (!result.ok || !result.bullets) {
        setError(result.error ?? 'הניסוח נכשל');
        return;
      }
      update({ summaryBullets: result.bullets });
      onDrafted();
    });
  };

  /**
   * The lines are edited as one block of text, not as a list of rows.
   *
   * They are read as a paragraph and often rewritten as one — merging two bullets or
   * splitting one is a normal edit here, and a row-per-line editor turns both into
   * fiddling with buttons. One line of the box is one bullet in the document.
   */
  const text = report.summaryBullets.join('\n');
  const setText = (value: string) =>
    update({ summaryBullets: value.split('\n').map((l) => l.replace(/^[•\-\s]+/, '')) });

  return (
    <div>
      {error && <div className="notice error">{error}</div>}

      {buildings.length === 0 ? (
        <div className="notice warn">
          אין עדיין מבנים. הסיכום מנוסח מהטבלאות — הוסיפו מבנה בשלב ״מבנים״ וחזרו לכאן.
        </div>
      ) : (
        <div className="protocols-bare-actions">
          <button type="button" className="btn-primary btn-sm" onClick={draft} disabled={pending}>
            {pending ? 'מנסח…' : drafted ? 'ניסוח מחדש' : `ניסוח מ-${buildings.length} המבנים`}
          </button>
        </div>
      )}

      {drafted && (
        <div className="field wide" style={{ marginTop: 12 }}>
          <label>שורות הסיכום — שורה אחת לכל תבליט</label>
          <textarea
            rows={Math.max(6, report.summaryBullets.length + 1)}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={onDrafted}
          />
          <span className="hint">
            כל שורה תודפס כתבליט אחרי הטבלאות. אפשר לערוך, למחוק ולהוסיף שורות.
          </span>
        </div>
      )}

      {!drafted && buildings.length > 0 && (
        <div className="empty" style={{ padding: '20px 12px' }}>
          הסיכום ינוסח מהנתונים שמילאתם בטבלאות המבנים.
        </div>
      )}
    </div>
  );
}

/**
 * One table per building, as the tabled opinion prints it.
 *
 * The thirteen fields are the source document's own rows, labels included. They are asked
 * as a stack of labelled boxes rather than as a grid: the labels are whole questions
 * ("מופע אסבסט (גגות, סככה פתוחה, קיר חיצוני/פנימי וכו')"), and a table with thirteen
 * columns of those is unreadable anywhere, let alone on the phone this is filled in on.
 *
 * Each building folds, because a campus survey carries several and the one being written
 * is the only one worth having open.
 */
function BuildingsStep({
  reportId,
  report,
  update,
  onStructuralChange,
}: {
  reportId: string;
  report: AsbestosReport;
  update: (patch: Partial<AsbestosReport>) => void;
  /** Adding or removing a building is worth storing at once. */
  onStructuralChange: () => void;
}) {
  const [open, setOpen] = useState(0);

  const set = (index: number, patch: Partial<BuildingRow>) =>
    update({ buildings: report.buildings.map((b, i) => (i === index ? { ...b, ...patch } : b)) });

  const add = () => {
    update({ buildings: [...report.buildings, newBuildingRow()] });
    setOpen(report.buildings.length);
    onStructuralChange();
  };

  const remove = (index: number) => {
    update({ buildings: report.buildings.filter((_, i) => i !== index) });
    onStructuralChange();
  };

  return (
    <div>
      <div className="protocols-bare-actions">
        <button type="button" className="btn-primary btn-sm" onClick={add}>
          הוספת מבנה
        </button>
      </div>

      {report.buildings.length === 0 && (
        <div className="empty" style={{ padding: '20px 12px' }}>
          אין עדיין מבנים. כל מבנה מקבל טבלה משלו בדוח.
        </div>
      )}

      {report.buildings.map((building, i) => {
        const isOpen = open === i;
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
                <h2>{building.name.trim() || `מבנה ${i + 1}`}</h2>
              </button>
              <button
                type="button"
                className="btn-danger btn-sm"
                onClick={() => remove(i)}
                title="מחיקת המבנה"
              >
                ✕
              </button>
            </div>

            {isOpen && (
              <div className="card-body">
                <div className="grid">
                  {BUILDING_FIELDS.map(({ key, label, wide }) => {
                    // The remedial actions are a settled list, and more than one
                    // usually applies — see INSTRUCTION_OPTIONS.
                    if (key === 'instructions') {
                      return (
                        <InstructionsField
                          key={key}
                          label={label}
                          value={building.instructions}
                          onChange={(v) => set(i, { instructions: v })}
                        />
                      );
                    }

                    // Rows whose answers are nearly always one of a handful of words
                    // are picked, not typed — the survey is filled in on a phone in
                    // front of the building. The picker keeps a free-text box, so the
                    // answers that are a sentence still fit.
                    const choices = BUILDING_OPTIONS[key];
                    if (choices) {
                      return (
                        <ChoiceField
                          key={key}
                          label={label}
                          value={building[key]}
                          options={choices.options}
                          multi={choices.multi}
                          onChange={(v) => set(i, { [key]: v } as Partial<BuildingRow>)}
                        />
                      );
                    }

                    // The name and the area are different every time; a list of
                    // guesses in front of them would be noise.
                    return (
                      <div
                        className={wide ? 'field wide needed' : 'field needed'}
                        key={key}
                        data-filled={building[key].trim() !== '' ? 'true' : 'false'}
                      >
                        <label>{label}</label>
                        <input
                          value={building[key]}
                          onChange={(e) => set(i, { [key]: e.target.value } as Partial<BuildingRow>)}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* התמונה נלקחת ברגע שבוחנים את המבנה, ולכן הכפתור כאן ולא בשלב
                    נפרד — בדיוק כמו בטבלאות דוח הקרינה. הכיתוב נלקח משם המבנה
                    שמעליו, והתמונה מודפסת בעמוד שאחרי הטבלה של אותו מבנה. */}
                <BuildingPhotos
                  reportId={reportId}
                  report={report}
                  index={i}
                  photos={building.photos}
                  setPhotos={(photos) =>
                    update({
                      buildings: report.buildings.map((b, n) => (n === i ? { ...b, photos } : b)),
                    })
                  }
                  captionFallback={building.name}
                  onStructuralChange={onStructuralChange}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The opening photos step: pictures of the site, taken before anything is typed.
 *
 * The surveyor arrives, points the phone at the building, and the camera is already
 * open. The address is often empty at this moment — the field it would seed the
 * caption with is also the one being filled in a step later — so the caption falls
 * back to a plain "המבנה" until the address is typed, when later shots pick it up.
 *
 * Writes to `report.photos`, which print as the appendix at the end of the document
 * ([src/lib/asbestos-service.ts](../../lib/asbestos-service.ts)). Per-building and
 * per-finding pictures still have their own cameras in their own cards — that is
 * where the detail work gets photographed — but a general shot of the site has no
 * card to belong to, and used to have nowhere to live.
 */
function AsbestosPhotos({
  reportId,
  report,
  update,
  onStructuralChange,
}: {
  reportId: string;
  report: AsbestosReport;
  update: (patch: Partial<AsbestosReport>) => void;
  onStructuralChange: () => void;
}) {
  return (
    <div>
      <p className="hint" style={{ marginBottom: 12 }}>
        התמונות שתצרפו כאן יודפסו בנספח הדוח, ממוספרות אוטומטית —
        &quot;תמונה מס׳ 1&quot;, &quot;תמונה מס׳ 2&quot; וכן הלאה. תמונות של מבנה
        או ממצא ספציפי אפשר לצלם מתוך הכרטיס שלו בשלבים הבאים.
      </p>
      <BuildingPhotos
        reportId={reportId}
        report={report}
        index={0}
        attachAs="report"
        autoOpenCamera
        photos={report.photos}
        setPhotos={(photos) => update({ photos })}
        captionFallback={report.siteAddress.trim() || 'המבנה'}
        onStructuralChange={onStructuralChange}
      />
    </div>
  );
}

/**
 * One building's photographs, taken and reviewed from inside its own card.
 *
 * The same shape as the radiation report's per-table camera: the picture is taken at
 * the moment the building is examined, so the button belongs beside the answers rather
 * than in a step of its own, and the caption is the name already typed at the top of
 * the table.
 *
 * Where they print is the point of holding them here rather than in the report's
 * appendix — each building's pictures come out on the page after that building's table,
 * so a reader who has just read fifteen rows about a roof turns over and sees it.
 */
export function BuildingPhotos({
  reportId,
  report,
  index,
  photos,
  setPhotos,
  captionFallback,
  attachAs = 'buildingIndex',
  autoOpenCamera = false,
  onStructuralChange,
}: {
  reportId: string;
  report: AsbestosReport;
  index: number;
  /** The list this component shows and writes back. */
  photos: BuildingRow['photos'];
  /** Stores the new list on whatever holds it — a building or a finding. */
  setPhotos: (photos: BuildingRow['photos']) => void;
  /** What the caption says when the surveyor leaves it empty. */
  captionFallback: string;
  /**
   * Which list the server files the photograph on.
   *
   * The tabled form attaches to a building, whose table is followed by its own pages;
   * the prose form attaches to a finding, whose pictures print in the appendix because
   * a full-page photograph cannot sit inside a bulleted line. The report-level step
   * writes to the appendix straight out — a surveyor who has just arrived at the site
   * has nothing yet to attach a photograph to. Either way the picture is taken from
   * inside the thing it documents, which is the point.
   */
  attachAs?: 'buildingIndex' | 'findingIndex' | 'report';
  /**
   * Fires the phone's camera the moment the component mounts.
   *
   * Set only for the opening photos step, where there is no card to open and no
   * reason to stand in front of the building tapping a button labelled "take a
   * picture of the building". Latches on empty: a surveyor returning to review
   * what was shot should not have the camera reopen in their face.
   */
  autoOpenCamera?: boolean;
  onStructuralChange: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // Prefilled with the building (or finding) label the shot was taken for, so
  // "קיר צפוני, בית 2" gets typed while the surveyor is still beside the wall.
  const { ask: askCaption, node: captionPromptNode } = useCaptionPrompt();

  /*
   * Whether the camera can be opened straight away.
   *
   * `capture` is honoured on phones and tablets and ignored on desktop. The coarse
   * pointer query picks out the devices a survey is actually photographed on without
   * guessing at screen widths — same test the radiation report's photo section uses.
   */
  const [handheld, setHandheld] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const coarse = window.matchMedia('(pointer: coarse)');
    const apply = () => setHandheld(coarse.matches);
    apply();
    coarse.addEventListener('change', apply);
    return () => coarse.removeEventListener('change', apply);
  }, []);

  // A desktop has no `capture`, but it often has a camera: `getUserMedia` into a
  // modal, same as the radiation editor. On a desktop without a webcam the camera
  // button is hidden entirely rather than silently falling back to a file picker
  // the "הוספה מהגלריה" button already offers.
  const webcam = useCameraSupported();
  const [cameraOpen, setCameraOpen] = useState(false);

  // Fires once per mount: a step is remounted when it becomes current, so this is
  // effectively "the surveyor just opened the photos screen". Guards keep the camera
  // from greeting someone who came back to review what was already shot.
  const openedCamera = useRef(false);
  useEffect(() => {
    if (!autoOpenCamera || openedCamera.current) return;
    if (!handheld || photos.length > 0) return;
    openedCamera.current = true;
    cameraRef.current?.click();
  }, [autoOpenCamera, handheld, photos.length]);

  const upload = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setError('');
    startTransition(async () => {
      // Carried forward through the loop: the server stores the snapshot it is handed,
      // so sending the same one each time round would file every photograph against a
      // report that did not know about the one before it.
      let current = report;
      let added = [...photos];

      for (const file of Array.from(files)) {
        const toSend = await shrinkPhoto(file);
        const form = new FormData();
        form.set('file', toSend);
        form.set('report', JSON.stringify(current));
        // The photograph belongs to what it documents. A building or a finding carries
        // its own index; a report-level shot sends nothing, so the server falls through
        // to `report.photos` — see `uploadAsbestosPhoto`.
        if (attachAs !== 'report') form.set(attachAs, String(index));

        let result: Awaited<ReturnType<typeof uploadAsbestosPhoto>>;
        try {
          result = await uploadAsbestosPhoto(reportId, form);
        } catch (err) {
          console.error('העלאת התמונה נכשלה', err);
          setError(`העלאת "${file.name}" נכשלה — ייתכן שהחיבור נותק. נסו שוב.`);
          break;
        }

        if (!result.ok || !result.photo) {
          setError(result.error ?? 'העלאה נכשלה');
          break;
        }

        // Prompt pre-filled with the building or finding label — the context the surveyor
        // just chose when they tapped the camera. Dismissing keeps the fallback.
        const suggested = result.photo.caption || captionFallback.trim();
        const answered = await askCaption(suggested);
        const photo = { ...result.photo, caption: answered ?? suggested };
        // Accumulated locally: `photos` is the value from the render this closure was
        // created in, so selecting three from the gallery would otherwise keep only one.
        added = [...added, photo];
        setPhotos(added);
      }

      // Cleared so the same file — or another shot from the camera, which hands back
      // the same name every time — fires change again.
      if (cameraRef.current) cameraRef.current.value = '';
      if (galleryRef.current) galleryRef.current.value = '';
      onStructuralChange();
    });
  };

  const remove = (imageId: string) =>
    startTransition(async () => {
      await removeAsbestosPhoto(reportId, imageId);
      setPhotos(photos.filter((p) => p.imageId !== imageId));
      onStructuralChange();
    });

  return (
    <div className="building-photos">
      {error && <div className="notice error">{error}</div>}
      {captionPromptNode}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => upload(e.target.files)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => upload(e.target.files)}
      />

      <div className="protocols-bare-actions">
        {(handheld || webcam) && (
          <button
            type="button"
            className="btn-sm"
            disabled={pending}
            onClick={() => (handheld ? cameraRef.current?.click() : setCameraOpen(true))}
          >
            {pending ? 'מעלה…' : '📷 צילום'}
          </button>
        )}
        <button
          type="button"
          className="btn-sm"
          disabled={pending}
          onClick={() => galleryRef.current?.click()}
        >
          הוספה מהגלריה
        </button>
        {photos.length > 0 && <span className="hint">{photos.length} תמונות</span>}
      </div>
      {cameraOpen && (
        <CameraCapture
          onCapture={(file) => upload([file])}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((photo, n) => (
            <div className="photo-card" key={photo.imageId}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/asbestos/photos/${photo.imageId}`}
                alt={photo.caption || `${captionFallback} ${n + 1}`}
              />
              <div className="body">
                <input
                  value={photo.caption}
                  placeholder={captionFallback.trim() || 'כיתוב'}
                  onChange={(e) =>
                    setPhotos(
                      photos.map((p, m) => (m === n ? { ...p, caption: e.target.value } : p)),
                    )
                  }
                  onBlur={onStructuralChange}
                />
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  disabled={pending}
                  onClick={() => {
                    if (confirm('למחוק את התמונה?')) remove(photo.imageId);
                  }}
                >
                  מחיקה
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The thirteen questions, in the order the table prints them.
 *
 * Labels are the source document's, verbatim including their parenthetical examples: they
 * are the question being answered, and shortening them would change what the answer means.
 */
/**
 * The keys this loop can render: the building's text answers.
 *
 * `photos` is on the row too and is not one of them — it is a list of images with
 * its own control below the fields, and a generic <input> bound to it would render
 * "[object Object]". Deriving the type rather than listing it keeps a field added
 * to the row from silently falling out of the form.
 */
type BuildingTextField = {
  [K in keyof BuildingRow]: BuildingRow[K] extends string ? K : never;
}[keyof BuildingRow];

const BUILDING_FIELDS: Array<{ key: BuildingTextField; label: string; wide?: boolean }> = [
  { key: 'name', label: 'שם / תיאור המבנה', wide: true },
  { key: 'use', label: 'שימוש (בית מגורים, שטח עבודה בעסק, משרד, מחסן, סככה וכו׳)', wide: true },
  { key: 'appearance', label: 'מופע אסבסט (גגות, סככה פתוחה, קיר חיצוני/פנימי וכו׳)', wide: true },
  { key: 'barrier', label: 'תקרת ביניים / חומר מבנה חוצץ בין האסבסט לחלל המבנה', wide: true },
  { key: 'area', label: 'שטח אסבסט מקורב (מ״ר)' },
  { key: 'moisture', label: 'רטיבות בתוך המבנה / על הלוחות' },
  { key: 'sheetCondition', label: 'מצב לוחות: תקינים / שבורים / סדוקים / שחוקים / מתפוררים', wide: true },
  { key: 'edgeCondition', label: 'מצב שולי הלוחות: תקין / שבור / סדוק / שחוק / מתפורר', wide: true },
  { key: 'debris', label: 'שברי לוחות על הקרקע (כן/לא)' },
  { key: 'painted', label: 'לוחות צבועים (פרט)' },
  { key: 'roofCover', label: 'האם הגגות מכוסים בחזזיות / יריעות ביטומן וכו׳' },
  { key: 'friable', label: 'האם נצפה אסבסט פריך במבנה' },
  { key: 'instructions', label: 'הנחיות לביצוע', wide: true },
];

/**
 * One building row, answered by tapping rather than typing.
 *
 * Twelve free-text boxes was the wrong shape for this screen: the survey is filled
 * in standing in front of the building, on a phone, and nearly every answer is one
 * of a handful of words the surveyor writes over and over. Tapping "סדוקים" is one
 * gesture; typing it one-handed on a roof is not.
 *
 * The free-text box stays, and that is the part worth defending. Galit's own reports
 * answer these rows with "לא ניתן לראות- בוצע עליהם שיפוץ חיפוי גבס" and "יש- לא
 * רלוונטי גג רעפים" — answers that carry a reason. A picker on its own would flatten
 * them to "לא" and lose exactly the part a reader needs, so the list is a shortcut
 * for the common answer and never a limit on the real one.
 *
 * Single-choice rows use radios and multi-choice rows checkboxes, because the two
 * say different things: a building has one use, and its sheeting can be both cracked
 * and worn. Both write the same comma-joined string, so nothing downstream — the
 * mapper, the template, the stored report — has to know which kind a row was.
 */
function ChoiceField({
  label,
  value,
  options,
  multi,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  multi?: boolean;
  onChange: (v: string) => void;
}) {
  // Radios in one row must not join the radios of the row above, or answering
  // "שימוש" would clear "מופע אסבסט". One id per field instance does that.
  const groupName = useId();

  const parts = splitInstructions(value);
  const picked = options.filter((o) => parts.includes(o));
  // Whatever was typed rather than picked — including answers written before this
  // list existed, which must survive being shown in a screen that now offers choices.
  const other = parts.filter((p) => !options.includes(p)).join(', ');

  // Picked options keep the list's own order, so two buildings with the same answer
  // read identically however they were tapped.
  const commit = (nextPicked: readonly string[], nextOther: string) =>
    onChange(joinInstructions([...nextPicked, ...splitInstructions(nextOther)]));

  const toggle = (option: string) => {
    if (!multi) {
      // Tapping the chosen one again clears it: a row answered by mistake has to be
      // un-answerable, and with radios alone there is no way back to blank.
      commit(picked.includes(option) ? [] : [option], other);
      return;
    }
    const next = picked.includes(option)
      ? picked.filter((o) => o !== option)
      : options.filter((o) => o === option || picked.includes(o));
    commit(next, other);
  };

  return (
    <div className="field wide needed" data-filled={value.trim() !== '' ? 'true' : 'false'}>
      <label>{label}</label>
      <div className="check-list">
        {options.map((option) => (
          <label key={option} className="check-item">
            <input
              type={multi ? 'checkbox' : 'radio'}
              checked={picked.includes(option)}
              onChange={() => toggle(option)}
              name={multi ? undefined : groupName}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
      <input
        value={other}
        placeholder="אחר…"
        style={{ marginTop: 4 }}
        onChange={(e) => commit(picked, e.target.value)}
      />
      {/* Exactly what the table cell will print, so the wording can be checked
          without producing the document. */}
      {value.trim() !== '' && (
        <span className="hint" style={{ color: 'var(--muted)', fontSize: 12 }}>
          בדוח: {value}
        </span>
      )}
    </div>
  );
}

/**
 * The remedial actions for one building — several at once.
 *
 * A tick list rather than a dropdown: a building routinely needs three of these (clean
 * the roof, remove the lichen, then paint), and a select that closes after each choice
 * makes picking three a three-step chore. Every option is visible and each row is one tap
 * target the width of the list, which is the shape the radiation report's field sources
 * already use.
 *
 * The "אחר" box beside it holds anything the list does not carry, and survives alongside
 * the ticks: an instruction that is partly standard and partly specific to this roof is
 * both, not one or the other.
 */
function InstructionsField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const parts = splitInstructions(value);
  const listed = INSTRUCTION_OPTIONS.filter((o) => parts.includes(o));
  // Whatever was typed rather than ticked — including "אין" from a building written
  // before this list existed.
  const other = parts.filter((p) => !(INSTRUCTION_OPTIONS as readonly string[]).includes(p)).join(', ');

  // Ticked options keep the list's own order, so two buildings with the same actions read
  // identically however they were clicked.
  const commit = (nextListed: readonly string[], nextOther: string) =>
    onChange(joinInstructions([...nextListed, ...splitInstructions(nextOther)]));

  const toggle = (option: (typeof INSTRUCTION_OPTIONS)[number]) => {
    const next = listed.includes(option)
      ? listed.filter((o) => o !== option)
      : INSTRUCTION_OPTIONS.filter((o) => o === option || listed.includes(o));
    commit(next, other);
  };

  return (
    <div className="field wide needed" data-filled={value.trim() !== '' ? 'true' : 'false'}>
      <label>{label}</label>
      <div className="check-list">
        {INSTRUCTION_OPTIONS.map((option) => (
          <label key={option} className="check-item">
            <input type="checkbox" checked={listed.includes(option)} onChange={() => toggle(option)} />
            <span>{option}</span>
          </label>
        ))}
      </div>
      <input
        value={other}
        placeholder="אחר…"
        style={{ marginTop: 4 }}
        onChange={(e) => commit(listed, e.target.value)}
      />
      {/* Exactly what the table cell will print, so the wording can be checked without
          producing the document. */}
      {value.trim() !== '' && (
        <span className="hint" style={{ color: 'var(--muted)', fontSize: 12 }}>
          בדוח: {value}
        </span>
      )}
    </div>
  );
}


