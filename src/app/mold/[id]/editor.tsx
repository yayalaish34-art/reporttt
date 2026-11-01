'use client';

import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { CustomerPicker } from '../../reports/[id]/customer-picker';
import { DictateButton } from '../../asbestos/[id]/dictate-button';
import type { DictationField } from '@/lib/transcribe';
import {
  finishMoldReport,
  persistMoldReportDraft,
  prepareMoldChainOfCustody,
  removeMoldLabSheet,
  draftMoldSections,
  removeMoldPhoto,
  uploadMoldLabSheet,
  uploadMoldPhoto,
} from '../actions';
import type { LabResult, MoldReport, MoldSample, WallReading } from '@/lib/mold-schema';
import {
  BUILDING_TYPE_OPTIONS,
  FLOW_VERIFICATION_OPTIONS,
  HVAC_STATE_OPTIONS,
  COC_ANALYSIS_CODES,
  MOISTURE_INSTRUMENT,
  MOISTURE_SURFACES,
  MOLD_STAFF,
  OPENINGS_STATE_OPTIONS,
  SAMPLING_HEIGHT_OPTIONS,
} from '@/lib/mold-schema';
import {
  applyLabScan,
  describeMoldFindings,
  indoorAirSamples,
  isOutdoorSample,
  LOCATION_OPTIONS,
  labResultFor,
  moistureText,
  newOutdoorSampleRow,
  newSampleRow,
  outdoorAirSample,
  photosInRoomOrder,
  realSamples,
} from '@/lib/mold-rules';
import {
  chainOfCustody,
  cocSamples,
  englishRoomName,
  isoFromNumeric,
  numericFromIso,
  todayNumeric,
} from '@/lib/mold-coc';
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

  // The sampling date is today unless it was already set — a report opened before the
  // field defaulted gets it on first open.
  useEffect(() => {
    if (!initial.surveyDateTime.trim()) update({ surveyDateTime: todayNumeric() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            title: 'חדרים ותמונות',
            hint: 'פרטי הבדיקה, ולכל חדר — מספר מדיה, תמונות וקריאות לחות',
            content: (
              <>
                <DetailsSection report={report} update={update} />
                <RoomsSection
                  id={id}
                  report={report}
                  update={update}
                  setReport={setReport}
                  onChange={autosave.saveNow}
                />
              </>
            ),
          },
          {
            title: 'דוח מעבדה Hayes',
            hint: 'טופס Chain of Custody לשליחה, ואחר כך דוח התוצאות — נקרא לטבלאות ומצורף כנספח',
            content: (
              <>
                <ChainOfCustodySection id={id} report={report} update={update} setReport={setReport} />
                <LabResultsStep
                  id={id}
                  report={report}
                  update={update}
                  setReport={setReport}
                  onChange={autosave.saveNow}
                />
              </>
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
    (s) => moistureText(s) !== '',
  );

  const rows: Array<[string, string]> = [
    ['שם המבקש', report.clientName.trim() || '—'],
    ['כתובת', report.siteAddress.trim() || '—'],
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
    report.siteAddress.trim() === '' ? 'כתובת' : null,
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
    // נספח ב׳ (דוח Hayes המלא) הוא נספח קבוע לדוח — ר' סיכום ומקורות. ללא עמוד סרוק
    // אחד לפחות הכותרת מודפסת מעל נספח ריק.
    report.labSheets.length === 0 ? 'נספח דוח Hayes (נספח ב׳)' : null,
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
 * Hayes' Chain of Custody, built from the rooms above and printed as the laboratory's
 * own form.
 *
 * Every box shows, greyed, what the form will print if it is left empty — the sampler's
 * English name and mobile, today's date, the room names in English — so the usual job
 * is a job number and a click. Each row is a room: its number is the room's media
 * number, which is what Hayes sends its result back under.
 */
function ChainOfCustodySection({
  id,
  report,
  update,
  setReport,
}: {
  id: string;
  report: MoldReport;
  update: (patch: Partial<MoldReport>) => void;
  setReport: (fn: (r: MoldReport) => MoldReport) => void;
}) {
  const [producing, startProducing] = useTransition();
  const [error, setError] = useState('');

  const coc = report.coc;
  // What each header box falls back to — the form with no overrides at all.
  const derived = chainOfCustody({
    ...report,
    coc: { jobNumber: coc.jobNumber, jobName: '', collector: '', mobile: '', email: '', dateCollected: '', note: '' },
  });
  const setCoc = (patch: Partial<MoldReport['coc']>) => update({ coc: { ...coc, ...patch } });
  const rows = cocSamples(report);
  const setSample = (sample: MoldSample, patch: Partial<MoldSample>) =>
    update({ samples: report.samples.map((s) => (s === sample ? { ...s, ...patch } : s)) });

  /*
   * Prepared and stored on the server before it is produced — the job number from the
   * shared sequence, English for anything in Hebrew ("בית מלון" → "Hotel"), and the
   * numbers the form prints written into the rooms, so a room printed as "817-3" is
   * findable under that number when the results come back. The editor then shows
   * exactly what the PDF printed.
   */
  const produce = () =>
    startProducing(async () => {
      setError('');
      const prepared = await prepareMoldChainOfCustody(id, report);
      if (!prepared.ok || !prepared.report) {
        setError(prepared.error ?? 'הכנת הטופס נכשלה');
        return;
      }
      const next = prepared.report;
      setReport(() => next);
      try {
        await downloadDocument(`/api/mold/${id}/coc`, 'Chain of Custody Hayes.pdf');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'הפקת הטופס נכשלה');
      }
    });

  const header: Array<[keyof MoldReport['coc'], string, string, boolean?]> = [
    ['jobName', 'Job Name', derived.jobName],
    ['collector', 'Collector', derived.collector],
    ['mobile', 'Mobile', derived.mobile, true],
    ['email', 'Email', derived.email, true],
    ['note', 'Note', derived.note],
  ];

  return (
    <div style={{ marginTop: 24 }}>
      <strong>טבלת Hayes — Chain of Custody</strong>
      <p className="hint">
        הטופס שנשלח עם הדגימות למעבדה. שורה לכל חדר משלב החדרים; שדה שנשאר ריק מודפס עם מה שמופיע
        בו באפור. מה שכתוב בעברית מתורגם לאנגלית בהפקה (״בית מלון״ → Hotel).
      </p>

      <div className="grid">
        <div className="field needed" data-filled={coc.jobNumber.trim() !== '' ? 'true' : 'false'}>
          <label>Job Number</label>
          <input
            className="ltr"
            value={coc.jobNumber}
            placeholder="אוטומטי"
            onChange={(e) => setCoc({ jobNumber: e.target.value })}
          />
          <span className="hint">
            ריק — יוקצה בהפקה, ברצף החל מ-817. מספר כל דגימה בטופס: Job Number-מספר מדיה, למשל
            817-20546.
          </span>
        </div>
        <div className="field">
          <label>Date Collected</label>
          <input
            type="date"
            className="ltr"
            value={coc.dateCollected}
            onChange={(e) => setCoc({ dateCollected: e.target.value })}
          />
          <span className="hint">ריק — היום ({derived.dateCollected})</span>
        </div>
        {header.map(([key, label, fallback, ltr]) => (
          <div className="field" key={key}>
            <label>{label}</label>
            <input
              className={ltr ? 'ltr' : undefined}
              dir="auto"
              value={coc[key]}
              placeholder={fallback}
              onChange={(e) => setCoc({ [key]: e.target.value })}
            />
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="empty" style={{ padding: '12px' }}>
          הוסיפו חדרים בשלב הקודם — כל חדר הוא שורה בטופס.
        </div>
      ) : (
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>מספר מדיה</th>
                <th>Number</th>
                <th>Sample</th>
                <th>Analysis</th>
                <th>Volume</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sample, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <input
                      className="ltr"
                      value={sample.mediaNumber}
                      placeholder="20546"
                      onChange={(e) => setSample(sample, { mediaNumber: e.target.value })}
                    />
                  </td>
                  {/* What the form prints: job number, then the media number. */}
                  <td className="ltr">{derived.rows[i]?.number || '—'}</td>
                  <td>
                    <input
                      className="ltr"
                      value={sample.sampleNameEn}
                      placeholder={englishRoomName(sample)}
                      onChange={(e) => setSample(sample, { sampleNameEn: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      value={sample.analysis}
                      onChange={(e) => setSample(sample, { analysis: e.target.value })}
                    >
                      {COC_ANALYSIS_CODES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="ltr"
                      value={sample.volume}
                      placeholder="150 Lit."
                      onChange={(e) => setSample(sample, { volume: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="ltr"
                      value={sample.cocNote}
                      onChange={(e) => setSample(sample, { cocNote: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="protocols-bare-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={producing || rows.length === 0}
          onClick={produce}
        >
          {producing ? 'מפיק…' : '📄 הפקת טופס Hayes (PDF)'}
        </button>
        {error && <span className="hint error-text">{error}</span>}
      </div>
    </div>
  );
}

/**
 * The rooms of the survey — one card per sampling point, indoors or out.
 *
 * The same arrangement as the ELF tables of the radiation report: the room being
 * worked on is open and every other one folds to its heading, so a survey of six rooms
 * is not six screens of photographs. Adding a room folds the one before it and opens
 * the new one, which is the order the surveyor walks the flat in.
 *
 * Each card is a `samples` row. The laboratory's scan later fills in its counts,
 * matched by the media number written here — see `labResultFor`.
 */
function RoomsSection({
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
  /** `null` means "the last one", as in the radiation tables — see `ProtocolBlock`. */
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const shown = openIndex ?? report.samples.length - 1;

  const add = (row: MoldSample) => {
    update({ samples: [...report.samples, row] });
    setOpenIndex(report.samples.length);
  };

  const setSample = (index: number, patch: Partial<MoldSample>) =>
    update({ samples: report.samples.map((s, n) => (n === index ? { ...s, ...patch } : s)) });

  /*
   * A removed room's photographs stay in the report, unassigned, rather than being
   * deleted with it: a card removed by mistake should not take the pictures along.
   */
  const remove = (index: number) => {
    update({ samples: report.samples.filter((_, n) => n !== index) });
    setOpenIndex(null);
  };

  const unassigned = report.photos.filter(
    (p) => !report.samples.some((s) => s.photoIds.includes(p.imageId)),
  );

  let indoorCount = 0;

  return (
    <div style={{ marginTop: 20 }}>
      <strong>חדרים ונקודות דיגום</strong>
      <p className="hint">
        לכל חדר — שם, מספר מדיה, תמונות{report.moistureSurveyed === 'כן' ? ' וקריאות לחות' : ''}.
        החדר הפתוח הוא זה שעובדים עליו; הוספת חדר מקפלת את הקודם.
      </p>

      {report.samples.length === 0 && (
        <div className="empty" style={{ padding: '16px 12px' }}>
          עדיין לא נוספו חדרים. הוסיפו את החדר הראשון, ובסוף — דגימה מבחוץ להשוואה.
        </div>
      )}

      {report.samples.map((sample, index) => {
        const outdoor = isOutdoorSample(sample);
        if (!outdoor) indoorCount++;
        const open = shown === index;
        const readings = sample.wallReadings.filter((w) => w.reading.trim() !== '').length;
        const label = outdoor ? 'חוץ' : `חדר ${indoorCount}`;
        const summary = [
          sample.mediaNumber.trim() ? `מדיה ${sample.mediaNumber.trim()}` : 'ללא מספר מדיה',
          `${sample.photoIds.length} תמונות`,
          !outdoor && report.moistureSurveyed === 'כן' ? `${readings} קריאות לחות` : '',
          sample.totalCount.trim() ? `סה״כ ${sample.totalCount.trim()}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const toggle = () => setOpenIndex(open ? -1 : index);

        return (
          <div className="protocol-block" key={index} style={{ marginTop: 10 }}>
            <div className="card-head" style={{ background: '#f7f9fb' }}>
              <button
                type="button"
                className="btn-sm"
                onClick={toggle}
                title={open ? 'סגירה' : 'פתיחה'}
                style={{ minWidth: 30 }}
              >
                {open ? '▾' : '▸'}
              </button>
              <span className="badge">{label}</span>
              <strong
                onClick={toggle}
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
              >
                {sample.location.trim() || (outdoor ? 'דגימת חוץ' : 'חדר ללא שם')}
              </strong>
              <span className="hint">{summary}</span>
              <span className="spacer" style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  onClick={() => {
                    if (confirm(`למחוק את "${sample.location.trim() || label}"? התמונות יישארו בדוח.`)) {
                      remove(index);
                    }
                  }}
                >
                  מחיקה
                </button>
              </span>
            </div>

            {open && (
              <div style={{ padding: 14 }}>
                <div className="grid">
                  <div className="field needed" data-filled={sample.location.trim() !== '' ? 'true' : 'false'}>
                    <label>{outdoor ? 'נקודת הדיגום בחוץ' : 'שם החדר'}</label>
                    <input
                      list={outdoor ? undefined : 'mold-room-names'}
                      value={sample.location}
                      placeholder={outdoor ? 'חוץ — מרפסת / חצר' : 'סלון, חדר שינה…'}
                      onChange={(e) => setSample(index, { location: e.target.value })}
                      onBlur={onChange}
                    />
                  </div>
                  <div className="field needed" data-filled={sample.mediaNumber.trim() !== '' ? 'true' : 'false'}>
                    <label>מספר מדיה</label>
                    <input
                      className="ltr"
                      value={sample.mediaNumber}
                      placeholder="12345678"
                      onChange={(e) => setSample(index, { mediaNumber: e.target.value })}
                      onBlur={onChange}
                    />
                    <span className="hint">המספר שעל ראש הדיגום — לפיו התוצאה בדוח Hayes משויכת לחדר</span>
                  </div>
                </div>

                <RoomPhotos id={id} report={report} setReport={setReport} onChange={onChange} room={index} />

                {!outdoor && report.moistureSurveyed === 'כן' && (
                  <WallReadings
                    sample={sample}
                    onChange={(wallReadings) => setSample(index, { wallReadings })}
                    onBlur={onChange}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      <datalist id="mold-room-names">
        {LOCATION_OPTIONS.filter((o) => o !== 'חוץ').map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      <div className="protocols-bare-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn-primary btn-sm" onClick={() => add(newSampleRow())}>
          + הוספת חדר
        </button>
        <button type="button" className="btn-sm" onClick={() => add(newOutdoorSampleRow())}>
          + הוספת דגימה מבחוץ
        </button>
      </div>

      {unassigned.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <strong>תמונות שלא שויכו לחדר ({unassigned.length})</strong>
          <RoomPhotos id={id} report={report} setReport={setReport} onChange={onChange} room={null} />
        </div>
      )}
    </div>
  );
}

/**
 * A room's wall-moisture readings — one per surface, as a percentage.
 *
 * The six surfaces are offered as buttons rather than a menu per row: a room is read
 * on two or three of them, and one tap per surface is quicker standing beside the
 * wall than choosing from a list each time. A surface already read is not offered
 * again.
 */
function WallReadings({
  sample,
  onChange,
  onBlur,
}: {
  sample: MoldSample;
  onChange: (readings: WallReading[]) => void;
  onBlur: () => void;
}) {
  const readings = sample.wallReadings;
  const remaining = MOISTURE_SURFACES.filter((surface) => !readings.some((r) => r.surface === surface));

  return (
    <div style={{ marginTop: 16 }}>
      <strong>בדיקת לחות בקירות</strong>
      <p className="hint">
        מיקום המדידה בחדר והתוצאה באחוזים, במכשיר {MOISTURE_INSTRUMENT}. מודפס בטבלה 2.1 ובסעיף 6.5.
      </p>

      {readings.length === 0 && sample.moistureReading.trim() !== '' && (
        <p className="hint">קריאה שנרשמה קודם: {sample.moistureReading}</p>
      )}

      {readings.map((reading, n) => (
        <div key={n} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <select
            value={reading.surface}
            style={{ flex: 1 }}
            onChange={(e) =>
              onChange(readings.map((r, m) => (m === n ? { ...r, surface: e.target.value } : r)))
            }
          >
            {!(MOISTURE_SURFACES as readonly string[]).includes(reading.surface) && (
              <option value={reading.surface}>{reading.surface || 'בחרו משטח…'}</option>
            )}
            {MOISTURE_SURFACES.map((surface) => (
              <option key={surface} value={surface}>
                {surface}
              </option>
            ))}
          </select>
          <input
            className="ltr"
            inputMode="decimal"
            style={{ width: 90 }}
            value={reading.reading.replace(/%$/, '')}
            placeholder="0.8"
            onChange={(e) =>
              onChange(readings.map((r, m) => (m === n ? { ...r, reading: e.target.value } : r)))
            }
            onBlur={onBlur}
          />
          <span>%</span>
          <button
            type="button"
            className="btn-danger btn-sm"
            onClick={() => onChange(readings.filter((_, m) => m !== n))}
          >
            ✕
          </button>
        </div>
      ))}

      {remaining.length > 0 && (
        <div className="protocols-bare-actions" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          {remaining.map((surface) => (
            <button
              key={surface}
              type="button"
              className="btn-sm"
              onClick={() => onChange([...readings, { surface, reading: '' }])}
            >
              + {surface}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The photographs of one room, or — with `room` null — those tied to no room.
 *
 * Every photograph still lives in the report's one `photos` list, so the appendix
 * numbers them in a single run; the room only records which of them it owns. The
 * number shown is the one the appendix will print, room by room — see
 * `photosInRoomOrder`.
 */
function RoomPhotos({
  id,
  report,
  setReport,
  onChange,
  room,
}: {
  id: string;
  report: MoldReport;
  setReport: (fn: (r: MoldReport) => MoldReport) => void;
  onChange: () => void;
  room: number | null;
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

  const roomName = room === null ? '' : report.samples[room]?.location.trim() ?? '';
  const owned =
    room === null
      ? report.photos.filter((p) => !report.samples.some((s) => s.photoIds.includes(p.imageId)))
      : report.photos.filter((p) => report.samples[room]?.photoIds.includes(p.imageId));
  const appendixOrder = photosInRoomOrder(report).map((p) => p.imageId);

  /** Adds a photograph to the report and, when there is one, to this room. */
  const attach = (r: MoldReport, photo: MoldReport['photos'][number]): MoldReport => ({
    ...r,
    photos: [...r.photos, photo],
    samples:
      room === null
        ? r.samples
        : r.samples.map((s, n) => (n === room ? { ...s, photoIds: [...s.photoIds, photo.imageId] } : s)),
  });

  // Accepts a plain array too, so a single frame from the webcam takes the same path
  // as a gallery selection rather than needing an upload path of its own.
  const upload = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setError('');
    startTransition(async () => {
      let prepared: File[];
      try {
        // A PDF containing photographs becomes one appendix image per page.
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
        // The room's name is the starting caption — the appendix otherwise prints a
        // bare number over a picture nobody can place.
        const answered = await askCaption(result.photo.caption || roomName);
        const photo = { ...result.photo, caption: answered ?? (result.photo.caption || roomName) };
        current = attach(current, photo);
        setReport((r) => attach(r, photo));
      }
      if (inputRef.current) inputRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
      onChange();
    });
  };

  const remove = (imageId: string) =>
    startTransition(async () => {
      await removeMoldPhoto(id, imageId);
      setReport((r) => ({
        ...r,
        photos: r.photos.filter((p) => p.imageId !== imageId),
        samples: r.samples.map((s) => ({ ...s, photoIds: s.photoIds.filter((p) => p !== imageId) })),
      }));
    });

  return (
    <div style={{ marginTop: 12 }}>
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

      {room !== null && (
        <div className="protocols-bare-actions">
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
      )}

      {owned.length === 0 ? (
        <div className="empty" style={{ padding: '12px' }}>
          אין עדיין תמונות בחדר הזה. כל תמונה תודפס בנספח בעמוד נפרד וממוספרת אוטומטית.
        </div>
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
              {owned.map((photo) => (
                <tr key={photo.imageId}>
                  {/* המספר מוצג ולא נערך — הוא נגזר מהסדר בנספח, חדר אחר חדר. */}
                  <td className="ltr">תמונה מס׳ {appendixOrder.indexOf(photo.imageId) + 1}</td>
                  <td>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/mold/photos/${photo.imageId}`}
                      alt={photo.caption || roomName || 'תמונה'}
                      style={{ maxWidth: 120, maxHeight: 90, objectFit: 'cover' }}
                    />
                  </td>
                  <td>
                    <input
                      value={photo.caption}
                      placeholder={roomName || 'קיר בחדר הילדים'}
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
    </div>
  );
}

/** "29.10.2026, 08:00" → "29.10.2026". */
function surveyDay(value: string): string {
  return value.split(',')[0]?.trim() ?? '';
}

/** "29.10.2026, 08:00" → "08:00" — the first time written after the date, or ''. */
function surveyTime(value: string): string {
  const m = value.split(',').slice(1).join(',').match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

function joinSurveyDateTime(day: string, time: string): string {
  return time ? `${day}, ${time}` : day;
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
 * The particulars of the visit — who, where, when, and how the sampling was done.
 *
 * The first thing on the first step, above the rooms, because they are the same for
 * every room and are known on site; the laboratory adds nothing to them.
 */
function DetailsSection({
  report,
  update,
}: {
  report: MoldReport;
  update: (patch: Partial<MoldReport>) => void;
}) {
  return (
    <div>
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
             * address is its offices, and printing those as "כתובת" would name a
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
          label="כתובת"
          value={report.siteAddress}
          onChange={(v) => update({ siteAddress: v })}
          wide
          hint="כתובת האתר שנדגם — לא כתובת המשרדים. מודפס בסעיף 1 וקובע את שם הקובץ."
        />

        {/*
          The date and the time, stored together as "29.10.2026, 08:00" — the shape
          `surveyDateTime` always had. The date is today by default: the report is
          opened on the day of the visit.
        */}
        <div className="field">
          <label>שעת הדיגום</label>
          <input
            type="time"
            className="ltr"
            value={surveyTime(report.surveyDateTime)}
            onChange={(e) =>
              update({ surveyDateTime: joinSurveyDateTime(surveyDay(report.surveyDateTime), e.target.value) })
            }
          />
          <span className="hint">מודפס ליד מועד הדיגום, בשער ובסעיף 1</span>
        </div>

        <div className="field">
          <label>מועד הדיגום</label>
          <input
            type="date"
            className="ltr"
            value={isoFromNumeric(report.surveyDateTime)}
            onChange={(e) =>
              update({
                surveyDateTime: joinSurveyDateTime(numericFromIso(e.target.value), surveyTime(report.surveyDateTime)),
              })
            }
          />
        </div>

        <Choice
          label="תיאור המבנה"
          value={report.buildingDescription}
          options={BUILDING_TYPE_OPTIONS}
          onChange={(v) => update({ buildingDescription: v })}
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
        on adds per-surface readings to each indoor room below, a moisture column to the
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
            ? `נמדדה במכשיר ${MOISTURE_INSTRUMENT}, בכל חדר — לפי קיר, רצפה ותקרה.`
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
         * Matched to the rooms, with a room of its own for any block none of them
         * claims, and the sheet's particulars filling §1 where it is blank — the same
         * path the e-mail from Hayes takes. See `applyLabScan`.
         */
        const scanned = applyLabScan(report, results, payload.details);
        const merged = scanned.report;
        update({
          labResults: merged.labResults,
          samples: merged.samples,
          labReportNumber: merged.labReportNumber,
          labReceivedDate: merged.labReceivedDate,
          labReportedDate: merged.labReportedDate,
          surveyDateTime: merged.surveyDateTime,
        });

        const stray = scanned.stray;
        setNotice(
          [
            `נקראו ${results.length} בלוקי תוצאות.` +
              (scanned.added > 0 ? ` נוצרו ${scanned.added} דגימות חדשות.` : ''),
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
