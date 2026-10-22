/**
 * Reports every value marked in a Word document, and proposes a field for it.
 *
 * The workflow this belongs to:
 *
 *   1. open the document in Word and highlight every dynamic value
 *   2. run this — it lists what it found and writes `templates/field-map.json`
 *   3. fill in any field name it could not work out
 *   4. `npm run build:template` turns each marked region into its placeholder
 *
 * Marking beats matching literal text in a build script: the person doing it can
 * see the document, and the mark survives the value being reworded.
 *
 *   npx tsx scripts/scan-fields.ts [document.docx]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import {
  MARKER_COLOR,
  RESERVED_COLOR,
  countRunsWithColor,
  findMarkedRegions,
  type MarkedRegion,
} from '../src/lib/docx/marked-runs';
import { explicitFieldName } from '../src/lib/docx/apply-marks';
import { KNOWN_FIELDS, type FieldMap } from '../src/lib/field-map';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE = resolve(ROOT, 'templates/source/report-source.docx');
const MAP_PATH = resolve(ROOT, 'templates/field-map.json');

const source = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_SOURCE;
if (!existsSync(source)) {
  console.error(`הקובץ לא נמצא: ${source}`);
  process.exit(1);
}

const zip = new PizZip(readFileSync(source));
const parts = Object.keys(zip.files).filter((p) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(p));

console.log(`סורק: ${source}\n`);

const reserved = parts.reduce((n, part) => n + countRunsWithColor(zip.file(part)!.asText(), RESERVED_COLOR), 0);
if (reserved > 0) {
  console.log(
    `הערה: ${reserved} ריצות בצבע #${RESERVED_COLOR} (אדום כהה) — זה טקסט תוכן במסמך, לא סימון, והוא מתעלם ממנו.`,
  );
  console.log(`      לסימון שדות השתמשו באדום מלא (#${MARKER_COLOR}) — "אדום" בלוח הצבעים של Word.\n`);
}

const existing: FieldMap = existsSync(MAP_PATH) ? JSON.parse(readFileSync(MAP_PATH, 'utf8')) : {};
const found: Array<{ part: string; region: MarkedRegion; proposal: string | null }> = [];

for (const part of parts) {
  const regions = findMarkedRegions(zip.file(part)!.asText(), MARKER_COLOR);
  for (const region of regions) {
    found.push({ part, region, proposal: existing[region.text.trim()] ?? propose(region) });
  }
}

if (found.length === 0) {
  console.log('לא נמצא טקסט מסומן.');
  console.log('סמנו ב-Word את הערכים הדינמיים בהדגשה (Highlight) ונסו שוב.');
  console.log(`גם צבע טקסט אדום מלא (#${MARKER_COLOR}) מתקבל.`);
  process.exit(0);
}

console.log(`נמצאו ${found.length} ערכים מסומנים:\n`);

const unnamed: string[] = [];
for (const { part, region, proposal } of found) {
  const where = part.replace('word/', '').replace('.xml', '');
  const context = region.paragraphText.trim().slice(0, 54);
  console.log(`  ${proposal ? `{${proposal}}`.padEnd(26) : '— ללא שם —'.padEnd(26)} ${JSON.stringify(region.text)}`);
  console.log(`  ${' '.repeat(26)} ב-${where}: "${context}${context.length >= 54 ? '…' : ''}"`);
  if (region.runCount > 1) {
    console.log(`  ${' '.repeat(26)} (${region.runCount} ריצות אוחדו)`);
  }
  console.log('');
  if (!proposal) unnamed.push(region.text.trim());
}

// The map is keyed by the marked text: it is what the build has to match, and
// it stays readable for whoever fills in the blanks.
const map: FieldMap = {};
for (const { region, proposal } of found) {
  // A mark that names its own field needs no entry — the document says it.
  if (explicitFieldName(region.text)) continue;
  // Keyed on the trimmed text. The whitespace around a marked value belongs to
  // the sentence, not to the value, and the build puts it back.
  map[region.text.trim()] = proposal ?? '';
}

mkdirSync(dirname(MAP_PATH), { recursive: true });
writeFileSync(MAP_PATH, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
console.log(`מפת השדות נכתבה: ${MAP_PATH}`);

if (unnamed.length > 0) {
  console.log(`\n${unnamed.length} ערכים ללא שם שדה. פתחו את field-map.json ומלאו אותם:`);
  for (const text of unnamed) console.log(`  ${JSON.stringify(text)}: ""`);
  console.log('\nערך שנשאר ריק ייכשל בבנייה — כדי שסימון לא ילך לאיבוד בשקט.');
}

/**
 * Guesses which field a marked value belongs to.
 *
 * Two cheap signals, in order: the value is one the system already knows, or
 * the paragraph names it — "אפיון המקום: משרדים" says what "משרדים" is. Anything
 * else is left for a human, because a wrong guess here writes the wrong data
 * into every future report.
 */
function propose(region: MarkedRegion): string | null {
  // A name written inside the mark is not a guess at all.
  const explicit = explicitFieldName(region.text);
  if (explicit) return explicit;

  // The label wins over the value. The same text can be several fields — the
  // contact and the requester are often the same person — and the label says
  // which one this occurrence is, where the value alone only says who.
  const label = region.paragraphText.split(':')[0]?.trim();
  const byLabel = KNOWN_FIELDS.find((f) => f.label && f.label === label);
  if (byLabel) return byLabel.field;

  const byValue = KNOWN_FIELDS.find((f) => f.sample === region.text.trim());
  return byValue ? byValue.field : null;
}
