'use client';

import { useCallback, useState, useTransition } from 'react';
import { BarcodeScanner, beep } from '../../../barcode-scanner';
import { ProtocolBlock } from '../../../reports/[id]/protocols';
import { SaveIndicator } from '../../../save-indicator';
import { useAutosave } from '../../../use-autosave';
import { Wizard } from '../../../wizard';
import { persistInstallation, scanInstallationDetector } from '../../actions';
import { RadonCustomerFields } from '../../customer-fields';
import {
  FLOOR_MAX,
  FLOOR_MIN,
  HALL_POSITIONS,
  ROOM_DESCRIPTIONS,
  LONG_TEST_DAYS,
  SHORT_TEST_HOURS,
  floorTitle,
  installationEnd,
  installationSpots,
  israelNow,
  type InstalledHall,
  type InstalledRoom,
  type InstalledSpace,
  type Installation,
} from '@/lib/radon-installation';
import { detectorKey } from '@/lib/radon-rules';
import { radonCustomerMissing } from '@/lib/report-complete';

/** Where a scan lands: a room, or one row of a hall. */
type Target = { space: number; row?: number };

const OTHER = '__other__';

const BIG_BUTTON = { padding: '20px 12px', fontSize: 18, fontWeight: 700, justifyContent: 'center', textAlign: 'center' } as const;

/**
 * The detector installation, written while walking the site.
 *
 * Two steps: whose site it is, then one folding block per room or hall. Each place has
 * its own scan button, so a number can only land on the place it was scanned for.
 */
export function InstallationEditor({ id, initial }: { id: string; initial: Installation }) {
  const [installation, setInstallation] = useState(initial);
  const [open, setOpen] = useState<number | null>(initial.spaces.length > 0 ? 0 : null);
  const [target, setTarget] = useState<Target | null>(null);
  const [scanError, setScanError] = useState('');
  const [finishing, startFinish] = useTransition();
  const [finishError, setFinishError] = useState('');

  const update = (patch: Partial<Installation>) => setInstallation((current) => ({ ...current, ...patch }));

  const autosave = useAutosave(
    installation,
    useCallback((current: Installation) => persistInstallation(id, current), [id]),
  );

  const setSpace = (index: number, patch: Partial<InstalledRoom> | Partial<InstalledHall>) =>
    setInstallation((current) => ({
      ...current,
      spaces: current.spaces.map((space, i) => (i === index ? ({ ...space, ...patch } as InstalledSpace) : space)),
    }));

  /** The new place starts on the last one's floor: a building is walked a floor at a time. */
  const addSpace = (make: (floor: number) => InstalledSpace) => {
    const previous = installation.spaces[installation.spaces.length - 1];
    update({ spaces: [...installation.spaces, make(previous?.floor ?? 0)] });
    setOpen(installation.spaces.length);
    autosave.saveNow();
  };

  const removeSpace = (index: number) => {
    update({ spaces: installation.spaces.filter((_, i) => i !== index) });
    setOpen(null);
    autosave.saveNow();
  };

  const moveSpace = (from: number, to: number) => {
    const spaces = [...installation.spaces];
    const [space] = spaces.splice(from, 1);
    spaces.splice(to, 0, space);
    update({ spaces });
    setOpen(to);
    autosave.saveNow();
  };

  const setRow = (space: InstalledHall, index: number, rowIndex: number, patch: Partial<InstalledHall['rows'][number]>) =>
    setSpace(index, { rows: space.rows.map((row, i) => (i === rowIndex ? { ...row, ...patch } : row)) });

  const place = (at: Target, detectorNumber: string) =>
    setInstallation((current) => ({
      ...current,
      spaces: current.spaces.map((space, i) => {
        if (i !== at.space) return space;
        if (space.kind === 'room') return { ...space, detectorNumber };
        return {
          ...space,
          rows: space.rows.map((row, r) => (r === at.row ? { ...row, detectorNumber } : row)),
        };
      }),
    }));

  /** The place in this installation already holding a number, other than the one being scanned for. */
  const heldBy = (key: string, at: Target): string | null => {
    for (const [i, space] of installation.spaces.entries()) {
      if (space.kind === 'room') {
        if (space.detectorNumber === key && i !== at.space) return space.description || `מקום ${i + 1}`;
        continue;
      }
      for (const [r, row] of space.rows.entries()) {
        if (row.detectorNumber === key && !(i === at.space && r === at.row)) {
          return `${space.name || 'אולם'} — ${row.position || `שורה ${r + 1}`}`;
        }
      }
    }
    return null;
  };

  const scan = async (code: string) => {
    if (!target) return;
    const at = target;
    const holder = heldBy(detectorKey(code), at);
    if (holder) {
      beep(false);
      setScanError(`גלאי ${detectorKey(code)} כבר נסרק ב${holder}.`);
      return;
    }
    try {
      const result = await scanInstallationDetector(id, installation.customerId, code);
      if (!result.ok) {
        beep(false);
        setScanError(result.message);
        return;
      }
      beep(true);
      place(at, result.detectorNumber);
      setScanError('');
      setTarget(null);
      autosave.saveNow();
    } catch {
      beep(false);
      setScanError('הסריקה לא נשמרה — אין חיבור. נסו שוב.');
    }
  };

  const openScanner = (at: Target) => {
    setScanError('');
    setTarget(at);
  };

  const short = installation.testLength === 'קצרה';
  const spots = installationSpots(installation);
  const missingDetector = spots.filter((spot) => spot.detectorNumber === '').length;

  const finish = () =>
    startFinish(async () => {
      const result = await persistInstallation(id, installation);
      if (!result.ok) {
        setFinishError(result.message);
        return;
      }
      window.location.href = '/radon/installations';
    });

  const customerGaps = installation.customerId
    ? radonCustomerMissing(installation)
    : ['בחירת לקוח מהספרייה', radonCustomerMissing(installation)].filter(Boolean).join(' · ');

  return (
    <>
      <Wizard
        finish={
          <button type="button" className="btn-primary wizard-next" onClick={finish} disabled={finishing}>
            {finishing ? 'שומר…' : 'סיום'}
          </button>
        }
        onStepChange={autosave.saveNow}
        status={<SaveIndicator state={autosave.state} />}
        steps={[
          {
            title: 'לקוח',
            hint: 'אצל מי מותקנים הגלאים',
            blocker: customerGaps ? `חסר כדי להמשיך: ${customerGaps}` : undefined,
            content: <RadonCustomerFields customer={installation} update={update} />,
          },
          {
            title: 'חדרים ואולמות',
            hint: 'לכל חדר או שורה באולם יש כפתור סריקה משלו',
            content: (
              <div>
                <div className="grid">
                  <div className="field wide">
                    <label>סוג הגלאי</label>
                    <div className="toggle">
                      {(
                        [
                          ['ארוכה', `ארוך טווח — ${LONG_TEST_DAYS} ימים`],
                          ['קצרה', `קצר טווח — ${SHORT_TEST_HOURS} שעות`],
                        ] as const
                      ).map(([value, text]) => (
                        <button
                          key={value}
                          type="button"
                          className={installation.testLength === value ? 'active' : undefined}
                          onClick={() => {
                            if (installation.testLength === value) return;
                            // Starts from now: the hour is what a short test is counted from.
                            const now = israelNow();
                            update({ testLength: value, installedOn: value === 'קצרה' ? now : now.slice(0, 10) });
                            autosave.saveNow();
                          }}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <label>{short ? 'התחלה — תאריך ושעה' : 'תאריך התחלה'}</label>
                    <input
                      type={short ? 'datetime-local' : 'date'}
                      className="ltr"
                      value={installation.installedOn}
                      onChange={(e) => update({ installedOn: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>{short ? 'סיום — תאריך ושעה' : 'תאריך סיום'}</label>
                    {/* Follows from the start; a detector collected on another day is
                        corrected in the report, which is what prints it. */}
                    <input
                      type={short ? 'datetime-local' : 'date'}
                      className="ltr"
                      value={installationEnd(installation.testLength, installation.installedOn)}
                      readOnly
                      disabled
                    />
                  </div>
                </div>

                {finishError && <div className="notice error">{finishError}</div>}
                {spots.length > 0 && missingDetector > 0 && (
                  <div className="notice warn" style={{ marginTop: 12 }}>
                    {missingDetector === 1 ? 'מקום אחד עדיין ללא גלאי.' : `${missingDetector} מקומות עדיין ללא גלאי.`}
                  </div>
                )}

                <div style={{ marginTop: 16 }}>
                  {installation.spaces.map((space, index) => {
                    const ordinal = installation.spaces.slice(0, index + 1).filter((s) => s.kind === space.kind).length;
                    const blockProps = {
                      kind: space.kind === 'room' ? 'חדר' : 'אולם',
                      badge: `${space.kind === 'room' ? 'חדר' : 'אולם'} ${ordinal}`,
                      index,
                      total: installation.spaces.length,
                      open: open === index,
                      onToggle: () => setOpen(open === index ? null : index),
                      onMove: (to: number) => moveSpace(index, to),
                      onRemove: () => removeSpace(index),
                    };

                    if (space.kind === 'room') {
                      return (
                        <ProtocolBlock
                          key={index}
                          {...blockProps}
                          title={space.description || 'ללא תיאור'}
                          rowCount={1}
                          summary={`${floorTitle(space.floor)} · ${space.detectorNumber || 'ללא גלאי'}`}
                          removePrompt="למחוק את החדר?"
                        >
                          <div className="grid">
                            <Choice
                              label="תיאור החדר"
                              options={ROOM_DESCRIPTIONS}
                              value={space.description}
                              onChange={(description) => setSpace(index, { description })}
                            />
                            <FloorScale value={space.floor} onChange={(floor) => setSpace(index, { floor })} />
                            <div className="field wide">
                              <label>גלאי</label>
                              <ScanControl
                                number={space.detectorNumber}
                                onScan={() => openScanner({ space: index })}
                                onClear={() => place({ space: index }, '')}
                              />
                            </div>
                          </div>
                        </ProtocolBlock>
                      );
                    }

                    const hallScanned = space.rows.filter((row) => row.detectorNumber !== '').length;
                    return (
                      <ProtocolBlock
                        key={index}
                        {...blockProps}
                        title={space.name || 'ללא שם'}
                        rowCount={space.rows.length}
                        summary={`${floorTitle(space.floor)} · ${hallScanned} מתוך ${space.rows.length} גלאים`}
                        removePrompt={`למחוק את האולם על כל ${space.rows.length} השורות שבו?`}
                      >
                        <div className="grid">
                          <div className="field">
                            <label>שם האולם</label>
                            <input
                              value={space.name}
                              placeholder="למשל: אולם ספורט"
                              onChange={(e) => setSpace(index, { name: e.target.value })}
                            />
                          </div>
                          <FloorScale value={space.floor} onChange={(floor) => setSpace(index, { floor })} />
                        </div>

                        <div className="table-scroll" style={{ marginTop: 12 }}>
                          <table>
                            <thead>
                              <tr>
                                <th>מיקום באולם</th>
                                <th>גלאי</th>
                                <th />
                              </tr>
                            </thead>
                            <tbody>
                              {space.rows.map((row, r) => (
                                <tr key={r}>
                                  <td>
                                    <Choice
                                      options={HALL_POSITIONS}
                                      value={row.position}
                                      onChange={(position) => setRow(space, index, r, { position })}
                                    />
                                  </td>
                                  <td>
                                    <ScanControl
                                      number={row.detectorNumber}
                                      onScan={() => openScanner({ space: index, row: r })}
                                      onClear={() => place({ space: index, row: r }, '')}
                                    />
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="btn-danger btn-sm"
                                      title="מחיקת שורה"
                                      onClick={() => {
                                        setSpace(index, { rows: space.rows.filter((_, n) => n !== r) });
                                        autosave.saveNow();
                                      }}
                                    >
                                      ✕
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <button
                          type="button"
                          className="btn-sm"
                          style={{ marginTop: 10 }}
                          onClick={() => {
                            setSpace(index, { rows: [...space.rows, { position: '', detectorNumber: '' }] });
                            autosave.saveNow();
                          }}
                        >
                          הוספת שורה
                        </button>
                      </ProtocolBlock>
                    );
                  })}
                </div>

                {/* Under the last block rather than above the list: that is where the thumb is
                    when a place has just been scanned and the next one is wanted. */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn-primary"
                    style={BIG_BUTTON}
                    onClick={() =>
                      addSpace((floor) => ({ kind: 'room', description: '', floor, detectorNumber: '' }))
                    }
                  >
                    הוספת חדר
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    style={BIG_BUTTON}
                    onClick={() =>
                      addSpace((floor) => ({
                        kind: 'hall',
                        name: '',
                        floor,
                        rows: [{ position: '', detectorNumber: '' }],
                      }))
                    }
                  >
                    הוספת אולם
                  </button>
                </div>
              </div>
            ),
          },
        ]}
      />

      {target && (
        <BarcodeScanner
          error={scanError}
          onCode={(code) => void scan(code)}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}

function ScanControl({
  number,
  onScan,
  onClear,
}: {
  number: string;
  onScan: () => void;
  onClear: () => void;
}) {
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {number && <strong className="ltr">{number}</strong>}
      <button type="button" className={number ? 'btn-sm' : 'btn-primary btn-sm'} onClick={onScan}>
        {number ? 'סריקה מחדש' : 'סריקת ברקוד'}
      </button>
      {number && (
        <button type="button" className="btn-danger btn-sm" title="הסרת הגלאי" onClick={onClear}>
          ✕
        </button>
      )}
    </span>
  );
}

/** The floors as a scale, with steps for a phone, where a slider is hard to land exactly. */
function FloorScale({ value, onChange }: { value: number; onChange: (floor: number) => void }) {
  return (
    <div className="field">
      <label>קומה: {floorTitle(value)}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', direction: 'ltr' }}>
        <button type="button" className="btn-sm" disabled={value <= FLOOR_MIN} aria-label="קומה למטה" onClick={() => onChange(value - 1)}>
          −
        </button>
        <input
          type="range"
          min={FLOOR_MIN}
          max={FLOOR_MAX}
          value={value}
          aria-label="קומה"
          style={{ flex: 1 }}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <button type="button" className="btn-sm" disabled={value >= FLOOR_MAX} aria-label="קומה למעלה" onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

/** A list of the usual answers, with "אחר" for the one that is not on it. */
function Choice({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const free = custom || (value !== '' && !options.includes(value));

  return (
    <div className="field">
      {label && <label>{label}</label>}
      {free ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={value} placeholder="הקלידו תיאור" autoFocus={custom} onChange={(e) => onChange(e.target.value)} />
          <button
            type="button"
            className="btn-sm"
            onClick={() => {
              setCustom(false);
              onChange('');
            }}
          >
            רשימה
          </button>
        </div>
      ) : (
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === OTHER) setCustom(true);
            else onChange(e.target.value);
          }}
        >
          <option value="">בחרו…</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
          <option value={OTHER}>אחר…</option>
        </select>
      )}
    </div>
  );
}
