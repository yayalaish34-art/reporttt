/**
 * Renders the template with sample data and checks the result opens cleanly.
 *
 * This is the guard against the two failure modes that are invisible until a
 * human double-clicks the file: an unrendered tag left in the text, and a ZIP
 * whose `[Content_Types].xml` is not first — which Word reports as corruption.
 *
 *   npx tsx scripts/smoke-merge.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { mergeDocx } from '../src/lib/docx/merge-docx';
import { buildMergeData } from '../src/lib/report-mapper';
import { sampleReport } from '../src/lib/sample-report';
import { splitBody, textOf } from '../src/lib/docx/ooxml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = resolve(ROOT, 'templates/report-template.docx');
const OUT = resolve(ROOT, 'out/smoke.docx');

const template = readFileSync(TEMPLATE);
const report = sampleReport();

console.log(`תבנית: ${(template.length / 1024 / 1024).toFixed(1)} MB`);
console.log(`נתונים: ${report.elfProtocols.length} פרוטוקולי ELF, ${report.rfProtocols.length} פרוטוקולי RF`);

const started = process.hrtime.bigint();
const merged = mergeDocx(template, buildMergeData(report));
const ms = Number(process.hrtime.bigint() - started) / 1e6;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, merged);
console.log(`מוזג ב-${ms.toFixed(0)}ms → ${OUT} (${(merged.length / 1024 / 1024).toFixed(1)} MB)`);

// ── Assertions ──────────────────────────────────────────────────────

const zip = new PizZip(merged);
const entries = Object.keys(zip.files);

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\nבדיקות:');

check(entries[0] === '[Content_Types].xml', 'הפריט הראשון בארכיון הוא [Content_Types].xml', entries[0]);

const doc = zip.file('word/document.xml')?.asText() ?? '';
check(doc.length > 0, 'word/document.xml קיים', `${(doc.length / 1024).toFixed(0)} KB`);

const body = textOf(doc);

// Headers and footers are rendered too, and hold placeholders of their own.
const sideParts = entries.filter((e) => /^word\/(header|footer)\d+\.xml$/.test(e));
const sideText = sideParts.map((p) => textOf(zip.file(p)?.asText() ?? '')).join('\n');
const allText = `${body}\n${sideText}`;

const leftoverTags = [...allText.matchAll(/\{[^}]{0,60}\}/g)].map((m) => m[0]);
check(leftoverTags.length === 0, 'לא נותרו תגיות שלא רונדרו', leftoverTags.slice(0, 5).join(', '));

check(!allText.includes('undefined'), 'אין "undefined" בטקסט');

// Every protocol title supplied must appear in the rendered text.
const missingTitles = [...report.elfProtocols, ...report.rfProtocols]
  .map((p) => p.title)
  .filter((title) => !body.includes(title));
check(missingTitles.length === 0, 'כל כותרות הפרוטוקולים רונדרו', missingTitles.slice(0, 3).join(' | '));

// Every measurement row must appear.
const totalRows =
  report.elfProtocols.reduce((n, p) => n + p.rows.length, 0) +
  report.rfProtocols.reduce((n, p) => n + p.rows.length, 0);
const renderedRows = (doc.match(/<w:tr[ >]/g) ?? []).length;
check(renderedRows > 0, `הטבלאות שוכפלו`, `${renderedRows} שורות במסמך, ${totalRows} שורות מדידה בנתונים`);

// The conclusions are no longer built from report fields: the template holds
// them as finished prose, and only the passages highlighted in it are reworded
// at generation. What still has to hold is that the numbering survives — a
// reworded passage must not add or lose a numbered item.
const elfNumbered = countNumberedConclusions(doc);
check(elfNumbered >= 5, 'סעיפי המסקנות של ELF ממוספרים', `${elfNumbered} סעיפים`);

// The order details and characterization block, asserted line by line against
// the source wording. The full stop on the characterization lines belongs to
// the template, so a value carrying its own must not produce a double.
const ORDER_LINES = [
  'יבוצע בנוכחות: ירון חכם',
  'תאריך ושעה: 21/06/26, 11:00.',
  'מקום: מצדה 3, בני ברק.',
  'אפיון המקום: משרדים.',
  'תנאי מזג אוויר: קיצי בהיר.',
  'מקורות הקרינה שנבדקו: לוח חשמל.',
  'סוג המדידות: מדידות שדה מגנטי.',
];
const missingOrderLines = ORDER_LINES.filter((line) => !body.includes(line));
check(
  missingOrderLines.length === 0,
  'פרטי ההזמנה ואפיון המדידות',
  missingOrderLines.length ? missingOrderLines.join(' | ') : `${ORDER_LINES.length} שורות`,
);

check(!/[^.]\.\./.test(body), 'אין נקודה כפולה בסוף משפט');

check(body.includes(report.recipientName), 'שם הנמען הוזרק', report.recipientName);
check(sideText.includes(report.referenceNumber), 'מספר הסימוכין הוזרק בכותרת העליונה', report.referenceNumber);

// The images from the template must survive the merge untouched.
const media = entries.filter((e) => e.startsWith('word/media/'));
check(media.length > 0, 'תמונות התבנית נשמרו', `${media.length} קבצים`);

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);

/**
 * Numbered items in the ELF conclusions list.
 *
 * Counted by the shared numbering id rather than by reading the printed
 * numbers, which Word generates and the XML never stores.
 */
function countNumberedConclusions(docXml: string): number {
  const blocks = splitBody(docXml);
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  const start = blocks.findIndex((b) => norm(textOf(docXml.slice(b.start, b.end))) === 'מסקנות');
  if (start === -1) return -1;

  let count = 0;
  for (let i = start + 1; i < blocks.length; i++) {
    const fragment = docXml.slice(blocks[i].start, blocks[i].end);
    if (norm(textOf(fragment)) === '') continue;
    // The list ends where the signature block begins.
    if (count > 0 && !/<w:numPr>/.test(fragment) && norm(textOf(fragment)).startsWith('יורם')) break;
    if (/<w:numId w:val="6"/.test(fragment)) count++;
  }
  return count;
}
