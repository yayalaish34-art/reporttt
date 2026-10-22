'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { ElfProtocol, Report, RfProtocol } from '@/lib/report-schema';
import { SCOPE_OPTIONS } from '@/lib/report-text';
import {
  FIELD_SOURCE_LABEL,
  FIELD_SOURCE_OPTIONS,
  FIELD_SOURCE_SEPARATOR,
  MEASUREMENT_TYPE_OPTIONS,
  REQUESTER_LABEL,
  SITE_CHARACTER_OPTIONS,
  WEATHER_OPTIONS,
  ANTENNA_CLASSIFICATION_OPTIONS,
  joinFieldSources,
  measuredProtocols,
  reportRequiresAntennaMap,
  shouldIncludeAntennaMap,
  splitFieldSources,
} from '@/lib/measurement-rules';
import { finishReport, persistReportDraft, type ActionResult } from '../../actions';
import { PhotosSection } from './photos-section';
import { CustomerPicker, type RecipientFields } from './customer-picker';
import { Protocols } from './protocols';
import { InspectorsStep } from './inspectors-step';
import { Wizard } from '../../wizard';
import { useAutosave } from '../../use-autosave';
import { SaveIndicator } from '../../save-indicator';
import { joinAddress } from '@/lib/address';

/**
 * The report editor.
 *
 * The whole report is held in one piece of state and saved as one document.
 * That suits how a survey is actually written up — in a sitting, from field
 * notes — and it keeps the measurement tables, where a row means nothing
 * without its neighbours, consistent.
 */
export function ReportEditor({
  id,
  initial,
  aiAvailable,
}: {
  id: string;
  initial: Report;
  aiAvailable: boolean;
}) {
  const [report, setReport] = useState<Report>(initial);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [saving, startSave] = useTransition();
  const [dirty, setDirty] = useState(false);
  const resultNoticeRef = useRef<HTMLDivElement>(null);
  const antennaMapRequired = reportRequiresAntennaMap(report);
  const includeAntennaMap = shouldIncludeAntennaMap(report);

  /**
   * Applies a change and marks the report unsaved.
   *
   * Wrapped in useCallback because usePrefilledDateTime depends on it: a fresh function
   * every render would re-run that effect on every keystroke.
   */
  const update = useCallback((patch: Partial<Report>) => {
    setReport((prev) => ({ ...prev, ...patch }));
    setDirty(true);
    setResult(null);
  }, []);

  // תאריך ושעה מתמלאים משעון הדפדפן כשהם ריקים — ראו usePrefilledDateTime.
  usePrefilledDateTime(report, update);

  /**
   * What the last customer pick wrote into "יבוצע בנוכחות" ו"מקום".
   *
   * A ref rather than state: it is read inside the pick handler and must not itself
   * cause a render. Seeded from the loaded report so a value saved by an earlier
   * sitting counts as the surveyor's, not as something a pick may overwrite.
   */
  const filledByPick = useRef({ requesterName: '', location: '' });

  const pickCustomer = useCallback(
    (fields: RecipientFields) => {
      const patch = withCustomerDefaults(report, fields, filledByPick.current);
      filledByPick.current = {
        requesterName: patch.requesterName ?? filledByPick.current.requesterName,
        location: patch.location ?? filledByPick.current.location,
      };
      update(patch);
    },
    [report, update],
  );

  /**
   * Switching between a company and a private customer.
   *
   * Beyond the lines a private recipient does not have, this also drops a "מקום" that a
   * customer pick had filled in: that address belongs to a private customer, whose home
   * is the site, and on a company it would print the offices instead of the surveyed
   * address. Only a value still holding exactly what the pick wrote is cleared — anything
   * the surveyor typed is theirs and stays.
   */
  const setCustomerType = useCallback(
    (value: 'company' | 'private') => {
      if (value === 'private') {
        // A private recipient has neither of these lines; clearing them keeps a stale
        // company from reappearing on a later switch back.
        update({ customerType: value, companyName: '', recipientTitle: '' });
        return;
      }
      const autoFilled =
        filledByPick.current.location.trim() !== '' &&
        report.location.trim() === filledByPick.current.location.trim();
      if (autoFilled) filledByPick.current = { ...filledByPick.current, location: '' };
      update({ customerType: value, ...(autoFilled ? { location: '' } : {}) });
    },
    [report, update],
  );

  /**
   * Stores the report as it is written, so nothing depends on reaching the last step.
   *
   * Partial reports can be saved and issued; readings are filtered only for the document.
   */
  const autosave = useAutosave(
    report,
    useCallback(async (current: Report) => persistReportDraft(id, current), [id]),
  );

  // A save that has landed is what "unsaved" means, so the two are the same fact.
  useEffect(() => {
    if (autosave.state.status === 'saved') setDirty(false);
  }, [autosave.state]);

  // `saveNow` already defers to after the render carrying the change, so a table edit
  // can ask for a save straight from its onChange.
  const saveSoon = autosave.saveNow;

  /**
   * Ends the survey and goes back to the list.
   *
   * Saves first rather than trusting the autosave: that runs on a timer, so the last
   * few keystrokes before the button is pressed may not have landed yet, and leaving
   * the screen would take them with it. The draft save is the right one — a report is
   * allowed to be unfinished, which is the whole reason for leaving and coming back.
   *
   * Sending to the customer used to sit here. It happens in the CRM over the sender's
   * own Outlook account, so it was never really part of writing the report — and it is
   * still offered per report from the list, which is where someone looking to send an
   * already-finished report goes anyway.
   */
  const finish = () =>
    startSave(async () => {
      const outcome = await finishReport(id, report);
      setResult(outcome);
      if (!outcome.ok) return;
      setDirty(false);
      // Back to the list, which is where the next job starts — but not instantly: the
      // filing confirmation is the only sign the report reached the customer's card, and
      // navigating on the same tick would take it off screen before it could be read.
      // Only on success; a report that failed to file stays put, with the reason showing.
      setTimeout(() => {
        window.location.href = '/reports';
      }, 1200);
    });

  useEffect(() => {
    if (result && !result.ok) {
      resultNoticeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [result]);

  const finishActions = (
    <button type="button" className="btn-primary wizard-next" onClick={finish} disabled={saving}>
      {saving ? 'מפיק ושומר…' : 'הפק דוח ושמור'}
    </button>
  );

  return (
    <>
      {result && (
        <div
          ref={resultNoticeRef}
          className={`notice ${result.ok ? 'ok' : 'error'}`}
          role={result.ok ? 'status' : 'alert'}
        >
          {result.message}
          {result.issues && (
            <ul>
              {result.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Wizard
        finish={finishActions}
        onStepChange={autosave.saveNow}
        status={<SaveIndicator state={autosave.state} />}
        steps={[
      {
        title: 'לקוח',
        hint: 'מופיע בעמוד הפתיחה של הדוח',
        content: (
        <div className="grid">
          <CustomerPicker onPick={pickCustomer} />

          <div className="field wide">
            <label>סוג לקוח</label>
            <div className="toggle">
              {(
                [
                  ['company', 'חברה'],
                  ['private', 'לקוח פרטי'],
                ] as const
              ).map(([value, text]) => (
                <button
                  key={value}
                  type="button"
                  className={report.customerType === value ? 'active' : undefined}
                  onClick={() => setCustomerType(value)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          <Text
            label={report.customerType === 'private' ? 'שם הלקוח' : 'שם איש הקשר'}
            value={report.recipientName}
            onChange={(v) => update({ recipientName: v })}
          />
          {report.customerType === 'company' && (
            <>
              <Text label="תפקיד" value={report.recipientTitle} onChange={(v) => update({ recipientTitle: v })} optional />
              <Text
                label="שם החברה"
                value={report.companyName}
                onChange={(v) => update({ companyName: v })}
                hint="מודפס מודגש עם קו תחתון"
              />
            </>
          )}
          {/* Whose address and whose telephone: for a company these are the
              company's address and the contact person's own line, and a bare
              "טלפון" beside a company name reads as the switchboard. */}
          <Text
            label={report.customerType === 'private' ? 'כתובת הלקוח' : 'כתובת החברה'}
            value={report.addressLine}
            onChange={(v) => update({ addressLine: v })}
          />
          <Text label="עיר" value={report.city} onChange={(v) => update({ city: v })} hint="מודפס מודגש עם קו תחתון" />
          <Text
            label={report.customerType === 'private' ? 'טלפון' : 'טלפון איש הקשר'}
            value={report.phone}
            onChange={(v) => update({ phone: v })}
            ltr
          />
          <Text
            label={report.customerType === 'private' ? 'דוא״ל' : 'דוא״ל איש הקשר'}
            value={report.email}
            onChange={(v) => update({ email: v })}
            ltr
          />

          {/* בלוק "כפי שיודפס בדוח" הוסר מהמסך: הוא רק שיכפל את השדות שמעליו.
              הנמען עצמו מודפס בדוח כרגיל — כאן זו הייתה תצוגה בלבד. */}
        </div>
        ),
      },
      {
        // סוג הסקר קובע אילו טווחי תדר הדוח מצהיר שנמדדו, ומכאן גם את שלושת
        // משפטי הפתיחה — שנוסחם נבנה אוטומטית ואינו מוצג כאן.
        title: 'סוג הסקר והאתר',
        hint: 'קובע את טווחי התדר בכותרת ובמשפטי הפתיחה',
        content: (
        <div className="grid">
          <div className="field wide">
            <label>סוג הסקר</label>
            <div className="toggle">
              {SCOPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={report.surveyScope === option.value ? 'active' : undefined}
                  onClick={() => update({ surveyScope: option.value })}
                  title={option.description}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {/*
            שם האתר נשאל פעם אחת וממלא גם את "מקום" בטבלת האפיון.
            קודם הוא נשאל בשני מקומות — אותה תשובה פעמיים, שהיא גם הקלדה מיותרת
            וגם דרך שבה שתי התשובות מספרות שני דברים שונים באותו מסמך.
          */}
          <Text
            label="שם האתר"
            value={report.siteName}
            onChange={(v) => update({ siteName: v, location: v })}
            hint='נכתב אחרי "ב" — למשל "משרדי חברת כ.א.ל, מוקד בני ברק". מודפס גם כ"מקום" בטבלת האפיון.'
          />
        </div>
        ),
      },
      {
        title: 'פרטי ההזמנה',
        hint: 'תאריך, מקום ואפיון המדידות',
        content: (
        <div className="grid">
          <Text
            label={REQUESTER_LABEL}
            value={report.requesterName}
            onChange={(v) => update({ requesterName: v })}
            hint="מולא משם איש הקשר — ניתן לשנות"
          />
          {/* אחד לתאריך הבדיקה ואחד לשעתה. הערך המודפס בטבלת האפיון
              ("21/06/26, 11:00") נבנה משניהם ואינו נערך בנפרד. */}
          <DateField
            label="תאריך הבדיקה"
            value={report.measurementDate}
            onChange={(v) => update(withMeasurementDate(report, v))}
          />
          <TimeField
            label="שעת הבדיקה"
            value={timeOf(report.measurementDateTime)}
            onChange={(v) => update(withMeasurementTime(report, v))}
          />
          <Choice
            label="אפיון המקום"
            value={report.siteCharacter}
            options={SITE_CHARACTER_OPTIONS}
            onChange={(v) => update({ siteCharacter: v })}
          />
          <Choice
            label="תנאי מזג אוויר"
            value={report.weather}
            options={WEATHER_OPTIONS}
            onChange={(v) => update({ weather: v })}
          />
          {/* מקורות הקרינה יכולים להיות יותר מאחד ("אנטנות, לוח חשמל") ולכן זו
              בחירה מרובה, לא רשימה נפתחת. */}
          <MultiChoice
            label={FIELD_SOURCE_LABEL}
            value={report.fieldSource}
            options={FIELD_SOURCE_OPTIONS}
            onChange={(v) => update({ fieldSource: v })}
          />
          <Choice
            label="סוג המדידות"
            value={report.measurementType}
            options={MEASUREMENT_TYPE_OPTIONS}
            onChange={(v) => update({ measurementType: v })}
          />
        </div>
        ),
      },
      {
        // מי שביצע את הבדיקה משתנה מסקר לסקר, ולכן הוא נבחר כאן. מפרטי המכשירים
        // עדיין קבועים ויושבים בתבנית עצמה.
        title: 'בודקים וחתימות',
        hint: 'מי ביצע את הבדיקה, ומי מאשר את הדוח',
        content: <InspectorsStep report={report} update={update} />,
      },
      {
        // מפרטי המכשירים אינם נערכים לכל דוח: הם קבועים, יושבים בתבנית עצמה,
        // ונשלחים למיזוג מתוך נתוני הדוח כפי שנוצרו.
        title: 'טבלאות מדידה',
        hint: 'כל טבלה מייצגת מקור אחד בקומה אחת',
        content: (
        <Protocols
          bare
          elfProtocols={report.elfProtocols}
          rfProtocols={report.rfProtocols}
          // Decides whether the measurement points offer the four faces of a
          // board — a field the tables have no other reason to know about.
          fieldSource={report.fieldSource}
          siteCharacter={report.siteCharacter}
          // בסקר משולב הטבלאות נעשות בשני מעברים — ELF ואז RF — ולכן הכפתורים
          // שונים שם: "הוספת טבלה" מוסיף עוד מאותו סוג, ויש מעבר מפורש ל-RF.
          surveyScope={report.surveyScope}
          onChangeElf={(elfProtocols) => {
            update({ elfProtocols });
            // A table gained or lost a row, or a whole table was added or deleted —
            // structural work worth storing at once rather than waiting for the typing
            // to stop. Editing a cell is left to the idle save, so a reading being typed
            // is not a request per digit.
            if (elfProtocols.length !== report.elfProtocols.length ||
                elfProtocols.some((p, i) => p.rows.length !== report.elfProtocols[i]?.rows.length)) {
              saveSoon();
            }
          }}
          onChangeRf={(rfProtocols) => {
            update({ rfProtocols });
            if (rfProtocols.length !== report.rfProtocols.length ||
                rfProtocols.some((p, i) => p.rows.length !== report.rfProtocols[i]?.rows.length)) {
              saveSoon();
            }
          }}
          // "סיום" הוא כפתור המשך של השלב — הוא כבר לא צריך לפתוח סקשן אחר.
          onFinish={undefined}
          // כפתור צילום בכל טבלה, עם כותרת הטבלה ככיתוב.
          photos={{ reportId: id, report, onAdd: (photos) => update({ photos }), runExclusive: autosave.runExclusive }}
        />
        ),
      },
      {
        // המסקנות אינן נערכות כאן. הן חיות בתבנית: הקטעים המסומנים בה
        // מנוסחים מחדש מהמדידות בזמן ההפקה, ומה שאינו מסומן נשאר כלשונו.
        //
        // שלב "תמונות" הוסר: התמונות מצולמות מתוך הטבלה שאותה הן מתעדות, ולכן
        // אין יותר מה לעשות בשלב נפרד. מה שנשאר — לעבור על מה שצולם ולתקן
        // כיתוב — יושב כאן, במסך שממילא סוקר את הדוח לפני ההפקה.
        title: 'הפקת הדוח',
        hint: 'בדקו את הסיכום, ואז הפיקו ושמרו את הדוח בלחיצה אחת',
        content: (
          <>
            <Summary report={report} />

            <h3 className="summary-heading">נספח מפת אנטנות</h3>
            <label className="check-item" style={{ marginBottom: includeAntennaMap ? 8 : 0 }}>
              <input
                type="checkbox"
                checked={includeAntennaMap}
                disabled={antennaMapRequired}
                onChange={(e) => update({ antennaMapEnabled: e.target.checked })}
              />
              <span>צרף נספח מפת אנטנות סלולריות בסביבת הנכס</span>
            </label>
            {antennaMapRequired && (
              <p style={{ margin: '0 0 8px', color: 'var(--muted)' }}>
                הנספח יצורף אוטומטית כשנתוני המפה זמינים. אם לא ניתן להפיקו, הדוח יופק בלעדיו ויצוין בו שהנספח לא נכלל.
              </p>
            )}
            {includeAntennaMap && (
              <div className="grid" style={{ marginBottom: 16 }}>
                {/*
                  ממולא כבר מהשלבים הקודמים (כתובת ועיר הנמען, שם האתר) — כדי שלא יצטרכו
                  להקליד שוב מה שכבר נכתב. הקלדה כאן יוצרת חריגה פרטנית לצורך המפה בלבד,
                  מבלי לגעת בשדות המקוריים; ריקון השדה חוזר לברירת המחדל.
                */}
                <Text
                  label="כתובת הנכס למפה"
                  value={report.antennaMapAddress || report.addressLine || report.location}
                  onChange={(v) => update({ antennaMapAddress: v })}
                  hint="רחוב ומספר של אתר הבדיקה — ממולא מכתובת הנמען, ניתן לתקן"
                />
                <Text
                  label="עיר הנכס למפה"
                  value={report.antennaMapCity || report.city}
                  onChange={(v) => update({ antennaMapCity: v })}
                  hint="העיר שבה בוצעה הבדיקה — ממולא מעיר הנמען, ניתן לתקן"
                />
                <Text
                  label="כינוי הנקודה במפה"
                  value={report.antennaMapLabel || report.siteName}
                  onChange={(v) => update({ antennaMapLabel: v })}
                  hint='למשל "בית ספר אליאנס" — ממולא משם האתר, ניתן לתקן'
                />
                <Choice
                  label="סיווג הנכס"
                  value={report.antennaMapClassification}
                  options={ANTENNA_CLASSIFICATION_OPTIONS}
                  onChange={(v) => update({ antennaMapClassification: v })}
                />
                <div className="field">
                  <label>רדיוס חיפוש אנטנות</label>
                  <output className="antenna-radius-value">500 מטר, ובהיעדר אנטנות — 1,000 מטר</output>
                  <span className="hint">החיפוש מתחיל ברדיוס 500 מ׳ מנקודת הבדיקה. אם לא נמצאו אנטנות, החיפוש והתמונה בדוח מתרחבים אוטומטית לרדיוס 1,000 מ׳.</span>
                </div>
              </div>
            )}

            <h3 className="summary-heading">נספח תמונות</h3>
            <PhotosSection
              bare
              reportId={id}
              report={report}
              photos={report.photos}
              onChange={(photos) => update({ photos })}
              // המצלמה כבר לא נפתחת מכאן — היא נפתחת מהטבלה.
              open={false}
              defaultCaption={lastProtocolTitle(report)}
              runExclusive={autosave.runExclusive}
            />
          </>
        ),
      },
        ]}
      />

    </>
  );
}






// ── Building blocks ─────────────────────────────────────────────────

/**
 * What the report will say, before it is produced.
 *
 * The last step is the one place the whole survey is visible at once — every other step
 * shows one part of it. Producing a Word file to find out what is missing is a slow way
 * to check, so the counts and the blanks are stated here instead.
 */
function Summary({ report }: { report: Report }) {
  const elf = measuredProtocols(report.elfProtocols);
  const rf = measuredProtocols(report.rfProtocols);
  const tables = elf.length + rf.length;
  const readings = [...elf, ...rf].reduce(
    (n, p) => n + p.rows.length,
    0,
  );
  const rows: Array<[string, string]> = [
    ['לקוח', report.recipientName.trim() || (report.companyName.trim() || '—')],
    ['אתר', report.siteName.trim() || '—'],
    ['מקום', report.location.trim() || '—'],
    ['תאריך ושעה', report.measurementDateTime.trim() || '—'],
    ['טבלאות שייכללו בדוח', tables === 0 ? '—' : `${tables} (${elf.length} ELF, ${rf.length} RF)`],
    ['קריאות שהוזנו', readings === 0 ? '—' : String(readings)],
    ['תמונות', report.photos.length === 0 ? '—' : String(report.photos.length)],
  ];

  return (
    <div>
      <p className="hint">אפשר להפיק עם הפרטים שהוזנו. טבלאות ושורות ללא ערכי מדידה לא ייכללו בדוח.</p>
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
 * A measurement table.
 *
 * Numeric columns are forced left-to-right: a bare "0.3" inside an RTL field
 * renders correctly, but "1.5-2" or "0.3 מ׳" reorders and the surveyor sees a
 * value they did not type.
 */



/**
 * Picking a customer also fills the two fields that always repeat their details.
 *
 * "יבוצע בנוכחות" is the contact who was present at the survey and "מקום" is where it was
 * taken — in practice the customer and their address, retyped by hand every
 * time. They stay editable: a survey ordered by one person at a site belonging
 * to another is unusual, not impossible.
 *
 * "מקום" is filled from the address only for a private customer, whose address is
 * where the survey happens. A company's address is its offices — the registered seat or
 * head office — while the survey is at whichever branch, site or client property was
 * ordered, so copying it there printed the wrong place far more often than the right one.
 * For a company the surveyor types the site themselves.
 *
 * A field is filled when it is empty, or when it still holds exactly what an earlier
 * pick put there. Filling only blanks was not enough: picking a second customer left the
 * first one's address sitting in "מקום", because the field was no longer empty — so a
 * company picked after any other customer printed the wrong address. Remembering what
 * was filled separates "left over from the previous pick" from "typed by the surveyor",
 * which a blank check cannot tell apart.
 *
 * For a company the picker calls this twice — once on the company, once on the contact
 * chosen from it — and the second call must reach the same conclusion as the first.
 */
function withCustomerDefaults(
  report: Report,
  fields: RecipientFields,
  filled: { requesterName: string; location: string },
): Partial<Report> {
  const place = placeOf(fields);
  // Fill a field that is empty, or one still holding what a previous pick put there.
  // Anything else is the surveyor's own wording and is left alone.
  const mine = (current: string, lastFilled: string) => {
    const value = current.trim();
    return value === '' || value === lastFilled.trim();
  };
  return {
    ...fields,
    ...(mine(report.requesterName, filled.requesterName) && fields.recipientName.trim() !== ''
      ? { requesterName: fields.recipientName }
      : {}),
    ...(fields.customerType === 'private' && mine(report.location, filled.location) && place !== ''
      ? { location: place }
      : {}),
  };
}

/** "תפוצות ישראל 13, גבעתיים" — a private customer's address as the "מקום" line prints it. */
function placeOf(fields: Pick<RecipientFields, 'addressLine' | 'city'>): string {
  return joinAddress(fields.addressLine, fields.city);
}

/**
 * The heading of the last table that has been filled in.
 *
 * Used as the opening caption for a photograph, because a survey is photographed as it is
 * measured: finish the table for a source, photograph that source. RF tables come after
 * ELF ones in the document and in the order they are worked through, so the search runs
 * backwards from the end and takes the last table that has a heading *and* a reading in
 * it — an empty table just added is not what is being photographed.
 *
 * The heading is stored without its fixed opening ("פרוטוקול רשמי - מדידת שדה מגנטי ELF ב"),
 * which is what makes it usable here as it stands: the field holds "לוח חשמל ראשי".
 */
function lastProtocolTitle(report: Report): string {
  const touched = [...report.elfProtocols, ...report.rfProtocols].filter(
    (p) => p.title.trim() !== '' && p.rows.some((r) => r.measured.trim() !== ''),
  );
  return touched.length > 0 ? touched[touched.length - 1].title.trim() : '';
}

/* ── Measurement date and time ──────────────────────────────────────
 *
 * The report holds two values: `measurementDate` ("21/06/26") for the opening
 * sentence, and `measurementDateTime` ("21/06/26, 11:00") for the
 * characterization table. Editing them separately meant typing the same date
 * twice and letting the two disagree, so the screen offers a date and a time
 * and keeps both stored values in step from them.
 */

/** The "11:00" half of "21/06/26, 11:00". */
function timeOf(dateTime: string): string {
  const part = dateTime.split(',')[1]?.trim() ?? '';
  return /^\d{1,2}:\d{2}$/.test(part) ? part.padStart(5, '0') : '';
}

/** "21/06/26" — the date format the characterization line is written in. */
function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${p(d.getFullYear() % 100)}`;
}

/** "11:00", to the minute. */
function formatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Date and time of the survey, prefilled from the browser's clock.
 *
 * Filled on the client rather than when the report row is created: the report is created
 * on the server, whose clock is UTC on Railway, so a survey entered at 09:00 Israel time
 * was getting stamped 06:00 — and the date itself was wrong for anything after 21:00.
 * The browser is the surveyor's own clock, which is the one meant here.
 *
 * Only ever fills *blanks*. An existing report keeps whatever date it was given — a
 * survey is typed up after the fact as often as during it, so today's date is a starting
 * point, never a correction. Both halves are treated separately so a report that has a
 * date but no time gets only the time.
 */
function usePrefilledDateTime(report: Report, update: (patch: Partial<Report>) => void) {
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current) return;
    const hasDate = report.measurementDate.trim() !== '';
    const hasTime = timeOf(report.measurementDateTime) !== '';
    if (hasDate && hasTime) return;
    filled.current = true; // once per mount, so a cleared field is not refilled under the cursor
    const now = new Date();
    const date = hasDate ? report.measurementDate : formatDate(now);
    const time = hasTime ? timeOf(report.measurementDateTime) : formatTime(now);
    update({ measurementDate: date, measurementDateTime: joinDateTime(date, time) });
  }, [report.measurementDate, report.measurementDateTime, update]);
}

const joinDateTime = (date: string, time: string) =>
  date && time ? `${date}, ${time}` : date || (time ? `, ${time}` : '');

function withMeasurementDate(report: Report, date: string): Partial<Report> {
  return { measurementDate: date, measurementDateTime: joinDateTime(date, timeOf(report.measurementDateTime)) };
}

function withMeasurementTime(report: Report, time: string): Partial<Report> {
  return { measurementDateTime: joinDateTime(report.measurementDate, time) };
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { cls, 'data-filled': dataFilled } = fieldProps(value);
  return (
    <div className={`field${cls}`} data-filled={dataFilled}>
      <label>{label}</label>
      <input type="time" className="ltr" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* ── Date fields ────────────────────────────────────────────────────
 *
 * The report prints these dates exactly as they are stored — "21/06/26",
 * "21/06/26, 11:00" — so the stored format cannot change. What changes here is
 * only how they are entered: a real date (and time) picker instead of a text
 * box that accepted any typo silently.
 *
 * A value that does not parse is left alone and shown in a plain text box
 * beside the picker, so an old or hand-written entry is never wiped by the
 * control failing to understand it.
 */

/** "21/06/26" → "2026-06-21", the form the native picker speaks. */
function toIso(display: string): string {
  const m = display.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return '';
  const [, d, mo, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** "2026-06-21" → "21/06/26", the form the report prints. */
function toDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y.slice(2)}`;
}

function DateField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const iso = toIso(value);
  const unparsed = value.trim() !== '' && iso === '';
  const { cls, 'data-filled': dataFilled } = fieldProps(value);
  return (
    <div className={`field${cls}`} data-filled={dataFilled}>
      <label>{label}</label>
      <input
        type="date"
        className="ltr"
        value={iso}
        onChange={(e) => onChange(e.target.value ? toDisplay(e.target.value) : '')}
      />
      {unparsed && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          title="הערך הקיים אינו בפורמט תאריך — נשמר כפי שהוא"
        />
      )}
      {hint && <span className="hint" style={{ color: 'var(--muted)', fontSize: 12 }}>{hint}</span>}
    </div>
  );
}


/**
 * A short list of answers, with a way out.
 *
 * The list covers the usual cases; "אחר" swaps in a free field for the one it
 * does not. The value itself is always plain text — the report has no notion of
 * a chosen option, and a survey typed before the lists existed still opens with
 * its own wording, shown in the free field rather than silently replaced by the
 * first option in the list.
 */
/**
 * Several options from a list, stored as one comma-joined string.
 *
 * Kept as a string rather than an array so the value stays the same shape everywhere it
 * already travels — the report schema, the DOCX merge, and every report saved before the
 * field accepted more than one source. Ticking "לוח חשמל" and "אנטנות" prints
 * "אנטנות, לוח חשמל" in the document, which is what the surveyor is after.
 *
 * Anything typed that is not on the list survives in the "אחר" box beside the ticks, so
 * a one-off source can still be worded freely and mixed with listed ones.
 */
function MultiChoice({
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
  const selected = splitFieldSources(value);
  // Ticked options keep the list's order; anything else is the free-text remainder.
  const listed = options.filter((o) => selected.includes(o));
  const extra = selected.filter((s) => !options.includes(s));
  const [other, setOther] = useState(extra.join(FIELD_SOURCE_SEPARATOR));

  // Rebuilds the stored string: listed options first (in list order, so the wording is
  // stable however they were ticked), then whatever sits in the "אחר" box.
  const commit = (nextListed: readonly string[], nextOther: string) =>
    onChange(joinFieldSources([...nextListed, ...splitFieldSources(nextOther)]));

  const toggle = (option: string) => {
    const next = listed.includes(option)
      ? listed.filter((o) => o !== option)
      : options.filter((o) => o === option || listed.includes(o));
    commit(next, other);
  };

  const { cls, 'data-filled': dataFilled } = fieldProps(value);
  return (
    <div className={`field${cls}`} data-filled={dataFilled}>
      <label>{label}</label>
      <div className="check-list">
        {options.map((o) => (
          <label key={o} className="check-item">
            <input type="checkbox" checked={listed.includes(o)} onChange={() => toggle(o)} />
            <span>{o}</span>
          </label>
        ))}
      </div>
      <input
        value={other}
        placeholder="אחר…"
        style={{ marginTop: 4 }}
        onChange={(e) => {
          setOther(e.target.value);
          commit(listed, e.target.value);
        }}
      />
      {/* מראה בדיוק את מה שייכנס לוורד — כדי שלא צריך למזג כדי לבדוק ניסוח. */}
      {value.trim() && (
        <span className="hint" style={{ color: 'var(--muted)', fontSize: 12 }}>
          בדוח: {value}
        </span>
      )}
    </div>
  );
}

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
  const listed = options.includes(value);
  // "Other" while there is a value that is not in the list, or once it is
  // picked. `value === ''` is the untouched state, which shows the list.
  const [other, setOther] = useState(value !== '' && !listed);
  const { cls, 'data-filled': dataFilled } = fieldProps(value);

  return (
    <div className={`field${cls}`} data-filled={dataFilled}>
      <label>{label}</label>
      {other ? (
        <>
          <input value={value} autoFocus onChange={(e) => onChange(e.target.value)} />
          <button
            type="button"
            className="btn-sm"
            style={{ marginTop: 6 }}
            onClick={() => {
              setOther(false);
              onChange('');
            }}
          >
            חזרה לרשימה
          </button>
        </>
      ) : (
        <select
          value={listed ? value : ''}
          onChange={(e) => {
            if (e.target.value === '__other__') {
              setOther(true);
              onChange('');
              return;
            }
            onChange(e.target.value);
          }}
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value="__other__">אחר…</option>
        </select>
      )}
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  wide,
  ltr,
  hint,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  wide?: boolean;
  ltr?: boolean;
  hint?: string;
  /** Left out of the step's field count — see fieldProps. */
  optional?: boolean;
}) {
  const { cls, 'data-filled': dataFilled } = fieldProps(value, optional);
  return (
    <div className={`field${wide ? ' wide' : ''}${cls}`} data-filled={dataFilled}>
      <label>{label}</label>
      <input value={value} className={ltr ? 'ltr' : undefined} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="hint" style={{ color: 'var(--muted)', fontSize: 12 }}>{hint}</span>}
    </div>
  );
}

/**
 * Marks a field as one the step is counting, and says whether it is filled.
 *
 * The class is what the phone stylesheet draws the waiting-mark from, and the attribute
 * is what the step's "מולאו 3 מתוך 7" counts. Both come from the value itself, so a
 * field cannot drift out of step with the count describing it.
 *
 * `optional` opts a field out of both. It is for the lines that genuinely may stay empty
 * — a contact's title, a private customer's second address line — where counting them
 * would leave a step permanently short of its own total and the number would stop
 * meaning anything.
 */
function fieldProps(value: string, optional?: boolean): { cls: string; 'data-filled'?: string } {
  if (optional) return { cls: '' };
  return { cls: ' needed', 'data-filled': value.trim() !== '' ? 'true' : 'false' };
}

function Area({ label, value, onChange, wide }: { label: string; value: string; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <div className={`field${wide ? ' wide' : ''}`}>
      <label>{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────
