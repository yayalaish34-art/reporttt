/**
 * Builds the indoor-air-quality template from Galit's signed report.
 *
 * The source document is the design. This script changes only the case-specific
 * text, result rows and photographs into merge fields; it does not recreate the
 * document. Consequently Word keeps the original RTL paragraphs, page furniture,
 * table widths, logos, styles and pagination rules.
 *
 *   npm run build:iaq
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { setParagraphText, setRowCells, tagParagraph } from '../src/lib/docx/authoring';
import { ensureContentTypesFirst } from '../src/lib/docx/merge-docx';
import { findElementEnd, splitBody, textOf } from '../src/lib/docx/ooxml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'templates/source/iaq-source.docx');
const OUTPUT = resolve(process.argv[2] ?? resolve(ROOT, 'templates/iaq-template.docx'));

if (!existsSync(SOURCE)) {
  throw new Error(
    `מסמך המקור חסר: ${SOURCE}\n` +
      'יש לשמור את דוח איכות האוויר שסופק כ-DOCX בשם templates/source/iaq-source.docx.',
  );
}

const zip = new PizZip(readFileSync(SOURCE));
const documentPart = zip.file('word/document.xml');
if (!documentPart) throw new Error('word/document.xml חסר במסמך המקור');
let xml = documentPart.asText();

const normal = (value: string) => value.replace(/[\u0001\u0007\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const paragraphs = () => xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
const failures: string[] = [];
let changes = 0;

function findParagraph(match: (text: string) => boolean): string | undefined {
  return paragraphs().find((p) => match(normal(textOf(p))));
}

function replaceExact(anchor: string, value: string, label = anchor): void {
  const target = findParagraph((text) => text === normal(anchor));
  if (!target) {
    failures.push(`${label} — לא נמצאה הפסקה "${anchor}"`);
    return;
  }
  xml = xml.replace(target, setParagraphText(target, value));
  changes++;
}

function replaceStarts(anchor: string, value: string, label = anchor): void {
  const target = findParagraph((text) => text.startsWith(normal(anchor)));
  if (!target) {
    failures.push(`${label} — לא נמצאה פסקה שמתחילה ב-"${anchor}"`);
    return;
  }
  xml = xml.replace(target, setParagraphText(target, value));
  changes++;
}

function replaceAllExact(anchor: string, value: string, expected: number, label = anchor): void {
  const targets = paragraphs().filter((p) => normal(textOf(p)) === normal(anchor));
  if (targets.length !== expected) {
    failures.push(`${label} — נמצאו ${targets.length} מופעים במקום ${expected}`);
    return;
  }
  for (const target of targets.reverse()) xml = xml.replace(target, setParagraphText(target, value));
  changes += targets.length;
}

function removeExact(anchor: string, required = true): void {
  const target = findParagraph((text) => text === normal(anchor));
  if (!target) {
    if (required) failures.push(`לא נמצאה פסקה להסרה: "${anchor}"`);
    return;
  }
  xml = xml.replace(target, '');
  changes++;
}

function removeStartsIfFound(anchor: string): void {
  const target = findParagraph((text) => text.startsWith(normal(anchor)));
  if (!target) return;
  xml = xml.replace(target, '');
  changes++;
}

/** Replaces all top-level body blocks between two anchors, excluding the anchors. */
function replaceBetween(
  after: (text: string) => boolean,
  before: (text: string) => boolean,
  replacement: string,
  label: string,
) {
  const blocks = splitBody(xml);
  const texts = blocks.map((block) => normal(textOf(xml.slice(block.start, block.end))));
  const from = texts.findIndex(after);
  const to = texts.findIndex((text, index) => index > from && before(text));
  if (from < 0 || to <= from + 1) {
    failures.push(`${label} — גבולות המקטע לא נמצאו`);
    return;
  }
  const start = blocks[from + 1]!.start;
  const end = blocks[to]!.start;
  xml = xml.slice(0, start) + replacement + xml.slice(end);
  changes++;
}

// ── Cover and order details ─────────────────────────────────────────

replaceExact('עבור אלה ניאזוב בדירת המגורים של אימה', '{coverRecipientLine}', 'שער — מזמין');
replaceExact("שנקר 24 א' דירה 3, חולון", '{fullAddress}', 'שער — כתובת');
replaceExact('19 באוגוסט 2026', '{coverDate}', 'שער — תאריך');
replaceStarts("דו\"ח מס' 0626082401", "דו\"ח מס' {referenceNumber}", 'שער — סימוכין');

replaceStarts('שם המזמין:', 'שם המזמין: {customerName}', 'פרטי הזמנה — שם');
replaceStarts('טל. נייד:', 'טל. נייד: {contactPhone}', 'פרטי הזמנה — טלפון');
replaceStarts('תאריך הבקשה:', 'תאריך הבקשה: {requestDate}', 'פרטי הזמנה — תאריך');
replaceStarts('תאריך ושעה:', 'תאריך ושעה: {surveyDate}, {surveyTime}', 'פרטי בדיקה — מועד');
replaceStarts('מקום:', 'מקום: {fullAddress}', 'פרטי בדיקה — מקום');
replaceStarts('תנאי מזג אוויר:', 'תנאי מזג אוויר: {weather}', 'פרטי בדיקה — מזג אוויר');
replaceStarts('הבדיקה בוצעה בנוכחות', '{presentAt}', 'פרטי בדיקה — נוכחים');
replaceExact('ד"ר אביחי מוכתר', '{authorName}', 'מבצע הבדיקה — שם');
replaceStarts('טל. 054-4274143', 'טל. {authorPhone}', 'מבצע הבדיקה — טלפון');
replaceStarts('דוא"ל: avihay@galit.co.il', 'דוא"ל: {authorEmail}', 'מבצע הבדיקה — דוא״ל');

// ── Executive summary and signature ────────────────────────────────

replaceStarts('על פי בקשתכם, ערכנו בתאריך 19/08/2026', '{summaryText}', 'תקציר');
replaceExact(
  'ריכוז הפחמן הדו-חמצני (CO2) היה בהתאם לערכים המומלצים בכל המקומות שנבדקו.',
  '{@summaryConclusionsXml}',
  'מסקנות — רשימה דינמית',
);
for (const sentence of [
  'ריכוז הפחמן חד-חמצני (CO) היה בהתאם למומלץ בתקן בכל המקומות שנבדקו.',
  'לא נמצא חנקן דו-חמצני (NO2) בכל המקומות שנבדקו.',
  'לא נמצאה גופרית דו-חמצנית (SO2) בכל המקומות שנבדקו.',
  'ריכוז התרכובות האורגניות הנדיפות היה בטווח אי הנוחות בכל המקומות שנבדקו.',
  'הטמפרטורה שנמדדה הייתה בדרך כלל בהתאם לטווח מעלות החום המומלץ לחודשי הקיץ כאשר הופעל מזגן, וגבוהה מטווח זה כאשר לא הופעל מזגן.',
  'הלחות היחסית במקומות שנבדקו הייתה גבוהה מהמומלץ בתקן בכל המקומות שנבדקו.',
  'מהארונית שמתחת לכיור מתפשט ריח של כימיקלים שמזכיר ריח של חומר הדברה, ויש חשש שהוא מהווה מטרד ריח.',
]) removeExact(sentence);
replaceStarts('לבצע בדיקה מקיפה של הארונית מתחל לכיור', '{recommendations}', 'המלצות — תקציר');
replaceExact('אביחי מוכתר', '{authorName}', 'חתימה — שם');
replaceStarts('ד"ר (Ph.D.) למדעי החיים', '{authorTitle}', 'חתימה — תפקיד');

// ── Introduction, site and photographs ─────────────────────────────

replaceStarts('על פי בקשתכם, ערכנו בתאריך 19/08/2026 מדידות תוך מבניות', '{summaryText}', 'הקדמה');
replaceStarts('דירה בבניין מגורים, באזור מגורים עירוני', '{siteCharacter}', 'תיאור המקום');

// The aerial map and its callout identify the old customer's address. They are
// deliberately removed; the new report's uploaded photographs take their place.
replaceBetween(
  (text) => text === '{siteCharacter}',
  (text) => text.startsWith('דיגומי האוויר בתחנת טיפת החלב'),
  '',
  'מפת הלקוח הישן',
);
replaceStarts('דיגומי האוויר בתחנת טיפת החלב', 'דיגומי האוויר בוצעו במקומות הבאים:', 'פתיח נקודות דיגום');
replaceStarts('בארונית מתחת לכיור', '{locationsText}', 'רשימת נקודות דיגום');
removeExact('סלון מתחת למזגן (תמונה 4)');
removeExact('חשר שינה אמצעי (תמונה 5)');
{
  const locationRow = findParagraph((text) => text === '{locationsText}');
  if (!locationRow) failures.push('רשימת נקודות דיגום — שורת הלולאה לא נמצאה');
  else {
    xml = xml.replace(
      locationRow,
      tagParagraph('{#locations}') + setParagraphText(locationRow, '{name}') + tagParagraph('{/locations}'),
    );
    changes++;
  }
}
replaceStarts('בארונית מתחת לכיור המטבח, אותר ריח', '{reason}', 'תצפית/סיבת הזימון');
replaceStarts('במקומות שנבדקו יש מזגנים עיליים', '{airConditioning}', 'מערכות מיזוג');

// Every old site photograph is anchored between the HVAC paragraph and the first
// measurement chapter. One raw-XML field replaces that whole customer-specific page.
replaceBetween(
  (text) => text === '{airConditioning}',
  (text) => text.startsWith('מדידות פחמן דו-חמצני'),
  '<w:p><w:r><w:t xml:space="preserve">{@photosXml}</w:t></w:r></w:p>',
  'עמוד התמונות',
);

// ── Calibration dates and per-chapter conclusions ──────────────────

replaceAllExact(
  'תוקף הכיול של המכשיר עד 11.07.2027',
  'תוקף הכיול של המכשיר עד {calibrationGraywolf}',
  7,
  'כיול Graywolf',
);
replaceExact(
  'תוקף הכיול של המכשיר עד 09.12.2027',
  'תוקף הכיול של המכשיר עד {calibrationFormaldehyde}',
  'כיול פורמלדהיד',
);

replaceStarts('ריכוז הפחמן הדו-חמצני בכל המקומות', '{co2Conclusion}', 'מסקנת CO₂');
replaceStarts('ריכוז הפחמן החד-חמצני היה בהתאם', '{coConclusion}', 'מסקנת CO');
removeExact('לא נמצא חנקן דו חמצני בכל המקומות שנבדקו.');
replaceStarts('ריכוז החנקן הדו-חמצני בכל המקומות', '{no2Conclusion}', 'מסקנת NO₂');
removeExact('לא נמצאה גופרית דו חמצנית בכל המקומות שנבדקו.');
replaceStarts('ריכוז הגופרית הדו-חמצנית בכל המקומות', '{so2Conclusion}', 'מסקנת SO₂');
replaceStarts('ריכוז סך כל התרכובות האורגניות הנדיפות', '{tvocConclusion}', 'מסקנת TVOC');
removeStartsIfFound('עם זאת ריכוזם של תרכובות אלו מתחת לכיור');
replaceStarts(
  'לבצע בדיקה מקיפה של הארונית מתחל לכיור',
  '{recommendations}',
  'המלצות — TVOC',
);
replaceStarts('ריכוז הפורמלדהיד במקומות שנבדקו', '{formaldehydeConclusion}', 'מסקנת פורמלדהיד');
replaceStarts('הטמפרטורה שנמדדה בסלון שבו פעל המזגן', '{temperatureConclusion}', 'מסקנת טמפרטורה');
removeStartsIfFound('מתחת לכיור במטבח ובידר השינה');
replaceStarts('הלחות היחסית במקומות שנבדקו', '{humidityConclusion}', 'מסקנת לחות');

// Correct a copied caption in the signed source while it becomes the template.
replaceExact(
  'טבלה 7: תוצאות בדיקת התרכובות האורגניות הנדיפות (TVOC)',
  'טבלה 7: תוצאות בדיקת פורמלדהיד',
  'כותרת טבלת פורמלדהיד',
);

// ── Result tables: keep their exact design, turn one sample row into a loop ──

const TABLE_LOOPS: Array<{ index: number; loop: string; label: string }> = [
  { index: 0, loop: 'co2Rows', label: 'CO₂' },
  { index: 1, loop: 'coRows', label: 'CO' },
  { index: 2, loop: 'no2Rows', label: 'NO₂' },
  { index: 3, loop: 'so2Rows', label: 'SO₂' },
  // table 4 is the fixed TVOC standards table and remains untouched.
  { index: 5, loop: 'tvocRows', label: 'TVOC' },
  { index: 6, loop: 'formaldehydeRows', label: 'פורמלדהיד' },
  { index: 7, loop: 'temperatureRows', label: 'טמפרטורה' },
  { index: 8, loop: 'humidityRows', label: 'לחות' },
];

for (const definition of [...TABLE_LOOPS].sort((a, b) => b.index - a.index)) {
  const allTables = partsOf(xml, 'w:tbl');
  const table = allTables[definition.index];
  if (!table) {
    failures.push(`טבלת ${definition.label} לא נמצאה (אינדקס ${definition.index})`);
    continue;
  }
  const rows = partsOf(table, 'w:tr');
  if (rows.length < 2) {
    failures.push(`טבלת ${definition.label} אינה מכילה שורת נתונים`);
    continue;
  }
  const firstData = rows[1]!;
  let loopRow = setRowCells(firstData, [
    `{#${definition.loop}}{index}`,
    '{location}',
    `{value}{/${definition.loop}}`,
  ]);
  // The example temperature/humidity readings were red because they exceeded the
  // threshold. Dynamic readings must not all inherit that case-specific warning.
  loopRow = loopRow
    .replace(/<w:color w:val="(?:FF|EE)0000"\s*\/>/gi, '')
    .replace(/<w:bCs\s*\/>|<w:b\s*\/>/gi, '');

  const firstStart = table.indexOf(firstData);
  const last = rows[rows.length - 1]!;
  const lastEnd = table.lastIndexOf(last) + last.length;
  const rebuilt = table.slice(0, firstStart) + loopRow + table.slice(lastEnd);
  xml = xml.replace(table, rebuilt);
  changes++;
}

function spansOf(fragment: string, tag: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let index = 0;
  while (index < fragment.length) {
    const open = fragment.indexOf(`<${tag}`, index);
    if (open < 0) break;
    const end = findElementEnd(fragment, open, tag);
    spans.push({ start: open, end });
    index = end;
  }
  return spans;
}

function partsOf(fragment: string, tag: string): string[] {
  return spansOf(fragment, tag).map(({ start, end }) => fragment.slice(start, end));
}

// ── Header: preserve PAGE/NUMPAGES fields, replace only case text ─────

for (const part of Object.keys(zip.files).filter((name) => /^word\/header\d+\.xml$/.test(name))) {
  const file = zip.file(part);
  if (!file) continue;
  const source = file.asText();
  const targets: Array<{ start: number; end: number }> = [];
  collectLeafParagraphs(source, 0, source.length, targets);
  let rewritten = source;
  let localHits = 0;
  for (const target of targets.reverse()) {
    const paragraph = rewritten.slice(target.start, target.end);
    const text = normal(textOf(paragraph));
    let value: string | null = null;
    if (text.includes('אלול') && text.includes('תשפ')) value = '‏{headerWeekday} {headerHebrewDate}';
    else if (/^24 ב?אוגוסט 2026$/.test(text)) value = '{headerDate}';
    else if (text.startsWith('סימוכין')) value = 'סימוכין {referenceNumber}';
    if (value === null) continue;
    rewritten = rewritten.slice(0, target.start) + setParagraphText(paragraph, value) + rewritten.slice(target.end);
    localHits++;
  }
  if (localHits !== 3) failures.push(`${part} — הוחלפו ${localHits} מתוך 3 שדות כותרת`);
  else {
    zip.file(part, rewritten);
    changes += localHits;
  }
}

function collectLeafParagraphs(
  source: string,
  from: number,
  to: number,
  out: Array<{ start: number; end: number }>,
) {
  let index = from;
  while (index < to) {
    if (!source.startsWith('<w:p>', index) && !source.startsWith('<w:p ', index)) {
      index++;
      continue;
    }
    const end = findElementEnd(source, index, 'w:p');
    const inner = source.indexOf('>', index) + 1;
    if (/<w:p[ >]/.test(source.slice(inner, end))) collectLeafParagraphs(source, inner, end, out);
    else out.push({ start: index, end });
    index = end;
  }
}

if (failures.length > 0) {
  console.error('\nבניית תבנית איכות האוויר נעצרה:');
  for (const failure of failures) console.error(`  • ${failure}`);
  process.exit(1);
}

zip.file('word/document.xml', xml);
ensureContentTypesFirst(zip);
const bytes = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(OUTPUT, bytes);
console.log(`נבנתה תבנית מתוך מסמך המקור: ${OUTPUT}`);
console.log(`שינויים ממוקדים: ${changes} · גודל: ${Math.round(bytes.length / 1024)}KB`);
