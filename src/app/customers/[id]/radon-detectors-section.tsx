'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarcodeScanner, beep } from '../../barcode-scanner';
import { useCameraSupported } from '../../camera-capture';
import { LabScanPanel } from '../../radon/[id]/lab-scan';
import {
  addCustomerDetectors,
  confirmDetectorReadings,
  draftCustomerRadonReport,
  removeCustomerDetectors,
} from '../../radon/actions';
import type { AssignOutcome } from '@/lib/radon-detectors';
import {
  DEFAULT_SERIES_LENGTH,
  MAX_SERIES_LENGTH,
  detectorKey,
  detectorSeries,
  implausibleUncertainty,
  isDetectorKey,
} from '@/lib/radon-rules';

export interface DetectorView {
  detectorNumber: string;
  reportId: string;
  /** Where an installation placed it; empty for one scanned straight onto the customer. */
  roomName: string;
  installationId: string;
  concentration: string;
  uncertainty: string;
}

type Mode = 'single' | 'series';
type Message = { tone: 'ok' | 'warn' | 'error'; text: string; undo?: string[] };

/** The slider's reach. The box beside it goes further, for the rare larger batch. */
const SLIDER_MAX = 100;

/** How long the scanning must pause before the card re-reads results from the server. */
const REFRESH_AFTER_MS = 1500;

function describe(outcome: AssignOutcome): Message {
  const parts: string[] = [];
  if (outcome.added.length === 1) parts.push(`נוסף גלאי ${outcome.added[0]}`);
  if (outcome.added.length > 1) parts.push(`נוספו ${outcome.added.length} גלאים`);
  if (outcome.alreadyHere.length === 1) parts.push(`גלאי ${outcome.alreadyHere[0]} כבר ברשימה`);
  if (outcome.alreadyHere.length > 1) parts.push(`${outcome.alreadyHere.length} גלאים כבר ברשימה`);
  if (outcome.elsewhere.length > 0) {
    parts.push(
      `לא נוספו כי הם משויכים ללקוח אחר: ${outcome.elsewhere
        .map((d) => `${d.detectorNumber} (${d.customerName})`)
        .join(', ')}`,
    );
  }
  if (outcome.invalid.length > 0) parts.push(`לא מספר גלאי: ${outcome.invalid.join(', ')}`);

  return {
    tone: outcome.elsewhere.length + outcome.invalid.length > 0 ? 'error' : outcome.added.length > 0 ? 'ok' : 'warn',
    text: parts.join(' · '),
    undo: outcome.added.length > 1 ? outcome.added : undefined,
  };
}

/**
 * The customer's radon detectors: scanning them in, and turning them into a report.
 *
 * The box stays focused because a hardware scanner is a keyboard: it types the number
 * and presses Enter, so the next detector can be scanned with no click in between.
 */
export function RadonDetectorsSection({
  customerId,
  initial,
  reports,
  readingsAvailable,
}: {
  customerId: string;
  initial: DetectorView[];
  reports: Array<{ id: string; reference: string }>;
  readingsAvailable: boolean;
}) {
  const router = useRouter();
  const cameraSupported = useCameraSupported();
  const [detectors, setDetectors] = useState(initial);
  const [mode, setMode] = useState<Mode>('single');
  const [scan, setScan] = useState('');
  const [seriesStart, setSeriesStart] = useState('');
  const [count, setCount] = useState(DEFAULT_SERIES_LENGTH);
  const [message, setMessage] = useState<Message | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const countRef = useRef<HTMLInputElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => setDetectors(initial), [initial]);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const add = async (numbers: string[]) => {
    try {
      const outcome = await addCustomerDetectors(customerId, numbers);
      setDetectors((current) => {
        const added = outcome.added
          .filter((n) => !current.some((d) => d.detectorNumber === n))
          .map((detectorNumber) => ({ detectorNumber, reportId: '', roomName: '', installationId: '', concentration: '', uncertainty: '' }));
        return [...current, ...added].sort((a, b) => Number(a.detectorNumber) - Number(b.detectorNumber));
      });
      const next = describe(outcome);
      setMessage(next);
      beep(next.tone === 'ok');
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), REFRESH_AFTER_MS);
    } catch (err) {
      beep(false);
      setMessage({
        tone: 'error',
        text: `לא נשמר: ${numbers.join(', ')}. ${err instanceof Error ? err.message : 'נסו שוב.'}`,
      });
    }
  };

  /** One scan, from the box or the camera. In a series it only sets where the series starts. */
  const accept = (raw: string) => {
    const key = detectorKey(raw);
    setScan('');
    if (!isDetectorKey(key)) {
      beep(false);
      setMessage({ tone: 'error', text: `"${raw}" אינו מספר גלאי.` });
      return;
    }
    if (mode === 'series') {
      setSeriesStart(key);
      setMessage(null);
      setCameraOpen(false);
      // The scanner's own Enter lands here, so it cannot add a series nobody has confirmed.
      setTimeout(() => countRef.current?.select(), 0);
      return;
    }
    void add([key]);
  };

  const series = detectorSeries(seriesStart, count);

  const addSeries = async () => {
    if (series.length === 0) return;
    await add(series);
    setSeriesStart('');
    scanRef.current?.focus();
  };

  const remove = async (numbers: string[]) => {
    setDetectors((current) => current.filter((d) => !numbers.includes(d.detectorNumber)));
    setMessage(null);
    await removeCustomerDetectors(customerId, numbers);
  };

  const draft = async () => {
    setDrafting(true);
    const result = await draftCustomerRadonReport(customerId);
    if (result.ok && result.reportId) {
      router.push(`/radon/${result.reportId}`);
      return;
    }
    setDrafting(false);
    setMessage({ tone: 'error', text: result.error ?? 'הפקת הדוח נכשלה' });
  };

  const withResult = detectors.filter((d) => d.concentration.trim() !== '').length;
  const tooWide = detectors.filter((d) => implausibleUncertainty(d.uncertainty)).length;
  const unreported = detectors.filter((d) => d.reportId === '');
  const unreportedWithResult = unreported.filter(
    (d) => d.concentration.trim() !== '' && !implausibleUncertainty(d.uncertainty),
  ).length;
  const referenceOf = (id: string) => reports.find((r) => r.id === id)?.reference || 'דוח';

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>גלאי ראדון</h2>
          <span className="hint">
            {detectors.length === 0
              ? 'אין עדיין גלאים'
              : `${detectors.length} גלאים · ${withResult} עם תוצאה${tooWide ? ` · ${tooWide} דורשים החלטה` : ''}`}
          </span>
        </div>

        <div className="card-body">
          <div className="grid">
            <div className="field wide">
              <label>אופן ההוספה</label>
              <div className="toggle">
                {(
                  [
                    ['single', 'סריקה של כל גלאי'],
                    ['series', 'סדרה רצופה'],
                  ] as const
                ).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    className={mode === value ? 'active' : undefined}
                    onClick={() => {
                      setMode(value);
                      setSeriesStart('');
                      scanRef.current?.focus();
                    }}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>

            <div className="field wide">
              <label>{mode === 'series' ? 'הגלאי הראשון בסדרה' : 'ברקוד'}</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  ref={scanRef}
                  className="ltr"
                  autoFocus
                  autoComplete="off"
                  inputMode="numeric"
                  value={scan}
                  placeholder="סרקו או הקלידו מספר גלאי"
                  onChange={(e) => setScan(e.target.value)}
                  onKeyDown={(e) => {
                    // Scanners end a code with Enter or with Tab, depending on their setup.
                    if ((e.key === 'Enter' || e.key === 'Tab') && scan.trim() !== '') {
                      e.preventDefault();
                      accept(scan);
                    }
                  }}
                />
                <button type="button" className="btn" disabled={scan.trim() === ''} onClick={() => accept(scan)}>
                  הוספה
                </button>
                {cameraSupported && (
                  <button type="button" className="btn" onClick={() => setCameraOpen(true)}>
                    📷 מצלמה
                  </button>
                )}
              </div>
            </div>

            {mode === 'series' && (
              <div className="field wide">
                <label>כמה גלאים בסך הכול, כולל הראשון</label>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', direction: 'ltr' }}>
                  <input
                    type="range"
                    min={1}
                    max={SLIDER_MAX}
                    value={Math.min(count, SLIDER_MAX)}
                    aria-label="כמות גלאים"
                    style={{ flex: 1 }}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                  <input
                    ref={countRef}
                    type="number"
                    className="ltr"
                    min={1}
                    max={MAX_SERIES_LENGTH}
                    value={count}
                    aria-label="כמות גלאים"
                    style={{ width: 80 }}
                    onChange={(e) => setCount(Number(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void addSeries();
                      }
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={series.length === 0}
                    onClick={() => void addSeries()}
                  >
                    הוספת {series.length || count} גלאים
                  </button>
                  <span className="hint" dir="ltr">
                    {series.length > 0
                      ? `${series[0]} – ${series[series.length - 1]}`
                      : 'סרקו את הגלאי הראשון בסדרה'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {message && (
            <div className={`notice ${message.tone}`} style={{ marginTop: 12 }}>
              {message.text}
              {message.undo && (
                <>
                  {' '}
                  <button type="button" className="btn-sm" onClick={() => void remove(message.undo!)}>
                    ביטול ההוספה
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {detectors.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>מס׳ גלאי</th>
                  <th>חדר</th>
                  <th>ריכוז [Bq/m³]</th>
                  <th>אי ודאות [%]</th>
                  <th>מצב</th>
                  <th>דוח</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {detectors.map((detector) => {
                  const hasResult = detector.concentration.trim() !== '';
                  const wide = implausibleUncertainty(detector.uncertainty);
                  return (
                    <tr key={detector.detectorNumber}>
                      <td className="ltr">{detector.detectorNumber}</td>
                      <td>{detector.roomName || '—'}</td>
                      <td className="ltr">{detector.concentration || '—'}</td>
                      <td className="ltr">{detector.uncertainty || '—'}</td>
                      <td>
                        {wide ? (
                          <span className="badge">אי ודאות רחבה מדי — דורש החלטה</span>
                        ) : hasResult ? (
                          <span className="badge ok">התקבלה תוצאה</span>
                        ) : (
                          <span className="hint">ממתין לתוצאה</span>
                        )}
                      </td>
                      <td>
                        {detector.reportId ? (
                          <Link href={`/radon/${detector.reportId}`} prefetch={false}>
                            {referenceOf(detector.reportId)}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {!detector.reportId && !detector.installationId && (
                          <button
                            type="button"
                            className="btn-danger btn-sm"
                            title="הסרת הגלאי מהלקוח"
                            onClick={() => void remove([detector.detectorNumber])}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detectors.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>הפקת דוח מהתוצאות</h2>
          </div>
          <div className="card-body">
            {!readingsAvailable && (
              <div className="notice warn">
                לא ניתן לקרוא כרגע את תוצאות המעבדה. אפשר להפיק דוח ולהזין בו את התוצאות ידנית.
              </div>
            )}
            <p className="hint">
              הדוח נפתח כטיוטה עם פרטי הלקוח, מספרי הגלאים והתוצאות שכבר התקבלו. נשאר להשלים חדרים ותאריכים,
              לבדוק את התוצאות וללחוץ ״סיום״, שמתייק את הדוח בכרטיס הלקוח ב-CRM.
            </p>
            <button
              type="button"
              className="btn-primary"
              disabled={unreported.length === 0 || drafting}
              onClick={() => void draft()}
            >
              {drafting
                ? 'מכין דוח…'
                : unreported.length === 0
                  ? 'כל הגלאים כבר בדוח'
                  : `הפקת דוח מ-${unreported.length} גלאים (${unreportedWithResult} עם תוצאה)`}
            </button>
          </div>
        </section>
      )}

      {detectors.length > 0 && (
        <LabScanPanel
          reportId=""
          detectorNumbers={detectors.map((d) => d.detectorNumber)}
          onApply={(rows) => {
            void confirmDetectorReadings(customerId, rows).then((result) => {
              setMessage(
                result.ok
                  ? { tone: 'ok', text: `נשמרו ${rows.length} תוצאות.` }
                  : { tone: 'error', text: `התוצאות לא נשמרו: ${result.error}` },
              );
            });
          }}
        />
      )}

      {cameraOpen && (
        <BarcodeScanner
          hint={mode === 'series' ? 'סרקו את הגלאי הראשון בסדרה.' : 'כל ברקוד שנקרא נוסף מיד. סיימתם? לחצו ״סיום״.'}
          onCode={accept}
          onClose={() => {
            setCameraOpen(false);
            scanRef.current?.focus();
          }}
        />
      )}
    </>
  );
}
