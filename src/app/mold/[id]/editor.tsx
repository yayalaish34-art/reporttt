'use client';

import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { CustomerPicker } from '../../reports/[id]/customer-picker';
import { DictateButton } from '../../asbestos/[id]/dictate-button';
import type { DictationField } from '@/lib/transcribe';
import {
  finishMoldReport,
  persistMoldReportDraft,
  removeMoldLabSheet,
  draftMoldSections,
  removeMoldPhoto,
  uploadMoldLabSheet,
  uploadMoldPhoto,
} from '../actions';
import type { LabResult, MoldReport } from '@/lib/mold-schema';
import {
  FLOW_VERIFICATION_OPTIONS,
  HVAC_STATE_OPTIONS,
  MOISTURE_INSTRUMENT,
  MOLD_STAFF,
  OPENINGS_STATE_OPTIONS,
  SAMPLING_HEIGHT_OPTIONS,
} from '@/lib/mold-schema';
import {
  describeMoldFindings,
  indoorAirSamples,
  isOutdoorLocation,
  isOutdoorSample,
  labResultFor,
  newSampleRow,
  outdoorAirSample,
  realSamples,
  sampleWithLabResult,
  unmatchedLabResults,
} from '@/lib/mold-rules';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { CameraCapture, useCameraSupported } from '../../camera-capture';
import { useCaptionPrompt } from '../../caption-prompt';
import { Wizard } from '../../wizard';
import { useAutosave } from '../../use-autosave';
import { SaveIndicator } from '../../save-indicator';
import { expandPdfPages, isPdf } from '@/lib/pdf-pages';
import { joinAddress } from '@/lib/address';
import { downloadDocument } from '../../download-document';

/**
 * The mould report editor.
 *
 * One job, and the form is shaped around it: the laboratory's pages are photographed,
 * the figures are read off them into the result tables, and the closing sections are
 * worded from those figures. Everything else the report prints is either standing text
 * that belongs to the template or a particular that can be filled in later.
 *
 * It used to ask for all of it up front — client, place, survey details, description,
 * samples, moisture — eight steps before reaching the part that does the work. That
 * order came from the other three departments, where the surveyor writes the report
 * from what they saw. Mould is not like that: the findings arrive from a laboratory in
 * the United States about a week after the visit, and by the time anyone opens this
 * screen the only thing they have in hand is a PDF from Hayes.
 *
 * So the scan is the first step and the rest are left blank, to be typed into the
 * finished document or added here later. The fields all still exist and still print —
 * see the mapper — they simply are not demanded before the useful work can happen.
 */
export function MoldEditor({ id, initial }: { id: string; initial: MoldReport }) {
  const [report, setReport] = useState(initial);
  const [saving, startSave] = useTransition();
  const [issues, setIssues] = useState<string[]>([]);

  const update = (patch: Partial<MoldReport>) => setReport((r) => ({ ...r, ...patch }));

  /**
   * Stores the report as it is written, so nothing depends on reaching the last step.
   *
   * The draft action rather than `persistMoldReport`: a survey in progress has samples
   * taken but not yet analysed, and the strict validation is there to stop such a
   * report being *issued*, not to stop it being kept.
   */
  const autosave = useAutosave(
    report,
    useCallback(async (current: MoldReport) => {
      const result = await persistMoldReportDraft(id, current);
      // The mould action reports an `error`; the autosave speaks `message`.
      return result.ok
        ? { ok: true as const }
        : { ok: false as const, message: result.error ?? 'שמירה נכשלה' };
    }, [id]),
  );

  /** Ends the survey: saves it, builds the document, files it on the customer's card. */
  const finish = () =>
    startSave(async () => {
      const result = await finishMoldReport(id, report);
      setIssues(result.ok && !result.error ? [] : result.issues ?? (result.error ? [result.error] : []));
      if (!result.ok) return;
      // The saved report is what the endpoint renders, so this runs after the save has
      // returned — downloading first would produce the copy from before the last edit.
      // Awaited in full before leaving: see `downloadDocument` for the report that never
      // arrived because the page left for the list while it was still being produced.
      try {
        await downloadDocument(`/api/mold/${id}/docx`);
      } catch (err) {
        setIssues([err instanceof Error ? err.message : 'הורדת הדוח נכשלה']);
        return;
      }
      window.location.href = '/mold';
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
          {
            title: 'תוצאות מעבדה',
            hint: 'צילום דוח הייס — נקרא אוטומטית לטבלאות ומצורף כנספח',
            content: (
              <LabResultsStep
                id={id}
                report={report}
                update={update}
                setReport={setReport}
                onChange={autosave.saveNow}
              />
            ),
          },
          {
            title: 'תמונות',
            hint: 'נספח התמונות — תמונה אחת בעמוד, ממוספרת אוטומטית',
            content: (
              <PhotoStep id={id} report={report} setReport={setReport} onChange={autosave.saveNow} />
            ),
          },
          {
            title: 'סיכום ומסקנות',
            hint: 'מה הדוח אומר — מנוסח מהדגימות וניתן לעריכה',
            content: <SummaryStep report={report} update={update} />,
          },
        ]}
      />
    </>
  );
}

/**
 * The summary step: what the report will say.
 *
 * The findings are listed above the boxes rather than left to memory. Every line comes
 * from the sample rows one step back, so what is on screen here is the evidence the
 * conclusions have to match — which is the check worth making before a report is signed.
 */
function SummaryStep({
  report,
  update,
}: {
  report: MoldReport;
  update: (patch: Partial<MoldReport>) => void;
}) {
  const findings = describeMoldFindings(report);
  const [drafting, startDraft] = useTransition();
  const [error, setError] = useState('');

  const draft = () =>
    startDraft(async () => {
      setError('');
      const result = await draftMoldSections(report);
      if (!result.ok || !result.draft) {
        setError(result.error ?? 'הניסוח נכשל');
        return;
      }
      /*
       * The drafted sections replace what is on screen, and the surveyor edits from
       * there. The interpretations merge rather than replace: a sentence already
       * edited by hand survives a re-draft, and a sample the model did not reach keeps
       * whatever it had.
       */
      update({
        executiveSummary: result.draft.executiveSummary,
        purposeDescription: result.draft.purposeDescription,
        interpretations: { ...report.interpretations, ...result.draft.interpretations },
        conclusions: result.draft.conclusions,
        recommendations: result.draft.recommendations,
      });
    });

  return (
    <div>
      {findings.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: '12px 14px' }}>
          <strong>הממצאים כפי שנרשמו:</strong>
          <ul style={{ margin: '8px 0 0', paddingInlineStart: 20 }}>
            {findings.map((line) => (
              <li key={line} className="hint" style={{ marginBottom: 4 }}>
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        The wording is drafted here, not only when the document is built.

        It used to be drafted at production time alone, which meant the boxes below sat
        empty through the whole of writing the report and the only way to find out what
        it would say was to finish it and open the file. For a document somebody signs
        that is the wrong order.
      */}
      <div className="protocols-bare-actions">
        <button type="button" className="btn-primary btn-sm" disabled={drafting} onClick={draft}>
          {drafting ? 'מנסח…' : '✨ נסח מהתוצאות'}
        </button>
        {error && <span className="hint error-text">{error}</span>}
      </div>

      <div className="grid">
        <Area
          label="תקציר מנהלים (סעיף 2)"
          value={report.executiveSummary}
          onChange={(v) => update({ executiveSummary: v })}
          hint="שורה לכל תבליט. אילו חדרים חרגו, מה הקבוצה הדומיננטית, ומה היחס לדגימת החוץ."
        />
        <Area
          label="מטרת הבדיקה ותיאור המקום (סעיף 3)"
          value={report.purposeDescription}
          onChange={(v) => update({ purposeDescription: v })}
          hint="שורה לכל תבליט. לשם מה בוצעה הבדיקה ובאילו חללים."
        />
      </div>

      {/*
        The per-sample sentences, keyed by the laboratory's own number.

        Stored per sample so the surveyor edits each one against its own result block,
        but the mapper gathers every non-empty entry into one chapter (§7) printed
        *after* all the result tables — not under each one — per Galit's 2026-09-16
        request. One box per result block here is for editing convenience only.
      */}
      {report.labResults.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <strong>פרשנות מקצועית (סעיף 7)</strong>
          <p className="hint">
            מרוכזת בפרק אחד אחרי כל טבלאות התוצאות — לא מתחת לכל דגימה בנפרד. משפט אחד-שניים,
            רק כשיש ממצא משמעותי; אפשר להשאיר ריק.
          </p>
          {report.labResults.map((result) => {
            const key = result.labNumber || result.sampleName;
            return (
              <div className="field wide" key={key} style={{ marginTop: 8 }}>
                <label>
                  {result.sampleName || 'ללא שם'}
                  {result.labNumber ? ` — דגימה ${result.labNumber}` : ''}
                </label>
                <textarea
                  rows={2}
                  value={report.interpretations[key] ?? ''}
                  onChange={(e) =>
                    update({
                      interpretations: { ...report.interpretations, [key]: e.target.value },
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      <Lines
        label="מסקנות (סעיף 9)"
        hint="כל שורה מודפסת כתבליט נפרד בסעיף המסקנות"
        values={report.conclusions}
        onChange={(conclusions) => update({ conclusions })}
      />
      <Lines
        label="המלצות (סעיף 10)"
        hint="כל שורה מודפסת כתבליט נפרד בסעיף ההמלצות"
        values={report.recommendations}
        onChange={(recommendations) => update({ recommendations })}
      />

      <MoldSummary report={report} />
    </div>
  );
}

/**
 * A list of sentences, each printed as its own bullet.
 *
 * One box per line rather than one textarea split on newlines: the template loops over
 * these and prints a bullet each, so the shape on screen is the shape in the document.
 * A textarea would let a line break become a bullet by accident and would hide that it
 * had.
 */
function Lines({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="protocols-bare-actions">
        <strong style={{ marginInlineEnd: 'auto' }}>{label}</strong>
        <button
          type="button"
          className="btn-sm"
          onClick={() => onChange([...values, ''])}
        >
          הוספת שורה
        </button>
      </div>
      {hint && <p className="hint">{hint}</p>}

      {values.length === 0 ? (
        <div className="empty" style={{ padding: '16px 12px' }}>
          אין עדיין שורות.
        </div>
      ) : (
        values.map((value, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <textarea
              rows={2}
              style={{ flex: 1 }}
              value={value}
              onChange={(e) => onChange(values.map((v, n) => (n === i ? e.target.value : v)))}
            />
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={() => onChange(values.filter((_, n) => n !== i))}
            >
              ✕
            </button>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * What the report will say, before it is produced.
 *
 * The last step is the only one that sees the whole survey, and producing a file to
 * find out what is missing is a slow way to check.
 */
function MoldSummary({ report }: { report: MoldReport }) {
  const samples = realSamples(report);
  const outdoor = outdoorAirSample(report);
  const indoorWithMoisture = indoorAirSamples(report).filter(
    (s) => s.moistureReading.trim() !== '',
  );

  const rows: Array<[string, string]> = [
    ['שם המבקש', report.clientName.trim() || '—'],
    ['כתובת הבדיקה', report.siteAddress.trim() || '—'],
    ['מועד הדיגום', report.surveyDateTime.trim() || '—'],
    ['מבצע הדיגום', report.samplerName.trim() || '—'],
    ['עורך הדוח', report.authorName.trim() || '—'],
    ['דגימות', samples.length === 0 ? '—' : String(samples.length)],
    ['דגימת ביקורת', outdoor ? outdoor.location || 'חוץ' : '—'],
    [
      'מדידות לחות',
      report.moistureSurveyed === 'לא'
        ? 'לא בוצעה'
        : `${indoorWithMoisture.length} מתוך ${indoorAirSamples(report).length}`,
    ],
    ['תמונות', report.photos.length === 0 ? '—' : String(report.photos.length)],
    ['נספח דוח Hayes', report.labSheets.length === 0 ? '—' : String(report.labSheets.length)],
  ];

  const missing = [
    report.clientName.trim() === '' ? 'שם המבקש' : null,
    report.siteAddress.trim() === '' ? 'כתובת הבדיקה' : null,
    report.surveyDateTime.trim() === '' ? 'מועד הדיגום' : null,
    report.samplerName.trim() === '' ? 'מבצע הדיגום' : null,
    report.authorName.trim() === '' ? 'עורך הדוח' : null,
    samples.length === 0 ? 'דגימות' : null,
    !outdoor ? 'דגימת חוץ להשוואה' : null,
    report.moistureSurveyed === 'כן' && indoorWithMoisture.length < indoorAirSamples(report).length
      ? 'קריאת לחות בחלק מהדגימות'
      : null,
    report.siteDescription.trim() === '' ? 'תיאור מקום הבדיקה' : null,
    report.executiveSummary.trim() === '' ? 'תקציר מנהלים' : null,
    report.conclusions.filter((c) => c.trim() !== '').length === 0 ? 'מסקנות' : null,
    // נספח א׳ (דוח Hayes המלא) הוא נספח קבוע לדוח — ר' סיכום ומקורות. ללא עמוד סרוק
    // אחד לפחות הכותרת מודפסת מעל נספח ריק.
    report.labSheets.length === 0 ? 'נספח דוח Hayes (נספח א׳)' : null,
  ].filter(Boolean) as string[];

  return (
    <div style={{ marginTop: 20 }}>
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

/**
 * The photo appendix step.
 *
 * Numbering is deliberately not offered: the appendix numbers the pages itself, one
 * photograph per page, in the order they appear here.
 */
function PhotoStep({
  id,
  report,
  setReport,
  onChange,
}: {
  id: string;
  report: MoldReport;
  setReport: (fn: (r: MoldReport) => MoldReport) => void;
  onChange: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  /**
   * Which kind of camera this machine has.
   *
   * A phone gets `<input capture>`, which hands the job to the operating system's own
   * camera app — better than anything this page could draw. A desktop ignores `capture`
   * entirely and would fall back to a file picker, so it gets `getUserMedia` in a prompt
   * instead. Both end at the same upload.
   *
   * The button used to be hidden on desktop altogether, which left a laptop that has a
   * camera with no way to use it — and a mould survey is written on whatever is to hand.
   */
  const [handheld, setHandheld] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const apply = () => setHandheld(coarse.matches);
    apply();
    coarse.addEventListener('change', apply);
    return () => coarse.removeEventListener('change', apply);
  }, []);

  const webcam = useCameraSupported();
  const [cameraOpen, setCameraOpen] = useState(false);
  // Asked after each upload so a wall, a drip stain or a mould patch gets its own
  // caption while the surveyor is still beside it — not later from a long list.
  const { ask: askCaption, node: captionPromptNode } = useCaptionPrompt();

  // Accepts a plain array too, so a single frame from the webcam takes the same path
  // as a gallery selection rather than needing an upload path of its own.
  const upload = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setError('');
    startTransition(async () => {
      let prepared: File[];
      try {
        // A PDF containing photographs becomes one appendix image per page. Keeping
        // the conversion here means PDF pages and selected photos have identical
        // captions, previews, deletion and DOCX output from this point onward.
        prepared = await expandPdfPages(Array.from(files));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'לא ניתן לפתוח את קובץ ה-PDF.');
        return;
      }

      /**
       * The report each upload is filed against, carried forward through the loop.
       *
       * The server stores the snapshot it is handed, so sending the same one every time
       * round would save each photograph against a report that did not know about the
       * one before it — selecting three from the gallery would keep only the third.
       */
      let current = report;

      for (const file of prepared) {
        // Shrunk before it goes — a full camera shot is ten megabytes, and the appendix
        // prints it six inches wide.
        const toSend = await shrinkPhoto(file);
        const form = new FormData();
        form.set('file', toSend);
        // The report as it stands on screen, so an unsaved edit is not lost by the
        // server writing back the stored copy.
        form.set('report', JSON.stringify(current));

        let result: Awaited<ReturnType<typeof uploadMoldPhoto>>;
        try {
          result = await uploadMoldPhoto(id, form);
        } catch (err) {
          console.error('העלאת התמונה נכשלה', err);
          setError(
            `העלאת "${file.name}" נכשלה — ייתכן שהחיבור נותק. נסו שוב, או צלמו באיכות נמוכה יותר.`,
          );
          break;
        }

        if (!result.ok || !result.photo) {
          setError(result.error ?? 'העלאה נכשלה');
          break;
        }
        // Asked here, with whatever the server inferred (filename, OCR'd text) as a
        // starting point. Dismissing keeps the inference, which is how the appendix
        // used to behave before this prompt existed.
        const answered = await askCaption(result.photo.caption || '');
        const photo = { ...result.photo, caption: answered ?? result.photo.caption };
        current = { ...current, photos: [...current.photos, photo] };
        setReport((r) => ({ ...r, photos: [...r.photos, photo] }));
      }
      // Both are cleared so the same file — or another shot from the camera, which hands
      // back the same name every time — fires change again.
      if (inputRef.current) inputRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
    });
  };

  const remove = (imageId: string) =>
    startTransition(async () => {
      await removeMoldPhoto(id, imageId);
      setReport((r) => ({ ...r, photos: r.photos.filter((p) => p.imageId !== imageId) }));
    });

  return (
    <div>
      {error && <div className="notice error">{error}</div>}

      {captionPromptNode}

      {cameraOpen && (
        <CameraCapture onCapture={(file) => upload([file])} onClose={() => setCameraOpen(false)} />
      )}

      {/* Two inputs, because `capture` is what opens the camera and an input carrying it
          cannot also serve the gallery. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => upload(e.target.files)}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => upload(e.target.files)}
      />

      <div className="protocols-bare-actions">
        {/* One button, two implementations — the phone's own camera app where there is
            one, a webcam prompt otherwise. See `handheld` above. */}
        {(handheld || webcam) && (
          <button
            type="button"
            className="btn-primary btn-sm"
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
          onClick={() => inputRef.current?.click()}
        >
          {pending ? 'מעלה…' : 'הוספת תמונות או PDF'}
        </button>
      </div>

      {report.photos.length === 0 ? (
        <div className="empty">אין עדיין תמונות. כל תמונה תודפס בעמוד נפרד וממוספרת אוטומטית.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>תמונה</th>
                <th>תצוגה</th>
                <th>כיתוב</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {report.photos.map((photo, i) => (
                <tr key={photo.imageId}>
                  {/* המספר מוצג ולא נערך — הוא נגזר מהסדר, וזה בדיוק מה שמונע
                      שתי תמונות עם אותו מספר אחרי שינוי סדר. */}
                  <td className="ltr">תמונה מס׳ {i + 1}</td>
                  <td>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/mold/photos/${photo.imageId}`}
                      alt={photo.caption || `תמונה ${i + 1}`}
                      style={{ maxWidth: 120, maxHeight: 90, objectFit: 'cover' }}
                    />
                  </td>
                  <td>
                    <input
                      value={photo.caption}
                      placeholder="קיר בחדר הילדים"
                      onChange={(e) => {
                        const caption = e.target.value;
                        setReport((r) => ({
                          ...r,
                          photos: r.photos.map((p) =>
                            p.imageId === photo.imageId ? { ...p, caption } : p,
                          ),
                        }));
                      }}
                      onBlur={onChange}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      disabled={pending}
                      onClick={() => remove(photo.imageId)}
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

      <p className="hint">
        הכיתוב הוא מה שמופיע אחרי ״תמונה מס׳ {report.photos.length || 1} :״. המספור נעשה אוטומטית
        לפי הסדר כאן, וכל תמונה או עמוד שחולץ מ-PDF מקבלים עמוד משלהם.
      </p>
    </div>
  );
}

/**
 * A single-line field.
 *
 * `needed` is what the phone stylesheet draws the waiting-mark from, and `data-filled`
 * is what the step header counts — see the radon editor.
 */
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
   * surveyor is looking at rather than in a parenthetical on the label above it.
   */
  placeholder?: string;
}) {
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

/**
 * Several answers from a short list, joined by commas — with a way out.
 *
 * The sampling details of §4 are rarely one answer. A survey runs the air conditioning
 * in some rooms and not others, or checks the flow both before and after; a picker that
 * allowed one would force the surveyor to describe half of what happened, and the half
 * that was dropped is exactly the sort of thing a reader later asks about.
 *
 * Ticks rather than a menu, for the reason the asbestos instructions use them: choosing
 * three from a select that closes after each is a three-step chore, and here every
 * option is visible at once.
 *
 * The ticked answers keep the list's own order, so two reports describing the same
 * protocol read identically however they were clicked. The "אחר" box survives
 * alongside them: a sampling that genuinely happened otherwise has to be able to say
 * so, and an answer stored before this list existed opens there rather than vanishing.
 */
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const listed = options.filter((o) => parts.includes(o));
  const other = parts.filter((p) => !options.includes(p)).join(', ');

  const commit = (nextListed: readonly string[], nextOther: string) =>
    onChange(
      [...nextListed, ...nextOther.split(',').map((p) => p.trim()).filter(Boolean)]
        .filter((v) => v.trim() !== '')
        .join(', '),
    );

  const toggle = (option: string) => {
    const next = listed.includes(option)
      ? listed.filter((o) => o !== option)
      : options.filter((o) => o === option || listed.includes(o));
    commit(next, other);
  };

  return (
    <div className="field wide" data-filled={value.trim() !== '' ? 'true' : 'false'}>
      <label>{label}</label>
      <div className="check-list">
        {options.map((option) => (
          <label key={option} className="check-item">
            <input
              type="checkbox"
              checked={listed.includes(option)}
              onChange={() => toggle(option)}
            />
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
        <span className="hint">בדוח: {value}</span>
      )}
    </div>
  );
}

/**
 * One of the people in `MOLD_STAFF`, for the two names §1 prints.
 *
 * Radios rather than a menu: there are two answers, and both should be visible at once.
 *
 * A name stored before the choice existed — "חיים כהן" was the default nobody could
 * change — is shown as a third, ticked option rather than dropped. It is what the
 * report printed, and it changes only when somebody picks one of the others.
 */
function StaffChoice({
  label,
  value,
  onChange,
  hint = 'מודפס בעמוד 2, בסעיף 1',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const groupName = useId();
  const current = value.trim();
  const options = current && !(MOLD_STAFF as readonly string[]).includes(current)
    ? [...MOLD_STAFF, current]
    : MOLD_STAFF;

  return (
    <div className="field needed" data-filled={current !== '' ? 'true' : 'false'}>
      <label>{label}</label>
      <div className="check-list">
        {options.map((option) => (
          <label key={option} className="check-item">
            <input
              type="radio"
              name={groupName}
              checked={current === option}
              onChange={() => onChange(option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
      <span className="hint">{hint}</span>
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
   * Only the descriptive passages carry one. They are the sentences somebody is worst
   * placed to type — standing in a corridor with a pump running — and the shortest to
   * say out loud.
   */
  dictate?: DictationField;
}) {
  return (
    <div className="field wide">
      <label>{label}</label>
      <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
      {dictate && (
        <DictateButton
          field={dictate}
          // Appended, not replaced: a half-typed description finished by speaking means
          // both, and losing the typed half would be a nasty surprise.
          onText={(text) => onChange(value.trim() ? `${value.trim()}\n${text}` : text)}
        />
      )}
    </div>
  );
}

/**
 * The laboratory results step.
 *
 * This is where the report stops being a survey and becomes a set of findings. The
 * samples went to Hayes a week ago; what comes back is a PDF or a scan with a block
 * per sample, and every figure in the finished document is transcribed from it.
 *
 * Transcribing eighteen genera across five samples by hand is both slow and the place
 * a mould report goes wrong: a transposed digit in "37,000 נבגים/מ״ק" is invisible in
 * the finished file and changes what a customer is told to do about a child's bedroom.
 * So the sheet is photographed, read by a model, and the surveyor checks it against
 * the picture rather than typing it.
 *
 * The picture is kept as well as read. It becomes the closing appendix, so the report
 * carries the evidence its figures came from — a reader who doubts a count can see the
 * page it was read off, in the same file.
 */
function LabResultsStep({
  id,
  report,
  update,
  setReport,
  onChange,
}: {
  id: string;
  report: MoldReport;
  update: (patch: Partial<MoldReport>) => void;
  setReport: (fn: (r: MoldReport) => MoldReport) => void;
  onChange: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [handheld, setHandheld] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const apply = () => setHandheld(coarse.matches);
    apply();
    coarse.addEventListener('change', apply);
    return () => coarse.removeEventListener('change', apply);
  }, []);

  const webcam = useCameraSupported();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  /*
   * A file dropped just outside the zone must not replace the editor.
   *
   * The browser's own response to a PDF dropped on a page is to open it in the tab, and
   * a near miss would take the surveyor out of the report mid-step. Only file drags are
   * intercepted, and only while this step is on screen.
   */
  useEffect(() => {
    const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const swallow = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  /**
   * Reads the sheets, then files them as the appendix.
   *
   * In that order deliberately. Reading is the part that can fail — a blurred page, a
   * model that declines — and a surveyor whose scan failed should not also have to
   * undo an appendix they got no results from. Once the figures are in, the same files
   * are stored, so the report ends up carrying exactly the pages it was read from.
   */
  const scanAndFile = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setError('');
    setNotice('');
    setScanning(true);

    startTransition(async () => {
      try {
        // A laboratory PDF is rendered locally into one sharp image per page. From
        // here on those pages use the same tested reading and appendix path as camera
        // photographs, so the original PDF needs no separate storage or parser.
        const list = await expandPdfPages(Array.from(files));

        const form = new FormData();
        // Deliberately not shrunk: the whole point is small digits, and `shrinkPhoto`
        // is tuned for photographs of walls. A rescaled page is what turns 37,000 into
        // 87,000.
        for (const file of list) form.append('image', file);

        const response = await fetch('/api/mold/lab-scan', { method: 'POST', body: form });
        const payload = (await response.json().catch(() => ({}))) as {
          results?: LabResult[];
          /** The sheet's own particulars — its number and its two dates. */
          details?: {
            labReportNumber: string;
            labCollectedDate: string;
            labReceivedDate: string;
            labReportedDate: string;
          };
          warning?: string;
          error?: string;
        };

        if (!response.ok || !payload.results) {
          setError(payload.error ?? 'קריאת התמונה נכשלה');
          return;
        }

        /*
         * The scan replaces the previous reading rather than adding to it.
         *
         * Appending would double every block when a surveyor re-scans a page they
         * thought had failed, and the second copy is indistinguishable from a real
         * second sample. Re-scanning is how a bad read is corrected, so it has to fix
         * the list rather than corrupt it.
         */
        const results = payload.results;

        /*
         * The samples take what the sheet says, wherever the surveyor left a blank.
         *
         * This is the transcription being removed: the total and the genera are what
         * the summary and the comparison are built from, and they are on the sheet.
         * Anything already typed wins — see `sampleWithLabResult`.
         */
        const merged = { ...report, labResults: results };
        const updated = report.samples.map((sample) =>
          sampleWithLabResult(sample, labResultFor(merged, sample)),
        );

        /*
         * A block the sheet reports and no sample row claims becomes a row of its own.
         *
         * The rows used to be typed on site and the scan only filled them in. They are
         * not typed any more — the survey is written a week later from the laboratory's
         * PDF, and a report opens with no samples at all — so the sheet is what says
         * which samples exist. Without this the scan read nine blocks, matched none of
         * them, and left the summary table and the conclusions with nothing to work
         * from while showing nine "unmatched" warnings.
         *
         * The laboratory's own room name is used, and the outdoor control is recognised
         * by it: that one sample is what every indoor figure is compared against, so
         * mis-filing it as indoor would change what the report concludes.
         */
        const claimed = new Set(
          updated.map((sample) => labResultFor(merged, sample)).filter(Boolean),
        );
        const added = results
          .filter((result) => !claimed.has(result))
          .map((result) => {
            const name = result.sampleName.trim();
            const outdoor = isOutdoorLocation(name);
            return sampleWithLabResult(
              {
                ...newSampleRow(),
                location: name,
                scope: outdoor ? ('חוץ' as const) : ('פנים' as const),
              },
              result,
            );
          });

        const samples = [...updated, ...added];

        /*
         * The sheet's own particulars fill §1, where a blank was printing before.
         *
         * Only into fields still empty: a number or a date the surveyor typed is a
         * decision, and an overwrite would be silent. The same rule the sample rows
         * follow — see `sampleWithLabResult`.
         */
        const details = payload.details;
        update({
          labResults: results,
          samples,
          ...(details?.labReportNumber && !report.labReportNumber.trim()
            ? { labReportNumber: details.labReportNumber }
            : {}),
          ...(details?.labReceivedDate && !report.labReceivedDate.trim()
            ? { labReceivedDate: details.labReceivedDate }
            : {}),
          ...(details?.labReportedDate && !report.labReportedDate.trim()
            ? { labReportedDate: details.labReportedDate }
            : {}),
          // The sampling date — the sheet's "Collected" date is the day of the visit,
          // and the report opened days later has no better source for it.
          ...(details?.labCollectedDate && !report.surveyDateTime.trim()
            ? { surveyDateTime: details.labCollectedDate }
            : {}),
        });

        // Every block now has a row — matched to one the surveyor had, or given one of
        // its own just above. What is worth saying is how many arrived and how many
        // rows were created, not a mismatch that can no longer happen.
        const stray = unmatchedLabResults({ labResults: results, samples });
        setNotice(
          [
            `נקראו ${results.length} בלוקי תוצאות.` +
              (added.length > 0 ? ` נוצרו ${added.length} דגימות חדשות.` : ''),
            stray.length > 0
              ? `${stray.length} תוצאות לא שויכו לאף דגימה (${stray
                  .map((r) => r.labNumber || r.sampleName || 'ללא שם')
                  .join(', ')}) — בדקו את מספרי הדגימה.`
              : '',
            payload.warning ?? '',
          ]
            .filter(Boolean)
            .join(' '),
        );

        // Now keep the pages themselves, as the closing appendix.
        let current = merged;
        for (const file of list) {
          const sheetForm = new FormData();
          sheetForm.set('file', file);
          sheetForm.set('report', JSON.stringify(current));
          const stored = await uploadMoldLabSheet(id, sheetForm);
          if (!stored.ok || !stored.sheet) {
            setError(stored.error ?? 'שמירת גיליון המעבדה נכשלה');
            break;
          }
          /*
           * The caption is written now, not left to be typed.
           *
           * It was a placeholder only — grey text in an empty box — so every sheet was
           * stored with no caption at all, and the appendix headed each page "תמונה
           * מס' 1". A laboratory sheet is not a photograph of the building, and that is
           * the wrong word for it in a signed report.
           *
           * Numbered by position, so several pages of one laboratory report read as a
           * sequence. Still editable: a report carrying sheets from two laboratories
           * needs to say which is which.
           */
          const sheet = {
            ...stored.sheet,
            caption:
              stored.sheet.caption ||
              `תוצאות המעבדה — Hayes, עמוד ${current.labSheets.length + 1} מתוך ${list.length}`,
          };
          current = { ...current, labSheets: [...current.labSheets, sheet] };
          setReport((r) => ({ ...r, labSheets: [...r.labSheets, sheet] }));
        }
      } catch (err) {
        console.error('קריאת תוצאות המעבדה נכשלה', err);
        setError(
          err instanceof Error && /PDF/.test(err.message)
            ? err.message
            : 'קריאת התמונה נכשלה — ייתכן שהחיבור נותק. נסו שוב.',
        );
      } finally {
        setScanning(false);
        if (inputRef.current) inputRef.current.value = '';
        if (cameraRef.current) cameraRef.current.value = '';
      }
    });
  };

  const removeSheet = (imageId: string) =>
    startTransition(async () => {
      await removeMoldLabSheet(id, imageId);
      setReport((r) => ({ ...r, labSheets: r.labSheets.filter((s) => s.imageId !== imageId) }));
    });

  const busy = pending || scanning;

  return (
    <div>
      {error && <div className="notice error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {/*
        Who commissioned the survey, and where.

        Both print in §1 and both were coming out blank, because the steps that asked
        for them were removed. They are back as one block rather than a step of their
        own: picking the customer fills both, which is the whole reason the directory
        exists.

        The place is the *site*, not the customer's own address — a company's card
        carries its offices, and the survey was not done there. So it is filled from the
        card only for a private customer, whose home is the site, and left for the
        surveyor otherwise. That is the rule the radiation report follows; see
        `withCustomerDefaults`.
      */}
      <div className="grid">
        <CustomerPicker
          onPick={(fields) => {
            const patch: Partial<MoldReport> = {
              customerId: fields.customerId,
              customerType: fields.customerType,
              recipientName: fields.recipientName,
              companyName: fields.customerType === 'company' ? fields.companyName : '',
              addressLine: fields.addressLine,
              city: fields.city,
              phone: fields.phone,
              email: fields.email,
              // The commissioning party is normally the customer, and stays editable:
              // the מזמין is often a contractor or a managing agent while the report is
              // about somebody else's building.
              clientName:
                fields.customerType === 'company'
                  ? fields.companyName || fields.recipientName
                  : fields.recipientName,
              clientPhone: fields.phone,
              clientEmail: fields.email,
            };

            /*
             * The site address is filled from the card only where the card is the site.
             *
             * A private customer's home is what was sampled; a company's registered
             * address is its offices, and printing those as "מיקום" would name a
             * building nobody visited. Anything already typed wins either way.
             */
            const fromCard = joinAddress(fields.addressLine, fields.city);
            if (fields.customerType === 'private' && fromCard && !report.siteAddress.trim()) {
              patch.siteAddress = fromCard;
            }

            update(patch);
          }}
        />

        <Text
          label="מזמין הבדיקה"
          value={report.clientName}
          onChange={(v) => update({ clientName: v })}
          wide
          hint="מולא מהלקוח שנבחר — ניתן לשנות. מודפס בסעיף 1."
        />

        <Text
          label="מיקום"
          value={report.siteAddress}
          onChange={(v) => update({ siteAddress: v })}
          wide
          hint="כתובת האתר שנדגם — לא כתובת המשרדים. מודפס בסעיף 1 וקובע את שם הקובץ."
        />

        <Text
          label="תאריך הבקשה"
          value={report.requestDate}
          onChange={(v) => update({ requestDate: v })}
          hint="מולא בתאריך פתיחת הדוח — ניתן לשנות"
        />

        <Text
          label="מועד הדיגום"
          value={report.surveyDateTime}
          onChange={(v) => update({ surveyDateTime: v })}
          optional
          placeholder="מולא אוטומטית מדוח המעבדה"
          hint="יום הביקור בשטח — מתמלא מ״Collected״ בדוח המעבדה; אפשר לתקן."
        />

        <Text
          label="תיאור המבנה"
          value={report.buildingDescription}
          onChange={(v) => update({ buildingDescription: v })}
          optional
          placeholder="דירה בקומה 2 מעל קומת עמודים"
          hint="שורה אחת על הבניין. מודפס בסעיף 1."
        />

        <StaffChoice
          label="מבצע הדיגום"
          value={report.samplerName}
          onChange={(v) => update({ samplerName: v })}
        />
        <StaffChoice
          label="עורך הדוח"
          value={report.authorName}
          onChange={(v) => update({ authorName: v })}
          hint="מודפס בעמוד 2, בסעיף 1 — וקובע את החתימה בסוף הדוח"
        />
      </div>

      {/*
        The one thing about the site the laboratory's sheet cannot say.
        
        §3 is drafted from the results, and from figures alone it can only name rooms
        and counts — true, but thin. The Technion report's own §3 says which rooms have
        a window and which are sealed with an overhead unit, and that is exactly the
        sort of fact that explains why one room came back high. A model cannot invent
        it and is told not to guess, so without this the section simply comes out
        shorter than it should.
        
        One field rather than the five steps this replaced: it is the only one of them
        that changes what the drafting can say.
      */}
      <div className="grid">
        <Area
          label="תיאור המקום"
          value={report.siteDescription}
          onChange={(v) => update({ siteDescription: v })}
          dictate="moldSiteDescription"
          hint="באילו חללים בוצעה הבדיקה, ומה מאפיין אותם — חלונות, מיזוג, אוורור. משמש לניסוח סעיף 3."
        />
      </div>

      {/*
        Whether the wall-moisture survey ran at all.

        A separate instrument and a separate walk-through from the air sampling, and
        plenty of jobs are air alone — so this is asked rather than assumed. Turning it
        on adds a reading box beside each indoor sample above, a moisture column to the
        summary table, and the whole "בדיקת לחות בקירות" chapter to the document; turning
        it off drops all of that rather than printing empty boxes.
      */}
      <div className="field wide" data-filled="true" style={{ marginTop: 4 }}>
        <label>בדיקת לחות בקירות</label>
        <div className="check-list">
          {(['כן', 'לא'] as const).map((option) => (
            <label key={option} className="check-item">
              <input
                type="radio"
                name="moistureSurveyed"
                checked={report.moistureSurveyed === option}
                onChange={() => update({ moistureSurveyed: option })}
              />
              <span>{option === 'כן' ? 'בוצעה' : 'לא בוצעה'}</span>
            </label>
          ))}
        </div>
        <span className="hint">
          {report.moistureSurveyed === 'כן'
            ? `נמדדה במכשיר ${MOISTURE_INSTRUMENT}, ליד כל דגימת אוויר פנימית.`
            : 'הדוח יודפס בלי פרק הלחות.'}
        </span>
      </div>

      {/*
        §4 — the four sampling details the laboratory's sheet cannot supply.

        They print "יש להשלים מטופס השטח" until somebody answers them, which is a
        standing note that the protocol is incomplete — honest, but it reaches the
        customer looking like an unfinished document. They are asked here instead,
        as pickers: the answers are the same handful every time, and typing them per
        report is where the wording drifts.

        Every one keeps an "אחר…" box. A sampling that genuinely happened otherwise
        has to be able to say so, and a picker that flattened it to the nearest listed
        answer would be recording something that did not happen.
      */}
      <div style={{ marginTop: 16 }}>
        <strong>פרטי הדיגום (סעיף 4)</strong>
        <p className="hint">
          לא מופיעים בגיליון המעבדה. עד שימולאו, הדוח מדפיס ״יש להשלים מטופס השטח״.
        </p>
        <div className="grid">
          <Choice
            label="גובה נקודת הדיגום"
            value={report.samplingHeight}
            options={SAMPLING_HEIGHT_OPTIONS}
            onChange={(v) => update({ samplingHeight: v })}
          />
          <Choice
            label="מצב מערכת המיזוג"
            value={report.hvacState}
            options={HVAC_STATE_OPTIONS}
            onChange={(v) => update({ hvacState: v })}
          />
          <Choice
            label="מצב חלונות ודלתות"
            value={report.openingsState}
            options={OPENINGS_STATE_OPTIONS}
            onChange={(v) => update({ openingsState: v })}
          />
          <Choice
            label="בדיקת/אימות ספיקה"
            value={report.flowVerification}
            options={FLOW_VERIFICATION_OPTIONS}
            onChange={(v) => update({ flowVerification: v })}
          />
        </div>
      </div>

      {cameraOpen && (
        <CameraCapture
          onCapture={(file) => scanAndFile([file])}
          onClose={() => setCameraOpen(false)}
        />
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => scanAndFile(e.target.files)}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => scanAndFile(e.target.files)}
      />

      {/*
        The laboratory's PDF is dropped here, straight from the e-mail or the downloads
        folder. The zone is also a button — a tap on a phone, where nothing is dragged,
        opens the same file picker the old "העלאה" button did.
      */}
      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-disabled={busy}
        className={`drop-zone${dragOver ? ' over' : ''}${busy ? ' busy' : ''}`}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!busy && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = busy ? 'none' : 'copy';
        }}
        onDragLeave={(e) => {
          // Leaving for a child element is not leaving the zone.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (busy) return;
          const files = Array.from(e.dataTransfer.files).filter(
            (file) => file.type.startsWith('image/') || isPdf(file),
          );
          if (files.length === 0) {
            setError('אפשר לגרור לכאן רק PDF או תמונות של דוח המעבדה.');
            return;
          }
          scanAndFile(files);
        }}
      >
        <strong>{scanning ? 'מכין וקורא את הדוח…' : 'גררו לכאן את דוח המעבדה'}</strong>
        <span className="hint">
          {scanning ? 'זה לוקח כמה שניות לכל עמוד' : 'PDF או תמונות — או לחצו כאן לבחירת קובץ'}
        </span>
      </div>

      {(handheld || webcam) && (
        <div className="protocols-bare-actions">
          <button
            type="button"
            className="btn-sm"
            disabled={busy}
            onClick={() => (handheld ? cameraRef.current?.click() : setCameraOpen(true))}
          >
            📷 צילום הגיליון
          </button>
        </div>
      )}

      <p className="hint">
        אפשר לגרור PDF או כמה תמונות יחד. כל עמוד PDF יומר לתמונה, התוצאות ייקראו לטבלאות
        שבדוח, והעמודים עצמם יצורפו כנספח בסופו. כדאי לוודא שהמספרים חדים — הקריאה מבוססת
        על התמונה.
      </p>

      {report.labResults.length === 0 ? (
        <div className="empty" style={{ padding: '20px 12px' }}>
          עדיין לא נקראו תוצאות מעבדה.
        </div>
      ) : (
        <LabResultsReview report={report} update={update} onChange={onChange} />
      )}

      {report.labSheets.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, margin: '20px 0 8px' }}>
            גיליונות המעבדה בנספח ({report.labSheets.length})
          </h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>עמוד</th>
                  <th>תצוגה</th>
                  <th>כיתוב</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {report.labSheets.map((sheet, i) => (
                  <tr key={sheet.imageId}>
                    <td className="ltr">עמוד {i + 1}</td>
                    <td>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/mold/photos/${sheet.imageId}`}
                        alt={sheet.caption || `גיליון מעבדה ${i + 1}`}
                        style={{ maxWidth: 120, maxHeight: 90, objectFit: 'cover' }}
                      />
                    </td>
                    <td>
                      <input
                        value={sheet.caption}
                        placeholder="תוצאות מעבדה — הייס"
                        onChange={(e) => {
                          const caption = e.target.value;
                          setReport((r) => ({
                            ...r,
                            labSheets: r.labSheets.map((s) =>
                              s.imageId === sheet.imageId ? { ...s, caption } : s,
                            ),
                          }));
                        }}
                        onBlur={onChange}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        disabled={busy}
                        onClick={() => removeSheet(sheet.imageId)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The wall-moisture reading beside one indoor sample.
 *
 * Lives inside the lab-result card rather than a step of its own: the surveyor is
 * already looking at this room's numbers, and the reading was taken standing right
 * next to where the pump sat. Nothing prints for the outdoor sample — there is no
 * wall to read at an outdoor control point — and nothing prints for a sample the
 * scan has not matched yet, which is why the lookup can come back empty here.
 */
function MoistureField({
  report,
  update,
  result,
  onBlur,
}: {
  report: MoldReport;
  update: (patch: Partial<MoldReport>) => void;
  result: LabResult;
  onBlur: () => void;
}) {
  const sample = report.samples.find((s) => labResultFor(report, s) === result);
  if (!sample || isOutdoorSample(sample)) return null;

  return (
    <div className="field" data-filled={sample.moistureReading.trim() !== '' ? 'true' : 'false'}>
      <label>קריאת לחות בקיר</label>
      <input
        className="ltr"
        value={sample.moistureReading}
        placeholder="0.1%"
        onChange={(e) => {
          const moistureReading = e.target.value;
          update({
            samples: report.samples.map((s) => (s === sample ? { ...s, moistureReading } : s)),
          });
        }}
        onBlur={onBlur}
      />
      <span className="hint">קריאת המכשיר ליד נקודת הדיגום — מודפס בסעיף 4.1, 2.1 ובסעיף 6</span>
    </div>
  );
}

/**
 * What was read, laid out for checking against the sheet.
 *
 * Editable, because a transcription is a reading and readings can be wrong — the
 * surveyor is the only one who can see both the picture and this table. Only the
 * figures that reach the printed document are shown: the genus names are the
 * laboratory's fixed roster and are not something to retype.
 *
 * Blank rows are shown as blank rather than hidden. An empty row means the laboratory
 * did not find that genus, which is a finding of its own, and hiding it would make
 * this table stop matching the sheet it is being checked against.
 */
function LabResultsReview({
  report,
  update,
  onChange,
}: {
  report: MoldReport;
  update: (patch: Partial<MoldReport>) => void;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(0);

  const setResult = (index: number, patch: Partial<LabResult>) =>
    update({
      labResults: report.labResults.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    });

  return (
    <div>
      {report.labResults.map((result, i) => {
        const isOpen = open === i;
        const found = result.organisms.filter(
          (o) => o.perCubicMetre.trim() !== '' || o.raw.trim() !== '',
        );

        return (
          <div className="card" key={i} style={{ marginTop: 12 }}>
            <div className="card-head">
              <button
                type="button"
                className="card-toggle"
                onClick={() => setOpen(isOpen ? -1 : i)}
              >
                <span>
                  {result.sampleName || result.labNumber || `תוצאה ${i + 1}`}
                  <span className="hint" style={{ marginInlineStart: 8 }}>
                    {result.labNumber}
                    {result.totalPerCubicMetre ? ` · סה״כ ${result.totalPerCubicMetre}` : ''}
                    {found.length > 0 ? ` · ${found.length} אורגניזמים` : ' · לא נמצאו אורגניזמים'}
                  </span>
                </span>
                <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
              </button>
            </div>

            {isOpen && (
              <div style={{ padding: '0 12px 12px' }}>
                <div className="grid">
                  <Text
                    label="מספר דגימה במעבדה"
                    value={result.labNumber}
                    onChange={(v) => setResult(i, { labNumber: v })}
                    ltr
                    hint="לפי זה התוצאה משויכת לדגימה שנרשמה בשטח"
                  />
                  <Text
                    label="שם הדגימה"
                    value={result.sampleName}
                    onChange={(v) => setResult(i, { sampleName: v })}
                  />
                  <Text
                    label="נפח הדגימה"
                    value={result.volume}
                    onChange={(v) => setResult(i, { volume: v })}
                    optional
                  />
                  <Text
                    label="מגבלת דיווח"
                    value={result.reportingLimit}
                    onChange={(v) => setResult(i, { reportingLimit: v })}
                    optional
                  />
                  <Text
                    label="רקע כללי"
                    value={result.background}
                    onChange={(v) => setResult(i, { background: v })}
                    optional
                  />
                  <Text
                    label="מקטעים"
                    value={result.fragments}
                    onChange={(v) => setResult(i, { fragments: v })}
                    optional
                  />
                  {report.moistureSurveyed === 'כן' && (
                    <MoistureField report={report} update={update} result={result} onBlur={onChange} />
                  )}
                </div>

                <div className="table-scroll" style={{ marginTop: 12 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>אורגניזם</th>
                        <th>ספירה גולמית</th>
                        <th>ספירה / מטר³</th>
                        <th>% מסה״כ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.organisms.map((organism, n) => (
                        <tr key={organism.organism || n}>
                          <td className="ltr">{organism.organism}</td>
                          {(['raw', 'perCubicMetre', 'percent'] as const).map((field) => (
                            <td key={field}>
                              <input
                                className="ltr"
                                value={organism[field]}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setResult(i, {
                                    organisms: result.organisms.map((o, m) =>
                                      m === n ? { ...o, [field]: value } : o,
                                    ),
                                  });
                                }}
                                onBlur={onChange}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr>
                        <td>
                          <strong>סה״כ</strong>
                        </td>
                        {(['totalRaw', 'totalPerCubicMetre', 'totalPercent'] as const).map(
                          (field) => (
                            <td key={field}>
                              <input
                                className="ltr"
                                value={result[field]}
                                onChange={(e) => setResult(i, { [field]: e.target.value })}
                                onBlur={onChange}
                              />
                            </td>
                          ),
                        )}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
