/**
 * Turns the fixed answers in the radon template's notes table into merge fields.
 *
 * The signed report the template was built from answered these questions for one site,
 * and the answers stayed in the template as text, so every report repeated them. The
 * source document is not in the repository, so the built template is patched in place.
 * Run once; it refuses a template that already has the fields.
 *
 *   npx tsx scripts/radon-notes-fields.ts [--apply]
 */
import PizZip from 'pizzip';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../templates/radon-template.docx');
const APPLY = process.argv.includes('--apply');

/** A piece of the row's question, and the field its answer becomes. */
const ROWS: Array<[string, string]> = [
  ['אישור כניסה לבית חדש', 'noteForm4'],
  ['עבודות להפחתת ריכוז ראדון', 'noteMitigation'],
  ['האם הנחת הגלאים ואיסופם', 'notePlacedBy'],
  ['האם מקבל השירות מאשר לבצע', 'noteSkipShort'],
  ['באזור מועד לראדון (כן', 'noteSensitiveArea'],
  ['בוצעו בחדר עבודות הרחבה', 'noteExtension'],
  ['רמת האיטום בחדר סגור', 'noteSealing'],
  ['פתחי אוורור', 'noteVentOpenings'],
  ['מערכות אוורור (מ"א)', 'noteVentSystems'],
  ['מסלולים לחדירת ראדון', 'noteRadonPaths'],
  ['פתרונות להקטנת ריכוז', 'noteSolutions'],
  ['בעל ההיתר מאשר שהבדיקה', 'noteApproved'],
];

const textOf = (fragment: string) =>
  [...fragment.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
const unescape = (t: string) => t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Rewrites a paragraph's runs to one run of `text`, keeping the first run's look. */
function setParagraph(paragraph: string, text: string): string {
  const runs = [...paragraph.matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)].map((m) => m[0]);
  const rPr = runs[0]?.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
  const pPr = paragraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  const open = paragraph.match(/^<w:p(?:\s[^>]*)?>/)?.[0] ?? '<w:p>';
  return `${open}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

const bytes = readFileSync(FILE);
console.log(`התבנית הנוכחית: sha256 ${createHash('sha256').update(bytes).digest('hex')}`);

const zip = new PizZip(bytes);
let xml = zip.file('word/document.xml')!.asText();
if (xml.includes('{noteForm4}')) {
  console.error('התבנית כבר כוללת את השדות.');
  process.exit(1);
}

const tables = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((m) => m[0]);
const table = tables.find((t) => textOf(t).includes('רמת האיטום בחדר סגור'));
if (!table) {
  console.error('✗ טבלת ההערות לא נמצאה');
  process.exit(1);
}

let patched = table;
const rows = [...table.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);

for (const [piece, field] of ROWS) {
  const row = rows.find((r) => unescape(textOf(r)).includes(piece));
  if (!row) {
    console.error(`✗ לא נמצאה שורה: ${piece}`);
    process.exit(1);
  }
  const cells = [...row.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
  const answer = cells[1];
  const paragraph = answer?.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/)?.[0];
  if (!paragraph) {
    console.error(`✗ אין תא תשובה: ${piece}`);
    process.exit(1);
  }
  const was = unescape(textOf(answer));
  let next = row.replace(answer, answer.replace(paragraph, setParagraph(paragraph, `{${field}}`)));
  // Its legend named the old scale; the answers now come from the question asked on site.
  if (field === 'noteSealing') {
    const question = cells[0].match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/)![0];
    next = next.replace(question, setParagraph(question, 'רמת האיטום בחדר: נורמלי (נ), כמעט הרמטי (כ&quot;ה), הרמטי (ה)'));
  }
  patched = patched.replace(row, next);
  console.log(`  ✓ ${piece} — "${was}" → {${field}}`);
}

xml = xml.replace(table, patched);

if (!APPLY) {
  console.log('\nהרצה יבשה. להחלה: npx tsx scripts/radon-notes-fields.ts --apply');
  process.exit(0);
}

zip.file('word/document.xml', xml);
const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(FILE, out);
console.log(`\nנכתב ${FILE} — sha256 ${createHash('sha256').update(out).digest('hex')}`);
