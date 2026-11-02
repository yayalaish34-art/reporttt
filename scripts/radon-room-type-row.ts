/**
 * Adds the "sealed or regular room" row to the radon template's notes table.
 *
 * Cloned from the sealing row beside it, so it carries that row's borders and fonts. The
 * paragraph ids come off the copy, since Word expects each to appear once. Run once; it
 * refuses a template that already has the row.
 *
 *   npx tsx scripts/radon-room-type-row.ts [--apply]
 */
import PizZip from 'pizzip';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../templates/radon-template.docx');
const APPLY = process.argv.includes('--apply');

const bytes = readFileSync(FILE);
console.log(`התבנית הנוכחית: sha256 ${createHash('sha256').update(bytes).digest('hex')}`);

const zip = new PizZip(bytes);
let xml = zip.file('word/document.xml')!.asText();
if (xml.includes('{noteRoomType}')) {
  console.error('התבנית כבר כוללת את השורה.');
  process.exit(1);
}

const rows = [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
const sealing = rows.find((row) => row.includes('{noteSealing}'));
if (!sealing) {
  console.error('✗ שורת רמת האיטום לא נמצאה');
  process.exit(1);
}

const question = [...sealing.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].find((m) => m[1].includes('רמת האיטום'));
if (!question) {
  console.error('✗ טקסט השאלה לא נמצא');
  process.exit(1);
}

const added = sealing
  .replace(question[0], '<w:t xml:space="preserve">סוג החדר: רגיל / אטום</w:t>')
  .replace('{noteSealing}', '{noteRoomType}')
  .replace(/ w14:(paraId|textId)="[^"]*"/g, '');

xml = xml.replace(sealing, added + sealing);
console.log('  ✓ נוספה שורה: סוג החדר → {noteRoomType}');

if (!APPLY) {
  console.log('\nהרצה יבשה. להחלה: npx tsx scripts/radon-room-type-row.ts --apply');
  process.exit(0);
}

zip.file('word/document.xml', xml);
const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(FILE, out);
console.log(`נכתב ${FILE} — sha256 ${createHash('sha256').update(out).digest('hex')}`);
