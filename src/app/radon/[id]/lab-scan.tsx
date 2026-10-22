'use client';

import { useRef, useState } from 'react';
import { CollapsibleCard } from '../../collapsible-card';

/**
 * Reading the laboratory's results off a photograph of its screen.
 *
 * The whole point of this panel is that nothing it produces is applied without
 * being looked at. A model reading digits off a phone photo of a CRT gets one
 * wrong now and then — in testing it read detector 19640 as 19643 — and a wrong
 * concentration in a radon report is invisible in the finished document and
 * changes what the client is told to do. So the readings are listed beside the
 * photograph, and applying them is a separate, deliberate click.
 *
 * The safety net underneath that is the matching rule: readings are attached to
 * detector numbers the surveyor typed themselves. A misread number matches
 * nothing and shows up as unmatched, rather than quietly overwriting the wrong
 * room.
 */

export interface LabRow {
  detectorNumber: string;
  concentration: string;
  uncertainty: string;
  status: string;
  unreadable: boolean;
}

/**
 * The widest uncertainty that can be used as printed, as a percentage.
 *
 * Mirrors `MAX_PLAUSIBLE_UNCERTAINTY` on the server. The laboratory prints
 * wider figures when a detector caught almost no tracks — ±46, ±62 — and a
 * verdict computed from one of those is a verdict computed from noise. The
 * surveyor is asked what the figure should be instead.
 */
const MAX_UNCERTAINTY = 22;

const asNumber = (value: string) => {
  const cleaned = String(value ?? '').trim().replace(/[^\d.,-]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const implausible = (value: string) => {
  const n = asNumber(value);
  return n !== null && n > MAX_UNCERTAINTY;
};

/** A replacement is usable once it is a number within range. */
const isPlausibleInput = (value: string | undefined) => {
  const n = asNumber(value ?? '');
  return n !== null && n >= 0 && n <= MAX_UNCERTAINTY;
};

/** How many overlapping bands the photograph is cut into before upload. */
const BANDS = 5;

/** Pixels of overlap, so a row sitting on a cut is whole in one of the bands. */
const OVERLAP = 70;

/** OpenAI renders anything wider down to this, so there is no point sending more. */
const MAX_BAND_WIDTH = 2048;

/**
 * Cuts an image into overlapping horizontal bands.
 *
 * A band is wide and short, which is the only reason this works: the API scales
 * an image to fit its own budget, and a short image keeps its width where a
 * tall one loses it. The whole screen arrives at about 1024 across, a band at
 * 2048 — and at 1024 the digits are gone.
 */
async function cutIntoBands(file: File): Promise<Blob[]> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(MAX_BAND_WIDTH / bitmap.width, 2);
  const bandHeight = Math.ceil(bitmap.height / BANDS);
  const bands: Blob[] = [];

  for (let i = 0; i < BANDS; i++) {
    const top = Math.max(0, i * bandHeight - OVERLAP);
    const height = Math.min(bitmap.height - top, bandHeight + 2 * OVERLAP);
    if (height <= 0) continue;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) break;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, top, bitmap.width, height, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) bands.push(blob);
  }

  bitmap.close();
  return bands;
}

export function LabScanPanel({
  reportId,
  detectorNumbers,
  onApply,
}: {
  reportId: string;
  /** The numbers the surveyor has typed, so a reading can be matched to a row. */
  detectorNumbers: string[];
  onApply: (rows: LabRow[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<LabRow[]>([]);
  const [preview, setPreview] = useState('');
  /**
   * Replacements for uncertainties the laboratory printed too wide to use.
   *
   * Keyed by detector number. Empty means the surveyor has not decided yet, and
   * a row in that state cannot be applied — a verdict computed from ±46 is a
   * verdict computed from noise, and it would print as though it meant
   * something.
   */
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const wanted = new Set(detectorNumbers.map((n) => n.replace(/\D+/g, '').replace(/^0+(?=\d)/, '')).filter(Boolean));

  const scan = async (file: File) => {
    setBusy(true);
    setError('');
    setRows([]);
    setCorrections({});
    setStatus('חותך את התמונה…');
    setPreview(URL.createObjectURL(file));

    try {
      const bands = await cutIntoBands(file);
      if (bands.length === 0) throw new Error('לא ניתן היה לקרוא את התמונה');

      setStatus(`קורא ${bands.length} קטעים…`);
      const form = new FormData();
      form.append('reportId', reportId);
      bands.forEach((band, i) => form.append('image', band, `band-${i}.png`));

      const response = await fetch('/api/radon/lab-scan', { method: 'POST', body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? 'קריאת התמונה נכשלה');

      const found: LabRow[] = payload.rows ?? [];
      setRows(found);
      setStatus(
        `זוהו ${found.length} גלאים` +
          (payload.emptyBands ? ` · ${payload.emptyBands} מתוך ${payload.bands} קטעים לא נקראו` : '') +
          (payload.saved ? ` · ${payload.saved} נשמרו ב-Supabase` : '') +
          (payload.saveError ? ` · השמירה ב-Supabase נכשלה: ${payload.saveError}` : ''),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'קריאת התמונה נכשלה');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const matched = rows.filter((r) => wanted.has(r.detectorNumber));
  const unmatched = rows.filter((r) => !wanted.has(r.detectorNumber));

  /** The uncertainty that will actually be used: the surveyor's, or the printed one. */
  const effective = (row: LabRow) => corrections[row.detectorNumber] ?? row.uncertainty;

  const needsDecision = (row: LabRow) =>
    implausible(row.uncertainty) && !isPlausibleInput(corrections[row.detectorNumber]);

  /** Rows in the table that are still waiting on a decision block the apply. */
  const blocked = matched.filter(needsDecision);
  const ready = matched.filter((r) => !needsDecision(r));

  return (
    <CollapsibleCard
      title="קריאת תוצאות מהמעבדה"
      hint="צילום מסך של תוכנת המעבדה"
      action={
        <button
          type="button"
          className="btn-primary btn-sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'קורא…' : 'העלאת תמונה'}
        </button>
      }
    >
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void scan(file);
            e.target.value = '';
          }}
        />

        <p className="hint">
          העלו צילום של חלון התוצאות. המערכת קוראת מכל שורה את מספר הגלאי מעמודת Device, ואת הריכוז
          ואי הוודאות מעמודת KBq_m3_h. התוצאות מוצגות לבדיקה ומוחלות רק בלחיצה.
        </p>

        {error && <div className="notice error">{error}</div>}
        {status && !error && <div className="notice">{status}</div>}

        {rows.length > 0 && (
          <>
            {preview && (
              // Kept on screen next to the numbers: checking a reading against
              // the photograph is the whole review, and it cannot be done from
              // memory.
              <div className="table-scroll" style={{ marginBottom: 12 }}>
                <img src={preview} alt="צילום תוצאות המעבדה" style={{ maxWidth: '100%', border: '1px solid var(--rule, #ddd)' }} />
              </div>
            )}

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>מס׳ גלאי</th>
                    <th>ריכוז</th>
                    <th>אי ודאות</th>
                    <th>סטטוס</th>
                    <th>התאמה</th>
                  </tr>
                </thead>
                <tbody>
                  {[...matched, ...unmatched].map((row) => {
                    const isMatched = wanted.has(row.detectorNumber);
                    const tooWide = implausible(row.uncertainty);
                    return (
                      <tr key={row.detectorNumber}>
                        <td className="ltr">{row.detectorNumber}</td>
                        <td className="ltr">{row.concentration}</td>
                        <td className="ltr">
                          {tooWide ? (
                            // The printed figure is kept visible beside the box:
                            // the surveyor is correcting a specific number, not
                            // filling in a blank.
                            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <s style={{ opacity: 0.6 }}>{row.uncertainty}</s>
                              <input
                                className="ltr"
                                style={{ width: 64 }}
                                placeholder="0–22"
                                value={corrections[row.detectorNumber] ?? ''}
                                onChange={(e) =>
                                  setCorrections((c) => ({ ...c, [row.detectorNumber]: e.target.value }))
                                }
                              />
                            </span>
                          ) : (
                            row.uncertainty
                          )}
                        </td>
                        <td className="ltr">{row.status}</td>
                        <td>
                          {tooWide && !isPlausibleInput(corrections[row.detectorNumber]) ? (
                            <span className="badge">אי ודאות {row.uncertainty}% — לא הגיוני, הזינו ערך</span>
                          ) : row.unreadable ? (
                            <span className="badge">לא נקרא בוודאות</span>
                          ) : isMatched ? (
                            <span className="badge ok">יוחל</span>
                          ) : (
                            <span className="badge">אין גלאי כזה בטבלה</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {blocked.length > 0 && (
              <div className="notice error" style={{ marginTop: 12 }}>
                <strong>
                  {blocked.length === 1 ? 'גלאי אחד' : `${blocked.length} גלאים`} עם אי ודאות מעל {MAX_UNCERTAINTY}%:
                </strong>{' '}
                {blocked.map((r) => `${r.detectorNumber} (${r.uncertainty}%)`).join(', ')}. אי ודאות רחבה כל כך
                אינה נותנת תוצאה בעלת משמעות, ולכן לא נכניס אותה לדוח כמות שהיא — הזינו בשדה שליד כל
                שורה את הערך שיש להשתמש בו.
              </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-primary"
                disabled={ready.length === 0}
                onClick={() =>
                  onApply(ready.map((r) => ({ ...r, uncertainty: String(effective(r)).trim() })))
                }
              >
                החלת {ready.length} תוצאות על הטבלה
              </button>
              <span className="hint">
                {unmatched.length > 0
                  ? `${unmatched.length} גלאים בתמונה אינם בטבלה — הזינו את מספרם בטבלה כדי לייבא אותם.`
                  : 'כל הגלאים שבתמונה קיימים בטבלה.'}
              </span>
            </div>
          </>
        )}
      </div>
    </CollapsibleCard>
  );
}
