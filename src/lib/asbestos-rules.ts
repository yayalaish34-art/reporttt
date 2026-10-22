import type { AsbestosReport, BuildingRow, FindingRow } from './asbestos-schema';

/**
 * The rules the asbestos opinion follows.
 *
 * There is very little arithmetic in this report and exactly one piece that
 * matters: the summary states a total area, and that total is the sum of the
 * findings. In the source document it was typed by hand — "בגודל כולל של כ-48
 * מ"ר" against findings of 27 metres, 5 m² and 16 m² — and a hand-typed total is
 * the number that goes stale when a finding is added on site.
 */

/** Parses an area cell, which is free text and may be blank or carry a unit. */
export function toNumber(value: string): number | null {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[^\d.,-]/g, '')
    .replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** The findings the surveyor actually wrote — a blank row is an empty editor line. */
export function realFindings(report: Pick<AsbestosReport, 'findings'>): FindingRow[] {
  // Either shape counts as a real finding: a sentence the surveyor typed, or the
  // structured facts the wording is composed from. Testing the text alone dropped every
  // finding recorded through the fields before it had been worded — which is the state
  // every finding is in until the document is produced.
  return report.findings.filter((f) => f.text.trim() !== '' || f.element.trim() !== '');
}

/**
 * The total area, as the summary prints it.
 *
 * Rounded to a whole number and given the unit, because that is the form the
 * sentence takes: "בגודל כולל של כ-48 מ"ר". Returns '' when nothing has an area
 * yet, so an unfinished report does not claim a total of zero.
 */
export function totalArea(report: Pick<AsbestosReport, 'findings'>): string {
  const areas = realFindings(report)
    .map((f) => toNumber(f.area))
    .filter((n): n is number => n !== null);
  if (areas.length === 0) return '';
  const sum = areas.reduce((a, b) => a + b, 0);
  // Whole metres unless the sum genuinely is not one — a survey adding up to
  // 27.5 m² should not print as 28.
  const rounded = Math.round(sum * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} מ"ר`;
}

/** True when anything at all was found — gates the demolition sentence. */
export function hasFindings(report: Pick<AsbestosReport, 'findings'>): boolean {
  return realFindings(report).length > 0;
}

/**
 * True when a finding is buried or inside a wall.
 *
 * This is what the soil-contamination sentence follows from. Stated per finding
 * rather than asked as a separate question, because it is a property of the
 * piping and not of the survey.
 */
export function hasBuried(report: Pick<AsbestosReport, 'findings'>): boolean {
  return realFindings(report).some((f) => f.buried === 'כן');
}

/** A new finding row. Nothing carries over — each element is its own description. */
export function newFindingRow(): FindingRow {
  return {
    text: '',
    element: '',
    quantity: '',
    placement: '',
    dimensions: '',
    condition: '',
    area: '',
    buried: 'לא',
    photos: [],
  };
}

/**
 * The remedial actions a surveyor prescribes for a building.
 *
 * Free text was the first shape of this field, and it produced what free text always
 * produces on a field with a settled vocabulary: the same instruction written four ways
 * across four reports, so a reader could not tell whether "ניקוי הגג" and "לנקות את הגג"
 * meant the same requirement. These are the actions Galit actually prescribes.
 *
 * Painting is three entries rather than one with a slash, because which side is painted
 * is the instruction — a contractor reading "מצידם הפנימי / חיצוני / גם וגם" has been
 * told the options, not the job.
 *
 * More than one may apply to a building, and often does: a roof is cleaned and its
 * lichen removed and then painted. They are stored joined by ", " — the same convention
 * the radiation report uses for its field sources — so the document prints them as one
 * sentence without the template needing to know how many there were.
 */
export const INSTRUCTION_OPTIONS = [
  'ניקוי הגג',
  'גיזום צמחייה נושקת לאסבסט',
  'צביעת לוחות האסבסט מצידם הפנימי',
  'צביעת לוחות האסבסט מצידם החיצוני',
  'צביעת לוחות האסבסט משני הצדדים',
  'תיקון שברים באמצעות סנטף',
  'ניקוי פטריית החזזית',
  'החלפה ופינוי האסבסט',
] as const;

/** How several instructions are joined for storage and for the printed document. */
export const INSTRUCTION_SEPARATOR = ', ';

/**
 * The answers offered for each of the building rows.
 *
 * A survey is filled in standing in front of the building, on a phone, and the
 * twelve rows were twelve free-text boxes — which is a lot of typing for answers
 * that are nearly always one of a handful of words. These are those words, taken
 * from the answers Galit's own reports actually give.
 *
 * They are offered, never enforced. Every field keeps its free-text box, because
 * the real answers include "לא ניתן לראות- בוצע עליהם שיפוץ חיפוי גבס" and
 * "יש- לא רלוונטי גג רעפים" — a picker alone would flatten those into "לא" and
 * throw away the reason, which is the part a reader needs. So the list is a
 * shortcut for the common case and not a constraint on the uncommon one.
 *
 * A field absent from this map has no shortcut and stays a plain text box: the
 * building's name and its approximate area are different every time, and a list
 * of guesses in front of them would be noise.
 *
 * `multi` marks the rows where more than one answer genuinely applies — sheeting
 * can be both cracked and worn, and a survey that had to choose between them
 * would be recording less than it saw.
 */
export const BUILDING_OPTIONS: Partial<
  Record<keyof BuildingRow, { options: readonly string[]; multi?: boolean }>
> = {
  use: {
    options: [
      'בית מגורים',
      'שטח עבודה בעסק',
      'משרד',
      'מחסן',
      'סככה',
      'מבנה חקלאי',
      'מבנה ציבור',
      'מבנה נטוש',
    ],
  },
  appearance: {
    options: [
      'גג',
      'סככה פתוחה',
      'קיר חיצוני',
      'קיר פנימי',
      'מחיצה',
      'צנרת',
      'מיכל מים',
      'ארובה',
    ],
    multi: true,
  },
  barrier: {
    options: ['אין', 'תקרת גבס', 'תקרה אקוסטית', 'תקרת בטון', 'בידוד', 'לא ניתן לראות'],
  },
  moisture: { options: ['אין', 'יש', 'רטיבות קלה', 'לא ניתן לראות'] },
  // The five conditions the source table names, in its own order and wording.
  sheetCondition: {
    options: ['תקינים', 'שבורים', 'סדוקים', 'שחוקים', 'מתפוררים'],
    multi: true,
  },
  edgeCondition: {
    options: ['תקין', 'שבור', 'סדוק', 'שחוק', 'מתפורר'],
    multi: true,
  },
  debris: { options: ['לא', 'כן'] },
  painted: { options: ['לא', 'צבועים מבפנים', 'צבועים מבחוץ', 'צבועים משני הצדדים'] },
  roofCover: { options: ['לא', 'חזזיות', 'יריעות ביטומן', 'צמחייה', 'לא רלוונטי'], multi: true },
  friable: { options: ['לא נצפה', 'נצפה'] },
};

/**
 * The stored field split back into its parts.
 *
 * Tolerant on the way in — a comma with or without a space, stray blanks — because the
 * value also arrives from the free-text box beside the list, and from buildings written
 * before the list existed, where "אין" was typed by hand.
 */
export function splitInstructions(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Several instructions joined for storage. Order is the caller's. */
export function joinInstructions(values: readonly string[]): string {
  return values.filter((v) => v.trim() !== '').join(INSTRUCTION_SEPARATOR);
}

/**
 * A blank building for the tabled opinion.
 *
 * Every field starts empty rather than pre-answered: "לא" is the commonest answer to
 * several of these rows, but pre-filling it would let an unvisited building print a full
 * set of confident answers nobody gave.
 */
export function newBuildingRow(): BuildingRow {
  return {
    // No pictures until the surveyor takes one; the button sits under the table.
    photos: [],
    name: '',
    use: '',
    appearance: '',
    barrier: '',
    area: '',
    moisture: '',
    sheetCondition: '',
    edgeCondition: '',
    debris: '',
    painted: '',
    roofCover: '',
    friable: '',
    instructions: '',
  };
}

/**
 * The buildings the surveyor actually recorded.
 *
 * A nameless row is usually an empty editor line, and printing an empty fifteen-row
 * table for it is worse than printing nothing. But "left unfilled" is not the same as
 * "unnamed": a building with photographs attached is one somebody stood in front of
 * and photographed, and dropping it discarded those pictures from the finished
 * document without a word — which is exactly how a photograph taken on site failed to
 * reach the report.
 *
 * So the test is whether anything was recorded at all; the name is only the most
 * common way for that to be true.
 */
export function realBuildings(report: Pick<AsbestosReport, 'buildings'>): BuildingRow[] {
  return report.buildings.filter((b) => b.name.trim() !== '' || b.photos.length > 0);
}

/**
 * The labels the summary drafting sends with each answer.
 *
 * Shortened from the table's own headings, which carry parenthetical examples —
 * "מופע אסבסט (גגות, סככה פתוחה, קיר חיצוני/פנימי וכו׳)" — that are there to
 * prompt a surveyor and would read to the model as a list of things that were
 * found. The question is the same; only the prompting is dropped.
 */
/** The text answers only — `photos` is a list of images, not something to describe. */
type BuildingTextKey = {
  [K in keyof BuildingRow]: BuildingRow[K] extends string ? K : never;
}[keyof BuildingRow];

const SUMMARY_LABELS: Array<[BuildingTextKey, string]> = [
  ['use', 'שימוש'],
  ['appearance', 'מופע אסבסט'],
  ['barrier', 'תקרת ביניים / חומר חוצץ'],
  ['area', 'שטח אסבסט מקורב'],
  ['moisture', 'רטיבות'],
  ['sheetCondition', 'מצב הלוחות'],
  ['edgeCondition', 'מצב שולי הלוחות'],
  ['debris', 'שברי לוחות על הקרקע'],
  ['painted', 'לוחות צבועים'],
  ['roofCover', 'כיסוי הגגות'],
  ['friable', 'אסבסט פריך'],
  ['instructions', 'הנחיות שסומנו'],
];

/**
 * The building tables, reduced to what the summary drafting needs.
 *
 * Unanswered rows are dropped rather than sent as empty strings: a model handed
 * "רטיבות: " tends to write about the absence of moisture, and a row nobody
 * answered is not a finding of "no". Only what the surveyor actually recorded
 * reaches the draft.
 */
export function buildingsForSummary(
  report: Pick<AsbestosReport, 'buildings'>,
): Array<{ name: string; answers: Array<[string, string]> }> {
  return realBuildings(report).map((building) => ({
    name: building.name.trim(),
    answers: SUMMARY_LABELS.filter(([key]) => building[key].trim() !== '').map(
      ([key, label]) => [label, building[key].trim()] as [string, string],
    ),
  }));
}

export interface AsbestosFindings {
  count: number;
  total: string;
  buried: FindingRow[];
  siteDescription: string;
}

export function computeAsbestosFindings(report: AsbestosReport): AsbestosFindings {
  const rows = realFindings(report);
  return {
    count: rows.length,
    total: totalArea(report),
    buried: rows.filter((f) => f.buried === 'כן'),
    siteDescription: report.siteDescription,
  };
}

/** Hebrew for a small count, so a sentence reads "שלושה ממצאים" and not "3". */
const HEBREW_COUNT = ['', 'ממצא אחד', 'שני ממצאים', 'שלושה ממצאים', 'ארבעה ממצאים', 'חמישה ממצאים',
  'שישה ממצאים', 'שבעה ממצאים', 'שמונה ממצאים', 'תשעה ממצאים', 'עשרה ממצאים'];

/**
 * The findings as a brief for the model, in the shape the other reports use.
 *
 * Only used where the template offers a highlighted passage to reword. The
 * source opinion has none — its closing sentences are fields the surveyor
 * edits — so this normally goes unused, and exists so that a future template
 * which does mark a passage behaves like the other two rather than silently
 * doing nothing.
 */
export function describeAsbestosFindings(f: AsbestosFindings): string {
  const lines: string[] = [];
  if (f.count === 0) {
    lines.push('לא נמצאו אלמנטים עשויים אסבסט — אין לרמוז על ממצא או על צורך בפינוי.');
    return lines.join('\n');
  }

  lines.push(`נמצאו ${f.count} ממצאים (${HEBREW_COUNT[f.count] || `${f.count} ממצאים`}).`);
  if (f.total) lines.push(`השטח הכולל: ${f.total}.`);
  if (f.siteDescription) lines.push(`תיאור המקום: ${f.siteDescription}`);
  if (f.buried.length > 0) {
    lines.push(
      'חלק מהאלמנטים קבורים או בתוך קירות, ולכן קיים פוטנציאל לנוכחות אסבסט בקרקע.',
    );
  }
  lines.push('זהו סקר ויזואלי ולא בדיקת מעבדה — אין לציין סוגי סיבים, ריכוזים או תוצאות מעבדה.');
  return lines.join('\n');
}

