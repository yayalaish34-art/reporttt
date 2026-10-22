/**
 * Checks the recipient block and the page header for both customer kinds.
 *
 * These are the two places where a wrong value is hardest to spot: the header
 * repeats on every page, and the recipient block reads as correct even when it
 * names the wrong person. Both are asserted against the exact expected lines.
 *
 *   npx tsx scripts/smoke-recipient.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { mergeDocx } from '../src/lib/docx/merge-docx';
import { buildMergeData } from '../src/lib/report-mapper';
import { sampleReport } from '../src/lib/sample-report';
import { ReportSchema } from '../src/lib/report-schema';
import { textOf } from '../src/lib/docx/ooxml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(resolve(ROOT, 'templates/report-template.docx'));

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Renders a report and returns the visible text of the body and the header. */
function render(report: ReturnType<typeof sampleReport>, name: string) {
  const bytes = mergeDocx(TEMPLATE, buildMergeData(report));
  const out = resolve(ROOT, `out/${name}.docx`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);

  const zip = new PizZip(bytes);
  const body = textOf(zip.file('word/document.xml')!.asText());
  const header = textOf(zip.file('word/header1.xml')!.asText());
  return { body, header, out };
}

/** The paragraph texts of the recipient block, between "לכבוד" and the subject. */
function recipientBlock(bytes: string): string[] {
  const lines = bytes
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines;
}

// ── Company customer ────────────────────────────────────────────────

console.log('לקוח חברה:');
const company = sampleReport();
company.reportDate = '2026-06-23';
const c = render(company, 'recipient-company');

check(c.body.includes('ירון חכם - רמ"ד אחזקה ובינוי'), 'שורת איש הקשר עם התפקיד');
check(c.body.includes('כרטיסי אשראי לישראל בע"מ'), 'שורת שם החברה מופיעה');
check(c.body.includes('תפוצות ישראל 13'), 'כתובת');
check(c.body.includes('גבעתיים'), 'עיר');
check(c.body.includes('נייד : 052-2857557'), 'טלפון');
check(c.body.includes('yaron.haham@icc.co.il'), 'דוא"ל');

console.log('  כותרת עליונה:');
check(c.header.includes('יום שלישי'), 'יום בשבוע', 'יום שלישי');
check(c.header.includes(`ח' תמוז תשפ"ו`), 'תאריך עברי', `ח' תמוז תשפ"ו`);
check(c.header.includes('23 יוני 2026'), 'תאריך לועזי', '23 יוני 2026');
check(c.header.includes('סימוכין  2126062303'), 'סימוכין');

// ── Private customer ────────────────────────────────────────────────

console.log('\nלקוח פרטי:');
const priv = ReportSchema.parse({
  ...sampleReport(),
  customerType: 'private',
  recipientName: 'דנה לוי',
  recipientTitle: 'רמ"ד אחזקה', // deliberately set: it must be ignored
  companyName: 'כרטיסי אשראי לישראל בע"מ', // also deliberately set
  reportDate: '2026-08-24',
});
const p = render(priv, 'recipient-private');

check(p.body.includes('דנה לוי'), 'שם הלקוח הפרטי מופיע');
check(!p.body.includes('דנה לוי - '), 'התפקיד אינו מודפס אחרי השם');
check(!p.body.includes('רמ"ד אחזקה'), 'התפקיד אינו מופיע כלל');
check(!recipientBlock(p.body).includes('כרטיסי אשראי לישראל בע"מ'), 'שורת שם החברה הושמטה');
check(p.body.includes('תפוצות ישראל 13'), 'כתובת נשמרה');
check(p.body.includes('גבעתיים'), 'עיר נשמרה');

console.log('  כותרת עליונה:');
check(p.header.includes('יום שני'), 'יום בשבוע', 'יום שני');
check(p.header.includes(`י"א אלול תשפ"ו`), 'תאריך עברי', `י"א אלול תשפ"ו`);
check(p.header.includes('24 אוגוסט 2026'), 'תאריך לועזי', '24 אוגוסט 2026');

// ── Formatting ──────────────────────────────────────────────────────

console.log('\nעיצוב:');
const doc = new PizZip(readFileSync(resolve(ROOT, 'out/recipient-company.docx')))
  .file('word/document.xml')!
  .asText();

// Searched by a prefix free of `"` and `&`: those are escaped as entities in the
// XML, so the rendered value does not appear there verbatim.
for (const [label, value] of [
  ['שם החברה', 'כרטיסי אשראי לישראל'],
  ['עיר', 'גבעתיים'],
]) {
  const at = doc.indexOf(value);
  if (at === -1) {
    check(false, `${label} נמצא במסמך`, 'לא נמצא');
    continue;
  }
  const paragraph = doc.slice(doc.lastIndexOf('<w:p', at), at);
  const bold = /<w:b\/>/.test(paragraph) && /<w:bCs\/>/.test(paragraph);
  const underlined = /<w:u w:val="single"\/>/.test(paragraph);
  check(bold && underlined, `${label} מודגש עם קו תחתון`, `מודגש=${bold} קו=${underlined}`);
}

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
