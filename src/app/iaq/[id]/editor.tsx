'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import {
  draftIaqSections,
  fetchWeather,
  finishIaqReport,
  persistIaqReportDraft,
  removeIaqPhoto,
  uploadIaqPhoto,
} from '../actions';
import {
  MEASUREMENT_KEYS,
  MEASUREMENT_LABELS,
  MEASUREMENT_UNITS,
  type IaqReport,
  type MeasurementKey,
} from '@/lib/iaq-schema';
import {
  compactIaqDraftReport,
  compactIaqDraftRequest,
  concludeMeasurement,
  hasMeasurement,
  summaryConclusions,
} from '@/lib/iaq-rules';
import { CustomerPicker } from '../../reports/[id]/customer-picker';
import { Wizard } from '../../wizard';
import { useAutosave } from '../../use-autosave';
import { SaveIndicator } from '../../save-indicator';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { downloadDocument } from '../../download-document';
import { iaqCurrentDateTime } from '@/lib/iaq-date-defaults';
import { useCaptionPrompt } from '../../caption-prompt';
import { savePhotoToDevice } from '@/lib/save-to-device';

/**
 * עורך דוח איכות אוויר תוך-מבנית.
 *
 * ארבעה צעדים: פרטי הבדיקה, נקודות הדיגום (עד 10), המדידות (גריד נקודות × מדדים),
 * ולבסוף תמונות + ניסוח המסקנות (מוצעות אוטומטית לפי הספים).
 */
export function IaqEditor({ id, initial }: { id: string; initial: IaqReport }) {
  const [report, setReport] = useState<IaqReport>(initial);
  const [saving, startSave] = useTransition();
  const [issues, setIssues] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const latestReport = useRef(report);
  const draftingRef = useRef(false);
  const lastDraftInput = useRef<string | null>(null);

  latestReport.current = report;

  const update = useCallback((patch: Partial<IaqReport>) => {
    setReport((r) => ({ ...r, ...patch }));
  }, []);

  // New reports are prefilled on the server. This also repairs an older draft whose
  // date/time fields were saved empty, without ever replacing values already entered.
  const dateDefaultsApplied = useRef(false);
  useEffect(() => {
    if (dateDefaultsApplied.current) return;
    dateDefaultsApplied.current = true;
    const current = iaqCurrentDateTime();
    const patch: Partial<IaqReport> = {};
    if (!report.reportDate.trim()) patch.reportDate = current.date;
    if (!report.surveyDate.trim()) patch.surveyDate = current.date;
    if (!report.surveyTime.trim()) patch.surveyTime = current.time;
    if (Object.keys(patch).length > 0) update(patch);
  }, [report.reportDate, report.surveyDate, report.surveyTime, update]);

  const autosave = useAutosave(
    report,
    useCallback(
      async (current: IaqReport) => {
        const result = await persistIaqReportDraft(id, current);
        return result.ok
          ? { ok: true as const }
          : { ok: false as const, message: result.error ?? 'שמירה נכשלה' };
      },
      [id],
    ),
  );

  const draftAfterMeasurements = useCallback(async () => {
    const snapshot = latestReport.current;
    const signature = iaqDraftInputSignature(snapshot);

    // The wizard can be operated from its step bar as well as from "המשך". Both paths
    // report the same transition, so guard the request here rather than relying on the
    // shape of one button. An unchanged visit must also not overwrite text edited later.
    if (draftingRef.current || lastDraftInput.current === signature) return;

    draftingRef.current = true;
    lastDraftInput.current = signature;
    setDrafting(true);
    setDraftError('');

    try {
      // Send measurement facts only: no placeholder rows, null cells, or empty
      // location-name properties. A numeric zero is deliberately preserved.
      const result = await draftIaqSections(compactIaqDraftRequest(snapshot));
      if (!result.ok || !result.draft) {
        // A failed request may be retried by returning to measurements and finishing
        // the step again; only successful input is remembered as already drafted.
        lastDraftInput.current = null;
        setDraftError(result.error ?? 'הניסוח נכשל');
        return;
      }
      setReport((current) => ({
        ...current,
        summaryText: result.draft!.summaryText,
        recommendations: result.draft!.recommendations,
      }));
      // saveNow waits for the render above, so it stores the generated text rather than
      // the pre-generation snapshot. The autosave hook also serializes this with the
      // save already requested by leaving the measurements step.
      autosave.saveNow();
    } catch (err) {
      lastDraftInput.current = null;
      setDraftError(err instanceof Error ? err.message : 'הניסוח נכשל');
    } finally {
      draftingRef.current = false;
      setDrafting(false);
    }
  }, [autosave.saveNow]);

  const onStepChange = useCallback(
    (from: number, to: number) => {
      autosave.saveNow();
      // In this editor step 2 is measurements and step 3 is the editable summary.
      // Draft only on that forward boundary — not on restore, back, or unrelated steps.
      if (from === 1 && to === 2) void draftAfterMeasurements();
    },
    [autosave.saveNow, draftAfterMeasurements],
  );

  const finish = () => {
    // The generated wording is part of the document. Do not let a programmatic click
    // race past the disabled button while the server is still composing it.
    if (draftingRef.current) return;
    startSave(async () => {
      const result = await finishIaqReport(id, report);
      setIssues(
        result.ok && !result.error
          ? []
          : result.issues ?? (result.error ? [result.error] : []),
      );
      if (!result.ok) return;
      try {
        await downloadDocument(`/api/iaq/${id}/docx`);
      } catch (err) {
        setIssues([err instanceof Error ? err.message : 'הורדת הדוח נכשלה']);
        return;
      }
      window.location.href = '/iaq';
    });
  };

  const finishActions = (
    <button
      type="button"
      className="btn-primary wizard-next"
      onClick={finish}
      disabled={saving || drafting}
    >
      {drafting ? 'ממתין לניסוח…' : saving ? 'מסיים…' : 'סיום והפקה'}
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
        onStepChange={onStepChange}
        status={<SaveIndicator state={autosave.state} />}
        steps={[
          {
            title: 'פרטי הבדיקה',
            hint: 'מזמין, תאריך, מקום ומבצע הבדיקה',
            content: <DetailsStep report={report} update={update} />,
          },
          {
            title: 'מדידות',
            hint: 'שם הנקודה + ערכים שנמדדו + צילום — הכל בשורה אחת',
            content: (
              <MeasurementsStep
                id={id}
                report={report}
                setReport={setReport}
                runExclusive={autosave.runExclusive}
              />
            ),
          },
          {
            title: 'מסקנות ותמונות',
            hint: 'תקציר/המלצות מוצעים לפי הספים — ניתנים לעריכה; הוסף תמונות לנספח',
            content: (
              <SummaryStep
                id={id}
                report={report}
                setReport={setReport}
                update={update}
                drafting={drafting}
                draftError={draftError}
                runExclusive={autosave.runExclusive}
              />
            ),
          },
        ]}
      />
    </>
  );
}

/** Only facts seen by the IAQ drafting prompt participate in duplicate detection. */
function iaqDraftInputSignature(report: IaqReport): string {
  // The editor deliberately keeps ten placeholder rows. They are not facts and
  // must not trigger another AI request merely because a user focused a cell and
  // cleared it, leaving behind an all-null results object.
  const compact = compactIaqDraftReport(report);
  const locations = compact.locations.map((location) => ({
    name: location.name,
    measurements: Object.fromEntries(
      MEASUREMENT_KEYS.flatMap((key) => {
        const value = compact.results[location.id]?.[key];
        return typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : [];
      }),
    ),
  }));

  return JSON.stringify({
    recipientName: report.recipientName,
    companyName: report.companyName,
    address: report.address,
    city: report.city,
    siteCharacter: report.siteCharacter,
    reason: report.reason,
    surveyDate: report.surveyDate,
    surveyTime: report.surveyTime,
    weather: report.weather,
    presentAt: report.presentAt,
    airConditioning: report.airConditioning,
    locations,
  });
}

/* ─── צעד 1: פרטי הבדיקה ────────────────────────────────────────── */

function DetailsStep({
  report,
  update,
}: {
  report: IaqReport;
  update: (patch: Partial<IaqReport>) => void;
}) {
  const field = (
    label: string,
    key: keyof IaqReport,
    opts: { placeholder?: string; width?: string } = {},
  ) => (
    <label className="field" style={{ minWidth: opts.width ?? '240px', flex: 1 }}>
      <span>{label}</span>
      <input
        type="text"
        value={String(report[key] ?? '')}
        placeholder={opts.placeholder}
        onChange={(e) => update({ [key]: e.target.value } as Partial<IaqReport>)}
      />
    </label>
  );

  return (
    <div className="form">
      <section>
        <h3>מזמין</h3>
        {report.sourceQuoteId && (
          <div className="notice ok" style={{ marginBottom: 12 }}>
            הפרטים מולאו מהצעת מחיר{' '}
            <strong>{report.sourceQuoteNumber ? `מס׳ ${report.sourceQuoteNumber}` : report.sourceQuoteId}</strong>.
            אפשר לתקן כל שדה לפני ההפקה.
          </div>
        )}
        {/*
          חיפוש לקוח מתוך ה-CRM — אותו רכיב בדיוק שבעובש / אסבסט / קרינה / ראדון
          משתמשים בו. הבחירה ממלאת את כל שדות המזמין בהמשך הטופס (סוג לקוח, שם,
          חברה, כתובת, טלפון, מייל) + שומרת customerId כדי שהדוח יתויק בכרטיס
          הלקוח בסיום.
        */}
        <div className="row">
          <CustomerPicker
            onPick={(fields) =>
              update({
                customerId: fields.customerId,
                customerType: fields.customerType,
                companyName:
                  fields.customerType === 'company' ? fields.companyName : '',
                recipientName: fields.recipientName,
                clientName:
                  fields.customerType === 'company'
                    ? fields.companyName || fields.recipientName
                    : fields.recipientName,
                contactPhone: fields.phone,
                contactEmail: fields.email,
                address: fields.addressLine,
                city: fields.city,
              })
            }
          />
        </div>
        <div className="row">
          <label className="field">
            <span>סוג לקוח</span>
            <select
              value={report.customerType}
              onChange={(e) =>
                update({ customerType: e.target.value as 'company' | 'private' })
              }
            >
              <option value="private">פרטי</option>
              <option value="company">חברה</option>
            </select>
          </label>
          {report.customerType === 'company' && field('שם חברה', 'companyName')}
          {field('שם לקוח', 'recipientName')}
          {field('טלפון', 'contactPhone', { placeholder: '052-...' })}
        </div>
        <div className="row">
          {field('דוא"ל', 'contactEmail', { placeholder: 'name@example.com' })}
          {field('כתובת', 'address')}
          {field('עיר', 'city')}
        </div>
      </section>

      <section>
        <h3>פרטי הבדיקה</h3>
        <div className="row">
          {field('תאריך הדוח (בשער)', 'reportDate', { placeholder: 'dd/mm/yyyy' })}
          {field('תאריך הבדיקה', 'surveyDate', { placeholder: 'dd/mm/yyyy' })}
          {field('שעת הבדיקה', 'surveyTime', { placeholder: 'HH:mm' })}
          {field('תאריך הבקשה', 'requestDate', { placeholder: 'dd/mm/yyyy' })}
        </div>
        <div className="row">
          <WeatherField report={report} update={update} />
          {field('בנוכחות', 'presentAt')}
        </div>
        <div className="row">
          {field('תיאור המקום', 'siteCharacter', {
            placeholder: 'דירה בבניין מגורים',
          })}
          {field('מערכות מיזוג', 'airConditioning', {
            placeholder: 'מזגנים עיליים נפרדים',
          })}
        </div>
        <label className="field">
          <span>סיבת הזימון (לפתיח התקציר)</span>
          <textarea
            rows={3}
            value={report.reason}
            onChange={(e) => update({ reason: e.target.value })}
            placeholder="ריח של כימיקלים שמתפשט בדירה מכיוון הארון שמתחת לכיור..."
          />
        </label>
      </section>

      <section>
        <h3>מבצע הבדיקה</h3>
        {/*
          בחירת מבצע: אביחי מוכתר (ברירת המחדל ההיסטורית) או יורם גבאי. בחירה
          ממלאת את כל שדות הקרדיט בבת-אחת, אך הם נשארים ניתנים לעריכה — אם יש
          תיאום לפרט ספציפי בדוח הזה. העורך מזהה לפי `authorName` מי חתם ובוחר
          את תמונת החתימה הנכונה ב-mapper (`signedByYoram`).
        */}
        <div className="row">
          <label className="field">
            <span>בחר מבצע</span>
            <select
              value={
                report.authorName.trim() === 'יורם גבאי'
                  ? 'yoram'
                  : report.authorName.trim() === 'ד"ר אביחי מוכתר'
                    ? 'avihay'
                    : 'custom'
              }
              onChange={(e) => {
                const choice = e.target.value;
                if (choice === 'avihay') {
                  update({
                    authorName: 'ד"ר אביחי מוכתר',
                    authorTitle: 'ד"ר (Ph.D.) למדעי החיים ומומחה לאיכות סביבה',
                    authorPhone: '054-4274143',
                    authorEmail: 'avihay@galit.co.il',
                  });
                } else if (choice === 'yoram') {
                  // טלפון/תפקיד של יורם לא רשומים במערכת — העורך משאיר אותם
                  // ריקים (עם placeholder) כדי שתשלים ידנית, בלי להמציא ערך
                  // ספציפי שלא נמסר.
                  update({
                    authorName: 'יורם גבאי',
                    authorTitle: '',
                    authorPhone: '',
                    authorEmail: 'yoram@galit.co.il',
                  });
                }
              }}
            >
              <option value="avihay">ד"ר אביחי מוכתר</option>
              <option value="yoram">יורם גבאי</option>
              <option value="custom">אחר (ערוך ידנית)</option>
            </select>
          </label>
          {field('שם', 'authorName')}
          {field('תפקיד', 'authorTitle')}
        </div>
        <div className="row">
          {field('טלפון', 'authorPhone')}
          {field('דוא"ל', 'authorEmail')}
        </div>
      </section>

      <section>
        <h3>כיול מכשירים</h3>
        <div className="row">
          {field('תוקף כיול DSII-8 (Graywolf)', 'calibrationGraywolf', {
            placeholder: '11.07.2027',
          })}
          {field('תוקף כיול FM-801 (פורמלדהיד)', 'calibrationFormaldehyde', {
            placeholder: '09.12.2027',
          })}
        </div>
      </section>
    </div>
  );
}

/**
 * שדה מזג אוויר עם שליפה אוטומטית מ-Open-Meteo (לפי העיר של הלקוח ותאריך הבדיקה).
 * כפתור "📍 שלוף" שולח ל-/actions/fetchWeather, מקבל טקסט ("סתיו, בהיר ונוח · ממוצע
 * 22°C · לחות 58% · רוח מערבית 12 קמ"ש") ושותל בשדה weather. ניתן לעריכה אחרי.
 */
function WeatherField({
  report,
  update,
}: {
  report: IaqReport;
  update: (patch: Partial<IaqReport>) => void;
}) {
  const [loading, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canFetch = report.city.trim() !== '' && report.surveyDate.trim() !== '';

  const run = () =>
    start(async () => {
      setError(null);
      const result = await fetchWeather({
        city: report.city,
        surveyDate: report.surveyDate,
        surveyTime: report.surveyTime || undefined,
      });
      if (!result.ok || !result.text) {
        setError(result.error ?? 'שליפת מזג האוויר נכשלה');
        return;
      }
      update({ weather: result.text });
    });

  return (
    <label className="field" style={{ flex: 1, minWidth: '280px' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        מזג אוויר
        <button
          type="button"
          className="btn-sm"
          onClick={run}
          disabled={loading || !canFetch}
          title={
            canFetch
              ? 'שליפת נתוני מזג אוויר מ-Open-Meteo לפי העיר ותאריך הבדיקה'
              : 'מלאו עיר ותאריך בדיקה כדי לשלוף אוטומטית'
          }
          style={{ fontSize: 11, padding: '2px 8px' }}
        >
          {loading ? 'שולף…' : '📍 שלוף אוטומטית'}
        </button>
      </span>
      <input
        type="text"
        value={report.weather}
        placeholder="קיץ, חם ובהיר"
        onChange={(e) => update({ weather: e.target.value })}
      />
      {error && (
        <span className="hint error-text" style={{ fontSize: 11 }}>
          {error}
        </span>
      )}
    </label>
  );
}

/* ─── צעד 2: מדידות — שם נקודה + ערכים + תמונה בשורה אחת ───────── */

const DEFAULT_LOCATION_COUNT = 10;

function newBlankLocation(seed = 0): { id: string; name: string } {
  return {
    id: `loc_${Date.now()}_${seed}_${Math.random().toString(36).slice(2, 6)}`,
    name: '',
  };
}

function MeasurementsStep({
  id,
  report,
  setReport,
  runExclusive,
}: {
  id: string;
  report: IaqReport;
  setReport: React.Dispatch<React.SetStateAction<IaqReport>>;
  runExclusive: <R>(work: () => Promise<R>) => Promise<R>;
}) {
  // רשומות ישנות שנשמרו לפני ברירת-המחדל של 10 שורות (או עם פחות) מרופדות
  // ל-10 בפתיחה — כדי שהבודק יראה את אותם 10 התאים הריקים כמו בדוח חדש.
  useEffect(() => {
    if (report.locations.length >= DEFAULT_LOCATION_COUNT) return;
    const padding = DEFAULT_LOCATION_COUNT - report.locations.length;
    setReport((r) =>
      r.locations.length >= DEFAULT_LOCATION_COUNT
        ? r
        : {
            ...r,
            locations: [
              ...r.locations,
              ...Array.from({ length: padding }, (_, i) =>
                newBlankLocation(r.locations.length + i),
              ),
            ],
          },
    );
    // רץ רק פעם אחת לפתיחה — על בסיס אורך הטעינה הראשוני.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addLocation = () => {
    setReport((r) => ({
      ...r,
      locations: [...r.locations, newBlankLocation(r.locations.length)],
    }));
  };

  const removeLocation = (locId: string) => {
    setReport((r) => {
      const { [locId]: _removed, ...rest } = r.results;
      return {
        ...r,
        locations: r.locations.filter((l) => l.id !== locId),
        results: rest,
      };
    });
  };

  const setValue = (locId: string, key: MeasurementKey, raw: string) => {
    const value = raw.trim() === '' ? null : Number(raw);
    setReport((r) => {
      const row = {
        ...ensureResultsRow(r.results[locId]),
        [key]: Number.isFinite(value) ? value : null,
      };
      const results = { ...r.results };

      // Clearing the final value should restore a truly empty placeholder row.
      // The output filters old all-null drafts too, but avoiding new ghost objects
      // keeps autosave payloads and draft-change detection clean at the source.
      if (MEASUREMENT_KEYS.every((measurementKey) => row[measurementKey] === null)) {
        delete results[locId];
      } else {
        results[locId] = row;
      }

      return { ...r, results };
    });
  };

  const renameLocation = (locId: string, name: string) => {
    setReport((r) => ({
      ...r,
      locations: r.locations.map((l) => (l.id === locId ? { ...l, name } : l)),
    }));
  };

  return (
    <div className="form">
      <p className="muted">
        10 שורות ריקות מופיעות אוטומטית — לכל אחת: שם הנקודה, הערכים שנמדדו,
        ואפשרות לצלם תמונה של המקום. אפשר להוסיף עוד שורות בכפתור למטה, ולמחוק
        שורה בעודף. שדות ריקים לא יודפסו בדוח. ליחידות — ראה כותרת העמודה.
      </p>

      {/*
        סריקת טבלת תוצאות: הבודק מצלם את הדף של ה-Graywolf (או גיליון עבודה),
        gpt-5 vision מתעתק את הטבלה לשורות, והערכים נכנסים לתאים הנכונים לפי שם
        הנקודה (או לפי סדר כשהשם לא מופיע). קיים = נדרס בלבד אם המודל החזיר ערך
        (null = "לא קרא" ולא מוחק).
      */}
      <ScanTableButton report={report} setReport={setReport} />

      <div style={{ overflowX: 'auto' }}>
        <table className="simple-table" style={{ minWidth: '1100px' }}>
          <thead>
            <tr>
              <th style={{ width: '36px' }}>#</th>
              <th style={{ textAlign: 'right', minWidth: '200px' }}>שם הנקודה</th>
              {MEASUREMENT_KEYS.map((k) => (
                <th key={k} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>
                    {MEASUREMENT_LABELS[k]}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    {MEASUREMENT_UNITS[k]}
                  </div>
                </th>
              ))}
              <th style={{ width: '90px' }}>תמונה</th>
              <th style={{ width: '48px' }}></th>
            </tr>
          </thead>
          <tbody>
            {report.locations.map((loc, i) => (
              <tr key={loc.id}>
                <td>{i + 1}</td>
                <td>
                  <input
                    type="text"
                    value={loc.name}
                    onChange={(e) => renameLocation(loc.id, e.target.value)}
                    placeholder='למשל "סלון מתחת למזגן"'
                    style={{ width: '100%' }}
                  />
                </td>
                {MEASUREMENT_KEYS.map((k) => (
                  <td key={k}>
                    <input
                      type="number"
                      step="any"
                      value={report.results[loc.id]?.[k] ?? ''}
                      onChange={(e) => setValue(loc.id, k, e.target.value)}
                      style={{ width: '90px', textAlign: 'center' }}
                    />
                  </td>
                ))}
                <td>
                  <LocationPhotoButton
                    reportId={id}
                    report={report}
                    setReport={setReport}
                    locationName={loc.name}
                    runExclusive={runExclusive}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => removeLocation(loc.id)}
                    title="מחק את הנקודה"
                    aria-label="מחק את הנקודה"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: '12px' }}>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={addLocation}
          disabled={report.locations.length >= 20}
          title={report.locations.length >= 20 ? 'מקסימום 20 נקודות' : undefined}
        >
          + הוסף נקודה
        </button>
      </div>

      <div style={{ marginTop: '20px' }}>
        <h3>מסקנות אוטומטיות (תצוגה מקדימה)</h3>
        <ul className="muted">
          {MEASUREMENT_KEYS.filter((k) => hasMeasurement(report, k)).map((k) => {
            const c = concludeMeasurement(report, k);
            return (
              <li
                key={k}
                style={{ color: c.exceeded ? '#dc2626' : 'inherit' }}
              >
                <strong>{MEASUREMENT_LABELS[k]}:</strong> {c.text}
              </li>
            );
          })}
          {MEASUREMENT_KEYS.every((k) => !hasMeasurement(report, k)) && (
            <li>
              <em>אין מדידות — הזן ערך לפחות לנקודה אחת כדי לראות מסקנות</em>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

/* ─── כפתור סריקת טבלה (OCR) ────────────────────────────────────── */

/** מחזיר שורת תוצאות ריקה כברירת מחדל (null לכל פרמטר). */
function ensureResultsRow(
  prev: IaqReport['results'][string] | undefined,
): IaqReport['results'][string] {
  return (
    prev ?? ({
      co2: null,
      co: null,
      o2: null,
      h2s: null,
      no2: null,
      so2: null,
      ozone: null,
      tvoc: null,
      formaldehyde: null,
      pm25: null,
      pm10: null,
      tpm: null,
      temperature: null,
      humidity: null,
    } as IaqReport['results'][string])
  );
}

function ScanTableButton({
  report,
  setReport,
}: {
  report: IaqReport;
  setReport: React.Dispatch<React.SetStateAction<IaqReport>>;
}) {
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setStatus(null);
    start(async () => {
      try {
        // ⚠️ לא קוראים ל-shrinkPhoto כאן. הסריקה היא OCR של כתב-יד בטבלה
        // צפופה — גודל התמונה הוא הגורם הישיר לאיכות הקריאה; הקטנה ל-2000px
        // גורמת ל-vision לפספס "0" או לבלבל "189"↔"169". ה-API תקוע ב-20MB,
        // וצילום של ה-iPhone הסטנדרטי יושב מתחת לזה.
        const form = new FormData();
        for (const f of Array.from(files)) form.append('image', f, f.name);
        const res = await fetch('/api/iaq/lab-scan', { method: 'POST', body: form });
        const payload = (await res.json().catch(() => ({}))) as {
          rows?: Array<{
            name?: string;
            values?: Partial<Record<MeasurementKey, number | null>>;
          }>;
          warning?: string;
          error?: string;
        };
        if (!res.ok) {
          setError(payload.error ?? `הסריקה נכשלה (${res.status})`);
          return;
        }
        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        if (rows.length === 0) {
          setError('לא זוהו שורות בתמונה. צלמו קרוב יותר, רק את הטבלה.');
          return;
        }

        // ── שיוך לנקודות קיימות ──
        // התאמה לפי שם (case-insensitive, מתעלמים מרווחים כפולים); שורות ללא
        // התאמה נכנסות ל-"פנויות" הראשונות — שם שלא מולא עד הסריקה (כשהבודק רק
        // מצלם ועוד לא כתב שמות). עדכון בלבד: null לא דורס ערך שהבודק כבר הקיש
        // ידנית, רק ערכים חדשים מהסריקה דורסים.
        const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
        setReport((r) => {
          const locations = [...r.locations];
          const results = { ...r.results };
          let touched = 0;

          const freeIdxs = locations
            .map((l, i) => ({ l, i }))
            .filter(({ l }) => !l.name.trim())
            .map(({ i }) => i);
          let freeCursor = 0;

          for (const scanned of rows) {
            const scannedName = (scanned.name ?? '').trim();
            let targetIdx = -1;
            if (scannedName) {
              targetIdx = locations.findIndex((l) => norm(l.name) === norm(scannedName));
            }
            if (targetIdx < 0 && freeCursor < freeIdxs.length) {
              targetIdx = freeIdxs[freeCursor++];
              if (scannedName && !locations[targetIdx].name.trim()) {
                locations[targetIdx] = { ...locations[targetIdx], name: scannedName };
              }
            }
            if (targetIdx < 0) {
              const fresh = newBlankLocation(locations.length);
              if (scannedName) fresh.name = scannedName;
              locations.push(fresh);
              targetIdx = locations.length - 1;
            }

            const loc = locations[targetIdx];
            const existing = ensureResultsRow(results[loc.id]);
            const patched = { ...existing };
            let changed = false;
            for (const k of MEASUREMENT_KEYS) {
              const v = scanned.values?.[k];
              if (typeof v === 'number' && Number.isFinite(v)) {
                patched[k] = v;
                changed = true;
              }
            }
            if (changed) {
              results[loc.id] = patched;
              touched++;
            }
          }

          setStatus(
            `${rows.length} שורות נקראו${touched < rows.length ? ` (${touched} עודכנו)` : ''}` +
              (payload.warning ? ` — ${payload.warning}` : ''),
          );
          return { ...r, locations, results };
        });
      } catch (err) {
        console.error('IAQ lab scan failed', err);
        setError('הסריקה נכשלה. נסה שוב.');
      }
    });
  };

  return (
    <div
      style={{
        margin: '12px 0',
        padding: '12px 14px',
        border: '1px dashed #94a3b8',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 220 }}>
        <strong>📷 סריקת טבלת תוצאות</strong>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          צלמו את הטבלה של ה-Graywolf (או גיליון עבודה) — הערכים נכנסים לתאים
          הנכונים לפי שם הנקודה. ערכים שכבר הקשתם ידנית לא יידרסו.
        </div>
      </div>
      <label className="btn-primary btn-sm" style={{ cursor: pending ? 'wait' : 'pointer' }}>
        {pending ? 'סורק…' : 'צלמו / בחרו קובץ'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          disabled={pending}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {status && <span className="hint">{status}</span>}
      {error && <span className="hint error-text">{error}</span>}
    </div>
  );
}

/**
 * כפתור צילום פר-שורה: פותח את המצלמה של המכשיר (כמו ב-PhotoButton של דוח הקרינה),
 * מעלה את הקובץ עם `uploadIaqPhoto`, ושומר את שם הנקודה כ-caption אוטומטית.
 * התמונה נכנסת לאותו `report.photos[]` שמופיע גם בנספח התמונות של השלב האחרון —
 * אין מקום אחסון נפרד, כדי שהנספח יישאר אחד.
 */
function isCameraFileName(caption: string): boolean {
  const name = caption.trim();
  if (name === '') return true;
  return /^(img|dsc|dscn|pxl|mvimg|photo|image|screenshot|wa)?[\s_-]*(\d[\d\s_.()-]*|\(\d+\))$/i.test(name);
}

function LocationPhotoButton({
  reportId,
  report,
  setReport,
  locationName,
  runExclusive,
}: {
  reportId: string;
  report: IaqReport;
  setReport: React.Dispatch<React.SetStateAction<IaqReport>>;
  locationName: string;
  runExclusive: <R>(work: () => Promise<R>) => Promise<R>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(0);
  // כמו בדוח הקרינה: הכיתוב נשאל בזמן שהבודק עדיין ליד נקודת המדידה,
  // ושם הנקודה משמש כהצעה בלבד כדי שאפשר יהיה לדייק לכל צילום בנפרד.
  const { ask: askCaption, node: captionPromptNode } = useCaptionPrompt();

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    start(async () => {
      await runExclusive(async () => {
      let photos = [...report.photos];
      for (const file of Array.from(files)) {
        try {
          const toSend = await shrinkPhoto(file);
          const form = new FormData();
          form.set('file', toSend);
          // כל צילום נשלח יחד עם הרשימה שכבר נצברה בסבב הזה. כך כמה תמונות
          // רצופות אינן דורסות זו את זו בשמירת השרת.
          form.set('report', JSON.stringify({ ...report, photos }));
          const result = await uploadIaqPhoto(reportId, form);
          if (!result.ok || !result.photo) {
            setError(result.error ?? 'העלאה נכשלה');
            break;
          }
          const fromName = result.photo.caption;
          const suggested = isCameraFileName(fromName)
            ? locationName.trim() || fromName
            : fromName || locationName.trim();
          const answered = await askCaption(suggested);
          const photo = { ...result.photo, caption: answered ?? suggested };
          photos = [...photos, photo];
          setReport((r) => ({ ...r, photos }));
          setAdded((n) => n + 1);
          // צילום שנפתח ישירות מהמצלמה נשמר גם במכשיר, בדיוק כמו בדוח הקרינה.
          savePhotoToDevice(file, photo.caption);
        } catch (err) {
          console.error('העלאת תמונה נכשלה', err);
          setError('העלאה נכשלה — ייתכן שהחיבור נותק');
          break;
        }
      }
      });
    });
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        <label className="btn-sm" style={{ cursor: pending ? 'wait' : 'pointer' }}>
          {pending ? 'מעלה…' : '📷 צילום'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            disabled={pending}
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {added > 0 && <span className="hint">{added} תמונות נוספו</span>}
        {error && <span className="hint error-text">{error}</span>}
      </div>
      {captionPromptNode}
    </>
  );
}

/**
 * נספח התמונות של דוח איכות האוויר.
 *
 * החוויה זהה לדוח הקרינה: צילום ובחירה מהגלריה הם פעולות נפרדות, כל תמונה
 * מקבלת כיתוב מיד לאחר ההעלאה, והמספור נגזר תמיד מהמיקום שלה ברשימה. לכן
 * מחיקה או הוספה לעולם אינן משאירות מספר ידני ישן בכיתוב.
 */
function IaqPhotosSection({
  id,
  report,
  setReport,
  runExclusive,
}: {
  id: string;
  report: IaqReport;
  setReport: React.Dispatch<React.SetStateAction<IaqReport>>;
  runExclusive: <R>(work: () => Promise<R>) => Promise<R>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const { ask: askCaption, node: captionPromptNode } = useCaptionPrompt();

  const upload = (files: FileList | File[] | null, fromCamera = false) => {
    if (!files || files.length === 0) return;
    setError(null);

    start(async () => {
      await runExclusive(async () => {
      // מצטברים מקומית כדי שבחירה של כמה קבצים לא תשלח לשרת שוב ושוב את
      // אותה רשימה ישנה ותדרוס את התמונה שקדמה לה.
      let photos = [...report.photos];
      for (const file of Array.from(files)) {
        try {
          const shrunk = await shrinkPhoto(file);
          const form = new FormData();
          form.set('file', shrunk, file.name);
          form.set('report', JSON.stringify({ ...report, photos }));

          const result = await uploadIaqPhoto(id, form);
          if (!result.ok || !result.photo) {
            setError(result.error ?? `העלאת "${file.name}" נכשלה`);
            break;
          }

          // כמו בקרינה, שואלים עכשיו ולא בסוף העבודה. המספר אינו חלק מהכיתוב:
          // הוא מוצג ומופק אוטומטית לפי הסדר העדכני של התמונות.
          const suggested = isCameraFileName(result.photo.caption) ? '' : result.photo.caption;
          const answered = await askCaption(suggested);
          const photo = { ...result.photo, caption: answered ?? suggested };
          photos = [...photos, photo];
          setReport((current) => ({ ...current, photos }));
          if (fromCamera) savePhotoToDevice(file, photo.caption);
        } catch (err) {
          console.error('העלאת תמונה נכשלה', err);
          setError(
            `העלאת "${file.name}" נכשלה — ייתכן שהחיבור נותק. נסו שוב, או צלמו באיכות נמוכה יותר.`,
          );
          break;
        }
      }

      if (fileInput.current) fileInput.current.value = '';
      if (cameraInput.current) cameraInput.current.value = '';
      });
    });
  };

  const remove = (imageId: string) =>
    start(async () => {
      await runExclusive(async () => {
      setError(null);
      const result = await removeIaqPhoto(id, imageId);
      if (!result.ok) {
        setError(result.error ?? 'מחיקת התמונה נכשלה');
        return;
      }
      setReport((current) => ({
        ...current,
        photos: current.photos.filter((photo) => photo.imageId !== imageId),
      }));
      });
    });

  return (
    <section>
      <h3>תמונות ({report.photos.length})</h3>
      <div className="photos-bare-actions">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          disabled={pending}
          onChange={(event) => upload(event.target.files)}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          disabled={pending}
          onChange={(event) => upload(event.target.files, true)}
        />
        <button
          type="button"
          className="btn-sm"
          disabled={pending}
          onClick={() => cameraInput.current?.click()}
        >
          {pending ? 'מעלה…' : '📷 צילום'}
        </button>
        <button
          type="button"
          className="btn-sm"
          disabled={pending}
          onClick={() => fileInput.current?.click()}
        >
          {pending ? 'מעלה…' : 'הוספת תמונות'}
        </button>
      </div>

      {error && <div className="notice error">{error}</div>}

      {report.photos.length === 0 ? (
        <div className="empty">
          התמונות יופיעו בנספח ממוספרות אוטומטית — ״תמונה מס׳ 1״, ״תמונה מס׳ 2״ וכן הלאה.
        </div>
      ) : (
        <div className="photo-grid iaq-photo-grid">
          {report.photos.map((photo, index) => (
            <div key={photo.imageId} className="photo-card iaq-photo-card">
              <div className="iaq-photo-title">
                תמונה מס׳ {index + 1}
                {photo.caption.trim() ? `: ${photo.caption.trim()}` : ''}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/iaq/photos/${photo.imageId}`}
                alt={photo.caption || `תמונה ${index + 1}`}
              />
              <div className="body">
                <label htmlFor={`iaq-photo-caption-${photo.imageId}`}>כותרת התמונה</label>
                <input
                  id={`iaq-photo-caption-${photo.imageId}`}
                  type="text"
                  value={photo.caption}
                  onChange={(event) => {
                    const caption = event.target.value;
                    setReport((current) => ({
                      ...current,
                      photos: current.photos.map((item) =>
                        item.imageId === photo.imageId ? { ...item, caption } : item,
                      ),
                    }));
                  }}
                  placeholder="כיתוב"
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
      {captionPromptNode}
    </section>
  );
}

/* ─── צעד 4: סיכום + תמונות ──────────────────────────────────────── */

function SummaryStep({
  id,
  report,
  setReport,
  update,
  drafting,
  draftError,
  runExclusive,
}: {
  id: string;
  report: IaqReport;
  setReport: React.Dispatch<React.SetStateAction<IaqReport>>;
  update: (patch: Partial<IaqReport>) => void;
  drafting: boolean;
  draftError: string;
  runExclusive: <R>(work: () => Promise<R>) => Promise<R>;
}) {
  const autoConclusions = summaryConclusions(report);

  return (
    <div className="form">
      {drafting && (
        <div className="notice" role="status">
          מנסח כעת את התקציר וההמלצות מתוך המדידות…
        </div>
      )}
      {draftError && (
        <div className="notice error" role="alert">
          {draftError}
        </div>
      )}

      <section>
        <h3>תקציר (פתיח הדוח)</h3>
        <p className="muted">
          נוסח ברירת מחדל נבנה מהפרטים שהזנת. שנה כרצונך.
        </p>
        <textarea
          rows={6}
          value={report.summaryText}
          disabled={drafting}
          onChange={(e) => update({ summaryText: e.target.value })}
          placeholder="על פי בקשתכם, ערכנו בתאריך... מדידות תוך מבניות..."
        />
      </section>

      <section>
        <h3>מסקנות (מה הדוח אומר)</h3>
        <p className="muted">
          מופקות אוטומטית לפי הספים — יודפסו בטבלת המסקנות של הפרק הפותח.
        </p>
        <ul>
          {autoConclusions.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
          {autoConclusions.length === 0 && (
            <li>
              <em>עדיין אין מסקנות — חזור לצעד "מדידות" והזן ערכים</em>
            </li>
          )}
        </ul>
      </section>

      <section>
        <h3>המלצות</h3>
        <textarea
          rows={4}
          value={report.recommendations}
          disabled={drafting}
          onChange={(e) => update({ recommendations: e.target.value })}
          placeholder="לבצע בדיקה מקיפה של הארונית..."
        />
      </section>

      <IaqPhotosSection
        id={id}
        report={report}
        setReport={setReport}
        runExclusive={runExclusive}
      />
    </div>
  );
}
