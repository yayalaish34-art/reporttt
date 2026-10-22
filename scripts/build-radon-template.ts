/**
 * Turns the signed radon report into a merge template.
 *
 * Same procedure as the radiation template, and the surveyor's own marking is
 * the specification: what is highlighted yellow is what changes per survey.
 * Two things are done with those marks, and which is which is decided by where
 * the mark sits.
 *
 *   - In the header block and the tables, a highlighted value is *data*. It
 *     becomes a `{field}`, and the yellow comes off — the surveyor fills it in
 *     on screen.
 *   - In section ז, the highlighted sentence is *prose*. It stays highlighted,
 *     and is reworded from the findings at generation time, exactly as the
 *     conclusions of the radiation report are.
 *
 * The measurement table is the third case: five example rows collapse into one,
 * wrapped in a loop, so a survey can have as many detectors as it took.
 *
 *   npx tsx scripts/build-radon-template.ts [--apply]
 */
import PizZip from 'pizzip';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'radon-template.docx');
const OUT = resolve(ROOT, 'templates/radon-template.docx');
const APPLY = process.argv.includes('--apply');

const textOf = (fragment: string) =>
  [...fragment.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

if (!existsSync(SOURCE)) {
  console.error(
    `לא נמצא ${SOURCE}\n\n` +
      'זהו דוח הראדון החתום שממנו נבנית התבנית. אם הקובץ שבידך הוא ‎.doc‎ ישן,\n' +
      'פתח אותו ב-Word ושמור בשם כ-‎.docx‎ בשם הזה. התבנית הבנויה עצמה נמצאת\n' +
      'ב-templates/radon-template.docx וממשיכה לעבוד — הסקריפט הזה נחוץ רק\n' +
      'כדי לבנות אותה מחדש ממסמך מקור מעודכן.',
  );
  process.exit(1);
}

const zip = new PizZip(readFileSync(SOURCE));
let xml = zip.file('word/document.xml')!.asText();

/** Rewrites a paragraph's runs to one run of `text`, keeping the first run's look. */
function setParagraph(paragraph: string, text: string, keepHighlight = false): string {
  const runs = [...paragraph.matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)].map((m) => m[0]);
  const base = runs[0] ?? '';
  let rPr = base.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '<w:rPr></w:rPr>';
  if (!keepHighlight) rPr = rPr.replace(/<w:highlight w:val="[^"]*"\s*\/>/g, '');

  const pPr = paragraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  const open = paragraph.match(/^<w:p(?:\s[^>]*)?>/)?.[0] ?? '<w:p>';
  const cleanedPPr = keepHighlight ? pPr : pPr.replace(/<w:highlight w:val="[^"]*"\s*\/>/g, '');
  return `${open}${cleanedPPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

/** Replaces the first paragraph whose text matches, and reports if it did not. */
function replaceParagraph(match: (t: string) => boolean, text: string, label: string, keepHighlight = false) {
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
  const target = paragraphs.find((m) => match(textOf(m[0]).trim()));
  if (!target) {
    console.error(`✗ לא נמצאה פסקה: ${label}`);
    process.exitCode = 1;
    return;
  }
  xml = xml.replace(target[0], setParagraph(target[0], text, keepHighlight));
  console.log(`  ✓ ${label} → ${text.slice(0, 60)}`);
}

// ── 1. The recipient block ──────────────────────────────────────────
console.log('כותרת המכתב:');
replaceParagraph((t) => t === 'דותן יצחקי', '{recipientName}', 'שם איש הקשר');
replaceParagraph((t) => t === 'איחוד הצלה ישראל 1221', '{companyName}', 'שם החברה');
replaceParagraph((t) => t === 'קיבוץ גלויות 5', '{addressLine}', 'כתובת');
replaceParagraph((t) => t === 'ירושלים', '{city}', 'ישוב');
replaceParagraph((t) => t.startsWith('טל:'), 'טל:  {phone}', 'טלפון');
replaceParagraph((t) => t.startsWith('מייל'), 'מייל : {email}', 'דוא"ל');

// ── 2. The customer table and the site kind ─────────────────────────
console.log('\nטבלת מקבל השירות:');
const CELL_FIELDS: Array<[string, string]> = [
  ['איחוד הצלה ישראל 1221', '{companyName}'],
  ['דותן יצחקי', '{recipientName}'],
  ['052-3542952', '{phone}'],
  ['קיבוץ גלויות 5', '{addressLine}'],
  ['ירושלים', '{city}'],
  ['מקום עבודה', '{siteKind}'],
  ['CR39', '{detectorType}'],
  ['RV', '{detectorBrand}'],
  ['גלית החברה לאיכות הסביבה', '{laboratory}'],
  ['חדרים בקומת 1-', '{notesRooms}'],
];
for (const [literal, field] of CELL_FIELDS) replaceParagraph((t) => t === literal, field, literal);

/**
 * The row labels were marked too, and they are not data.
 *
 * The mark reads as "this table is what changes", which is true of the table
 * and false of the word "נייד" in it. The text stays exactly as written; only
 * the yellow comes off, so that nothing but the conclusion is left marked.
 */
const LABELS = ['שם החברה', 'איש הקשר', 'נייד', 'כתובת', 'ישוב', 'סוג אתר הבדיקה'];
for (const label of LABELS) replaceParagraph((t) => t === label, label, `כותרת: ${label}`);

// ── 3. The measurement table: five rows become one loop ─────────────
console.log('\nטבלת המדידות:');
const tables = [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)];
const measurement = tables.find((m) => textOf(m[0]).includes('ריכוז ראדון'));
if (!measurement) {
  console.error('✗ טבלת המדידות לא נמצאה');
  process.exit(1);
}

const rows = [...measurement[0].matchAll(/<w:tr[\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
const dataRows = rows.filter((r) => /🚫/.test('') || textOf(r).trim().match(/^\d/));
console.log(`  שורות בטבלה: ${rows.length} · מהן שורות נתונים: ${dataRows.length}`);

const FIELDS = [
  '{#detectors}{pointNumber}',
  '{detectorNumber}',
  '{roomName}',
  '{floor}',
  '{testLength}',
  '{ventilation}',
  '{placedAt}',
  '{collectedAt}',
  '{concentration}',
  '{uncertainty}',
  '{threshold}',
  '{recommendation}{/detectors}',
];

const first = dataRows[0];
const cells = [...first.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
if (cells.length !== FIELDS.length) {
  console.error(`✗ הטבלה מכילה ${cells.length} עמודות, ולא ${FIELDS.length}`);
  process.exit(1);
}

let loopRow = first;
cells.forEach((cell, i) => {
  const paragraph = cell.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/)?.[0];
  if (!paragraph) return;
  const rebuilt = cell.replace(paragraph, setParagraph(paragraph, FIELDS[i]));
  loopRow = loopRow.replace(cell, rebuilt);
});
console.log(`  ✓ שורת הלולאה נבנתה מ-${cells.length} עמודות`);

// The remaining example rows go; the loop repeats this one per detector.
let table = measurement[0].replace(first, loopRow);
for (const row of dataRows.slice(1)) table = table.replace(row, '');
xml = xml.replace(measurement[0], table);
console.log(`  ✓ ${dataRows.length - 1} שורות דוגמה הוסרו`);

// ── 4. The conclusion sentence stays highlighted ────────────────────
console.log('\nמשפט הסיכום:');
const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
const conclusion = paragraphs.find((m) => textOf(m[0]).includes('נמדדו ערכים הנמוכים מרמת הפעולה'));
if (!conclusion) {
  console.error('✗ משפט הסיכום לא נמצא');
  process.exit(1);
}
console.log(`  ✓ נשאר מסומן בצהוב, יתנסח מהממצאים:\n     ${textOf(conclusion[0]).trim().slice(0, 120)}`);

// ── 5. Nothing else may stay yellow ─────────────────────────────────
const before = (xml.match(/<w:highlight w:val="yellow"\/>/g) ?? []).length;
console.log(`\nריצות שנשארו מסומנות: ${before} (אמורות להיות רק אלה של משפט הסיכום)`);

const stillMarked = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
  .filter((m) => /<w:highlight w:val="yellow"/.test(m[0]))
  .map((m) => textOf(m[0]).trim())
  .filter(Boolean);
stillMarked.forEach((t) => console.log(`   🟡 ${t.slice(0, 100)}`));

if (!APPLY) {
  console.log('\nהרצה יבשה. להחלה: npx tsx scripts/build-radon-template.ts --apply');
  process.exit(process.exitCode ?? 0);
}

zip.file('word/document.xml', xml);
const bytes = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(OUT, bytes);
console.log(`\nנכתב ${OUT} (${Math.round(bytes.length / 1024)}KB)`);
