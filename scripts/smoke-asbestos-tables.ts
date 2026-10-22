/**
 * Checks the tabled asbestos opinion.
 *
 * Galit issues the opinion in two shapes and they are different documents: the prose form
 * states findings as sentences, the tabled form puts every building to the same thirteen
 * questions. This covers the second, and in particular the two ways its template broke
 * while it was being built — both of which produced a file Word offers to repair rather
 * than an obviously wrong one, so a check on the visible text alone would have passed.
 *
 *   npx tsx scripts/smoke-asbestos-tables.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { mergeDocx } from '../src/lib/docx/merge-docx';
import { buildAsbestosMergeData } from '../src/lib/asbestos-mapper';
import {
  CONDITION_OPTIONS,
  DraftAsbestosReportSchema,
  ELEMENT_OPTIONS,
  PLACEMENT_OPTIONS,
  parseIssuableReport,
  type AsbestosReport,
} from '../src/lib/asbestos-schema';
import {
  BUILDING_OPTIONS,
  INSTRUCTION_OPTIONS,
  buildingsForSummary,
  realBuildings,
  joinInstructions,
  newBuildingRow,
  newFindingRow,
  splitInstructions,
} from '../src/lib/asbestos-rules';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(resolve(ROOT, 'templates/asbestos-tables-template.docx'));

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const textOf = (xml: string) =>
  (xml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('');

/**
 * Every opened tag closed, in order.
 *
 * This is what Word actually refuses over, and it is the check both template bugs needed:
 * a field written after a cell's closing tag, and a run placed before `<w:pPr>`, each
 * produced a document whose *text* was perfectly correct.
 */
function wellFormed(xml: string): string | null {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)(w:[a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m;
    if (self === '/' || attrs.endsWith('/')) continue;
    if (close) {
      if (stack.pop() !== tag) return `סגירה לא תואמת: ${tag}`;
    } else stack.push(tag);
  }
  return stack.length ? `תגים לא נסגרו: ${stack.slice(0, 3).join(', ')}` : null;
}

const building = (name: string, use: string, area: string) => ({
  ...newBuildingRow(),
  name,
  use,
  area,
  appearance: 'קירות חיצוניים',
  friable: 'לא',
  instructions: 'אין',
});

const report = DraftAsbestosReportSchema.parse({
  referenceNumber: '2609020001',
  reportDate: 'נובמבר 2025',
  layout: 'tables',
  clientName: 'רחל כהן',
  siteAddress: 'עליית הנוער 13, הוד השרון',
  asbestosKind: 'צמנט ופריך',
  siteDescription: 'בית חולים ציבורי.',
  buildings: [building('ביתן 3', 'משרד משק', '50'), building('בית ספר שלוותה', 'בית ספר', '200')],
  /**
   * The closing bullets, as the drafting step leaves them.
   *
   * The tabled opinion prints these and not `findings`: its summary is drafted from
   * the building tables, and a stale row left over in the prose form's field must not
   * reach the page. The stray finding below is here to prove exactly that.
   */
  summaryBullets: [
    'במבנים בית ספר שלוותה וביתן 3 קירות חיצוניים עשויים אסבסט צמנט.',
    'יש לצבוע קירות חיצוניים בבית ספר שלוותה ובביתן 3 אחת לשלוש שנים.',
  ],
  findings: [{ ...newFindingRow(), text: 'שורה ישנה שאסור שתודפס בדוח טבלאות.' }],
}) as AsbestosReport;

const merged = mergeDocx(TEMPLATE, buildAsbestosMergeData(report));
const xml = new PizZip(merged).file('word/document.xml')!.asText();
const body = textOf(xml);

console.log('\nהמסמך שנוצר:');

const problem = wellFormed(xml);
check(problem === null, 'ה-XML תקין', problem ?? '');
check(
  Object.keys((new PizZip(merged) as unknown as { files: Record<string, unknown> }).files)[0] ===
    '[Content_Types].xml',
  '[Content_Types].xml ראשון בארכיון',
);

// Two buildings, fifteen rows each — the loop repeated rather than printing once.
const rows = (xml.match(/<w:tr[ >]/g) ?? []).length;
check(rows === 30, '30 שורות — שני מבנים, 15 שורות לכל אחד', String(rows));

for (const value of ['ביתן 3', 'בית ספר שלוותה', 'משרד משק', '200']) {
  check(body.includes(value), `נדפס: ${value}`);
}

check(body.includes('רחל כהן'), 'מזמין הסקר נדפס');
check(body.includes('עליית הנוער 13'), 'הכתובת נדפסה');
check(body.includes('יש לצבוע קירות'), 'שורת הסיכום נדפסה');

const leftover = body.match(/\{[^}]{1,40}\}/g) ?? [];
check(leftover.length === 0, 'לא נשארו שדות שלא מולאו', leftover.join(' '));

// ── What must not leak from the source document ─────────────────────

console.log('\nנתוני המסמך המקורי:');

const templateXml = new PizZip(TEMPLATE).file('word/document.xml')!.asText();
const templateText = textOf(templateXml);
for (const leak of ['שלוותה', 'עליית הנוער', 'רחל כהן', 'משרד משק']) {
  check(!templateText.includes(leak), `התבנית אינה נושאת את "${leak}"`);
}

const marks = (templateXml.match(/<w:highlight w:val="(?!none)/g) ?? []).length;
check(marks === 0, 'לא נשארו סימוני צהוב', String(marks));

// ── A building nobody filled in is not printed ──────────────────────

console.log('\nמבנה שלא מולא:');

const withBlank = { ...report, buildings: [...report.buildings, newBuildingRow()] };
const blankXml = new PizZip(mergeDocx(TEMPLATE, buildAsbestosMergeData(withBlank)))
  .file('word/document.xml')!
  .asText();
check(
  (blankXml.match(/<w:tr[ >]/g) ?? []).length === 30,
  'שורה ריקה אינה מדפיסה טבלה נוספת',
  String((blankXml.match(/<w:tr[ >]/g) ?? []).length),
);

// ── The remedial actions are a list, several at a time ──────────────
//
// Free text on this field produced the same instruction written four ways across four
// reports. The list settles the wording; what matters here is that several can be chosen
// at once and that the free-text box beside it still survives alongside them.

console.log('\nהנחיות לביצוע:');

const many = joinInstructions([INSTRUCTION_OPTIONS[0], INSTRUCTION_OPTIONS[6]]);
check(splitInstructions(many).length === 2, 'שתי הנחיות נשמרות יחד', many);

const withFree = joinInstructions([INSTRUCTION_OPTIONS[0], 'לבדוק שוב בעוד שנה']);
check(splitInstructions(withFree).length === 2, 'הנחיה מהרשימה וטקסט חופשי חיים יחד');

// A building written before the list existed carried "אין" typed by hand.
check(splitInstructions('אין').join('') === 'אין', 'ערך ישן שנכתב ביד נשמר');

// Painting is three separate options, not one with slashes: which side is painted is
// the instruction, and a contractor reading the slashes has been told the options.
const painting = INSTRUCTION_OPTIONS.filter((o) => o.startsWith('צביעת'));
check(painting.length === 3, 'לצביעה שלוש אפשרויות נפרדות', String(painting.length));

const printed = mergeDocx(
  TEMPLATE,
  buildAsbestosMergeData({
    ...report,
    buildings: [{ ...report.buildings[0]!, instructions: many }],
  }),
);
const printedText = textOf(new PizZip(printed).file('word/document.xml')!.asText());
check(printedText.includes(INSTRUCTION_OPTIONS[0]), 'ההנחיה הראשונה נדפסה בדוח');
check(printedText.includes(INSTRUCTION_OPTIONS[6]), 'וגם השנייה — שתיהן באותו תא');

/**
 * The building rows are answered by tapping, and the picker must not eat an answer.
 *
 * This is what `ChoiceField` does to a stored value on the way in: split it, match
 * the parts against the row's options, and leave everything else in the free-text
 * box. The cases that matter are the real ones — Galit's own reports answer these
 * rows with a sentence carrying a reason, and a picker that flattened those to "לא"
 * would silently drop the part a reader needs.
 */
/**
 * The closing section of the tabled opinion comes from the drafted bullets.
 *
 * The two forms share one template loop, and before the summary was drafted the tabled
 * form borrowed the prose form's `findings` to fill it. A report switched from prose to
 * tables still carries those old rows, so the mapper has to pick by layout — otherwise a
 * line the surveyor wrote for a different shape of document prints under the tables.
 */
console.log('\nסיכום והנחיות לביצוע:');

check(
  body.includes('במבנים בית ספר שלוותה וביתן 3 קירות חיצוניים עשויים אסבסט צמנט.'),
  'שורת הסיכום הראשונה נדפסה',
);
check(
  body.includes('יש לצבוע קירות חיצוניים בבית ספר שלוותה ובביתן 3 אחת לשלוש שנים.'),
  'וגם השנייה — הלולאה חוזרת',
);
check(
  !body.includes('שורה ישנה שאסור שתודפס'),
  'שורת findings שנשארה מהצורה הרציפה אינה מודפסת בדוח טבלאות',
);

/*
 * The two shapes close the document from the same field.
 *
 * `summaryLines` used to carry the prose form's own finding sentences, which made its
 * closing section a second copy of the section above it. Both forms now draft real
 * closing lines into `summaryBullets`, so the template has one loop and the mapper
 * feeds it from one place — this pins that, since the two used to diverge.
 */
const proseData = buildAsbestosMergeData({
  ...report,
  layout: 'prose',
  summaryBullets: ['שורת סיכום של הצורה הרציפה.'],
  // Built from the blank row rather than written out, so a field added to a finding
  // later does not leave this fixture behind.
  findings: [{ ...newFindingRow(), text: 'ממצא רציף אמיתי.', area: '12' }],
}) as Record<string, unknown>;

check(
  (proseData.findings as unknown[]).length === 1,
  'הצורה הרציפה עדיין מעבירה את הממצאים שלה לתבנית',
);
check(
  (proseData.summaryLines as Array<{ text: string }>)[0]?.text ===
    'שורת סיכום של הצורה הרציפה.',
  'וסוגרת בשורות הסיכום שלה, לא בממצאים עצמם',
);

// An unnamed building is an empty editor row, and must not reach the model as a survey
// of a building nobody visited.
const forSummary = buildingsForSummary({
  buildings: [...report.buildings, { ...newBuildingRow(), use: 'משרד' }],
});
check(forSummary.length === 2, 'מבנה בלי שם אינו נשלח לניסוח', String(forSummary.length));
check(
  forSummary[0]!.answers.every(([, value]) => value.trim() !== ''),
  'שורות שלא נענו אינן נשלחות — מודל שמקבל "רטיבות: " כותב על היעדר רטיבות',
);

/**
 * A tabled opinion is not blocked by findings rows it has no screen for.
 *
 * Every new report is created with one blank findings row, and the tabled editor has
 * no step that shows it. Held to the strict schema that row demanded a description,
 * so pressing "סיום" on a fully answered tabled survey returned "תיאור הממצא — שדה
 * חובה" about a row the surveyor could not reach. `parseIssuableReport` drops the
 * rows belonging to the other layout before checking.
 */
console.log('\nאימות לפי צורת הדוח:');

const tabledWithStrayRow = {
  ...report,
  findings: [newFindingRow()], // the blank starter row, description and all
};
check(
  parseIssuableReport(tabledWithStrayRow).success,
  'דוח טבלאות מלא עובר אימות למרות שורת ממצא ריקה שנותרה מהיצירה',
);

/*
 * The prose form drops a wholly untouched row too, rather than blocking on it.
 *
 * This check used to assert the opposite, on the reasoning that the row is on screen in
 * the prose editor and so can be fixed there. That turned out to be the same complaint
 * one step further in: the editor has no box for a finding's description — it records
 * the element, the count, the placement and the size, and composes the sentence at
 * production — so a survey with two real findings and the untouched starter row was
 * refused over a row nobody had opened, naming a field that does not exist on screen.
 *
 * An empty row is the absence of a finding, not an incomplete one. A report with no
 * findings at all is still stopped, by the wizard's own blocker over `realFindings`,
 * which is where that belongs.
 */
check(
  parseIssuableReport({
    ...report,
    layout: 'prose',
    findings: [
      { ...newFindingRow(), element: 'צינורות ביוב', quantity: '3', area: '27' },
      newFindingRow(),
    ],
  }).success,
  'דוח רציף עם ממצא אמיתי ושורה ריקה — נשמר',
);

// A row that *was* opened and left half-answered is still named, because that one the
// surveyor can go and finish.
check(
  !parseIssuableReport({
    ...report,
    layout: 'prose',
    findings: [{ ...newFindingRow(), quantity: '3', area: '27' }],
  }).success,
  'דוח רציף עם ממצא שנפתח ולא נענה — נחסם',
);

// And a tabled report missing its own required answer is still refused.
check(
  !parseIssuableReport({ ...report, siteAddress: '' }).success,
  'דוח טבלאות בלי כתובת נחסם',
);

console.log('\nבחירת תשובות בשורות המבנה:');

const asChoiceField = (value: string, options: readonly string[]) => {
  const parts = splitInstructions(value);
  const picked = options.filter((o) => parts.includes(o));
  return { picked, other: parts.filter((p) => !options.includes(p)).join(', ') };
};

const barrierOptions = BUILDING_OPTIONS.barrier!.options;
const wordy = asChoiceField('לא ניתן לראות- בוצע עליהם שיפוץ חיפוי גבס', barrierOptions);
check(wordy.picked.length === 0, 'תשובה שהיא משפט אינה מזוהה כאופציה');
check(
  wordy.other === 'לא ניתן לראות- בוצע עליהם שיפוץ חיפוי גבס',
  'והיא נשמרת במלואה — הנימוק הוא החלק שהקורא צריך',
);

const roofOptions = BUILDING_OPTIONS.roofCover!.options;
const mixed = asChoiceField('חזזיות, יריעות ביטומן, ענפים נושקים לגג', roofOptions);
check(mixed.picked.length === 2, 'אופציות וטקסט חופשי חיים יחד באותה שורה');
check(mixed.other === 'ענפים נושקים לגג', 'והחלק החופשי נשאר בנפרד');

// Two buildings answered the same way must read the same however they were tapped.
const sheetOptions = BUILDING_OPTIONS.sheetCondition!.options;
check(
  joinInstructions(asChoiceField('שחוקים, סדוקים', sheetOptions).picked) ===
    joinInstructions(asChoiceField('סדוקים, שחוקים', sheetOptions).picked),
  'סדר הסימון אינו משנה את מה שמודפס',
);

check(
  asChoiceField('', BUILDING_OPTIONS.use!.options).picked.length === 0,
  'שדה ריק נשאר ריק — אין ברירת מחדל שמסמנת תשובה שאיש לא נתן',
);

/**
 * The findings step offers its answers and still takes anything else.
 *
 * Those fields were a `<datalist>`, which on a phone shows an empty text box and no
 * sign that a list exists — so the options were invisible and every answer was typed
 * out. They are tapped now, with an "אחר" box beneath them. What must not change is
 * that a wording the list does not carry survives: a flue nobody listed, a placement
 * written for one particular building.
 */
console.log('\nבחירת תשובות בשלב הממצאים:');

const asCombo = (value: string, options: readonly string[]) => {
  const chosen = options.find((o) => o === value.trim());
  return { chosen: chosen ?? null, other: chosen ? '' : value };
};

check(asCombo('לוחות גג', ELEMENT_OPTIONS).chosen === 'לוחות גג', 'ערך מהרשימה מסומן');
check(asCombo('לוחות גג', ELEMENT_OPTIONS).other === '', 'ותיבת אחר נשארת ריקה');

const ownWording = asCombo('ארובת אסבסט בגג הרעפים', ELEMENT_OPTIONS);
check(ownWording.chosen === null, 'ניסוח שאינו ברשימה אינו מסומן');
check(
  ownWording.other === 'ארובת אסבסט בגג הרעפים',
  'והוא נשמר במלואו — זה מה שה-datalist הסתיר',
);

// Findings recorded before the change still read back as listed answers.
check(
  asCombo('בתוך קירות הבניין', PLACEMENT_OPTIONS).chosen === 'בתוך קירות הבניין',
  'ממצא קיים עדיין מזוהה כאופציה',
);
check(
  asCombo('מאחורי חדר המכונות', PLACEMENT_OPTIONS).other === 'מאחורי חדר המכונות',
  'ומיקום שנוסח לבניין מסוים שורד',
);
check(asCombo('', CONDITION_OPTIONS).chosen === null, 'שדה ריק נשאר ריק');


// ── A photograph reaches the document from where it was taken ───────
//
// The picture is attached from inside the building's own card, and it has to print.
// It did not, in the way that is hardest to notice: a building whose name was still
// blank was filtered out of the document entirely — taking its photographs with it,
// and saying nothing at all. The surveyor saw the picture on screen and an appendix
// without it.

console.log('\nתמונה שצורפה למבנה:');

{
  const withPhoto = {
    ...report,
    buildings: [{ ...report.buildings[0]!, photos: [{ imageId: 'x1', caption: '' }] }],
  };
  check(realBuildings(withPhoto).length === 1, 'מבנה עם שם ועם תמונה נכלל בדוח');

  // The case that lost the photograph: attached before the building was named.
  const unnamed = {
    ...report,
    buildings: [{ ...newBuildingRow(), photos: [{ imageId: 'x2', caption: '' }] }],
  };
  check(
    realBuildings(unnamed).length === 1,
    'מבנה בלי שם אבל עם תמונה — אינו נושר, והתמונה מגיעה לדוח',
  );

  // A row nobody touched at all still prints nothing: an empty fifteen-row table is
  // worse than no table.
  const blank = { ...report, buildings: [newBuildingRow()] };
  check(realBuildings(blank).length === 0, 'שורה ריקה לגמרי עדיין אינה מודפסת');
}

console.log(failures === 0 ? '\nהכול עבר' : `\n${failures} בדיקות נכשלו`);
process.exit(failures === 0 ? 0 : 1);
