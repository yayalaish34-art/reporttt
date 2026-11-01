'use client';

import { useEffect, useRef, useState } from 'react';
import type { ElfProtocol, ElfRow, Photo, Report, RfProtocol, RfRow } from '@/lib/report-schema';
import type { SurveyScope } from '@/lib/report-text';
import { CollapsibleCard } from '../../collapsible-card';
import { Modal } from '../../modal';
import { PhotoButton } from './photo-button';
import {
  ELF_COMPLIANCE_OPTIONS,
  composeProtocolTitle,
  BOARD_POINT_OPTIONS,
  isBoardSource,
  ELF_PROFILE_DISTANCES,
  HEIGHT_OPTIONS,
  measurementDistanceOptions,
  withSlowScan,
  ELF_REFERENCE_OPTIONS,
  RF_REFERENCE_OPTIONS,
  RF_DEFAULT_REFERENCE,
  SEATING_REFERENCE,
  RF_CABINET_POINT_OPTIONS,
  isCabinetReference,
  ELF_OCCUPANCY_OPTIONS,
  RF_OCCUPANCY_OPTIONS,
  elfCompliance,
  elfNormalized,
  newElfRow,
  formatPercent,
  newRfRow,
  newRfRows,
  describeMeasurementProfile,
  percentOfThreshold,
  rfCompliance,
} from '@/lib/measurement-rules';

/**
 * The measurement tables.
 *
 * A table is added by choosing its type. The two kinds are kept in separate
 * lists because the document puts them in separate sections — every ELF
 * protocol prints under the ELF survey heading and every RF one under its own —
 * so they cannot be interleaved however they are ordered here.
 */

const ELF_COLUMNS = [
  'תיאור נקודת המדידה',
  'מרחק [מ׳]',
  'גובה [מ׳]',
  'נמדד [mG]',
  'לאחר נרמול [mG]',
  'סוג האכלוס',
  'חורג / לא חורג',
];

/*
 * The distance sits beside the description, not at the end of the row.
 *
 * A point is a place and a distance from the source, and the two are read together —
 * "במדרכה סמוך לאנטנה, 100 מ'". With the distance last, checking a row meant
 * crossing four columns of numbers to find which reading belonged to which range, and
 * on a phone it was off the screen entirely.
 */
const RF_COLUMNS = [
  'תיאור נקודת המדידה',
  'מרחק [מ׳]',
  'אכלוס האזור',
  'נמדד [µW/cm²]',
  'סף ייחוס',
  'עמידה בדרישות',
  'גובה מהרצפה [מ׳]',
];

/** Numeric columns read left-to-right; "1.5-2" in an RTL field renders reversed. */
const ELF_LTR = [1, 2, 3, 4];
const RF_LTR = [1, 3, 4, 6];

const emptyElfRow = (): ElfRow => newElfRow();

// A row added by hand continues the series rather than starting blank.
const nextRfRow = (existing: RfRow[]): RfRow => newRfRow(existing.length === 0 ? '0.3' : '');

const newElfProtocol = (): ElfProtocol => ({
  // Blank: the field holds the radiating source, and the fixed opening of the
  // heading is added when the document is built.
  title: '',
  referenceLabel: '',
  normalizationFactor: '1',
  normalizationNote: 'מכיוון שהמדידות בוצעו בעומס אופייני נקבע נרמול לבדיקה על 1.',
  /*
   * A new table opens with the five profile distances already laid out.
   *
   * One table = one measurement point, measured across the whole 0.3–2 m profile.
   * The surveyor types the point's description (board face, or free text) into the
   * first row and the readings into each; the "הוספת נקודת מדידה" modal that used
   * to carry the description before the rows existed is gone — adding another point
   * is now a new table, which is how the two kinds of measurement are already added.
   */
  rows: ELF_PROFILE_DISTANCES.map((distance) => newElfRow(distance)),
});

/**
 * A new RF protocol.
 *
 * Opens with five rows, carrying the reference threshold and the standard height
 * already in place — the surveyor fills in only where they stood and what the
 * meter read. A point description is shared across the five readings.
 */
const newRfProtocol = (): RfProtocol => ({
  // Blank, same as ELF: the source is what varies, the opening is fixed.
  title: '',
  // RF is nearly always measured against a communications cabinet, so it is
  // filled in and editable. ELF has no equivalent default — its source varies.
  referenceLabel: RF_DEFAULT_REFERENCE,
  rows: newRfRows(RF_DEFAULT_REFERENCE),
});

export function Protocols({
  elfProtocols,
  rfProtocols,
  fieldSource,
  siteCharacter,
  surveyScope,
  onChangeElf,
  onChangeRf,
  onFinish,
  bare = false,
  photos,
}: {
  elfProtocols: ElfProtocol[];
  rfProtocols: RfProtocol[];
  /** The survey's field source — a board offers its four faces as descriptions. */
  fieldSource: string;
  /** The site characterization — decides the ELF ceiling this survey is judged against. */
  siteCharacter: string;
  /** Which ranges the survey covers — a combined one is worked ELF first, then RF. */
  surveyScope: SurveyScope;
  onChangeElf: (p: ElfProtocol[]) => void;
  onChangeRf: (p: RfProtocol[]) => void;
  /**
   * Done with the tables: hands over to whatever comes next.
   *
   * Absent inside the wizard, where the step's own "המשך" already is that control and a
   * second one beside it would be two buttons for one action.
   */
  onFinish?: () => void;
  /**
   * Renders the contents without the folding card around them.
   *
   * The wizard gives each step its own screen and heading, so the card would be a second
   * frame around a panel that is already one — with a title bar repeating the step's.
   */
  bare?: boolean;
  /**
   * What a table needs to attach a photograph of its own source.
   *
   * Optional so the component still stands alone; when given, every table gets a camera
   * button captioned with its heading.
   */
  photos?: {
    reportId: string;
    report: Report;
    onAdd: (photos: Photo[]) => void;
    /** Holds the autosave off while an upload is in flight — see `use-autosave`. */
    runExclusive?: <R>(work: () => Promise<R>) => Promise<R>;
  };
}) {
  const total = elfProtocols.length + rfProtocols.length;

  /**
   * The first table is opened for the surveyor, not asked for.
   *
   * Arriving at this step with an empty screen and a "הוספת טבלה" button was a
   * click that only ever had one answer: a survey with no measurement tables is not a
   * survey, so the first one is always wanted. The button stays for the second and the
   * third, where the count genuinely varies.
   *
   * Which kind follows the survey's own scope — ELF for a combined or ELF-only survey,
   * because that is the range worked first, and RF where that is all there is.
   *
   * Runs once, and only on a step that is genuinely empty: a report reopened with its
   * tables already written must not have another appended on every visit.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || total > 0) return;
    opened.current = true;
    if (surveyScope === 'rf') {
      onChangeRf([newRfProtocol()]);
      setOpenKey('rf-0');
      return;
    }
    onChangeElf([newElfProtocol()]);
    setOpenKey('elf-0');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, surveyScope]);

  /**
   * Which table is expanded — one at a time.
   *
   * Held here rather than inside each block: opening the table just added has
   * to fold the one before it, and a block cannot fold its neighbour. `null`
   * means "the last one", so a freshly loaded report opens on the table most
   * likely to be worked on without anything having to be chosen.
   */
  const [openKey, setOpenKey] = useState<string | null>(null);
  const lastKey = rfProtocols.length
    ? `rf-${rfProtocols.length - 1}`
    : elfProtocols.length
      ? `elf-${elfProtocols.length - 1}`
      : null;
  const shown = openKey ?? lastKey;
  const toggle = (key: string) => setOpenKey((current) => ((current ?? lastKey) === key ? '' : key));

  // Adding a table used to be blocked until every RF row was filled in. It read
  // as an error for work simply not done yet — a surveyor writing up several
  // floors enters the tables first and the readings after, and the screen told
  // them off for it. Nothing here can be blocked on that.

  /**
   * A combined survey covers both ranges, and is worked through in two passes.
   *
   * Only then is there a crossing to make between them; an ELF-only or RF-only survey
   * has one kind of table and no order to keep.
   */
  const combined = surveyScope === 'both';

  /**
   * Which range the surveyor is on, in a combined survey.
   *
   * Inferred rather than stored: once an RF table exists the ELF pass is over, because
   * that is the order the two are worked in. So "הוספת טבלה" adds ELF while there are no
   * RF tables and RF afterwards — the button keeps meaning "another of what I am doing
   * now" without a mode to set or remember.
   */
  const onRf = combined && rfProtocols.length > 0;

  const addTable = () => {
    if (onRf) {
      onChangeRf([...rfProtocols, newRfProtocol()]);
      setOpenKey(`rf-${rfProtocols.length}`);
      return;
    }
    onChangeElf([...elfProtocols, newElfProtocol()]);
    setOpenKey(`elf-${elfProtocols.length}`);
  };

  /**
   * Sets an ELF table's reference, and mirrors a seating-points table into RF.
   *
   * Seating points are the one reference that is not a source but a place, and a place
   * is surveyed in both ranges at once: the same chairs are measured for magnetic field
   * and for power density on the same walk. So choosing it on an ELF table builds the
   * matching RF table from the point descriptions already typed, instead of asking for
   * the same list of rooms a second time.
   *
   * Only the descriptions cross over — the readings are a different instrument's and are
   * left blank. Rows without a description are skipped: they are the laid-out blanks the
   * table opens with, and mirroring them would produce an RF table of empty rows.
   *
   * Runs once: an RF table already measured against seating points is left alone rather
   * than rebuilt, so re-picking the reference cannot discard readings.
   */
  const setElfReference = (index: number, value: string) => {
    onChangeElf(patch(elfProtocols, index, { referenceLabel: value }));
    if (value !== SEATING_REFERENCE) return;
    if (rfProtocols.some((p) => p.referenceLabel === SEATING_REFERENCE)) return;

    const source = elfProtocols[index];
    const descriptions = Array.from(
      new Set(source.rows.map((r) => r.description.trim()).filter(Boolean)),
    );
    if (descriptions.length === 0) return;

    onChangeRf([
      ...rfProtocols,
      {
        ...newRfProtocol(),
        title: source.title,
        referenceLabel: SEATING_REFERENCE,
        rows: descriptions.map((description) => ({ ...newRfRow(''), description })),
      },
    ]);
  };

  /**
   * The ELF tables worth offering to copy: those with at least one described point.
   *
   * A table still being laid out has rows but no wording yet, and copying it would
   * produce an RF table of blank rows — the same reason `setElfReference` skips them.
   */
  const copyableElf: ElfCopyCandidate[] = elfProtocols
    .map((protocol, index) => ({
      index,
      title: protocol.title,
      descriptions: Array.from(
        new Set(protocol.rows.map((r) => r.description.trim()).filter(Boolean)),
      ),
    }))
    .filter((p) => p.descriptions.length > 0);

  /** Open while the crossing is asking which ELF tables to carry over; null when closed. */
  const [copyPrompt, setCopyPrompt] = useState<ElfCopyCandidate[] | null>(null);

  /** Opens the first RF table, adding one if the pass has none yet. */
  const openRf = () => {
    if (rfProtocols.length === 0) {
      onChangeRf([...rfProtocols, newRfProtocol()]);
      setOpenKey(`rf-${rfProtocols.length}`);
      return;
    }
    setOpenKey(`rf-${rfProtocols.length - 1}`);
  };

  /**
   * Builds the RF pass from the chosen ELF tables — one RF table per ELF table.
   *
   * Only the point descriptions cross over, which is the whole of what is being saved:
   * the same places are walked in both ranges, but they are a different instrument's
   * readings at different distances and heights, so every other cell opens at its RF
   * default. The heading comes along because it names the source, not a measurement.
   */
  const copyToRf = (chosen: ElfCopyCandidate[]) => {
    setCopyPrompt(null);
    if (chosen.length === 0) {
      openRf();
      return;
    }
    const added: RfProtocol[] = chosen.map((source) => ({
      ...newRfProtocol(),
      title: source.title,
      /*
       * The reference is left blank rather than copied or defaulted.
       *
       * Copied, because the two lists are deliberately disjoint — an ELF table is
       * measured against a mains source and an RF one against a radio source, so
       * "ללוח חשמל" is not an answer this field accepts. Defaulted, because the
       * default is "ארון תקשורת", which would declare the table a cabinet distance
       * profile: `isCabinetReference` then shapes it around 0.3/0.5/1 m and offers
       * cabinet wordings, which is precisely not what a table of copied points is.
       * Blank leaves the one question the copy cannot answer for the surveyor to.
       */
      referenceLabel: '',
      rows: source.descriptions.map((description) => ({ ...newRfRow(''), description })),
    }));
    onChangeRf([...rfProtocols, ...added]);
    // Opens the first of the tables just created — where the readings now get typed.
    setOpenKey(`rf-${rfProtocols.length}`);
  };

  /**
   * Crosses over to the RF pass.
   *
   * Asks first, when there are ELF tables whose points could be carried over: the RF
   * pass walks the same places, and retyping the list of points a second time is the
   * work this saves. With nothing to copy the question has one answer, so it is not
   * asked — the crossing just happens.
   */
  const goToRf = () => {
    if (copyableElf.length > 0 && rfProtocols.length === 0) {
      setCopyPrompt(copyableElf);
      return;
    }
    openRf();
  };

  /**
   * Adding the next table, and crossing over to RF.
   *
   * Buttons rather than one that opens a chooser. A surveyor writing up a building adds
   * six ELF tables in a row, and the intermediate "which kind?" step was a click per
   * table that answered the same way every time. In a combined survey the two ranges are
   * not worked on at once — every ELF table is filled, then the RF ones — so the buttons
   * name that order instead of asking which kind each time. A single-range survey has no
   * crossing to make, and keeps the two plain add buttons.
   *
   * Rendered at the foot of the *last* table, beside its camera button: that is where
   * the thumb is when a table has just been filled in, and the moment the next one is
   * wanted. Once, not under every table — the list would otherwise repeat the same three
   * controls between each pair of tables.
   */
  const actions = (
        <span className="table-actions">
          <button type="button" className="btn-primary btn-sm" onClick={addTable}>
            {combined ? 'הוספת טבלה' : '+ טבלת ELF'}
          </button>
          {combined ? (
            !onRf && (
              <button type="button" className="btn-sm" onClick={goToRf}>
                מעבר ל-RF
              </button>
            )
          ) : (
            <button
              type="button"
              className="btn-sm"
              onClick={() => {
                onChangeRf([...rfProtocols, newRfProtocol()]);
                setOpenKey(`rf-${rfProtocols.length}`);
              }}
            >
              + טבלת RF
            </button>
          )}
          {onFinish && (
            <button type="button" className="btn-sm" onClick={onFinish}>
              סיום
            </button>
          )}
        </span>
  );

  // The table the actions hang under: the last one in the list as it is worked through.
  const lastElf = rfProtocols.length === 0 ? elfProtocols.length - 1 : -1;
  const lastRf = rfProtocols.length - 1;

  const body = (
      <div>
        {total === 0 && (
          <div className="empty">
            אין טבלאות מדידה. כל טבלה מייצגת מקור אחד — לוח חשמל או ארון תקשורת — בקומה אחת.
          </div>
        )}

        {elfProtocols.length > 0 && (
          <GroupHeading
            label="שדה מגנטי (ELF)"
            count={elfProtocols.length}
          />
        )}
        {elfProtocols.map((protocol, index) => (
          <ProtocolBlock
            key={`elf-${index}`}
            kind="ELF"
            index={index}
            total={elfProtocols.length}
            title={protocol.title}
            rowCount={protocol.rows.length}
            open={shown === `elf-${index}`}
            onToggle={() => toggle(`elf-${index}`)}
            onMove={(to) => onChangeElf(move(elfProtocols, index, to))}
            onRemove={() => onChangeElf(elfProtocols.filter((_, i) => i !== index))}
          >
            <div className="grid">
              {/* The heading's fixed opening is shown as the hint rather than
                  typed into the field, so what will print is visible without
                  being retyped per table. */}
              <Text
                label="שם המקור המקרין"
                value={protocol.title}
                onChange={(v) => onChangeElf(patch(elfProtocols, index, { title: v }))}
                hint={`ייודפס: ${composeProtocolTitle('elf', protocol.title || '…')}`}
                placeholder="למשל: לוח חשמל ראשי, קומה 2"
                wide
              />
              {/* אותה רשימת מקורות כמו ב-RF, כדי שלא יוקלד "ללוח חשמל" בכל
                  טבלה מחדש. "אחר…" נשאר לניסוח חד-פעמי. */}
              <ReferenceChoice
                value={protocol.referenceLabel}
                onChange={(v) => setElfReference(index, v)}
              />
              <Text label="מקדם נרמול" value={protocol.normalizationFactor} onChange={(v) => onChangeElf(patch(elfProtocols, index, { normalizationFactor: v }))} ltr />
              {/* "הערת נרמול" אינה מוצגת: היא נכנסת עם ברירת המחדל של הטבלה
                  ונדפסת בדוח כרגיל. מה שבאמת נקבע לכל טבלה הוא המקדם. */}
            </div>

            <ElfTable
              rows={protocol.rows}
              normalizationFactor={protocol.normalizationFactor}
              boardSource={isBoardSource(fieldSource)}
              distanceOptions={measurementDistanceOptions(fieldSource, protocol.referenceLabel)}
              siteCharacter={siteCharacter}
              onChange={(rows) => onChangeElf(patch(elfProtocols, index, { rows }))}
            />

            {/* התמונה נלקחת ברגע שמודדים את המקור, ולכן הכפתור כאן ולא בשלב נפרד.
                הכיתוב נלקח מכותרת הטבלה שממש מעליו. */}
            {photos && (
              <PhotoButton
                reportId={photos.reportId}
                report={photos.report}
                caption={protocol.title}
                onAdd={photos.onAdd}
                runExclusive={photos.runExclusive}
                after={index === lastElf ? actions : undefined}
              />
            )}
          </ProtocolBlock>
        ))}

        {rfProtocols.length > 0 && (
          <GroupHeading
            label="צפיפות הספק (RF)"
            count={rfProtocols.length}
          />
        )}
        {rfProtocols.map((protocol, index) => (
          <ProtocolBlock
            key={`rf-${index}`}
            kind="RF"
            index={index}
            total={rfProtocols.length}
            title={protocol.title}
            rowCount={protocol.rows.length}
            open={shown === `rf-${index}`}
            onToggle={() => toggle(`rf-${index}`)}
            onMove={(to) => onChangeRf(move(rfProtocols, index, to))}
            onRemove={() => onChangeRf(rfProtocols.filter((_, i) => i !== index))}
          >
            <div className="grid">
              <Text
                label="שם המקור המקרין"
                value={protocol.title}
                onChange={(v) => onChangeRf(patch(rfProtocols, index, { title: v }))}
                hint={`ייודפס: ${composeProtocolTitle('rf', protocol.title || '…')}`}
                placeholder="למשל: לוח חשמל ראשי, קומה 2"
                wide
              />
              <RfReferenceField
                value={protocol.referenceLabel}
                onChange={(referenceLabel) =>
                  onChangeRf(patch(rfProtocols, index, { referenceLabel }))
                }
              />
            </div>

            <RfTable
              rows={protocol.rows}
              cabinet={isCabinetReference(protocol.referenceLabel)}
              distanceOptions={measurementDistanceOptions(fieldSource, protocol.referenceLabel)}
              onChange={(rows) => onChangeRf(patch(rfProtocols, index, { rows }))}
            />

            {photos && (
              <PhotoButton
                reportId={photos.reportId}
                report={photos.report}
                caption={protocol.title}
                onAdd={photos.onAdd}
                runExclusive={photos.runExclusive}
                after={index === lastRf ? actions : undefined}
              />
            )}
          </ProtocolBlock>
        ))}

        {/* בלי טבלאות אין תחתית להיתלות בה, ולכן הכפתורים מוצגים כאן. */}
        {total === 0 && <div className="protocols-bare-actions">{actions}</div>}

        {copyPrompt && (
          <CopyPointsToRf
            candidates={copyPrompt}
            onConfirm={copyToRf}
            onClose={() => setCopyPrompt(null)}
          />
        )}
      </div>
  );

  // Bare: the wizard's panel is the frame, and the actions hang under the last table
  // rather than above the list — see the note on `actions`.
  if (bare) {
    return <div className="protocols-bare">{body}</div>;
  }

  return (
    <CollapsibleCard
      title="טבלאות מדידה"
      hint={
        total === 0
          ? 'אין טבלאות'
          : `${total} טבלאות — ${elfProtocols.length} ELF, ${rfProtocols.length} RF`
      }
      action={actions}
    >
      {body}
    </CollapsibleCard>
  );
}

/** One ELF table as the crossing prompt sees it: a heading and the points typed into it. */
type ElfCopyCandidate = { index: number; title: string; descriptions: string[] };

/**
 * Asked once, on crossing from the ELF pass to the RF one: which tables to carry over.
 *
 * The two passes walk the same building. A surveyor who has just typed twenty point
 * descriptions into six ELF tables would otherwise type them again for RF, off the
 * screen above, and a mistyped one makes the two ranges disagree about where a reading
 * was taken. Ticking the tables here reproduces each as an RF table of the same points.
 *
 * Nothing starts ticked. Copying is the offer, not the assumption: crossing over with
 * no table chosen is the plain crossing this button always did — one empty RF table —
 * and that has to stay what happens when the prompt is dismissed without a choice.
 * Ticking is the deliberate act, so no table is ever reproduced unasked.
 */
function CopyPointsToRf({
  candidates,
  onConfirm,
  onClose,
}: {
  candidates: ElfCopyCandidate[];
  onConfirm: (chosen: ElfCopyCandidate[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set());

  const toggle = (index: number) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const chosen = candidates.filter((c) => picked.has(c.index));
  const points = chosen.reduce((sum, c) => sum + c.descriptions.length, 0);

  return (
    <Modal title="העתקת נקודות מדידה ל-RF" onClose={onClose} wide>
      <p className="hint" style={{ marginBottom: 12 }}>
        אילו טבלאות ELF להעתיק? כל טבלה שתיבחר תיפתח כטבלת RF עם אותן נקודות מדידה.
        מועתקים תיאורי הנקודות בלבד — המרחקים, הגבהים והקריאות נשארים ריקים למדידה,
        ו״בדיקה ביחס ל…״ נבחר בכל טבלה מחדש.
      </p>

      <div className="copy-points-list">
        {candidates.map((candidate) => (
          <label key={candidate.index} className="copy-points-item">
            <input
              type="checkbox"
              checked={picked.has(candidate.index)}
              onChange={() => toggle(candidate.index)}
            />
            <span className="copy-points-text">
              <strong>{candidate.title.trim() || `טבלה ${candidate.index + 1}`}</strong>
              {/* The points themselves, not just how many: which table is which is told
                  by its points as much as by a heading that may still be blank. */}
              <span className="hint">
                {candidate.descriptions.length} נקודות — {candidate.descriptions.join(' · ')}
              </span>
            </span>
          </label>
        ))}
      </div>

      {/* The opening state, so it says what happens on a plain crossing rather than
          reading as a complaint about nothing being ticked. */}
      <p className="hint" style={{ marginTop: 12 }}>
        {chosen.length === 0
          ? 'ללא בחירה — תיפתח טבלת RF ריקה אחת, כרגיל.'
          : `ייפתחו ${chosen.length} טבלאות RF, ${points} נקודות בסך הכל.`}
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="btn-primary btn-sm" onClick={() => onConfirm(chosen)}>
          {chosen.length === 0 ? 'מעבר ל-RF' : 'העתקה ומעבר ל-RF'}
        </button>
        <button type="button" className="btn-sm" onClick={onClose}>
          ביטול
        </button>
      </div>
    </Modal>
  );
}

/**
 * The RF measurement table.
 *
 * Distinct from the ELF one because two of its columns are not free text: the
 * area is occupied one of exactly two ways, and the verdict follows from the
 * reading against the threshold rather than being a judgement to type.
 */
function RfTable({
  rows,
  cabinet,
  distanceOptions,
  onChange,
}: {
  rows: RfRow[];
  /** A cabinet or a wifi point — the descriptions those are given. */
  cabinet: boolean;
  distanceOptions: readonly string[];
  onChange: (rows: RfRow[]) => void;
}) {
  const set = (index: number, patchRow: Partial<RfRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patchRow } : r)));

  return (
    <>
      <div className="table-scroll measurement-table-scroll">
        <table className="measurement-table">
          <thead>
            <tr>
              <th className="row-num">#</th>
              {RF_COLUMNS.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const verdict = rfCompliance(row.measured, row.threshold);
              const percent = percentOfThreshold(row.measured, row.threshold);

              return (
                <tr key={i}>
                  <td className="row-num" data-label="נקודה">{i + 1}</td>
                  <td data-label={RF_COLUMNS[0]}>
                    {/* A cabinet and a wifi point are measured the same way, so
                        the two words are offered as the description. Any other
                        reference has no such shorthand and stays free text. */}
                    <ComboBox
                      value={row.description}
                      options={cabinet ? RF_CABINET_POINT_OPTIONS : []}
                      placeholder="אפשר להשאיר ריק"
                      rtl
                      onChange={(v) => onChange(describeMeasurementProfile(rows, i, v))}
                    />
                  </td>
                  <td data-label={RF_COLUMNS[1]}>
                    <PickList
                      value={row.distance}
                      options={distanceOptions}
                      keepCustomOption
                      ariaLabel="מרחק במטרים"
                      onChange={(v) => set(i, { distance: v })}
                    />
                  </td>
                  <td data-label={RF_COLUMNS[2]}>
                    {/* Two options, so a toggle rather than a menu — one click to switch. */}
                    <button
                      type="button"
                      className="btn-sm occupancy-toggle"
                      title="לחצו כדי להחליף"
                      onClick={() =>
                        set(i, {
                          occupancy:
                            row.occupancy === RF_OCCUPANCY_OPTIONS[0]
                              ? RF_OCCUPANCY_OPTIONS[1]
                              : RF_OCCUPANCY_OPTIONS[0],
                        })
                      }
                    >
                      {row.occupancy || RF_OCCUPANCY_OPTIONS[0]} ⇄
                    </button>
                  </td>
                  <td data-label={RF_COLUMNS[3]}>
                    <input
                      value={row.measured}
                      className="ltr"
                      inputMode="decimal"
                      placeholder="אפשר להשאיר ריק"
                      onChange={(e) => set(i, { measured: e.target.value })}
                    />
                  </td>
                  <td data-label={RF_COLUMNS[4]}>
                    <input
                      value={row.threshold}
                      className="ltr"
                      inputMode="decimal"
                      onChange={(e) => set(i, { threshold: e.target.value })}
                    />
                  </td>
                  <td data-label={RF_COLUMNS[5]}>
                    {/* Derived, so not editable: typing "עומד" over a real
                        exceedance is exactly the error this column exists to
                        prevent. */}
                    {verdict === '' ? (
                      <span className="verdict-pending">—</span>
                    ) : (
                      <span className={`badge ${verdict === 'עומד' ? 'ok' : 'bad'}`}>
                        {verdict}
                        {percent !== null && <span className="verdict-percent">{formatPercent(percent)} מהסף</span>}
                      </span>
                    )}
                  </td>
                  <td data-label={RF_COLUMNS[6]}>
                    <HeightField value={row.height} onChange={(v) => set(i, { height: v })} />
                  </td>
                  <td className="row-delete-cell">
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      onClick={() => onChange(rows.filter((_, n) => n !== i))}
                      title="מחיקת שורה"
                      aria-label={`מחיקת שורה ${i + 1}`}
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
      {/*
        "הוספת נקודת מדידה" הוסר: טבלת RF חדשה כבר נפתחת עם 5 שורות של פרופיל
        המרחקים, בדיוק כמו ELF, ועוד נקודה פירושה טבלה חדשה דרך "הוספת טבלה"
        שבתחתית הטבלה האחרונה. "הוספת שורה בודדת" נשאר למקרה החד-פעמי שבו דרושה
        שורה אחת נוספת מעבר לפרופיל.
      */}
      <button type="button" className="btn-sm" onClick={() => onChange([...rows, nextRfRow(rows)])} style={{ marginTop: 10 }}>
        הוספת שורה בודדת
      </button>
    </>
  );
}

/**
 * The ELF measurement table.
 *
 * Four of its seven columns are constrained: the distance and the two verdict
 * columns come from fixed lists, and the normalized value is the reading times
 * this protocol's coefficient. The surveyor supplies where they stood and what
 * the meter read; the rest follows.
 */
function ElfTable({
  rows,
  normalizationFactor,
  boardSource,
  distanceOptions,
  siteCharacter,
  onChange,
}: {
  rows: ElfRow[];
  normalizationFactor: string;
  /** True when the survey's source is a distribution board. */
  boardSource: boolean;
  distanceOptions: readonly string[];
  /** Decides the ceiling a reading is judged against. */
  siteCharacter: string;
  onChange: (rows: ElfRow[]) => void;
}) {
  const set = (index: number, patchRow: Partial<ElfRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patchRow } : r)));

  // A new table opens with the five-row profile pre-filled, so the empty state is only
  // reached by deleting every row. It stays as a safety net rather than being removed.
  if (rows.length === 0) {
    return (
      <>
        <div className="empty" style={{ padding: '20px 12px' }}>
          אין עדיין שורות בטבלה זו.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => onChange(ELF_PROFILE_DISTANCES.map((d) => newElfRow(d)))}
          >
            פתיחת פרופיל (5 שורות)
          </button>
          <button type="button" className="btn-sm" onClick={() => onChange([newElfRow()])}>
            שורה בודדת
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="table-scroll measurement-table-scroll">
        <table className="measurement-table">
          <thead>
            <tr>
              <th className="row-num">#</th>
              {ELF_COLUMNS.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const normalized = elfNormalized(row.measured, normalizationFactor);
              // What the reading and the occupancy point to, until the surveyor
              // says otherwise.
              const suggested = elfCompliance(normalized, row.occupancy, siteCharacter);

              return (
                <tr key={i}>
                  <td className="row-num" data-label="נקודה">{i + 1}</td>
                  <td data-label={ELF_COLUMNS[0]}>
                    {/* When the survey's source is a distribution board, the
                        four faces are offered as a list — each carrying the
                        method sentence that makes the reading mean something.
                        Any other source has no such faces, so the field stays
                        free text. A description already typed is kept. */}
                    <ComboBox
                      value={row.description}
                      options={boardSource ? BOARD_POINT_OPTIONS : []}
                      placeholder="אפשר להשאיר ריק"
                      rtl
                      onChange={(v) => onChange(describeMeasurementProfile(rows, i, v))}
                    />
                  </td>
                  <td data-label={ELF_COLUMNS[1]}>
                    <PickList
                      value={row.distance}
                      options={distanceOptions}
                      keepCustomOption
                      ariaLabel="מרחק במטרים"
                      onChange={(v) => set(i, { distance: v })}
                    />
                  </td>
                  <td data-label={ELF_COLUMNS[2]}>
                    <HeightField value={row.height} onChange={(v) => set(i, { height: v })} />
                  </td>
                  <td data-label={ELF_COLUMNS[3]}>
                    <input
                      value={row.measured}
                      className="ltr"
                      inputMode="decimal"
                      placeholder="אפשר להשאיר ריק"
                      onChange={(e) => set(i, { measured: e.target.value })}
                    />
                  </td>
                  <td data-label={ELF_COLUMNS[4]}>
                    {/* Derived: the reading times the coefficient. Not editable,
                        so the two columns cannot drift apart. */}
                    {normalized === '' ? (
                      <span className="verdict-pending">—</span>
                    ) : (
                      <span className="derived-value">
                        {normalized}
                        <span className="derived-note">× {normalizationFactor || '1'}</span>
                      </span>
                    )}
                  </td>
                  <td data-label={ELF_COLUMNS[5]}>
                    <select value={row.occupancy} onChange={(e) => set(i, { occupancy: e.target.value })}>
                      {ELF_OCCUPANCY_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td data-label={ELF_COLUMNS[6]}>
                    {/* The value shown is the value printed. A select whose
                        `value` is "" matches none of its options, so the browser
                        displayed the first one — "לא חורג" — while the row still
                        held nothing, and the column came out blank in the
                        delivered report. The suggestion from the reading is now
                        both what is shown and what is merged. */}
                    <select
                      value={row.compliance || suggested}
                      className={row.compliance ? undefined : 'verdict-suggested'}
                      onChange={(e) => set(i, { compliance: e.target.value })}
                    >
                      {suggested === '' && <option value="">—</option>}
                      {ELF_COMPLIANCE_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="row-delete-cell">
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      onClick={() => onChange(rows.filter((_, n) => n !== i))}
                      title="מחיקת שורה"
                      aria-label={`מחיקת שורה ${i + 1}`}
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
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {/* "הוספת נקודת מדידה" הוסר: טבלה חדשה כבר נפתחת עם פרופיל של 5 מרחקים,
            ועוד נקודה פירושה טבלה חדשה (כפתור "הוספת טבלה"). "שורה בודדת" נשאר
            למקרה החד-פעמי שבו דרושה שורה אחת מעבר לפרופיל. */}
        <button type="button" className="btn-sm" onClick={() => onChange([...rows, newElfRow()])}>
          הוספת שורה בודדת
        </button>
      </div>

    </>
  );
}

/**
 * A list of usual values that still accepts anything typed.
 *
 * The distances a reading is taken at are all but fixed, but a survey
 * occasionally needs an odd one — 1.5 metres to reach a desk — so the list is a
 * shortcut, not a constraint.
 */
/**
 * What an ELF protocol is measured against.
 *
 * The same list the RF field offers, minus its table-shaping behaviour: an ELF table has
 * one shape, so choosing a reference here only names the source. It was a free-text box,
 * which meant typing "ללוח חשמל" once per table and living with the spelling drift that
 * follows — the same reason the field sources became a list.
 *
 * The stored value keeps its ל prefix because the template prints it straight after the
 * words "בדיקה ביחס". "אחר…" clears the field for a one-off wording.
 */
/**
 * What an ELF table is measured against.
 *
 * The ELF list, not the RF one. The two were the same list, which offered "wifi" and
 * "ארון תקשורת" to somebody measuring a distribution board — radio-frequency
 * sources on a magnetic-field table, which is not a measurement anyone takes.
 */
function ReferenceChoice({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const listed = (ELF_REFERENCE_OPTIONS as readonly string[]).includes(value);
  const [other, setOther] = useState(value !== '' && !listed);

  return (
    <div className="field">
      <label>בדיקה ביחס ל…</label>
      {other ? (
        <>
          <input value={value} autoFocus placeholder="במה נמדד" onChange={(e) => onChange(e.target.value)} />
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
          {ELF_REFERENCE_OPTIONS.map((o) => (
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

/**
 * What an RF protocol is measured against.
 *
 * Changes the distance choices without replacing rows: manually entered
 * distances and heights must survive even before the first reading is taken.
 *
 * "אחר" clears the field rather than filling it with the word "אחר": what
 * belongs there is what the surveyor is about to type.
 */
function RfReferenceField({
  value,
  onChange,
}: {
  value: string;
  onChange: (referenceLabel: string) => void;
}) {
  const listed = (RF_REFERENCE_OPTIONS as readonly string[]).includes(value);
  const [other, setOther] = useState(value !== '' && !listed);

  return (
    <div className="field">
      <label>בדיקה ביחס ל…</label>
      {other ? (
        <>
          <input value={value} autoFocus placeholder="במה נמדד" onChange={(e) => onChange(e.target.value)} />
          <button
            type="button"
            className="btn-sm"
            style={{ marginTop: 6 }}
            onClick={() => {
              setOther(false);
              onChange(RF_DEFAULT_REFERENCE);
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
          {RF_REFERENCE_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value="__other__">אחר…</option>
        </select>
      )}
      {isCabinetReference(value) && (
        <span className="hint">חמש מדידות עם אותו תיאור, במרחקים 0.3 · 0.5 · 1 · 1.5 · 2 מ׳</span>
      )}
    </div>
  );
}

/**
 * A text field with suggestions.
 *
 * A `<datalist>` rather than a `<select>`, deliberately: every one of these
 * fields has a common set of answers and a long tail that the list will never
 * cover, and a select would force the tail through an "other" option. Typing
 * anything is always allowed; the list is a shortcut.
 *
 * With no options it is simply a text field, which is what lets the same
 * component serve a description that has suggestions on one survey and none on
 * the next.
 */
function ComboBox({
  value,
  options,
  onChange,
  placeholder,
  rtl,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  placeholder?: string;
  /** Hebrew text reads right-to-left; numeric fields do not. */
  rtl?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const start = () => {
    setDraft(value);
    setOpen(true);
  };

  const commit = (next: string) => {
    /*
     * The slow-scan phrase is completed here as well as on a new point.
     *
     * This editor is where a description is reworded, and a surveyor who rewrites one
     * expects the finished sentence to read the same way as every other row's. It is
     * idempotent, so saving an unchanged description does not append it twice.
     */
    onChange(withSlowScan(next));
    setOpen(false);
  };

  return (
    <>
      {/* readOnly on purpose: the cell is a handle that opens the editor, not somewhere
          to type. Editing in place is what made this unusable — the descriptions run to
          sixty characters and the column shows about fifteen of them. */}
      <input
        readOnly
        value={value}
        placeholder={placeholder}
        aria-label="תיאור נקודת המדידה"
        aria-haspopup="dialog"
        className={rtl ? 'tap-to-edit' : 'ltr tap-to-edit'}
        onClick={start}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            start();
          }
        }}
      />
      {open && (
        <Modal title="תיאור נקודת המדידה" onClose={() => setOpen(false)} wide>
          <div className="point-editor">
            {/* A textarea rather than an input: the whole description has to be readable
                at once, which is the entire reason this opens. */}
            <textarea
              autoFocus
              rows={4}
              value={draft}
              placeholder={placeholder}
              aria-label="תיאור נקודת המדידה"
              onChange={(e) => setDraft(e.target.value)}
            />
            {options.length > 0 && (
              <div className="point-options">
                {options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    className={o === draft ? 'point-option active' : 'point-option'}
                    onClick={() => setDraft(o)}
                  >
                    {o}
                  </button>
                ))}
              </div>
            )}
            <div className="point-actions">
              <button type="button" className="btn-sm" onClick={() => setOpen(false)}>
                ביטול
              </button>
              <button type="button" className="btn-sm btn-primary" onClick={() => commit(draft)}>
                שמירה
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * The height column: a list to scroll, from −30 to 30, opening at 0.
 *
 * Height carries a sign, because a reading taken above the point of reference and one
 * taken below it are both "1 metre from it" and only the sign tells them apart — the
 * board table has had a point above the board since ABOVE_BOARD_POINT, and a power line
 * is routinely measured from below.
 *
 * This was a text box with a ± button beside it, because the phone keypad has no minus
 * key: `inputMode="decimal"` offers digits and a separator and nothing else, so a
 * negative height could not otherwise be typed. A list settles that more simply — the
 * negative values are entries like any other, so there is no sign to toggle and no
 * keypad limitation to work around, and picking is one gesture where typing a digit and
 * then reaching for a button was two.
 *
 * Whole metres only. A picker holding every tenth of a metre across this range would be
 * 601 entries to scroll; a survey needing 1.5 m types it into "אחר", which `PickList`
 * already provides and which also keeps every height an older report stored.
 */
function HeightField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <PickList
      value={value}
      options={HEIGHT_OPTIONS}
      ariaLabel="גובה במטרים"
      onChange={onChange}
    />
  );
}

/**
 * A short list of values, picked rather than typed — with a way out.
 *
 * The distance columns were a `<datalist>`, which on a desktop is a text box that
 * suggests as you type and on a phone is a text box that does almost nothing: the
 * suggestions are a thin strip that appears only after a character is typed, so in
 * practice the whole list was invisible and every distance was typed by hand. A real
 * `<select>` is what a phone renders as a full-screen picker.
 *
 * "אחר…" swaps in a text box for a value the list does not carry — the list covers the
 * distances a reading is normally taken at, not all of them. A value already stored that
 * is not on the list opens in that box rather than being silently snapped to the nearest
 * option, so an older report keeps what it measured.
 */
function PickList({
  value,
  options,
  onChange,
  ariaLabel,
  keepCustomOption = false,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  ariaLabel?: string;
  keepCustomOption?: boolean;
}) {
  const listed = options.includes(value);
  const [other, setOther] = useState(!keepCustomOption && value !== '' && !listed);
  const editing = useRef(false);

  // External values can choose the control, but a partial keystroke cannot:
  // typing the first "1" of "10" must keep the input mounted and focused.
  useEffect(() => {
    if (!editing.current) setOther(!keepCustomOption && value !== '' && !options.includes(value));
  }, [value, options, keepCustomOption]);

  if (other) {
    return (
      <input
        value={value}
        className="ltr"
        inputMode="decimal"
        autoFocus
        aria-label={ariaLabel}
        onFocus={() => { editing.current = true; }}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          editing.current = false;
          const completed = e.currentTarget.value;
          setOther(!keepCustomOption && completed.trim() !== '' && !options.includes(completed));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <select
      className="ltr"
      value={listed || keepCustomOption ? value : ''}
      aria-label={ariaLabel}
      onChange={(e) => {
        if (e.target.value === '__other__') {
          editing.current = true;
          setOther(true);
          onChange('');
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">—</option>
      {keepCustomOption && !listed && value !== '' && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value="__other__">אחר…</option>
    </select>
  );
}

function GroupHeading({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <div className="group-heading">
      <span>{label}</span>
      <span className="badge">{count}</span>
    </div>
  );
}

/**
 * One measurement table, collapsed unless it is the one being worked on.
 *
 * A survey of several floors ends up with a screenful of tables, and every one
 * of them open at once buries whichever is actually being filled in. The newest
 * table opens and the rest fold to their heading, which still shows the kind,
 * the title and the row count — enough to find the one you want.
 */
export function ProtocolBlock({
  kind,
  index,
  total,
  title,
  rowCount,
  summary,
  removePrompt,
  badge,
  open,
  onToggle,
  onMove,
  onRemove,
  children,
}: {
  kind: string;
  index: number;
  total: number;
  title: string;
  rowCount: number;
  /** Replaces the row count on the heading, for a block that is not a table of rows. */
  summary?: string;
  removePrompt?: string;
  /** Replaces the kind and number on the heading's badge. */
  badge?: string;
  open: boolean;
  onToggle: () => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="protocol-block">
      <div className="card-head" style={{ background: '#f7f9fb' }}>
        <button
          type="button"
          className="btn-sm"
          onClick={onToggle}
          title={open ? 'סגירה' : 'פתיחה'}
          style={{ minWidth: 30 }}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="badge">
          {badge ?? `${kind} ${index + 1}`}
        </span>
        <strong
          onClick={onToggle}
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
        >
          {title.trim() || `טבלת ${kind} ${index + 1}`}
        </strong>
        <span className="hint">{summary ?? `${rowCount} שורות`}</span>
        <span className="spacer" style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn-sm" disabled={index === 0} onClick={() => onMove(index - 1)} title="הזזה למעלה">
            ↑
          </button>
          <button type="button" className="btn-sm" disabled={index === total - 1} onClick={() => onMove(index + 1)} title="הזזה למטה">
            ↓
          </button>
          <button
            type="button"
            className="btn-danger btn-sm"
            onClick={() => {
              if (confirm(removePrompt ?? `למחוק את הטבלה על כל ${rowCount} שורות המדידה שבה?`)) onRemove();
            }}
          >
            מחיקה
          </button>
        </span>
      </div>
      {open && <div style={{ padding: 14 }}>{children}</div>}
    </div>
  );
}

/**
 * A measurement table.
 *
 * Numeric columns are forced left-to-right: a bare "0.3" inside an RTL field
 * renders correctly, but "1.5-2" reorders and the surveyor sees a value they
 * did not type.
 */
function MeasurementTable({
  columns,
  rows,
  ltrColumns,
  onChange,
  onAdd,
}: {
  columns: string[];
  rows: string[][];
  ltrColumns: number[];
  onChange: (rows: string[][]) => void;
  onAdd: () => void;
}) {
  const setCell = (row: number, col: number, value: string) =>
    onChange(rows.map((r, i) => (i === row ? r.map((c, j) => (j === col ? value : c)) : r)));

  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="row-num">#</th>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td className="row-num">{rowIndex + 1}</td>
                {row.map((cell, colIndex) => (
                  <td key={colIndex}>
                    <input
                      value={cell}
                      className={ltrColumns.includes(colIndex) ? 'ltr' : undefined}
                      onChange={(e) => setCell(rowIndex, colIndex, e.target.value)}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => onChange(rows.filter((_, i) => i !== rowIndex))}
                    title="מחיקת שורה"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" className="btn-sm" onClick={onAdd}>
          הוספת שורת מדידה
        </button>
      </div>
    </>
  );
}

function Text({
  label,
  value,
  onChange,
  wide,
  ltr,
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  wide?: boolean;
  ltr?: boolean;
  /** Shown under the field — used to preview the heading that will print. */
  hint?: string;
  placeholder?: string;
}) {
  return (
    <div className={`field${wide ? ' wide' : ''}`}>
      <label>{label}</label>
      <input
        value={value}
        className={ltr ? 'ltr' : undefined}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}


function patch<T>(items: T[], index: number, changes: Partial<T>): T[] {
  return items.map((item, i) => (i === index ? { ...item, ...changes } : item));
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
