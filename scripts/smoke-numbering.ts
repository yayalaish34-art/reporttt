/**
 * The measurement tables: how points are numbered, and how they are judged.
 *
 * A survey is many protocols — one table per source per floor — and Word's own
 * list numbering restarted at 1 in each of them, so several points in one
 * report answered to the same number. The number is now merge data, counted
 * across all of a survey's protocols, and ELF and RF count separately because
 * they are two surveys bound into one report.
 *
 *   npx tsx scripts/smoke-numbering.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { mergeDocx } from '../src/lib/docx/merge-docx';
import { buildMergeData } from '../src/lib/report-mapper';
import { ReportSchema, StoredReportSchema } from '../src/lib/report-schema';
import { sampleReport } from '../src/lib/sample-report';
import { computeFindings } from '../src/lib/report-findings';
import {
  composeProtocolTitle,
  stripProtocolPrefix,
  elfThreshold,
  isCabinetReference,
  newRfRows,
  RF_DEFAULT_REFERENCE,
  RF_REFERENCE_OPTIONS,
  withReferencePrefix,
  ELF_DISTANCE_OPTIONS,
  POWER_LINE_DISTANCE_OPTIONS,
  POWER_LINE_SOURCES,
  RF_DISTANCE_OPTIONS,
  RF_PROFILE_DISTANCES,
  ELF_PROFILE_DISTANCES,
  ABOVE_BOARD_POINT,
  BOARD_POINT_OPTIONS,
  boardProfileRows,
  boardPointDistances,
  FIELD_SOURCE_LABEL,
  FIELD_SOURCE_OPTIONS,
  MEASUREMENT_TYPE_OPTIONS,
  SITE_CHARACTER_OPTIONS,
  WEATHER_OPTIONS,
  isBoardSource,
  joinFieldSources,
  splitFieldSources,
} from '../src/lib/measurement-rules';
const TEMPLATE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates/report-template.docx');

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// Three ELF protocols of 5, 2 and 4 points; two RF protocols of 3 and 2.
const elfRow = (description: string) => ({
  description, distance: '0.3', height: '1', measured: '1.2',
  normalized: '1.2', occupancy: 'קבועה', compliance: 'לא חורג',
});
const rfRow = (description: string) => ({
  description, occupancy: 'רציף', measured: '0.4',
  threshold: '40', compliance: '', distance: '0.3', height: '1',
});
const spread = (n: number, make: (d: string) => unknown, prefix: string) =>
  Array.from({ length: n }, (_, i) => make(`${prefix} ${i + 1}`));

const report = ReportSchema.parse({
  ...sampleReport(),
  elfProtocols: [5, 2, 4].map((n, i) => ({
    title: `פרוטוקול רשמי - מדידת שדה מגנטי ELF בקומה ${i + 1}`,
    referenceLabel: 'ללוח חשמל', normalizationFactor: '1', normalizationNote: '',
    rows: spread(n, elfRow, `נקודה בקומה ${i + 1}`),
  })),
  rfProtocols: [3, 2].map((n, i) => ({
    title: `פרוטוקול רשמי - מדידת קרינה בתדרי רדיו RF – קומה ${i + 1}`,
    referenceLabel: 'לארון תקשורת',
    rows: spread(n, rfRow, `אזור בקומה ${i + 1}`),
  })),
});

// ── The merge data, before any template is involved ─────────────────

const data = buildMergeData(report) as {
  elfProtocols: Array<{ rows: Array<{ pointNumber: string }> }>;
  rfProtocols: Array<{ rows: Array<{ pointNumber: string }> }>;
};

const elfNumbers = data.elfProtocols.flatMap((p) => p.rows.map((r) => r.pointNumber));
const rfNumbers = data.rfProtocols.flatMap((p) => p.rows.map((r) => r.pointNumber));

console.log('מספור בנתוני המיזוג:');
check(elfNumbers.join(',') === '1,2,3,4,5,6,7,8,9,10,11', 'ELF רץ 1–11 על פני שלוש טבלאות', elfNumbers.join(','));
check(rfNumbers.join(',') === '1,2,3,4,5', 'RF רץ 1–5 על פני שתי טבלאות', rfNumbers.join(','));
check(data.elfProtocols[1].rows[0].pointNumber === '6', 'הטבלה השנייה ב-ELF ממשיכה מ-6', data.elfProtocols[1].rows[0].pointNumber);
check(data.rfProtocols[1].rows[0].pointNumber === '4', 'הטבלה השנייה ב-RF ממשיכה מ-4', data.rfProtocols[1].rows[0].pointNumber);

// Counting must not leak between merges: a second call starts over.
const again = buildMergeData(report) as typeof data;
check(again.elfProtocols[0].rows[0].pointNumber === '1', 'מיזוג נוסף מתחיל שוב מ-1', again.elfProtocols[0].rows[0].pointNumber);

// ── The rendered document ───────────────────────────────────────────

console.log('\nמספור במסמך שנוצר:');
const merged = mergeDocx(readFileSync(TEMPLATE), buildMergeData(report));
const doc = new PizZip(merged).file('word/document.xml')!.asText();
const textOf = (f: string) => [...f.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

check(!/<w:numPr>[\s\S]{0,400}נקודה בקומה/.test(doc), 'עמודת המספור אינה רשימה אוטומטית של Word');

// Read the first cell of every measurement row back out of the tables.
const rendered: string[] = [];
for (const table of doc.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)) {
  for (const row of table[0].matchAll(/<w:tr[\s\S]*?<\/w:tr>/g)) {
    const cells = [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => textOf(c[0]).trim());
    if (cells.length > 1 && /^(נקודה|אזור) בקומה/.test(cells[1])) rendered.push(cells[0]);
  }
}

check(rendered.length === 16, 'כל 16 שורות המדידה רונדרו', `${rendered.length}`);
check(
  rendered.join(',') === '1,2,3,4,5,6,7,8,9,10,11,1,2,3,4,5',
  'הסדר במסמך: 1–11 ל-ELF ואז 1–5 ל-RF',
  rendered.join(','),
);

// ── The verdict column ──────────────────────────────────────────────
//
// It printed blank in a delivered report: the editor's select had no option
// matching an empty value, so it displayed "לא חורג" over a row that held
// nothing, and nothing was what reached the document.

console.log('\nעמודת חורג / לא חורג:');

const judgedAt = (siteCharacter: string, rows: Array<Record<string, string>>) => {
  const data = buildMergeData(
    ReportSchema.parse({
      ...sampleReport(),
      siteCharacter,
      elfProtocols: [{
        title: 'פרוטוקול ELF', referenceLabel: 'ללוח',
        normalizationFactor: '1', normalizationNote: '', rows,
      }],
      rfProtocols: [],
    }),
  ) as { elfProtocols: Array<{ rows: Array<{ compliance: string }> }> };
  return data.elfProtocols[0].rows.map((r) => r.compliance);
};

/** The workplace ceiling, which is what the sample report is characterized as. */
const judged = (rows: Array<Record<string, string>>) => judgedAt('מקומות עבודה', rows);

const point = (measured: string, occupancy: string, compliance = '') => ({
  description: 'לוח חשמל', distance: '0.3', height: '1',
  measured, normalized: '', occupancy, compliance,
});

// The screenshot's own rows: 133 and 150 mG at a point nobody stays at.
check(
  judged([point('133', 'לא קבועה'), point('150', 'לא קבועה')]).join(' · ') ===
    'לא חורג, חשיפה רגעית · לא חורג, חשיפה רגעית',
  'קריאה גבוהה בשהייה לא קבועה — "לא חורג, חשיפה רגעית"',
  judged([point('133', 'לא קבועה')])[0],
);
check(judged([point('133', 'קבועה')])[0] === 'חורג', 'אותה קריאה בשהייה קבועה — "חורג"');
check(judged([point('4.2', 'קבועה')])[0] === 'לא חורג', 'מתחת ל-10 מ״ג במקום עבודה — "לא חורג"');
check(judged([point('2500', 'לא קבועה')])[0] === 'חורג', 'מעל הסף הרגעי — "חורג" בלי קשר לאכלוס');
// שורה בלי קריאה כבר לא מגיעה למסמך בכלל (ולכן גם אין לה פסק דין להיות ריק):
// העורך פורש חמש שורות לכל תיאור כדי שיהיה לאן להקליד, ומה שלא נמדד לא נדפס.
check(judged([point('', 'קבועה')]).length === 0, 'שורה בלי קריאה אינה נכנסת למסמך');
check(
  judged([point('1.2', 'קבועה'), point('', 'קבועה'), point('3.4', 'קבועה')]).length === 2,
  'שורות ריקות באמצע נושרות, המלאות נשארות',
);
check(
  judged([point('133', 'לא קבועה', 'חורג')])[0] === 'חורג',
  'קביעה של הבודק גוברת על החישוב',
);

// ── The ceiling depends on what the place is ────────────────────────
//
// The same 5 mG at a desk is compliant in an office and an exceedance in a
// school. Judging every survey against the workplace's 10 mG — which this did —
// passed readings that the guidance does not.

console.log('\nסף לפי אפיון המקום:');
check(elfThreshold('מקומות עבודה') === 10, 'מקומות עבודה — 10 מ״ג');
check(elfThreshold('מוסדות חינוך') === 4, 'מוסדות חינוך — 4 מ״ג');
check(elfThreshold('מגורים') === 4, 'מגורים — 4 מ״ג');
check(elfThreshold('הדיור הממשלתי') === 2, 'הדיור הממשלתי — 2 מ״ג');
check(elfThreshold('') === 10, 'בלי אפיון — נופל ל-10, המקל מבין הארבעה');

// The user's own worked example: 5 mG, fixed occupancy, school.
check(
  judgedAt('מוסדות חינוך', [point('5', 'קבועה')])[0] === 'חורג',
  '5 מ״ג בשהייה קבועה במוסד חינוך — חורג',
  judgedAt('מוסדות חינוך', [point('5', 'קבועה')])[0],
);
check(
  judgedAt('מקומות עבודה', [point('5', 'קבועה')])[0] === 'לא חורג',
  'אותם 5 מ״ג במקום עבודה — לא חורג',
);
check(
  judgedAt('הדיור הממשלתי', [point('3', 'קבועה')])[0] === 'חורג',
  '3 מ״ג בדיור ממשלתי — חורג',
);
check(
  judgedAt('מוסדות חינוך', [point('5', 'לא קבועה')])[0] === 'לא חורג, חשיפה רגעית',
  'אותם 5 מ״ג במוסד חינוך בשהייה לא קבועה — חשיפה רגעית',
);

// The brief handed to the model has to state the ceiling it actually used.
const schoolFindings = computeFindings(
  ReportSchema.parse({
    ...sampleReport(),
    siteCharacter: 'מוסדות חינוך',
    elfProtocols: [{
      title: 'לוח', referenceLabel: 'ללוח', normalizationFactor: '1', normalizationNote: '',
      rows: [point('5', 'קבועה'), point('1', 'קבועה')],
    }],
    rfProtocols: [],
  }),
);
check(schoolFindings.elf.limit === 4, 'הממצאים נושאים את הסף שחל', String(schoolFindings.elf.limit));
check(schoolFindings.elf.exceeding.length === 1, 'הממצאים סופרים את החריגה לפי הסף הנכון');

// The conclusions must be drafted from what the table prints, not from a blank.
const findings = computeFindings(
  ReportSchema.parse({
    ...sampleReport(),
    elfProtocols: [{
      title: 'פרוטוקול ELF', referenceLabel: 'ללוח', normalizationFactor: '1', normalizationNote: '',
      rows: [point('133', 'קבועה'), point('2', 'קבועה')],
    }],
    rfProtocols: [],
  }),
);
check(findings.elf.exceeding.length === 1, 'הממצאים סופרים את החריגה', `${findings.elf.exceeding.length}`);
check(findings.elf.unjudged.length === 0, 'לא נשארות נקודות "טרם סומנו"', `${findings.elf.unjudged.length}`);

// ── The lists the cover fields offer ────────────────────────────────
//
// Free text made the same site read as "משרדים" on one survey and "מקום עבודה"
// on the next, which then reached the conclusions as two different site kinds.

console.log('\nרשימות הבחירה:');
check(ELF_PROFILE_DISTANCES.join(',') === '0.3,0.5,1,1.5,2', 'טבלת ELF נפתחת עם חמשת המרחקים', ELF_PROFILE_DISTANCES.join(','));
check(
  ELF_PROFILE_DISTANCES.every((d) => ELF_DISTANCE_OPTIONS.includes(d as never)),
  'כל מרחקי הפרופיל מופיעים גם ברשימת המרחקים של השורה',
);
// The same invariant on the RF side. The two were one constant, so offering 2 m as a
// choice also opened every cabinet table with a fourth row; splitting them is what makes
// this check necessary — a profile distance the picker cannot offer opens as "אחר".
check(
  RF_PROFILE_DISTANCES.every((d) => RF_DISTANCE_OPTIONS.includes(d as never)),
  'כל מרחקי פרופיל ה-RF מופיעים גם ברשימת המרחקים',
);
check(
  RF_DISTANCE_OPTIONS.join(',') === '0.3,0.5,1,1.5,2',
  'רשימת מרחקי RF',
  RF_DISTANCE_OPTIONS.join(','),
);
check(SITE_CHARACTER_OPTIONS.length === 4 && SITE_CHARACTER_OPTIONS[0] === 'מגורים', 'אפיון המקום — 4 אפשרויות');
check(WEATHER_OPTIONS.join(',') === 'חם,חם מאוד,קר,קר מאוד,נעים', 'מזג אוויר — 5 אפשרויות', WEATHER_OPTIONS.join(','));
check(
  FIELD_SOURCE_OPTIONS.join(',') ===
    'לוח חשמל,חדר שנאים,שנאי על עמוד,חדר חשמל,אנטנות,קו מתח נמוך,קו מתח גבוה,קו מתח עליון,קו מתח על,UPS,רקע',
  // "לוח חשמל" חייב להישאר ראשון — isBoardSource מזהה לוח לפי המקום הזה ברשימה.
  'מקור השדה — 11 אפשרויות, ולוח חשמל ראשון',
  FIELD_SOURCE_OPTIONS.join(','),
);

// קו מתח ושנאי על עמוד נמדדים בפרופיל אחר מלוח: שמונה מרחקים עד 25 מ'.
check(
  POWER_LINE_DISTANCE_OPTIONS.join(',') === Array.from({ length: 26 }, (_, i) => String(i)).join(','),
  'מרחקי קו מתח — כל מטר מ-0 עד 25',
  POWER_LINE_DISTANCE_OPTIONS.join(','),
);
check(
  (POWER_LINE_SOURCES as readonly string[]).every((sourceName) =>
    (FIELD_SOURCE_OPTIONS as readonly string[]).includes(sourceName),
  ),
  'כל מקורות קו המתח קיימים ברשימת המקורות',
);
// מרחק שהטבלה נפתחת עליו והבורר אינו מציע — נופל ל"אחר" ברגע שנוגעים בו.
check(
  boardPointDistances('כל תיאור', true).every((d) =>
    (POWER_LINE_DISTANCE_OPTIONS as readonly string[]).includes(d),
  ),
  'כל מרחקי פרופיל קו המתח מופיעים גם ברשימת המרחקים',
);
// בסקר מעורב (לוח + קו מתח) פאה של לוח נשארת פרופיל של לוח:
// 25 מ' מול ארון שאפשר לעמוד לידו אינו מדידה.
check(
  boardPointDistances(ABOVE_BOARD_POINT, true).length === 3,
  'פאת לוח שומרת על פרופיל הלוח גם בסקר עם קו מתח',
  String(boardPointDistances(ABOVE_BOARD_POINT, true).length),
);
check(
  boardPointDistances('מתחת לקו', true).length === 8,
  'תיאור שאינו פאת לוח נפתח ב-8 שורות בסקר קו מתח',
  String(boardPointDistances('מתחת לקו', true).length),
);
check(
  boardPointDistances('בחזית הלוח').length === 5,
  'לוח חשמל נשאר עם 5 מרחקים',
  String(boardPointDistances('בחזית הלוח').length),
);
check(
  MEASUREMENT_TYPE_OPTIONS.join(',') ===
    'מדידות שדה מגנטי,מדידות משולבת שדה מגנטי וצפיפות הספק,מדידות צפיפות הספק',
  'סוג המדידות — 3 אפשרויות',
  MEASUREMENT_TYPE_OPTIONS.join(','),
);
// הכותרת המודפסת של שורת המקורות. מקובעת כאן כי היא נכתבת לתבנית ע"י
// build-template, ושינוי שלה משנה את הדוח עצמו — לא רק את המסך.
check(FIELD_SOURCE_LABEL === 'מקורות הקרינה שנבדקו', 'כותרת מקורות הקרינה', FIELD_SOURCE_LABEL);

// Widened to string: the literal union makes `=== ''` a type error, but the
// check is about what reaches the document at runtime, not about the type.
const allOptions: string[] = [
  ...SITE_CHARACTER_OPTIONS,
  ...WEATHER_OPTIONS,
  ...FIELD_SOURCE_OPTIONS,
  ...MEASUREMENT_TYPE_OPTIONS,
];
check(
  allOptions.every((o) => o.trim() === o && o !== ''),
  'אין אפשרות ריקה או עם רווחים מיותרים',
);
check(new Set(allOptions).size === allOptions.length, 'אין אפשרות כפולה בין הרשימות');

// ── טבלת לוח חשמל: ארבעה תיאורים, חמישה מרחקים לכל אחד ──────────────
//
// כך הסקר באמת נלקח — מקיפים את הלוח ובכל פאה לוקחים את כל הפרופיל.
//
// הטבלה נפתחת ריקה, ונקודה נוספת אחת בכל פעם: בחירת תיאור פורשת את המרחקים שלו
// (`boardPointDistances`). הפרישה מראש של כל 23 השורות הוסרה — רוב הטבלאות אינן
// לוח שנמדד מכל פאותיו, ולכן היא הפכה למסך שמוחקים ממנו במקום למדוד בו.

console.log('\nטבלת ELF ללוח חשמל:');
check(BOARD_POINT_OPTIONS.length === 5, 'חמישה תיאורים', String(BOARD_POINT_OPTIONS.length));
check(
  BOARD_POINT_OPTIONS.every((o) => o.includes('בוצעה סריקה איטית ובנקודה החמה נמדדה')),
  'כל תיאור נושא את שיטת המדידה',
);
const boardLayout = boardProfileRows((description, distance) => ({ description, distance }));
// ארבע פאות × חמישה מרחקים, ועוד הנקודה שמעל הלוח שנפרשת בשלושה מרחקים בלבד.
check(boardLayout.length === 23, '23 שורות (4×5 + 3 מעל הלוח)', String(boardLayout.length));
check(
  BOARD_POINT_OPTIONS.filter((d) => d !== ABOVE_BOARD_POINT).every(
    (d) => boardLayout.filter((r) => r.description === d).map((r) => r.distance).join(',') ===
      ELF_PROFILE_DISTANCES.join(','),
  ),
  'כל פאה מקבלת את חמשת המרחקים',
);
check(
  boardLayout.filter((r) => r.description === ABOVE_BOARD_POINT).map((r) => r.distance).join(',') === '0.3,0.5,1',
  'מעל הלוח — שלושה מרחקים בלבד',
  boardLayout.filter((r) => r.description === ABOVE_BOARD_POINT).map((r) => r.distance).join(','),
);
// הוספת נקודה בודדת — מה ש-AddPoint עושה בעורך.
check(
  boardPointDistances(BOARD_POINT_OPTIONS[0]).join(',') === ELF_PROFILE_DISTANCES.join(','),
  'נקודה רגילה נפתחת בכל המרחקים',
  boardPointDistances(BOARD_POINT_OPTIONS[0]).join(','),
);
check(
  boardPointDistances(ABOVE_BOARD_POINT).join(',') === '0.3,0.5,1',
  'הנקודה שמעל הלוח נפתחת בשלושה',
  boardPointDistances(ABOVE_BOARD_POINT).join(','),
);
// תיאור חופשי — מקור בלי פאות — מקבל אף הוא את הפרופיל המלא.
check(
  boardPointDistances('ליד המקרר במטבחון').join(',') === ELF_PROFILE_DISTANCES.join(','),
  'תיאור חופשי נפתח בכל המרחקים',
  boardPointDistances('ליד המקרר במטבחון').join(','),
);
check(
  boardLayout.slice(0, 5).every((r) => r.description === BOARD_POINT_OPTIONS[0]),
  'השורות מקובצות לפי תיאור ולא משורגות',
);

// ── כמה מקורות שדה בבת אחת ──────────────────────────────────────────
//
// המקור נשמר כמחרוזת אחת מופרדת בפסיק ("אנטנות, לוח חשמל") ולא כמערך, כדי
// שהמיזוג לוורד, תיבת ה"אחר" והדוחות הישנים יישארו כמות שהם. מה שחשוב לשמור:
// isBoardSource שואל אם לוח חשמל הוא *אחד* מהמקורות — לא אם הוא היחיד. אילו
// נשאר כאן שוויון מדויק, סקר של "אנטנות, לוח חשמל" היה מאבד את ארבע פאות הלוח
// בנקודות המדידה.

console.log('\nמקור שדה מרובה:');
check(joinFieldSources(['אנטנות', 'לוח חשמל']) === 'אנטנות, לוח חשמל', 'מחובר בפסיק ורווח', joinFieldSources(['אנטנות', 'לוח חשמל']));
check(splitFieldSources('אנטנות,לוח חשמל').length === 2, 'פיצול סובל פסיק בלי רווח');
check(splitFieldSources('  אנטנות , , לוח חשמל , ').join('|') === 'אנטנות|לוח חשמל', 'רווחים ופסיקים מיותרים נזרקים');
check(isBoardSource('לוח חשמל'), 'לוח חשמל לבדו — נחשב לוח');
check(isBoardSource('אנטנות, לוח חשמל'), 'לוח חשמל כשני מתוך שניים — עדיין נחשב לוח');
check(isBoardSource('לוח חשמל, אנטנות'), 'לוח חשמל כראשון — נחשב לוח');
check(!isBoardSource('אנטנות'), 'אנטנות בלבד — לא לוח');
check(!isBoardSource(''), 'ריק — לא לוח');
check(!isBoardSource('ליד לוח חשמל'), 'טקסט שרק מכיל "לוח חשמל" — לא נחשב לוח');
// הניסוח בדוח נקבע לפי סדר הרשימה, לא לפי סדר הסימון — אחרת אותו סקר היה
// מודפס בשתי גרסאות ניסוח שונות.
const tick = (picked: string[]) => joinFieldSources(FIELD_SOURCE_OPTIONS.filter((o) => picked.includes(o)));
check(tick(['אנטנות', 'לוח חשמל']) === tick(['לוח חשמל', 'אנטנות']), 'הניסוח זהה בלי קשר לסדר הסימון', tick(['אנטנות', 'לוח חשמל']));

// ── The RF reference decides the table's shape ──────────────────────
//
// A cabinet is measured as a distance profile; antennas in the surroundings
// are not measured against anything at a fixed distance at all.

console.log('\nטבלאות RF לפי "בדיקה ביחס ל":');
// שלוש אפשרויות ה-RF, ואחריהן מקורות הקרינה עם תחילית ל' — אותה רשימה משרתת
// גם את טבלאות ה-ELF. UPS מקבל מקף כי "לUPS" נקרא כמילה משובשת.
check(
  RF_REFERENCE_OPTIONS.join(',') ===
    'אנטנות בסביבה,ארון תקשורת,wifi,נקודות ישיבה,ללוח חשמל,לחדר שנאים,לשנאי על עמוד,לחדר חשמל,לאנטנות,לקו מתח נמוך,לקו מתח גבוה,לקו מתח עליון,לקו מתח על,ל-UPS',
  'רשימת "בדיקה ביחס ל" — 4 אפשרויות RF + 10 מקורות',
  RF_REFERENCE_OPTIONS.join(','),
);
// withReferencePrefix מנרמל את תחילית ה-ל׳. הוא *אינו* מופעל בזמן המיזוג: בתבנית
// הפעילה {referenceLabel} הוא כותרת עמודה בטבלה, לא המשך של המשפט "בדיקה ביחס".
check(withReferencePrefix('לוח חשמל') === 'ללוח חשמל', 'בלי ל׳ → נוספת', withReferencePrefix('לוח חשמל'));
check(withReferencePrefix('ללוח חשמל') === 'ללוח חשמל', 'עם ל׳ → לא נכפלת');
check(withReferencePrefix('לארון תקשורת') === 'לארון תקשורת', 'אפשרות RF עם ל׳ אינה נכפלת');
check(withReferencePrefix('UPS') === 'ל-UPS', 'שם לטיני מקבל מקף', withReferencePrefix('UPS'));
check(withReferencePrefix('לובי הבניין') === 'ללובי הבניין', 'מילה שרק מתחילה ב-ל אינה נחשבת תחילית');
check(withReferencePrefix('') === '', 'ריק נשאר ריק');
check(
  (RF_REFERENCE_OPTIONS as readonly string[]).includes('נקודות ישיבה'),
  '"נקודות ישיבה" ברשימה',
);

// "רקע" אינו מקור שאפשר למדוד ביחס אליו, ולכן אינו ברשימה הזו.
check(!RF_REFERENCE_OPTIONS.some((o) => o.includes('רקע')), 'רקע אינו אפשרות ל"בדיקה ביחס"');
check(RF_DEFAULT_REFERENCE === 'ארון תקשורת', 'ברירת המחדל נשארה ארון תקשורת', RF_DEFAULT_REFERENCE);
// המקורות שנוספו אינם פרופיל מרחק — רק ארון תקשורת ו-wifi.
check(!isCabinetReference('ללוח חשמל') && !isCabinetReference('לאנטנות'), 'מקור שנוסף אינו פרופיל מרחק');
check(isCabinetReference('ארון תקשורת') && isCabinetReference('wifi'), 'ארון תקשורת ו-wifi נמדדים כפרופיל');
check(!isCabinetReference('אנטנות בסביבה'), 'אנטנות בסביבה — לא פרופיל');
check(!isCabinetReference(''), 'ריק — לא פרופיל');

// A new RF table opens with a five-row profile — the same shape as ELF, for the
// same reason: "add table" is now one tap away from a filled grid and the
// "הוספת נקודת מדידה" modal has been removed. Cabinet and non-cabinet share the
// layout; the reference label stays accepted for future divergence.
const cabinetRows = newRfRows('ארון תקשורת');
check(cabinetRows.length === 5, 'ארון תקשורת נפתח עם 5 שורות', String(cabinetRows.length));
check(
  cabinetRows.map((r) => r.distance).join(',') === '0.3,0.5,1,1.5,2',
  'המרחקים הם 0.3 · 0.5 · 1 · 1.5 · 2',
  cabinetRows.map((r) => r.distance).join(','),
);
check(newRfRows('wifi').length === 5, 'wifi נפתח גם הוא עם 5 שורות');
check(newRfRows('אנטנות בסביבה').length === 5, 'אנטנות בסביבה — חמש שורות גם היא');
check(newRfRows('אנטנות בסביבה')[0].distance === '0.3', 'שורה ראשונה — פרופיל רגיל');
check(
  cabinetRows.every((r) => r.height === '1' && r.threshold === '40'),
  'גובה וסף ייחוס ממולאים בכל שורה',
);

// ── The protocol heading ────────────────────────────────────────────
//
// The field holds the radiating source; the fixed opening is added when the
// document is built. Reports written before that split stored the whole
// sentence, and printing it as-is would put the opening in twice.

console.log('\nכותרת הפרוטוקול:');
check(
  composeProtocolTitle('elf', 'לוח חשמל ראשי') === 'פרוטוקול רשמי - מדידת שדה מגנטי ELF בלוח חשמל ראשי',
  'ELF — הפתיח מתחבר לשם המקור',
  composeProtocolTitle('elf', 'לוח חשמל ראשי'),
);
check(
  composeProtocolTitle('rf', 'ארון תקשורת') ===
    'פרוטוקול רשמי - מדידת צפיפות הספק קרינה אלקטרומגנטית RF – ארון תקשורת',
  'RF — הפתיח מתחבר לשם המקור',
  composeProtocolTitle('rf', 'ארון תקשורת'),
);
check(
  composeProtocolTitle('elf', 'פרוטוקול רשמי - מדידת שדה מגנטי ELF בלוח ראשי') ===
    'פרוטוקול רשמי - מדידת שדה מגנטי ELF בלוח ראשי',
  'כותרת ישנה שכבר מכילה את הפתיח לא מוכפלת',
  composeProtocolTitle('elf', 'פרוטוקול רשמי - מדידת שדה מגנטי ELF בלוח ראשי'),
);
check(stripProtocolPrefix('elf', 'פרוטוקול רשמי - מדידת שדה מגנטי ELF בלוח ראשי') === 'לוח ראשי', 'הפתיח מוסר בקריאה');
check(stripProtocolPrefix('elf', 'לוח ראשי') === 'לוח ראשי', 'שם מקור נקי נשאר כמות שהוא');

// Reading an old report strips the prefix, so the field shows the source alone.
const legacy = StoredReportSchema.parse({
  ...sampleReport(),
  elfProtocols: [{
    title: 'פרוטוקול רשמי - מדידת שדה מגנטי ELF בקומה 26',
    referenceLabel: 'ללוח', normalizationFactor: '1', normalizationNote: '',
    rows: [elfRow('נקודה')],
  }],
  rfProtocols: [],
}) as { elfProtocols: Array<{ title: string }> };
check(legacy.elfProtocols[0].title === 'קומה 26', 'דוח ישן נטען עם שם המקור בלבד', legacy.elfProtocols[0].title);

// A blank source no longer blocks saving or generation.
const blankTitle = ReportSchema.safeParse({
  ...sampleReport(),
  elfProtocols: [{
    title: '', referenceLabel: 'ללוח', normalizationFactor: '1', normalizationNote: '',
    rows: [elfRow('נקודה')],
  }],
  rfProtocols: [],
});
check(blankTitle.success, 'שם מקור מקרין ריק אינו חוסם שמירה');

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
