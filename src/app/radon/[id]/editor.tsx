'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { finishRadonReport, persistRadonReportDraft } from '../actions';
import type { DetectorRow, RadonReport } from '@/lib/radon-schema';
import { SITE_KINDS, TEST_LENGTHS, RADON_VERDICTS } from '@/lib/radon-schema';
import { actionLevel, combinedValue, implausibleUncertainty, newDetectorRow, radonVerdict, toNumber } from '@/lib/radon-rules';
import { LabScanPanel } from './lab-scan';
import { RadonCustomerFields, Text } from '../customer-fields';
import {
  radonCustomerMissing,
  radonDetectorsMissing,
  radonSurveyMissing,
} from '@/lib/report-complete';
import { Wizard } from '../../wizard';
import { useAutosave } from '../../use-autosave';
import { SaveIndicator } from '../../save-indicator';
import { joinAddress } from '@/lib/address';

/**
 * The radon report editor.
 *
 * Deliberately one screen: a radon survey is a recipient, a site kind and a
 * table of detectors, and splitting that across sections would be filing for
 * the sake of filing. The radiation editor is longer because a radiation survey
 * genuinely is.
 */
export function RadonEditor({ id, initial }: { id: string; initial: RadonReport }) {
  const [report, setReport] = useState(initial);
  const [saving, startSave] = useTransition();
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);

  const update = (patch: Partial<RadonReport>) => {
    setReport((r) => ({ ...r, ...patch }));
    setDirty(true);
  };

  const setRow = (index: number, patch: Partial<DetectorRow>) =>
    update({ detectors: report.detectors.map((r, i) => (i === index ? { ...r, ...patch } : r)) });

  /**
   * Typing a detector number fetches its reading.
   *
   * The laboratory's screen is scanned once for a whole batch and stored by
   * detector number, so by the time a report is written the numbers usually
   * already exist. Typing "19715" is then a lookup rather than an instruction
   * to find the photograph again — and it works months later, which the
   * upload-then-apply flow never could.
   *
   * Two rules keep it from being a nuisance. It never overwrites a value that
   * is already in the row, so a correction the surveyor made by hand stands.
   * And an uncertainty the laboratory printed too wide is not filled in at all
   * — the row is flagged instead, exactly as it would be after a scan.
   */
  const [lookups, setLookups] = useState<Record<number, 'busy' | 'found' | 'none' | 'wide'>>({});

  const lookUpDetector = async (index: number, raw: string) => {
    const key = raw.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
    if (key.length < 3) {
      setLookups((s) => ({ ...s, [index]: 'none' }));
      return;
    }

    setLookups((s) => ({ ...s, [index]: 'busy' }));
    try {
      const response = await fetch(`/api/radon/reading/${key}`);
      const { reading } = await response.json();
      if (!reading) {
        setLookups((s) => ({ ...s, [index]: 'none' }));
        return;
      }

      if (implausibleUncertainty(reading.uncertainty)) {
        // Found, but not usable as printed. The concentration is still worth
        // filling; the uncertainty is left for the surveyor to decide.
        setReport((r) => ({
          ...r,
          detectors: r.detectors.map((row, i) =>
            i === index && !row.concentration.trim()
              ? { ...row, concentration: reading.concentration }
              : row,
          ),
        }));
        setDirty(true);
        setLookups((s) => ({ ...s, [index]: 'wide' }));
        return;
      }

      setReport((r) => ({
        ...r,
        detectors: r.detectors.map((row, i) => {
          // A concentration typed by hand is a different measurement, and the
          // laboratory's uncertainty does not describe it.
          const typed = row.concentration.trim();
          if (i !== index || (typed !== '' && typed !== reading.concentration)) return row;
          return {
            ...row,
            concentration: typed || reading.concentration,
            uncertainty: row.uncertainty.trim() || reading.uncertainty,
          };
        }),
      }));
      setDirty(true);
      setLookups((s) => ({ ...s, [index]: 'found' }));
    } catch {
      setLookups((s) => ({ ...s, [index]: 'none' }));
    }
  };

  /**
   * Rows still missing a result are looked up as the report opens.
   *
   * A report drafted from a customer's detectors usually opens before every result is
   * back, and this picks up what arrived since. It is also what brings back the flag on
   * an uncertainty too wide to use, which is not stored on the row. One at a time, since
   * each lookup is its own connection to the store.
   */
  useEffect(() => {
    void (async () => {
      for (const [index, row] of initial.detectors.entries()) {
        if (row.detectorNumber.trim() !== '' && row.uncertainty.trim() === '') {
          await lookUpDetector(index, row.detectorNumber);
        }
      }
    })();
    // Once per opening; after that a lookup runs when a number is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The repeating cells of a survey, copied to the rows where they are still empty. */
  const fillFromFirstRow = () => {
    const [first] = report.detectors;
    if (!first) return;
    update({
      detectors: report.detectors.map((row) => ({
        ...row,
        floor: row.floor.trim() || first.floor,
        placedAt: row.placedAt.trim() || first.placedAt,
        collectedAt: row.collectedAt.trim() || first.collectedAt,
      })),
    });
  };

  /**
   * Stores the report as it is written, so nothing depends on reaching the last step.
   *
   * The draft action rather than `persistRadonReport`: a survey in progress has rooms
   * not yet named, and the strict validation is there to stop such a report being
   * *issued*, not to stop it being kept.
   */
  const autosave = useAutosave(
    report,
    useCallback(async (current: RadonReport) => {
      const result = await persistRadonReportDraft(id, current);
      // The radon action reports an `error`; the autosave speaks `message`.
      return result.ok ? { ok: true as const } : { ok: false as const, message: result.error ?? 'שמירה נכשלה' };
    }, [id]),
  );

  useEffect(() => {
    if (autosave.state.status === 'saved') setDirty(false);
  }, [autosave.state]);

  /**
   * Ends the survey: saves it, builds the document, files it on the customer's card.
   *
   * One button rather than two — see `finishReport` in the radiation actions for why the
   * pair was wrong. The Word file stays downloadable from the list whenever a copy is
   * actually wanted.
   */
  const finish = () =>
    startSave(async () => {
      const result = await finishRadonReport(id, report);
      setIssues(result.ok && !result.error ? [] : result.issues ?? (result.error ? [result.error] : []));
      if (!result.ok) return;
      setDirty(false);
      // Not on the same tick: the filing confirmation is the only sign the report reached
      // the card, and navigating at once would take it off screen before it is read.
      setTimeout(() => {
        window.location.href = '/radon';
      }, 1200);
    });

  const finishActions = (
    <button type="button" className="btn-primary wizard-next" onClick={finish} disabled={saving}>
      {saving ? 'מסיים…' : 'סיום'}
    </button>
  );

  /**
   * Changing the site kind changes which action level applies.
   *
   * Rows that still carry the old level are moved with it — leaving a workplace
   * survey's 500 on a report reclassified as residential would print a table
   * judged against a level that no longer applies to it.
   */
  const changeSiteKind = (siteKind: string) => {
    const before = String(actionLevel(report.siteKind));
    const after = String(actionLevel(siteKind));
    update({
      siteKind,
      detectors: report.detectors.map((r) => (r.threshold === before ? { ...r, threshold: after } : r)),
    });
  };

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
        title: 'לקוח',
        hint: 'מקבל השירות — מופיע בעמוד הפתיחה של הדוח',
        /* Required to move on — see `blocker` in the wizard. This block prints on
           the opening page, so a gap is a blank line in a signed document. */
        blocker: (() => {
          const gaps = radonCustomerMissing(report);
          return gaps ? `חסר כדי להמשיך: ${gaps}` : undefined;
        })(),
        content: <RadonCustomerFields customer={report} update={update} />,
      },
      {
        title: 'פרטי הבדיקה',
        blocker: (() => {
          const gaps = radonSurveyMissing(report);
          return gaps ? `חסר כדי להמשיך: ${gaps}` : undefined;
        })(),
        hint: `רמת הפעולה: ${actionLevel(report.siteKind)} בקרל/מ״ק`,
        content: (
        <div>
          <div className="grid">
            <div className="field">
              <label>סוג אתר הבדיקה</label>
              <select value={report.siteKind} onChange={(e) => changeSiteKind(e.target.value)}>
                {SITE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <span className="hint">
                מקום עבודה נבחן מול 500 בקרל/מ״ק; כל השאר מול 200.
              </span>
            </div>
            <Text label="תאריך הדוח" value={report.reportDate} onChange={(v) => update({ reportDate: v })} ltr />
            <Text label="סוג הגלאי" value={report.detectorType} onChange={(v) => update({ detectorType: v })} ltr />
            <Text label="שם הגלאי" value={report.detectorBrand} onChange={(v) => update({ detectorBrand: v })} ltr />
            <Text label="שם המעבדה" value={report.laboratory} onChange={(v) => update({ laboratory: v })} wide />
            <Text
              label="הערות לגבי הבדיקה — אילו חדרים"
              value={report.notesRooms}
              onChange={(v) => update({ notesRooms: v })}
              wide
            />
          </div>
        </div>
        ),
      },
      {
        title: 'תוצאות',
        hint: 'קריאת התוצאות מהמעבדה, והגלאים שהן משויכות אליהם',
        /* The rows may stand half-written — the laboratory answers weeks later —
           but every detector needs the room it sat in. See `radonDetectorsMissing`. */
        blocker: (() => {
          // A blank uncertainty would judge the reading on its own, so a figure the
          // laboratory printed too wide has to be replaced before moving on.
          const undecided = report.detectors.findIndex(
            (row, i) => lookups[i] === 'wide' && row.uncertainty.trim() === '',
          );
          if (undecided >= 0) return `חסר כדי להמשיך: גלאי ${undecided + 1}: אי ודאות`;
          const gaps = radonDetectorsMissing(report);
          if (!gaps) return undefined;
          return gaps.endsWith('כדי להמשיך.') ? gaps : `חסר כדי להמשיך: ${gaps}`;
        })(),
        content: (
        <div>
      {/* ── קריאת התוצאות מהמעבדה ──
          Part one of the two the surveyor works in: the readings come off the
          laboratory's screen. Part two is the table below, where the detector
          numbers and the rooms are typed — and that is what the readings are
          matched against. */}
      <LabScanPanel
        reportId={id}
        detectorNumbers={report.detectors.map((d) => d.detectorNumber)}
        onApply={(rows) => {
          const byNumber = new Map(
            rows.map((r) => [r.detectorNumber.replace(/\D+/g, '').replace(/^0+(?=\d)/, ''), r]),
          );
          update({
            detectors: report.detectors.map((row) => {
              const key = row.detectorNumber.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
              const found = key ? byNumber.get(key) : undefined;
              // Only the two measured columns are taken. The room, the floor and
              // the dates are the surveyor's, and the laboratory never saw them.
              return found
                ? { ...row, concentration: found.concentration, uncertainty: found.uncertainty }
                : row;
            }),
          });
        }}
      />

      {/* ── הגלאים ──
          בתוך אותו שלב כמו סריקת המעבדה: הקריאות מגיעות מהמעבדה והשורות כאן הן
          מה שהן משויכות אליו, ושתי הפעולות נעשות זו מול זו. */}
      <div className="protocols-bare-actions" style={{ marginTop: 20 }}>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => {
            update({ detectors: [...report.detectors, newDetectorRow(report)] });
            // A detector added is structural work; store it now rather than waiting for
            // the typing to stop.
            autosave.saveNow();
          }}
        >
          הוספת גלאי
        </button>
        {report.detectors.length > 1 && (
          <button type="button" className="btn btn-sm" onClick={fillFromFirstRow}>
            העתקת קומה ותאריכים מהשורה הראשונה לשורות הריקות
          </button>
        )}
      </div>
        <div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>מס׳</th>
                  <th>מס׳ גלאי</th>
                  <th>שם החדר</th>
                  <th>קומה</th>
                  <th>סוג</th>
                  <th>קצב אוורור</th>
                  <th>הנחה</th>
                  <th>איסוף</th>
                  <th>ריכוז [Bq/m³]</th>
                  <th>אי ודאות [%]</th>
                  <th>סף ייחוס</th>
                  <th>סיכום המלצה</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {report.detectors.map((row, i) => {
                  const combined = combinedValue(row.concentration, row.uncertainty);
                  const limit = toNumber(row.threshold);
                  const verdict = radonVerdict(row);
                  const over = verdict === RADON_VERDICTS.exceeds;
                  return (
                    <tr key={i}>
                      <td className="ltr">{i + 1}</td>
                      <td>
                        {/* The lookup runs on blur rather than per keystroke:
                            a partial number matches nothing, and firing on every
                            digit would be a request per digit. */}
                        <input
                          className="ltr"
                          value={row.detectorNumber}
                          placeholder="מס׳ גלאי"
                          onChange={(e) => setRow(i, { detectorNumber: e.target.value })}
                          onBlur={(e) => void lookUpDetector(i, e.target.value)}
                        />
                        {lookups[i] === 'busy' && <span className="hint">מחפש…</span>}
                        {lookups[i] === 'found' && <span className="badge ok">נמצא במעבדה</span>}
                        {lookups[i] === 'wide' && (
                          <span className="badge">אי ודאות רחבה מדי — הזינו ידנית</span>
                        )}
                        {lookups[i] === 'none' && row.detectorNumber.trim() !== '' && (
                          <span className="hint">לא נמצא — העלו צילום מעבדה</span>
                        )}
                      </td>
                      <td>
                        <input value={row.roomName} placeholder="חובה" onChange={(e) => setRow(i, { roomName: e.target.value })} />
                      </td>
                      <td>
                        <input className="ltr" value={row.floor} onChange={(e) => setRow(i, { floor: e.target.value })} />
                      </td>
                      <td>
                        <select value={row.testLength} onChange={(e) => setRow(i, { testLength: e.target.value })}>
                          {TEST_LENGTHS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input value={row.ventilation} onChange={(e) => setRow(i, { ventilation: e.target.value })} />
                      </td>
                      <td>
                        <input className="ltr" value={row.placedAt} placeholder="06/05/26" onChange={(e) => setRow(i, { placedAt: e.target.value })} />
                      </td>
                      <td>
                        <input className="ltr" value={row.collectedAt} placeholder="16/08/26" onChange={(e) => setRow(i, { collectedAt: e.target.value })} />
                      </td>
                      <td>
                        <input className="ltr" inputMode="decimal" value={row.concentration} placeholder="חובה" onChange={(e) => setRow(i, { concentration: e.target.value })} />
                      </td>
                      <td>
                        <input className="ltr" inputMode="decimal" value={row.uncertainty} onChange={(e) => setRow(i, { uncertainty: e.target.value })} />
                      </td>
                      <td>
                        <input className="ltr" value={row.threshold} onChange={(e) => setRow(i, { threshold: e.target.value })} />
                      </td>
                      <td>
                        {/* The verdict is computed and shown, not typed — but a
                            surveyor who overrides it keeps their wording, and
                            that is what the document prints. */}
                        <select
                          value={verdict}
                          className={row.recommendation ? undefined : 'verdict-suggested'}
                          onChange={(e) => setRow(i, { recommendation: e.target.value })}
                        >
                          {verdict === '' && <option value="">—</option>}
                          {Object.values(RADON_VERDICTS).map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                        {combined !== null && limit !== null && (
                          <span className={over ? 'badge' : 'badge ok'}>
                            {combined.toFixed(0)} / {limit}
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          title="מחיקת שורה"
                          onClick={() => {
                            update({ detectors: report.detectors.filter((_, n) => n !== i) });
                            autosave.saveNow();
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">
            ההשוואה לרמת הפעולה נעשית על הריכוז בתוספת אי הוודאות שלו — התג שליד ההמלצה מראה את
            הערך המחושב מול הסף.
          </p>
        </div>
        </div>
        ),
      },
      {
        title: 'סיום',
        hint: 'שמירה והפקת קובץ Word',
        content: <RadonSummary report={report} />,
      },
        ]}
      />
    </>
  );
}

/**
 * What the radon report will say, before it is produced.
 *
 * The same purpose as the radiation summary: the last step is the only one that sees the
 * whole survey, and producing a file to find out what is missing is a slow way to check.
 */
function RadonSummary({ report }: { report: RadonReport }) {
  const withReadings = report.detectors.filter((d) => d.concentration.trim() !== '').length;
  const rows: Array<[string, string]> = [
    ['לקוח', report.recipientName.trim() || report.companyName.trim() || '—'],
    ['כתובת', joinAddress(report.addressLine, report.city) || '—'],
    ['סוג האתר', report.siteKind],
    ['רמת הפעולה', `${actionLevel(report.siteKind)} בקרל/מ״ק`],
    ['גלאים', report.detectors.length === 0 ? '—' : String(report.detectors.length)],
    ['קריאות שהוזנו', withReadings === 0 ? '—' : `${withReadings} מתוך ${report.detectors.length}`],
  ];

  const missing = [
    report.recipientName.trim() === '' && report.companyName.trim() === '' ? 'לקוח' : null,
    report.detectors.length === 0 ? 'גלאים' : null,
    withReadings === 0 && report.detectors.length > 0 ? 'קריאות מהמעבדה' : null,
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
