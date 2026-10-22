/**
 * Checks the three cover sentences for every survey scope.
 *
 * All three name the surveyed frequency ranges, and in the source document all
 * three had them written in by hand. The failure this guards against is an
 * ELF-only report whose cover still claims radio frequencies were measured —
 * wrong in a way that reads as perfectly normal.
 *
 *   npx tsx scripts/smoke-wording.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { mergeDocx } from '../src/lib/docx/merge-docx';
import { buildMergeData } from '../src/lib/report-mapper';
import { sampleReport } from '../src/lib/sample-report';
import { ReportSchema } from '../src/lib/report-schema';
import { textOf } from '../src/lib/docx/ooxml';
import type { SurveyScope } from '../src/lib/report-text';
import { mentionsWrongRange } from '../src/lib/ai-text';
import { stripUnusedSurvey } from '../src/lib/docx/survey-sections';
import { stripUnusedPermitRow } from '../src/lib/docx/permit-rows';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(resolve(ROOT, 'templates/report-template.docx'));

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const SITE = 'משרדי חברת כ.א.ל, מוקד בני ברק';

/** Renders a report at the given scope and returns its visible body text. */
function renderAt(scope: SurveyScope): string {
  const report = ReportSchema.parse({ ...sampleReport(), surveyScope: scope, siteName: SITE, measurementDate: '21/06/26' });
  const bytes = mergeDocx(TEMPLATE, buildMergeData(report), {
    rewrite: (xml) => stripUnusedPermitRow(stripUnusedSurvey(xml, scope), scope),
  });
  return textOf(new PizZip(bytes).file('word/document.xml')!.asText());
}

interface Expectation {
  scope: SurveyScope;
  label: string;
  /** Lines that must appear verbatim. */
  present: string[];
  /** Phrases that must not appear anywhere on the cover. */
  absent: string[];
}

const CASES: Expectation[] = [
  {
    scope: 'both',
    label: 'סקר משולב',
    present: [
      `סקר בטיחות קרינה אלקטרומגנטית (אל מ"ג) בתדירויות רשת החשמל ורדיו ב${SITE}`,
      `בתאריך 21/06/26 בוצעו מדידות לקביעת רמת השדה האלקטרומגנטי בתדירויות רשת החשמל ורדיו ב${SITE}`,
      'המדידות בוצעו במכשיר מדידה תקני למדידות ELF ו- RF, ראה פרטים בהמשך.',
    ],
    absent: [],
  },
  {
    scope: 'elf',
    label: 'ELF בלבד',
    present: [
      `סקר בטיחות קרינה אלקטרומגנטית (אל מ"ג) בתדירויות רשת החשמל ב${SITE}`,
      `בתאריך 21/06/26 בוצעו מדידות לקביעת רמת השדה האלקטרומגנטי בתדירויות רשת החשמל ב${SITE}`,
      'המדידות בוצעו במכשיר מדידה תקני למדידות ELF, ראה פרטים בהמשך.',
    ],
    // The cover must not offer radio anywhere, in either language.
    absent: ['רשת החשמל ורדיו', 'ELF ו- RF'],
  },
  {
    scope: 'rf',
    label: 'RF בלבד',
    present: [
      `סקר בטיחות קרינה אלקטרומגנטית (אל מ"ג) בתדירויות רדיו ב${SITE}`,
      `בתאריך 21/06/26 בוצעו מדידות לקביעת רמת השדה האלקטרומגנטי בתדירויות רדיו ב${SITE}`,
      'המדידות בוצעו במכשיר מדידה תקני למדידות RF, ראה פרטים בהמשך.',
    ],
    absent: ['רשת החשמל ורדיו', 'ELF ו- RF'],
  },
];

for (const testCase of CASES) {
  console.log(`\n${testCase.label}:`);
  const body = renderAt(testCase.scope);
  // Only the cover is examined: the appendices legitimately discuss both ranges.
  const cover = body.slice(0, body.indexOf('פרטי ההזמנה'));

  for (const line of testCase.present) {
    check(cover.includes(line), truncate(line));
  }
  for (const phrase of testCase.absent) {
    check(!cover.includes(phrase), `אינו מזכיר "${phrase}" בעמוד הפתיחה`);
  }
}

// ── The body, not only the cover ────────────────────────────────────
//
// The cover was worded per scope from the start, but the body was not: both survey
// sections were printed whatever was measured, because only their tables and conclusion
// lists are loops — the heading, the instrument specification, the method text and the
// threshold explanation around them are plain paragraphs. An ELF-only report therefore
// named the RF meter and its calibration date, and printed the µW/cm² thresholds, for a
// measurement nobody took.

console.log('\nמקטעי הסקר בגוף הדוח:');

const ELF_HEADING = 'סקר בטיחות קרינה אלקטרומגנטית מרשת החשמל (ELF)';
const RF_HEADING = 'סקר בטיחות קרינה אלקטרומגנטית בתדירויות רדיו (RF)';
/** Names only in the RF instrument specification, and only inside the RF section. */
const RF_INSTRUMENT = 'LATNEX';
/** The RF threshold explanation — µW/cm² figures that mean nothing without an RF survey. */
const RF_THRESHOLDS = 'ערך הסף הבריאותי הינו 200';
/** The general appendix recommending a periodic check; it names both ranges by design. */
const APPENDIX = 'המלצה לבדיקה תקופתית';

const bodyBoth = renderAt('both');
check(bodyBoth.includes(ELF_HEADING) && bodyBoth.includes(RF_HEADING), 'סקר משולב — שני המקטעים מודפסים');

const bodyElf = renderAt('elf');
check(bodyElf.includes(ELF_HEADING), 'ELF בלבד — מקטע ELF מודפס');
check(!bodyElf.includes(RF_HEADING), 'ELF בלבד — כותרת מקטע ה-RF אינה מודפסת');
check(!bodyElf.includes(RF_INSTRUMENT), 'ELF בלבד — מכשיר ה-RF אינו מודפס');
check(!bodyElf.includes(RF_THRESHOLDS), 'ELF בלבד — הסבר ספי ה-RF אינו מודפס');
check(bodyElf.includes(APPENDIX), 'ELF בלבד — נספח ההמלצות הכללי נשאר');

/* ── טבלת היתרי הבודק ──────────────────────────────────────────────
 *
 * שתי השורות (היתר ELF והיתר RF) כתובות בתבנית כטקסט קשיח ולא כלולאה, ולכן
 * צמצום נתוני המיזוג לבדו לא משנה דבר במסמך — הן נחתכות מה-XML המרונדר.
 * זו הצהרה על מי שהוסמך למדוד, ולכן היתר שלא נעשה בו שימוש הוא טענה עודפת.
 */
const ELF_PERMIT = '2031-01-4';
const RF_PERMIT = '2031-01-5';
const PERMIT_HEADING = 'סוג היתר';

check(bodyBoth.includes(ELF_PERMIT) && bodyBoth.includes(RF_PERMIT), 'סקר משולב — שני ההיתרים מודפסים');
check(bodyElf.includes(ELF_PERMIT), 'ELF בלבד — היתר ה-ELF מודפס');
check(!bodyElf.includes(RF_PERMIT), 'ELF בלבד — שורת היתר ה-RF נמחקה');
check(bodyElf.includes(PERMIT_HEADING), 'ELF בלבד — כותרת הטבלה נשארה');

const bodyRf = renderAt('rf');
check(bodyRf.includes(RF_HEADING), 'RF בלבד — מקטע RF מודפס');
check(bodyRf.includes(RF_PERMIT), 'RF בלבד — היתר ה-RF מודפס');
check(!bodyRf.includes(ELF_PERMIT), 'RF בלבד — שורת היתר ה-ELF נמחקה');
check(bodyRf.includes(PERMIT_HEADING), 'RF בלבד — כותרת הטבלה נשארה');
check(!bodyRf.includes(ELF_HEADING), 'RF בלבד — כותרת מקטע ה-ELF אינה מודפסת');
check(bodyRf.includes(RF_INSTRUMENT), 'RF בלבד — מכשיר ה-RF כן מודפס');
check(bodyRf.includes(APPENDIX), 'RF בלבד — נספח ההמלצות הכללי נשאר');

// ── Manual override ─────────────────────────────────────────────────

console.log('\nניסוח ידני:');
const manual = ReportSchema.parse({
  ...sampleReport(),
  surveyScope: 'elf',
  siteName: SITE,
  subject: 'נוסח ידני של הבודק',
  subjectAuto: false,
  openingSentence: 'משפט פתיחה שנכתב ביד',
  openingAuto: false,
});
const manualBody = textOf(new PizZip(mergeDocx(TEMPLATE, buildMergeData(manual))).file('word/document.xml')!.asText());
check(manualBody.includes('נוסח ידני של הבודק'), 'נושא ידני גובר על האוטומטי');
check(manualBody.includes('משפט פתיחה שנכתב ביד'), 'משפט פתיחה ידני גובר על האוטומטי');
check(
  manualBody.includes('המדידות בוצעו במכשיר מדידה תקני למדידות ELF, ראה פרטים בהמשך.'),
  'משפט המכשור נשאר אוטומטי גם כששאר הנוסח ידני',
);

// ── Conclusion 4 ────────────────────────────────────────────────────
// One word decides whether the report says the occupied points came out below
// the threshold. It has to follow the verdict column, and the scope word has to
// move with it: "בכל … גבוהים" would claim every occupied point exceeds.

console.log('\nסעיף 4 — נמוכים / גבוהים:');
const point = (occupancy: string, compliance: string) => ({
  description: 'עמדת ישיבה', distance: '1', height: '1',
  measured: '3', normalized: '3', occupancy, compliance,
});
const withRows = (rows: ReturnType<typeof point>[]) =>
  ReportSchema.parse({
    ...sampleReport(),
    elfProtocols: [{
      title: 'פרוטוקול רשמי - מדידת שדה מגנטי ELF בקומה 3',
      referenceLabel: 'ללוח חשמל', normalizationFactor: '1', normalizationNote: '', rows,
    }],
  });

// The low/high wording used to be computed here, and was asserted against a
// fixed sentence. It is now written by the model into the passage the template
// highlights, so there is no deterministic string left to assert — the slot
// mechanism is covered by scripts/smoke-slots.ts instead.

// ── AI guard ────────────────────────────────────────────────────────
// The model keeps to the scope it is given even when pushed, so this predicate
// is tested directly rather than by trying to provoke a bad draft.

console.log('\nהגנה על נוסח AI:');
const GUARD_CASES: Array<{ scope: SurveyScope; text: string; blocked: boolean; label: string }> = [
  { scope: 'elf', text: 'מדידות בתדירויות רשת החשמל ורדיו', blocked: true, label: 'ELF שמזכיר רדיו נחסם' },
  { scope: 'elf', text: 'מדידות ELF ו- RF', blocked: true, label: 'ELF שמזכיר RF נחסם' },
  { scope: 'elf', text: 'מדידות בתדירויות רשת החשמל', blocked: false, label: 'ELF תקין עובר' },
  { scope: 'rf', text: 'מדידות בתדירויות רשת החשמל', blocked: true, label: 'RF שמזכיר רשת חשמל נחסם' },
  { scope: 'rf', text: 'מדידות בתדירויות רדיו', blocked: false, label: 'RF תקין עובר' },
  { scope: 'both', text: 'מדידות בתדירויות רשת החשמל ורדיו', blocked: false, label: 'משולב עובר' },
];
for (const guardCase of GUARD_CASES) {
  check(Boolean(mentionsWrongRange(guardCase.text, guardCase.scope)) === guardCase.blocked, guardCase.label);
}

/* ── הערת הנרמול ─────────────────────────────────────
 *
 * המקדם אומר במה הוכפלו המדידות כדי לייצג עומס אופייני, ולכן הוא גם אומר מה היה
 * העומס בזמן המדידה. המשפט חייב להסכים איתו: מקדם 2 עם "עומס אופייני" הוא משפט
 * שסותר את עצמו.
 */
console.log('\nהערת הנרמול:');
const NORMALIZATION_CASES: Array<{ factor: string; expect: string }> = [
  { factor: '2', expect: 'מכיוון שהמדידות בוצעו בעומס מופחת נקבע נרמול לבדיקה על 2.' },
  { factor: '1', expect: 'מכיוון שהמדידות בוצעו בעומס אופייני נקבע נרמול לבדיקה על 1.' },
  { factor: '0.5', expect: 'מכיוון שהמדידות בוצעו בעומס מוגבר נקבע נרמול לבדיקה על 0.5.' },
  // מקדם ריק או לא-מספרי לא אמור להצהיר משהו על האתר.
  { factor: '', expect: 'מכיוון שהמדידות בוצעו בעומס אופייני נקבע נרמול לבדיקה על 1.' },
];
for (const c of NORMALIZATION_CASES) {
  const s0 = sampleReport();
  const r = ReportSchema.parse({
    ...s0,
    elfProtocols: [{ ...s0.elfProtocols[0], normalizationFactor: c.factor }],
  });
  const note = (buildMergeData(r) as unknown as { elfProtocols: Array<{ normalizationNote: string }> })
    .elfProtocols[0].normalizationNote;
  check(note === c.expect, `מקדם ${c.factor || '(ריק)'}`, note);
}

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);

function truncate(line: string): string {
  return line.length > 62 ? `${line.slice(0, 62)}…` : line;
}
