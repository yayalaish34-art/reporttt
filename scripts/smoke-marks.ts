/**
 * The marking round trip: mark → scan → apply → merge.
 *
 * Checks the three things that make marking usable at all: the mark is found
 * even when Word split the value across runs, the marker colour does not leak
 * into the merged document, and the surrounding sentence survives intact.
 *
 *   npx tsx scripts/smoke-marks.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { applyMarks } from '../src/lib/docx/apply-marks';
import {
  findMarkedRegions,
  MARKER_COLOR,
  RESERVED_COLOR,
  countRunsWithColor,
  countHighlightedRuns,
} from '../src/lib/docx/marked-runs';
import { textOf } from '../src/lib/docx/ooxml';
import type { FieldMap } from '../src/lib/field-map';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKED = resolve(ROOT, 'out/marked-source.docx');

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const zip = new PizZip(readFileSync(MARKED));
const xml = zip.file('word/document.xml')!.asText();

// ── Detection ───────────────────────────────────────────────────────

console.log('זיהוי:');
const regions = findMarkedRegions(xml, MARKER_COLOR);
check(regions.length === 7, 'כל הערכים המסומנים נמצאו', `${regions.length}`);
// The fixture marks some by highlight and some by colour; both must register.
check(countHighlightedRuns(xml) >= 4, 'סימוני הדגשה זוהו', `${countHighlightedRuns(xml)} ריצות`);
check(countRunsWithColor(xml, MARKER_COLOR) >= 2, 'סימוני צבע אדום זוהו', `${countRunsWithColor(xml, MARKER_COLOR)} ריצות`);

// The dark-red disclaimer is content, not a mark, and must be left alone.
const reservedRuns = countRunsWithColor(xml, RESERVED_COLOR);
check(reservedRuns > 0, `הטקסט האדום-כהה עדיין במסמך`, `${reservedRuns} ריצות`);
check(
  !regions.some((r) => r.text.includes('בהסתמך על המחקרים')),
  'פסקת ההסתייגות באדום כהה לא נחשבת לסימון',
);

// ── Application ─────────────────────────────────────────────────────

console.log('\nהחלה:');
const fieldMap: FieldMap = JSON.parse(readFileSync(resolve(ROOT, 'templates/field-map.json'), 'utf8'));
const result = applyMarks(xml, fieldMap, MARKER_COLOR);

check(result.unmapped.length === 0, 'לכל סימון יש שם שדה', result.unmapped.join(', '));
check(result.applied.length === 7, 'כל הסימונים הוחלפו', result.applied.join(', '));
// "קיצי בהיר" was replaced with the literal {weather} in the document, so it
// names its own field and needs no entry in the map.
check(!('weather' in fieldMap) || fieldMap.weather === undefined, 'שדה ששמו כתוב בתוך הסימון אינו דורש רישום במפה');

const applied = textOf(result.xml);
for (const field of ['companyName', 'addressLine', 'city', 'phone', 'requesterName', 'siteCharacter', 'weather']) {
  check(applied.includes(`{${field}}`), `{${field}} נוצר`);
}

// ── The sentence around the value must survive ──────────────────────

console.log('\nהמשפט סביב הערך:');
check(applied.includes('אפיון המקום: {siteCharacter}.'), 'התווים סביב הערך נשמרו', 'אפיון המקום: {siteCharacter}.');
check(applied.includes('נייד : {phone}'), 'רווח לפני הערך נשמר', 'נייד : {phone}');
check(applied.includes('תנאי מזג אוויר: {weather}.'), 'הנקודה בסוף המשפט נשמרה');

// ── The marker colour must not survive ──────────────────────────────

console.log('\nצבע הסימון:');
check(
  countRunsWithColor(result.xml, MARKER_COLOR) === 0,
  'צבע הסימון הוסר — הערך לא יודפס באדום',
  `${countRunsWithColor(result.xml, MARKER_COLOR)} ריצות נותרו`,
);
check(
  countHighlightedRuns(result.xml) === 0,
  'ההדגשה הוסרה — הערך לא יודפס מודגש',
  `${countHighlightedRuns(result.xml)} ריצות נותרו`,
);
check(
  countRunsWithColor(result.xml, RESERVED_COLOR) === reservedRuns,
  'הטקסט האדום-כהה לא נפגע',
  `${countRunsWithColor(result.xml, RESERVED_COLOR)}/${reservedRuns}`,
);

// ── Formatting must be inherited ────────────────────────────────────

console.log('\nעיצוב:');
// The company name and city are bold and underlined in the source; the
// placeholder that replaces them has to keep that, or the merged value prints plain.
for (const [label, field] of [
  ['שם החברה', 'companyName'],
  ['עיר', 'city'],
]) {
  const at = result.xml.indexOf(`{${field}}`);
  const run = result.xml.slice(result.xml.lastIndexOf('<w:r>', at), at);
  const bold = /<w:b\/>/.test(run) && /<w:bCs\/>/.test(run);
  const underlined = /<w:u w:val="single"\/>/.test(run);
  check(bold && underlined, `${label} — הדגשה וקו תחתון נשמרו`, `מודגש=${bold} קו=${underlined}`);
}

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
