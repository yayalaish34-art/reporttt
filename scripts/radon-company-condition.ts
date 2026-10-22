/**
 * Wraps the radon template's two company lines in `{#isCompany}`.
 *
 * The template was built from a company's report, so it prints a company line
 * unconditionally: the address block's second line, and the "שם החברה" row of
 * the customer table. A private customer has neither, and printed both — an
 * empty line under their name, and a labelled table row with nothing in it.
 *
 * The tags go on the surrounding paragraph and table row rather than inside
 * them, so that with `paragraphLoop` the whole line disappears rather than
 * leaving an empty one behind.
 *
 *   npx tsx scripts/radon-company-condition.ts [--apply]
 */
import PizZip from 'pizzip';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = resolve(ROOT, 'templates/radon-template.docx');
const APPLY = process.argv.includes('--apply');

const textOf = (fragment: string) =>
  [...fragment.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');

const zip = new PizZip(readFileSync(FILE));
let xml = zip.file('word/document.xml')!.asText();

if (xml.includes('{#isCompany}')) {
  console.log('התבנית כבר מותנית. אין מה לעשות.');
  process.exit(0);
}

/** A bare paragraph carrying only a tag, for opening and closing a condition. */
const tagParagraph = (tag: string) =>
  `<w:p><w:r><w:t xml:space="preserve">${tag}</w:t></w:r></w:p>`;

let wrapped = 0;

// ── 1. The company line in the address block ────────────────────────
//
// The paragraph that holds nothing but {companyName}, directly under the
// recipient's name.
const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
const addressLine = paragraphs.find((m) => textOf(m[0]).trim() === '{companyName}');
if (!addressLine) {
  console.error('✗ לא נמצאה פסקת {companyName} בבלוק הכתובת');
  process.exit(1);
}
xml = xml.replace(
  addressLine[0],
  tagParagraph('{#isCompany}') + addressLine[0] + tagParagraph('{/isCompany}'),
);
wrapped++;
console.log('  ✓ שורת שם החברה בבלוק הכתובת הותנתה');

// ── 2. The "שם החברה" row of the customer table ─────────────────────
//
// Wrapped as a whole row: the label and the value are one line on the page and
// have to appear or vanish together.
const rows = [...xml.matchAll(/<w:tr[\s\S]*?<\/w:tr>/g)];
const companyRow = rows.find((m) => {
  const t = textOf(m[0]);
  return t.includes('שם החברה') && t.includes('{companyName}');
});
if (!companyRow) {
  console.error('✗ לא נמצאה שורת "שם החברה" בטבלת מקבל השירות');
  process.exit(1);
}

/**
 * The tags sit in the row's first cell, around its paragraph.
 *
 * docxtemplater removes a table row whose opening and closing tags are inside
 * it — the documented way to make a row conditional. A bare paragraph before
 * the row would be invalid inside a table.
 */
const firstCell = companyRow[0].match(/<w:tc>[\s\S]*?<\/w:tc>/)![0];
const firstParagraph = firstCell.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/)![0];
const openedCell = firstCell.replace(
  firstParagraph,
  firstParagraph.replace(/<w:t([^>]*)>/, '<w:t$1>{#isCompany}'),
);

const lastCellMatch = [...companyRow[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].pop()!;
const lastParagraph = lastCellMatch[0].match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/)![0];
const closedCell = lastCellMatch[0].replace(
  lastParagraph,
  lastParagraph.replace(/<\/w:t>/, '{/isCompany}</w:t>'),
);

const nextRow = companyRow[0].replace(firstCell, openedCell).replace(lastCellMatch[0], closedCell);
xml = xml.replace(companyRow[0], nextRow);
wrapped++;
console.log('  ✓ שורת "שם החברה" בטבלה הותנתה');

console.log(`\nהותנו ${wrapped} מקומות · {#isCompany}: ${(xml.match(/\{#isCompany\}/g) ?? []).length} · {/isCompany}: ${(xml.match(/\{\/isCompany\}/g) ?? []).length}`);

if (!APPLY) {
  console.log('הרצה יבשה. להחלה: npx tsx scripts/radon-company-condition.ts --apply');
  process.exit(0);
}

zip.file('word/document.xml', xml);
writeFileSync(FILE, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`נכתב ${FILE}`);
