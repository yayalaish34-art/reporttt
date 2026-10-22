/**
 * The rules an RF measurement row follows.
 *
 * A new protocol opens with the three distances every RF survey takes — 0.3,
 * 0.5 and 1 metre from the source — already filled in, along with the reference
 * threshold and the standard height. The surveyor is left with the two things
 * only they can know: where they stood, and what the meter read.
 *
 * The verdict is not one of those things. It follows from the reading and the
 * threshold, so it is computed rather than typed, here and at merge time both.
 */

/**
 * The profile a cabinet RF table is laid out at, in metres.
 *
 * This is a *shape*, not a list of choices: it decides how many rows a new cabinet
 * protocol opens with. Adding a distance here adds a row to every such table.
 *
 * Aligned with ELF_PROFILE_DISTANCES: a cabinet opens with the same five distances
 * ELF does, so the two tables are read the same way and "add table" is one tap
 * away from a filled profile rather than two taps and a modal.
 */
export const RF_PROFILE_DISTANCES = ['0.3', '0.5', '1', '1.5', '2'] as const;

/**
 * Distances from the source, in metres, that an RF reading is taken at.
 *
 * Offered as a list on each row rather than enforced — a survey occasionally
 * needs an odd distance to reach where someone actually sits, and the picker keeps an
 * "אחר" box for exactly that.
 *
 * Must contain every value in RF_PROFILE_DISTANCES above (and a smoke test says so):
 * a profile distance the picker cannot offer opens the row sitting on "אחר" the
 * moment it is touched.
 */
export const RF_DISTANCE_OPTIONS = ['0.3', '0.5', '1', '1.5', '2'] as const;

/**
 * The distances an RF measurement point is laid out at, in metres.
 *
 * Far larger than the cabinet profile above, and deliberately so: these are the
 * distances an antenna is measured at. Power density falls with the square of the
 * distance, so the readings that matter are taken where people actually are — across
 * a road, in the next building — and 300 m is not an unusual place to stand under a
 * rooftop installation.
 *
 * Descending, because that is the order the survey is walked: the surveyor starts far
 * off and works in towards the source, and a table laid out the other way asks them to
 * fill it bottom-up.
 */
export const RF_POINT_DISTANCES = ['300', '200', '100', '50', '20', '10'] as const;

/** Reference threshold in µW/cm², as the protocols are judged against. */
export const RF_DEFAULT_THRESHOLD = '40';

/** Height above the floor, in metres. */
export const RF_DEFAULT_HEIGHT = '1';

/**
 * How the area is occupied.
 *
 * Exactly two, because the threshold that applies depends on which: a
 * continuously occupied area is held to the environmental limit, a transient
 * one is not.
 */
export const RF_OCCUPANCY_OPTIONS = ['רציף', 'חשיפה רגעית'] as const;
export type RfOccupancy = (typeof RF_OCCUPANCY_OPTIONS)[number];

/** The verdict wording, matching the signed source report. */
export const COMPLIANT = 'עומד';
export const EXCEEDING = 'חורג';

/** Parses a measurement cell, which is free text and may be blank or "<0.1". */
export function toNumber(value: string): number | null {
  const cleaned = value.trim().replace(/[^\d.,-]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * The verdict for one RF row.
 *
 * Returns '' when either number is missing, so a half-filled row shows nothing
 * rather than a verdict it has no basis for.
 */
export function rfCompliance(measured: string, threshold: string): string {
  const value = toNumber(measured);
  const limit = toNumber(threshold);
  if (value === null || limit === null) return '';
  return value <= limit ? COMPLIANT : EXCEEDING;
}

/**
 * The reading as a percentage of the threshold.
 *
 * Shown in the form only. It is the fastest way to see that 0.16 against 40 is
 * not merely compliant but three orders of magnitude below the limit — which a
 * bare "עומד" hides.
 */
export function percentOfThreshold(measured: string, threshold: string): number | null {
  const value = toNumber(measured);
  const limit = toNumber(threshold);
  if (value === null || limit === null || limit === 0) return null;
  return (value / limit) * 100;
}

/** Formats that percentage for display, keeping small values readable. */
export function formatPercent(percent: number): string {
  if (percent >= 10) return `${percent.toFixed(0)}%`;
  if (percent >= 1) return `${percent.toFixed(1)}%`;
  return `${percent.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

/** A new RF row at the given distance, with everything derivable filled in. */
export function newRfRow(distance: string): {
  description: string;
  occupancy: string;
  measured: string;
  threshold: string;
  compliance: string;
  distance: string;
  height: string;
} {
  return {
    description: '',
    occupancy: RF_OCCUPANCY_OPTIONS[0],
    measured: '',
    threshold: RF_DEFAULT_THRESHOLD,
    compliance: '',
    distance,
    height: RF_DEFAULT_HEIGHT,
  };
}

// RF_REFERENCE_OPTIONS מוגדר למטה, ליד FIELD_SOURCE_OPTIONS — הוא נגזר ממנו
// (REFERENCE_SOURCE_OPTIONS) ולכן חייב לבוא אחריו.

/** The reference a new RF protocol assumes, being much the commonest. */
export const RF_DEFAULT_REFERENCE = 'ארון תקשורת';

/**
 * References measured as a distance profile, rather than at one spot.
 *
 * Named rather than taken by index off RF_REFERENCE_OPTIONS: the list now has the field
 * sources appended to it, and a positional lookup silently means something else the next
 * time an entry is added ahead of these.
 */
const PROFILE_REFERENCES = new Set<string>(['ארון תקשורת', 'wifi']);

/** True when the protocol is measured against a cabinet — a distance profile. */
export function isCabinetReference(referenceLabel: string): boolean {
  return PROFILE_REFERENCES.has(referenceLabel.trim());
}

/**
 * The measurement-point descriptions offered for a cabinet.
 *
 * A cabinet and a wifi access point are the same measurement — a source in the
 * room — so they share the wording.
 */
export const RF_CABINET_POINT_OPTIONS = ['ארון תקשורת', 'wifi'] as const;

/**
 * The rows a new RF protocol opens with.
 *
 * Always a five-row profile — the same shape as the ELF tables, so the surveyor
 * taps "add table" once and gets a filled grid rather than tapping "add
 * measurement point" afterwards. Cabinet and non-cabinet share the layout; the
 * distances carried on each row match ELF (0.3–2 m), and are editable per row
 * for the odd case where a different reach is wanted.
 *
 * The reference label is still accepted so callers can keep a cabinet in step
 * with any future divergence, but today every reference opens the same shape.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function newRfRows(_referenceLabel: string = RF_DEFAULT_REFERENCE) {
  return RF_PROFILE_DISTANCES.map((distance) => newRfRow(distance));
}

/** Fill a point's five readings together without overwriting a mixed legacy table. */
export function describeMeasurementProfile<T extends { description: string }>(
  rows: T[],
  index: number,
  description: string,
): T[] {
  const previous = rows[index]?.description;
  if (previous === undefined) return rows;
  const size = RF_PROFILE_DISTANCES.length;
  const start = Math.floor(index / size) * size;
  const profile = rows.slice(start, start + size);
  const shared = profile.length === size && profile.every(
    (row) => row.description.trim() === '' || row.description === previous,
  );
  return rows.map((row, position) => (
    position === index || (shared && position >= start && position < start + size)
      ? { ...row, description }
      : row
  ));
}

/** What a row is still missing before the protocol can be considered complete. */
export function missingRfFields(row: { description: string; measured: string }): string[] {
  const missing: string[] = [];
  if (row.description.trim() === '') missing.push('תיאור נקודת המדידה');
  if (row.measured.trim() === '') missing.push('עוצמת הקרינה שנמדדה');
  return missing;
}

// ── ELF ─────────────────────────────────────────────────────────────

/**
 * The distances a new ELF protocol opens with, in metres.
 *
 * A protocol is not one reading, it is a profile: the field falls off with
 * distance, and the whole point of the table is to show where it becomes
 * acceptable. So a new table starts with the distances that profile is always
 * taken at, already laid out — one blank row asked the surveyor to rebuild the
 * same rows for every source in the building.
 *
 * Starts at 0.3 m, against the source itself, which is the reading the rest of
 * the profile is read against.
 */
export const ELF_PROFILE_DISTANCES = ['0.3', '0.5', '1', '1.5', '2'] as const;

/**
 * Distances from the source, in metres, an ELF reading is normally taken at.
 *
 * Must contain every distance in ELF_PROFILE_DISTANCES above, and a smoke test says so.
 * A board table is *laid out* at those five distances, so a list missing one would open
 * twenty rows already sitting on a value the picker cannot offer — each of them landing
 * in "אחר" the moment it is touched, which is the opposite of the point.
 */
export const ELF_DISTANCE_OPTIONS = ['0.3', '0.5', '1', '1.5', '2'] as const;

/**
 * The distances an overhead power line is measured at, in metres.
 *
 * A different survey from a board or a cabinet, and the numbers say so: a board is
 * profiled at 0.3 to 2 metres because that is the span over which its field falls to
 * nothing and because that is how close a person can physically stand to it. A power
 * line is metres overhead and its field reaches far further, so the same profile would
 * take five readings inside the first two metres of a span that matters for fifteen —
 * and would ask the surveyor to stand 0.3 m from a conductor.
 *
 * Starts at 0, which is directly beneath the line rather than a distance from it. That
 * is the reading the rest of the profile is read against: the field is strongest under
 * the span and the question the survey answers is how far away it stops mattering.
 */
/** Every whole-metre distance in the requested range, including both endpoints. */
export const POWER_LINE_DISTANCE_OPTIONS = Array.from({ length: 26 }, (_, i) => String(i));
/** Existing eight-row layout; choosing a range must not create 26 draft rows. */
export const POWER_LINE_PROFILE_DISTANCES = ['0', '3', '8', '10', '12', '15', '20', '25'] as const;

/**
 * The sources measured as a power line — the ones the distances above belong to.
 *
 * All four voltage tiers, because the geometry is what decides the profile and it is
 * the same for every one of them: a conductor overhead, measured outward along the
 * ground. The voltage changes what the readings come out at, not where they are taken.
 *
 * A pole-mounted transformer belongs here too, added 2026-09-07. It is not a line, but
 * it is measured the same way and for the same reason: it sits up a pole in the street,
 * out of reach, and the question is how far along the ground its field still matters —
 * not what it reads at arm's length, which is a distance nobody can stand at.
 */
export const POWER_LINE_SOURCES = [
  'קו מתח נמוך',
  'קו מתח גבוה',
  'קו מתח עליון',
  'קו מתח על',
  'שנאי על עמוד',
  'חדר שנאים',
] as const;

/**
 * True when the survey is relative to a power line.
 *
 * A containment check over the multi-select field, the same shape as `isBoardSource`
 * and for the same reason: a survey that measures both a line and a board inside the
 * building selects both, and each table then offers what belongs to it.
 */
export function isPowerLineSource(fieldSource: string): boolean {
  return mentionsMeasurementSource(fieldSource, POWER_LINE_SOURCES);
}

/** Accept source selections and the prefixed/free-text "בדיקה ביחס" forms. */
function mentionsMeasurementSource(value: string, names: readonly string[]): boolean {
  const normalized = value.normalize('NFKC')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[־–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return names.some((name) => new RegExp(
    `(?:^|[\\s,;])(?:ל-?)?${name}(?=$|[\\s,;])`, 'i',
  ).test(normalized));
}

/** A specific board/UPS table keeps its short distances in a mixed survey. */
export function measurementDistanceOptions(fieldSource: string, referenceLabel = ''): readonly string[] {
  if (mentionsMeasurementSource(referenceLabel, ['לוח חשמל', 'UPS'])) return ELF_DISTANCE_OPTIONS;
  return isPowerLineSource(referenceLabel) || isPowerLineSource(fieldSource)
    ? POWER_LINE_DISTANCE_OPTIONS
    : ELF_DISTANCE_OPTIONS;
}

/** Keep measured rows and omit whole empty tables without altering the saved draft. */
export function measuredProtocols<R extends { measured: string }, P extends { rows: R[] }>(
  protocols: readonly P[],
): P[] {
  return protocols
    .map((protocol) => ({
      ...protocol,
      rows: protocol.rows.filter((row) => row.measured.trim() !== ''),
    }))
    .filter((protocol) => protocol.rows.length > 0);
}

/**
 * The heights a reading may be taken at, in metres, as a list to scroll.
 *
 * Whole metres from −30 to 30, opening at 0. The range is the one the surveyor asked
 * for and it is wider than any single survey needs, which is the point: a line crossing
 * a valley is measured from well below it and a rooftop from well above, and the list
 * has to hold both without anyone editing it.
 *
 * Both signs are real measurements rather than a quirk of the input. Height is measured
 * from the point of reference, so a reading taken below a line — or beneath a board, the
 * case this column already had a sign toggle for — is genuinely negative.
 *
 * Whole metres only, and that is a deliberate limit rather than an omission: a picker
 * holding every tenth of a metre over this range is 601 entries to scroll past. A survey
 * needing 1.5 m types it into "אחר", which is what that box is for.
 */
export const HEIGHT_OPTIONS = Array.from({ length: 61 }, (_, i) => String(i - 30));

/** Where the height list opens — directly at the point of reference. */
export const HEIGHT_DEFAULT = '0';

/**
 * The fixed opening of every protocol heading.
 *
 * The heading is one sentence — "פרוטוקול רשמי - מדידת שדה מגנטי ELF בלוח חשמל
 * ראשי" — but only its tail varies, and asking a surveyor to type the whole
 * thing meant retyping the same forty characters per table and getting them
 * subtly different each time. The field now holds the source alone and the
 * opening is added when the document is built.
 */
export const ELF_TITLE_PREFIX = 'פרוטוקול רשמי - מדידת שדה מגנטי ELF ב';
export const RF_TITLE_PREFIX = 'פרוטוקול רשמי - מדידת צפיפות הספק קרינה אלקטרומגנטית RF – ';

/** The heading as it is printed: the fixed opening, then the source. */
export function composeProtocolTitle(kind: 'elf' | 'rf', source: string): string {
  const prefix = kind === 'elf' ? ELF_TITLE_PREFIX : RF_TITLE_PREFIX;
  const name = stripProtocolPrefix(kind, source).trim();
  return name === '' ? prefix.trim() : `${prefix}${name}`;
}

/**
 * Removes the opening from a heading that already carries it.
 *
 * Reports written before this split stored the whole sentence in the field. Left
 * alone they would print the opening twice, and would show the surveyor a field
 * that is supposed to hold a source name with a full heading in it. Stripped on
 * the way in and on the way out, an old report simply starts behaving like a new
 * one.
 */
export function stripProtocolPrefix(kind: 'elf' | 'rf', title: string): string {
  const value = String(title ?? '');
  for (const prefix of [ELF_TITLE_PREFIX, RF_TITLE_PREFIX]) {
    if (value.startsWith(prefix)) return value.slice(prefix.length).trim();
    // The RF opening ends with a space that a stored value may not carry.
    const tight = prefix.trim();
    if (value.startsWith(tight)) return value.slice(tight.length).trim();
  }
  return value;
}

/**
 * The three cover fields that describe the site.
 *
 * Offered as lists because they are the same handful of answers on every
 * survey, and typed differently every time — "משרדים", "משרד", "מקום עבודה" —
 * which then reads as three different site kinds in the conclusions. "אחר"
 * opens a free field, because the list is the common case and not the whole
 * world.
 */
export const SITE_CHARACTER_OPTIONS = [
  'מגורים',
  'מקומות עבודה',
  'מוסדות חינוך',
  // Renamed 2026-09-07 from "הדיור הממשלתי": the 2 mG ceiling applies to government
  // buildings generally — offices as much as housing — and the old wording named only
  // the housing, so a survey of a government office had no entry that fitted it.
  // `GOVERNMENT_SITE_ALIASES` keeps reports written under the old name working.
  'משרדי ממשלה / מבנים ממשלתיים',
] as const;

/**
 * The government classification as it has been spelled over time.
 *
 * A stored report keeps the string that was chosen when it was written, and the
 * threshold and the appendix are both looked up by that string. Without the old name
 * here, renaming the option would silently move every existing government report from
 * the 2 mG ceiling to the workplace's 10 — the one direction a mistake must never go.
 */
export const GOVERNMENT_SITE_ALIASES = ['משרדי ממשלה / מבנים ממשלתיים', 'הדיור הממשלתי'] as const;

export const WEATHER_OPTIONS = ['חם', 'חם מאוד', 'קר', 'קר מאוד', 'נעים'] as const;

export const ANTENNA_CLASSIFICATION_OPTIONS = [
  'בית מגורים',
  'מוסד חינוך',
  'גן ילדים',
  'בית חולים / מרפאה',
  'משרדים',
  'מבנה ציבורי',
  'מבנה תעשייתי',
  'שטח פתוח',
] as const;

/**
 * The four faces of a distribution board, as the protocol names them.
 *
 * Offered only when the survey's source is a board, because that is the only
 * source these describe: a high-voltage line has no back panel and no right
 * side. Each carries the method with it — a slow scan, reading at the hot spot
 * — because that sentence is what makes the reading mean something, and typing
 * it forty times a survey is how it ends up worded four different ways.
 */
/**
 * The point above the board.
 *
 * Named apart from its siblings because it is the one that does not take the full
 * profile: above a board there is normally a ceiling a metre or so up, so the far
 * distances have nowhere to be measured from and would open rows that can never be
 * filled. See `boardPointDistances`.
 *
 * Also the reason the height column carries a sign — a reading taken above the board
 * and one taken below it are both "1 metre from it", and only the sign tells them apart.
 */
export const ABOVE_BOARD_POINT = 'מעל לוח החשמל - בוצעה סריקה איטית ובנקודה החמה נמדדה';

/**
 * The phrase every measurement point description ends with.
 *
 * A reading is not taken at a spot but across one: the surveyor sweeps the meter slowly
 * over the area and records the highest value it settles on. The description has to say
 * so — it is what makes the number in the next column mean "the worst reading here"
 * rather than "a reading here" — and the wording is the same on every row of every
 * report, which is exactly the sort of thing nobody should be retyping.
 *
 * So the surveyor writes where they stood, and this is appended when they confirm.
 * They can still delete or reword it afterwards: it is a completion, not a rule.
 */
export const SLOW_SCAN_SUFFIX = 'בוצעה סריקה איטית ונמדד';

/**
 * A point description with the slow-scan phrase on the end.
 *
 * Idempotent: a description that already says it — one of the board faces, which carry
 * their own wording, or a point being edited a second time — comes back unchanged
 * rather than saying it twice.
 */
export function withSlowScan(description: string): string {
  const text = description.trim();
  if (text === '') return text;
  // The board faces end in "סריקה איטית ובנקודה החמה נמדדה", which says the same
  // thing in more detail; appending to those would be redundant and wrong.
  if (/סריקה איטית/.test(text)) return text;
  return `${text} ${SLOW_SCAN_SUFFIX}`;
}

export const BOARD_POINT_OPTIONS = [
  'בחזית לוח החשמל - בוצעה סריקה איטית ובנקודה החמה נמדדה',
  'בגב לוח החשמל - בוצעה סריקה איטית ובנקודה החמה נמדדה',
  'בדופן השמאלית של לוח החשמל - בוצעה סריקה איטית ובנקודה החמה נמדדה',
  'בדופן הימנית של לוח החשמל - בוצעה סריקה איטית ובנקודה החמה נמדדה',
  // Last because it is the face walked last, and the only one that is not a side.
  ABOVE_BOARD_POINT,
] as const;

/**
 * A board table: every face, measured across the whole distance profile.
 *
 * Five distances per description, four descriptions — the shape the survey is actually
 * taken in, laid out so the surveyor types readings rather than building the grid. The
 * order is front, back, left, right: the order the faces are walked.
 *
 * Rows left unread do not reach the document — see `hasReading` in the mapper — so
 * laying out twenty costs nothing when a source is measured at six of them.
 */
export function boardProfileRows<T>(make: (description: string, distance: string) => T): T[] {
  return BOARD_POINT_OPTIONS.flatMap((description) =>
    boardPointDistances(description).map((distance) => make(description, distance)),
  );
}

/**
 * The distances one measurement point is laid out at.
 *
 * Two profiles, chosen by what is being measured rather than by what the point is
 * called. A board is profiled at 0.3–2 m: that is the span over which its field falls
 * away and the span a person can physically occupy beside it. A power line or a
 * pole-mounted transformer is metres overhead and its field reaches far further, so it
 * is profiled outward along the ground from directly beneath it — eight readings out to
 * 25 m, where 0.3 m is not a place anybody can stand.
 *
 * The exception is the point above a board, which gets the three near distances only: a
 * ceiling normally sits about a metre above a board, so 1.5 m and 2 m have nowhere to be
 * measured from and would open rows that can never be filled.
 *
 * `powerLine` is passed in rather than inferred from the description, because the
 * description is free text the surveyor writes — the survey's own field sources are what
 * actually decide which geometry applies. Defaulting it to false keeps every existing
 * caller on the board profile, which is what they all meant.
 */
export function boardPointDistances(description: string, powerLine = false): readonly string[] {
  // A named board face is a board reading whatever else the survey covers. A site with
  // both a line outside and a board inside selects both sources, and without this the
  // board's four faces would each open eight readings out to 25 m — distances that mean
  // nothing against a cabinet you can stand next to.
  const isBoardFace = (BOARD_POINT_OPTIONS as readonly string[]).includes(description.trim());
  if (powerLine && !isBoardFace) return POWER_LINE_PROFILE_DISTANCES;
  return description === ABOVE_BOARD_POINT ? ELF_PROFILE_DISTANCES.slice(0, 3) : ELF_PROFILE_DISTANCES;
}

/**
 * Whether a distribution board is among the survey's field sources.
 *
 * The field holds one *or more* sources joined by ", " (see FIELD_SOURCE_SEPARATOR),
 * so this asks "is a board one of them", not "is a board the only one" — a survey of
 * "אנטנות, לוח חשמל" still needs the four board faces offered on its measurement points.
 */
export function isBoardSource(fieldSource: string): boolean {
  return splitFieldSources(fieldSource).includes(FIELD_SOURCE_OPTIONS[0]);
}

/**
 * How several sources are joined into the single stored string, and how they read in
 * the merged document: "אנטנות, לוח חשמל".
 */
export const FIELD_SOURCE_SEPARATOR = ', ';

/**
 * The stored field split back into its parts.
 *
 * Tolerant on the way in — a comma with or without a space, and stray blanks — because
 * the value can also arrive from the free-text "אחר" box or from a report saved before
 * the field accepted more than one source.
 */
export function splitFieldSources(fieldSource: string): string[] {
  return fieldSource
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Several sources joined for storage and for the document. Order is the caller's. */
export function joinFieldSources(sources: readonly string[]): string {
  return sources.map((s) => s.trim()).filter(Boolean).join(FIELD_SOURCE_SEPARATOR);
}

/**
 * The small part of a report that decides whether an antenna-map appendix is mandatory.
 *
 * Kept structural (rather than importing `Report`) because `report-schema` already imports
 * this module. It also lets the same rule run against drafts while they are being edited.
 */
type AntennaMapSelection = {
  fieldSource?: string | null;
  elfProtocols?: readonly { referenceLabel?: string | null }[] | null;
  rfProtocols?: readonly { referenceLabel?: string | null }[] | null;
  antennaMapEnabled?: boolean | null;
};

/** Matches אנטנה, אנטנות, לאנטנה and free-text English equivalents. */
function mentionsAntenna(value: string | null | undefined): boolean {
  const normalized = (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0591-\u05c7\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  return normalized.includes('אנטנ') || /\bantennas?\b/i.test(normalized);
}

/**
 * Whether the survey itself requires the complete antenna appendix.
 *
 * Antennas can be selected globally under "מקורות הקרינה שנבדקו", or locally
 * under "בדיקה ביחס ל" on any ELF/RF protocol. Either is authoritative; the
 * manual appendix switch is deliberately not involved in this decision.
 */
export function reportRequiresAntennaMap(report: AntennaMapSelection): boolean {
  if (mentionsAntenna(report.fieldSource)) return true;
  return [...(report.elfProtocols ?? []), ...(report.rfProtocols ?? [])]
    .some((protocol) => mentionsAntenna(protocol.referenceLabel));
}

/** The effective appendix setting: mandatory from the survey, or explicitly requested. */
export function shouldIncludeAntennaMap(report: AntennaMapSelection): boolean {
  return reportRequiresAntennaMap(report) || report.antennaMapEnabled === true;
}

/**
 * How the field is titled — on screen and, more to the point, as the printed label of
 * the line in the report ("מקורות הקרינה שנבדקו: אנטנות, לוח חשמל.").
 *
 * Named once here because it is written in three places that must agree: the editor's
 * caption, the field map shown on the templates screen, and the line the template build
 * writes into the document. Renamed 2026-08-30 from "מקור שדה אל מ״ג" — the old wording
 * named one kind of field, while the line lists whatever was surveyed.
 *
 * Note the plain `"` here versus the typographic `״` the on-screen caption used to carry:
 * the document is built from this string, so it is the one that has to be right.
 */
export const FIELD_SOURCE_LABEL = 'מקורות הקרינה שנבדקו';

/**
 * How the person present at the survey is titled, on screen and in the report.
 *
 * Renamed 2026-08-30 from "שם המבקש": the name on this line is whoever accompanied the
 * surveyor on site, which is not always the person who ordered the job. Printed as a
 * line of its own ("יבוצע בנוכחות: …"), so this is the wording that reaches the document
 * — the template's own text is replaced to match.
 */
export const REQUESTER_LABEL = 'יבוצע בנוכחות';

export const FIELD_SOURCE_OPTIONS = [
  // 'לוח חשמל' must stay first: isBoardSource identifies a board by this entry's
  // position, and the four board faces hang off it.
  'לוח חשמל',
  // Rooms rather than cabinets, so deliberately *not* board sources: the board point
  // descriptions ("בחזית לוח החשמל", "בדופן הימנית…") describe faces of a cabinet and
  // read as nonsense against a room. A survey that measures both the room and a board
  // inside it selects both, and isBoardSource — a containment check — still offers the
  // faces.
  'חדר שנאים',
  // A pole-mounted transformer, which is a source in its own right: it sits outside the
  // building and is measured at a distance, so it is neither a transformer room nor a
  // line. Deliberately not a board source — it has no faces to profile.
  'שנאי על עמוד',
  'חדר חשמל',
  'אנטנות',
  'קו מתח נמוך',
  'קו מתח גבוה',
  'קו מתח עליון',
  'קו מתח על',
  'UPS',
  // Not a source at all — the reading with no identifiable source behind it.
  'רקע',
] as const;

/**
 * The radiating sources, worded for the "בדיקה ביחס ל…" line.
 *
 * The template prints the stored value straight after the words "בדיקה ביחס", so the
 * value has to carry the ל — "בדיקה ביחס ללוח חשמל" — which is why these are prefixed
 * here rather than reusing FIELD_SOURCE_OPTIONS as they stand. "רקע" is left out: it is
 * the reading with no source behind it, so there is nothing to measure relative to.
 *
 * Prefixing is a plain "ל" + the name. Hebrew would sometimes want לְ־ה ("ללוח") versus a
 * bare noun, but every entry here reads correctly with the simple form, and the existing
 * saved values ("ללוח חשמל דרומי") are written exactly this way.
 */
export const REFERENCE_SOURCE_OPTIONS = FIELD_SOURCE_OPTIONS.filter((o) => o !== 'רקע').map(
  // These are bare source names by construction, so the prefix is applied directly
  // rather than through withReferencePrefix — which runs at module load, before the
  // name table it consults has initialised.
  (o) => (/^[A-Za-z]/.test(o) ? `ל-${o}` : `ל${o}`),
);

/**
 * The RF-specific references, without the ל — the three that predate the shared list,
 * plus the seating points.
 *
 * Named here rather than read off RF_REFERENCE_OPTIONS because that list is built from
 * this one further down, and the prefix helpers above it need the bare names.
 */
/**
 * The reference that is a place rather than a source.
 *
 * Named because it behaves differently from the rest: the same chairs are surveyed in
 * both ranges on one walk, so choosing it on an ELF table mirrors the point descriptions
 * into a matching RF table (see `setElfReference` in the protocols editor).
 */
export const SEATING_REFERENCE = 'נקודות ישיבה';

const RF_ONLY_REFERENCES = ['אנטנות בסביבה', 'ארון תקשורת', 'wifi', SEATING_REFERENCE] as const;

/**
 * Every name the reference field can hold, in its bare form.
 *
 * Used to tell a ל that is a prefix from a word that merely starts with one: "ללוח חשמל"
 * strips to a known name, "לובי הבניין" does not.
 */
const REFERENCE_BARE_NAMES: readonly string[] = [...FIELD_SOURCE_OPTIONS, ...RF_ONLY_REFERENCES];

/**
 * The ל the "בדיקה ביחס" line needs, added only where it is missing.
 *
 * The template prints the stored value straight after the words "בדיקה ביחס", so the
 * value has to carry the ל to read as a sentence. But the value comes from three places
 * that do not agree: the RF options predate this and are stored bare ("ארון תקשורת"),
 * the source options carry it ("ללוח חשמל"), and the "אחר" box is whatever was typed —
 * with or without. Adding the prefix at print time rather than at entry lets all three
 * be right, and leaves every report already saved alone.
 *
 * A Latin-script name takes the prefix as a separate word: "לUPS" runs the ל into the
 * acronym and reads as one garbled token in a line that is otherwise all Hebrew.
 *
 * Known names are recognised whether or not they carry the ל. Free text typed into the
 * "אחר" box is only recognised as already-prefixed when the ל is followed by a known
 * name — "למנוע מעלית" is indistinguishable from a surveyor typing "מנוע מעלית" with
 * the prefix themselves, and no rule over the string alone can tell those apart. That is
 * why this is applied once, at merge time, to the stored value: the stored value is
 * always what was typed, never this function's own output.
 */
export function withReferencePrefix(value: string): string {
  const name = value.trim();
  if (name === '') return '';
  if (hasReferencePrefix(name)) return name;
  return /^[A-Za-z]/.test(name) ? `ל-${name}` : `ל${name}`;
}

/**
 * Whether the value already opens with the prefix.
 *
 * "ל-UPS" and "ללוח" carry it. A word that merely begins with ל does not — "לוח חשמל"
 * is a board, not "to a חשמל", and prefixing it again would print "ללוח חשמל" from a
 * value the surveyor typed as "לוח חשמל". The two are told apart by what follows: the
 * prefix form is ל + hyphen, or ל + another ל (ללוח), or ל + a word that is itself a
 * known source.
 */
function hasReferencePrefix(name: string): boolean {
  if (/^ל-/.test(name)) return true;
  if (!/^ל/.test(name)) return false;
  const rest = name.slice(1).trim();
  // "ללוח חשמל" → rest is "לוח חשמל", a name in its own right: the ל is a prefix.
  // Checked against every name the field can hold — the field sources *and* the RF
  // references — because both reach this line and either can be stored with the ל
  // already on it.
  return REFERENCE_BARE_NAMES.some((o) => rest === o || rest.startsWith(`${o} `));
}

/**
 * What an RF protocol is measured against.
 *
 * The reference decides how the table is filled in, which is why it is a list:
 * a communications cabinet is measured as a distance profile, and antennas in
 * the surroundings are not measured against anything at a fixed distance at
 * all. "אחר" leaves it blank for the surveyor to write.
 *
 * The three RF-specific entries come first because they are what an RF protocol is
 * usually measured against; the field sources follow so the same list serves both
 * kinds of table.
 */
export const RF_REFERENCE_OPTIONS = [
  // The RF references — including "נקודות ישיבה", not a source but a place, the
  // reading taken where people actually sit.
  ...RF_ONLY_REFERENCES,
  // Every field source, prefixed with ל, so the same list serves an RF table too.
  ...REFERENCE_SOURCE_OPTIONS,
] as const;

/**
 * What an ELF protocol is measured against.
 *
 * The field sources, and only those. The two lists used to be one, which offered every
 * RF reference on an ELF table and every field source on an RF one — so a surveyor
 * measuring a distribution board was offered "wifi", and one measuring a communications
 * cabinet was offered "קו מתח עליון". Neither is a thing that range is measured
 * against, and a picker that offers impossible answers is slower to use than a short
 * one, not more flexible: the "אחר" box is still there for the genuine exception.
 *
 * Antennas, cabinets and wifi are radio-frequency sources and appear on the RF list
 * alone; the mains-frequency sources appear here.
 */
export const ELF_REFERENCE_OPTIONS = REFERENCE_SOURCE_OPTIONS.filter(
  // Antennas are a radio-frequency source; a magnetic-field table is never measured
  // against one. It stays on the field-source list, which is a different question —
  // "what was surveyed here" rather than "what is this table measured against".
  (option) => !option.includes('אנטנות'),
);

/**
 * What was measured. One choice, not several — a survey is magnetic field, power density,
 * or the combined survey that covers both, and "combined" is its own wording rather than
 * the other two joined.
 *
 * Was a free-text box until 2026-08-30; the list is the same three phrasings that were
 * being typed by hand, which is what the conclusions and the ELF/RF section headings are
 * worded against. "אחר…" in the picker still allows a one-off wording.
 */
export const MEASUREMENT_TYPE_OPTIONS = [
  'מדידות שדה מגנטי',
  'מדידות משולבת שדה מגנטי וצפיפות הספק',
  'מדידות צפיפות הספק',
] as const;

/** Height above the floor, in metres. */
export const ELF_DEFAULT_HEIGHT = '1';

/**
 * How long people are at the point.
 *
 * Exactly two, because it decides which guidance applies: a continuously
 * occupied point is judged against the long-term reference, a transient one is
 * not.
 */
export const ELF_OCCUPANCY_OPTIONS = ['קבועה', 'לא קבועה'] as const;

/**
 * The verdict wordings used in the ELF protocols.
 *
 * "לא חורג, חשיפה רגעית" records a high reading at a point nobody stays at —
 * compliant, but worth saying why. "חורג" has to remain available: a survey
 * that cannot record an exceedance cannot do its job.
 */
export const ELF_COMPLIANCE_OPTIONS = ['לא חורג', 'לא חורג, חשיפה רגעית', 'חורג'] as const;

/**
 * The exposure ceiling, in mG, by what the place is.
 *
 * There is no single ELF threshold: a school and a workplace are held to
 * different numbers because the people in them are there for different reasons
 * and different lengths of time. Treating them all as the workplace's 10 mG —
 * which this did — passed a reading of 5 mG at a desk in a school, where the
 * limit is 4.
 *
 * Keyed by the site characterization, which is why that field is a list and not
 * free text: "משרדים" and "מקום עבודה" typed on two surveys would otherwise be
 * two different thresholds, or none.
 */
export const SITE_THRESHOLDS: Record<string, number> = {
  מגורים: 4,
  'מוסדות חינוך': 4,
  'מקומות עבודה': 10,
  // Both spellings map to the same 2 mG, so a report written before the rename keeps
  // the ceiling it was judged against. See `GOVERNMENT_SITE_ALIASES`.
  'משרדי ממשלה / מבנים ממשלתיים': 2,
  'הדיור הממשלתי': 2,
};

/**
 * The ceiling that applies to a survey, in mG.
 *
 * Falls back to the workplace's 10 when the characterization has not been
 * chosen yet. That is the most permissive of the four, and deliberately so: a
 * verdict computed before the surveyor has said what the place is should not
 * accuse a reading of exceeding a limit nobody has established.
 */
export function elfThreshold(siteCharacter: string): number {
  return SITE_THRESHOLDS[siteCharacter.trim()] ?? 10;
}

/** Recommended ceiling for a workplace at 8 hours a day, in mG. */
export const ELF_WORKPLACE_THRESHOLD = 10;

/**
 * Instantaneous maximum for the public, in mG.
 *
 * Exceeded, occupancy stops mattering. Corrected 2026-09-07 from 2,000 to 1,000, which
 * is the figure the conclusions are to state.
 */
export const ELF_INSTANTANEOUS_THRESHOLD = 1000;

/**
 * The two fixed sentences that open the ELF conclusions, by what the place is.
 *
 * The conclusions state the rules before arguing the findings, and those rules are not
 * the same everywhere: a school is held to 4 mG for continuous occupancy, a workplace to
 * 10 over an eight-hour day, a government building to 2. The template carries the
 * workplace pair alone, so a school survey stated the workplace standard beside tables
 * that had been judged against the school's — see `applyConclusionPreamble`, which is
 * what puts the right pair into the document.
 *
 * Written out per site rather than assembled from the threshold number, because the
 * sentences differ in more than the figure: the workplace one qualifies itself with the
 * eight-hour day, and the school and government ones name the population they protect.
 */
export interface ConclusionPreamble {
  /** The instantaneous-exposure sentence. Identical everywhere but the number. */
  instantaneous: string;
  /** The long-term recommendation, which is where the sites genuinely differ. */
  longTerm: string;
}

const INSTANTANEOUS = `חשיפה רגעית מרבית המותרת של בני אדם לשדה מגנטי משתנה בתדר 50 הרץ הינה ${ELF_INSTANTANEOUS_THRESHOLD} מיליגאוס.`;

const CONCLUSION_PREAMBLES: Record<string, ConclusionPreamble> = {
  'מקומות עבודה': {
    instantaneous: INSTANTANEOUS,
    longTerm:
      'רמת הקרינה המומלצת לחשיפה ממושכת ע"פ המשרד להגנת הסביבה בישראל במקומות עבודה הינה עד 10 מילי גאוס (לחשיפה של 8 שעות ביממה).',
  },
  'מוסדות חינוך': {
    instantaneous: INSTANTANEOUS,
    longTerm:
      'רמת הקרינה המומלצת לחשיפה ממושכת ע"פ המשרד להגנת הסביבה בישראל במוסדות חינוך הינה עד 4 מילי גאוס (ממוצע על פני 24 שעות), בהתאם להמלצת הארגון הבינלאומי לחקר הסרטן (IARC) ולעקרון הזהירות המונעת, המקבל משנה תוקף במקום שבו שהיית הילדים קבועה וממושכת.',
  },
  מגורים: {
    instantaneous: INSTANTANEOUS,
    longTerm:
      'רמת הקרינה המומלצת לחשיפה ממושכת ע"פ המשרד להגנת הסביבה בישראל באזורי מגורים הינה עד 4 מילי גאוס (ממוצע על פני 24 שעות), בהתאם להמלצת הארגון הבינלאומי לחקר הסרטן (IARC).',
  },
  'משרדי ממשלה / מבנים ממשלתיים': {
    instantaneous: INSTANTANEOUS,
    longTerm:
      'רמת הקרינה המומלצת לחשיפה ממושכת במשרדי ממשלה ובמבנים ממשלתיים הינה עד 2 מילי גאוס (ממוצע על פני 24 שעות), כמדיניות של זהירות מונעת.',
  },
};

/**
 * The preamble that applies to a survey.
 *
 * Falls back to the workplace pair for a site typed by hand through "אחר" or for a
 * report written before the list existed — the wording every report carried until now,
 * so an unrecognised characterization changes nothing rather than emptying the section.
 */
export function conclusionPreambleFor(siteCharacter: string): ConclusionPreamble {
  const character = siteCharacter.trim();
  if ((GOVERNMENT_SITE_ALIASES as readonly string[]).includes(character)) {
    return CONCLUSION_PREAMBLES['משרדי ממשלה / מבנים ממשלתיים'];
  }
  return CONCLUSION_PREAMBLES[character] ?? CONCLUSION_PREAMBLES['מקומות עבודה'];
}

/**
 * The verdict a row's own numbers point to.
 *
 * A suggestion, not a ruling: it fills the column when the surveyor has not
 * chosen, and whatever they choose wins. That is the difference from the RF
 * side, where the verdict follows from the reading alone and is recomputed over
 * anything stored.
 *
 * Both inputs are needed, which is why this could not be a default on a new
 * row: the same 133 mG is an exceedance at a desk and a transient reading in a
 * corridor. A blank verdict is returned when there is no reading to judge — a
 * half-filled row should show nothing rather than a verdict with no basis.
 *
 * Filling it matters beyond the table. Left blank, the column printed empty in
 * the delivered report, and the conclusions were drafted from "טרם סומנו".
 */
export function elfCompliance(normalized: string, occupancy: string, siteCharacter = ''): string {
  const value = toNumber(normalized);
  if (value === null) return '';

  // Above the instantaneous limit nobody may be exposed at all, however briefly.
  if (value > ELF_INSTANTANEOUS_THRESHOLD) return ELF_COMPLIANCE_OPTIONS[2];

  const limit = elfThreshold(siteCharacter);
  if (value <= limit) return ELF_COMPLIANCE_OPTIONS[0];

  // Over the limit, and the answer turns on how long anyone is there: a desk in
  // a school is an exceedance at 5 mG, the corridor outside it is not.
  const continuous = occupancy.trim() === ELF_OCCUPANCY_OPTIONS[0];
  return continuous ? ELF_COMPLIANCE_OPTIONS[2] : ELF_COMPLIANCE_OPTIONS[1];
}

/**
 * The reading after normalization.
 *
 * The normalization coefficient accounts for the load at the time of
 * measurement: a reading taken at typical load is scaled to the maximum the
 * installation can draw. Multiplying is the whole rule, and doing it here means
 * the two columns can never disagree.
 *
 * Returns '' when either number is missing, so a half-filled row shows nothing
 * rather than a figure it has no basis for.
 */
export function elfNormalized(measured: string, factor: string): string {
  const value = toNumber(measured);
  const coefficient = toNumber(factor);
  if (value === null || coefficient === null) return '';

  const result = value * coefficient;
  // Kept to the precision a field meter actually reports; trailing zeros from
  // the multiplication are noise, not significant figures.
  return String(Number(result.toFixed(4)));
}

/** A new ELF row, with everything derivable already in place. */
export function newElfRow(distance = '') {
  return {
    description: '',
    distance,
    height: ELF_DEFAULT_HEIGHT,
    measured: '',
    normalized: '',
    occupancy: ELF_OCCUPANCY_OPTIONS[1],
    // Deliberately blank. Starting at "לא חורג" meant a row read 20 mG and
    // still reported itself compliant, because nobody had touched the column —
    // and the conclusions were then drafted from "אף נקודה אינה חורגת".
    // Unlike RF this cannot be computed: it depends on how long people stay.
    compliance: '',
  };
}

/** What an ELF row is still missing. */
export function missingElfFields(row: {
  description: string;
  measured: string;
  compliance?: string;
}): string[] {
  const missing: string[] = [];
  if (row.description.trim() === '') missing.push('תיאור נקודת המדידה');
  if (row.measured.trim() === '') missing.push('צפיפות השטף המגנטי שנמדדה');
  if ((row.compliance ?? '').trim() === '') missing.push('חורג / לא חורג');
  return missing;
}
