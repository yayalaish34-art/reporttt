/**
 * The radon report: the template's fields, the loop, and the verdict rule.
 *
 * The verdict is the part worth pinning. It is not "is the reading over the
 * limit" — it is whether the reading *plus its uncertainty* reaches the action
 * level, and which action level applies depends on the site kind. A laboratory
 * that returns 480 ± 10% has not shown a workplace to be under 500, and a
 * residence is held to 200 rather than 500 in the first place.
 *
 *   npx tsx scripts/smoke-radon.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { mergeDocx } from '../src/lib/docx/merge-docx';
import { findMarkedRegions } from '../src/lib/docx/marked-runs';
import { textOf } from '../src/lib/docx/ooxml';
import { buildRadonMergeData, radonFileName } from '../src/lib/radon-mapper';
import { RadonReportSchema, RADON_VERDICTS, type DetectorRow } from '../src/lib/radon-schema';
import { actionLevel, combinedValue, computeRadonFindings, describeRadonFindings, radonVerdict } from '../src/lib/radon-rules';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = resolve(ROOT, 'templates/radon-template.docx');

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const detector = (over: Partial<DetectorRow> = {}): DetectorRow => ({
  detectorNumber: '19649', roomName: 'חדר מטבחון', floor: '1-', testLength: 'ארוכה',
  ventilation: 'ת.מ.ר', placedAt: '06/05/26', collectedAt: '16/08/26',
  concentration: '20', uncertainty: '10', threshold: '500', recommendation: '', ...over,
});

const report = RadonReportSchema.parse({
  referenceNumber: '2608270001',
  reportDate: '2026-08-27',
  recipientName: 'דותן יצחקי',
  companyName: 'איחוד הצלה ישראל 1221',
  addressLine: 'קיבוץ גלויות 5',
  city: 'ירושלים',
  phone: '052-3542952',
  email: 'dotani@1221.org.il',
  siteKind: 'מקום עבודה',
  notesRooms: 'חדרים בקומת 1-',
  detectors: [
    detector(),
    detector({ detectorNumber: '19715', roomName: 'חדר קטן', concentration: '17' }),
    detector({ detectorNumber: '19734', roomName: 'חדר מרכז ציוד רפואי', concentration: '28', uncertainty: '28' }),
  ],
});

// ── The template ────────────────────────────────────────────────────

console.log('התבנית:');
const templateXml = new PizZip(readFileSync(TEMPLATE)).file('word/document.xml')!.asText();
const marked = findMarkedRegions(templateXml).map((r) => r.text.trim()).filter(Boolean);
check(marked.length > 0, 'יש קטע מסומן לניסוח מחדש', `${marked.length} קטעים`);
check(
  marked.every((t) => t.includes('רמת הפעולה') || t.includes('מיקומים')),
  'הקטעים המסומנים הם משפט הסיכום בלבד',
  marked.map((t) => t.slice(0, 40)).join(' / '),
);
for (const field of ['{recipientName}', '{companyName}', '{siteKind}', '{#detectors}', '{/detectors}', '{concentration}']) {
  check(templateXml.includes(field), `התבנית מכילה ${field}`);
}

// ── The merge ───────────────────────────────────────────────────────

console.log('\nהמיזוג:');
const merged = mergeDocx(readFileSync(TEMPLATE), buildRadonMergeData(report));
const text = textOf(new PizZip(merged).file('word/document.xml')!.asText());

check(!/\{[a-zA-Z][\w.]*\}/.test(text), 'לא נשארו שדות שלא הוחלפו', (text.match(/\{[a-zA-Z][\w.]*\}/g) ?? []).join(' '));
check(text.includes('דותן יצחקי') && text.includes('איחוד הצלה ישראל 1221'), 'פרטי מקבל השירות רונדרו');
check(text.includes('052-3542952') && text.includes('dotani@1221.org.il'), 'טלפון ודוא"ל רונדרו');
for (const row of report.detectors) {
  check(text.includes(row.roomName), `שורת "${row.roomName}" רונדרה`);
}
check(text.includes('19715') && text.includes('19734'), 'הלולאה שכפלה את כל הגלאים');

// The rows are numbered across the survey, like the radiation protocols.
const numbered = report.detectors.map((_, i) => String(i + 1));
const data = buildRadonMergeData(report) as { detectors: Array<{ pointNumber: string }> };
check(data.detectors.map((d) => d.pointNumber).join(',') === numbered.join(','), 'הגלאים ממוספרים ברצף');

// ── The verdict ─────────────────────────────────────────────────────

console.log('\nכלל ההמלצה:');
check(actionLevel('מקום עבודה') === 500, 'מקום עבודה — 500 בקרל/מ״ק');
check(actionLevel('מגורים') === 200, 'מגורים — 200 בקרל/מ״ק');

check(combinedValue('480', '10') === 528, 'אי הוודאות מחושבת כאחוז מהריכוז', String(combinedValue('480', '10')));
check(combinedValue('20', '') === 20, 'בלי אי ודאות — הריכוז עצמו');
check(combinedValue('', '10') === null, 'בלי ריכוז — אין ערך');

check(radonVerdict(detector({ concentration: '20', uncertainty: '10' })) === RADON_VERDICTS.ok, 'הרבה מתחת לסף — תקין');
check(
  radonVerdict(detector({ concentration: '480', uncertainty: '10' })) === RADON_VERDICTS.exceeds,
  '480 עם 10% אי ודאות עובר את 500 — לא תקין',
  radonVerdict(detector({ concentration: '480', uncertainty: '10' })),
);
check(
  radonVerdict(detector({ concentration: '480', uncertainty: '0' })) === RADON_VERDICTS.ok,
  'אותו 480 בלי אי ודאות — תקין',
);
check(
  radonVerdict(detector({ concentration: '20', uncertainty: '10', testLength: 'קצרה' })) === RADON_VERDICTS.shortOk,
  'בדיקה קצרה תקינה מפנה לבדיקה ארוכה, לא מכריזה על תקינות',
);
check(radonVerdict(detector({ concentration: '' })) === '', 'שורה בלי ריכוז נשארת ריקה');
check(
  radonVerdict(detector({ concentration: '20', uncertainty: '46' })) === '',
  'אי ודאות מעל 22% לא מייצרת פסק כלל',
);
check(
  radonVerdict(detector({ concentration: '20', uncertainty: '22' })) === RADON_VERDICTS.ok,
  'בדיוק 22% עדיין מתקבל',
);
check(
  radonVerdict(detector({ concentration: '20', recommendation: 'נוסח ידני' })) === 'נוסח ידני',
  'קביעה של הבודק גוברת על החישוב',
);

// ── The brief handed to the model ───────────────────────────────────

console.log('\nהממצאים לניסוח:');
const clean = describeRadonFindings(computeRadonFindings(report));
check(clean.includes('אף מיקום אינו מגיע לרמת הפעולה'), 'סקר תקין — "בכל"', clean.split('\n').slice(-2)[0]);

const mixed = RadonReportSchema.parse({
  ...report,
  detectors: [detector(), detector({ roomName: 'מחסן', concentration: '620' })],
});
const mixedBrief = describeRadonFindings(computeRadonFindings(mixed));
check(mixedBrief.includes('יש לנסח "בחלק מ…"'), 'חריגה חלקית — "בחלק מ…"');
check(mixedBrief.includes('"מחסן"'), 'החדר החורג מצוין בשמו');

const allOver = RadonReportSchema.parse({
  ...report,
  detectors: [detector({ concentration: '700' }), detector({ roomName: 'מחסן', concentration: '620' })],
});
check(describeRadonFindings(computeRadonFindings(allOver)).includes('יש לנסח "בכל", אסור לנסח "בחלק"'), 'חריגה מלאה — "בכל"');

// ── A private customer has no company line ──────────────────────────
//
// The radon template was built from a company's report and printed the company
// line unconditionally: a private customer got an empty line under their name
// and a labelled table row with nothing in it.

console.log('\nלקוח פרטי מול חברה:');

const rendered = (over: Record<string, unknown>) => {
  const merged = mergeDocx(readFileSync(TEMPLATE), buildRadonMergeData(RadonReportSchema.parse({ ...report, ...over })));
  return textOf(new PizZip(merged).file('word/document.xml')!.asText());
};

const asCompany = rendered({ customerType: 'company' });
const asPrivate = rendered({ customerType: 'private' });

check(asCompany.includes('איחוד הצלה ישראל 1221'), 'חברה — שם החברה מודפס');
check(asCompany.includes('שם החברה'), 'חברה — שורת "שם החברה" בטבלה מודפסת');
check(!asPrivate.includes('איחוד הצלה ישראל 1221'), 'לקוח פרטי — שם החברה אינו מודפס');
check(!asPrivate.includes('שם החברה'), 'לקוח פרטי — גם התווית "שם החברה" נעלמת');
check(asPrivate.includes('דותן יצחקי'), 'לקוח פרטי — שמו כן מודפס');
check(
  !/\{[a-zA-Z][\w.]*\}/.test(asPrivate),
  'לקוח פרטי — לא נשארו שדות שלא הוחלפו',
  (asPrivate.match(/\{[a-zA-Z][\w.]*\}/g) ?? []).join(' '),
);

console.log('\nשם הקובץ:');
check(radonFileName(report).includes('דוח ראדון') && radonFileName(report).endsWith('.docx'), radonFileName(report));

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
