/**
 * Turns the signed-off example report into a merge template.
 *
 * The source document is a real, finished survey. This script rewrites it into
 * `templates/report-template.docx`: literal values become `{placeholders}`, the
 * 31 ELF and 11 RF protocol blocks collapse into one of each wrapped in a loop,
 * and the photo appendix becomes a raw-XML injection point.
 *
 * It is deliberately a build step rather than a one-off manual edit in Word:
 * when the survey team revises the master document, the template is rebuilt
 * from it instead of being re-marked-up by hand.
 *
 *   npm run build:template
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { bodyRange, findElementEnd, splitBody, textOf, type BodyBlock } from '../src/lib/docx/ooxml';
import {
  setParagraphText,
  setCellText,
  setRowCells,
  splitCells,
  tagParagraph,
  hasGraphics,
} from '../src/lib/docx/authoring';
import { ensureContentTypesFirst } from '../src/lib/docx/merge-docx';
import { applyMarks } from '../src/lib/docx/apply-marks';
import { countRunsWithColor, MARKER_COLOR } from '../src/lib/docx/marked-runs';
import type { FieldMap } from '../src/lib/field-map';
import { FIELD_SOURCE_LABEL, REQUESTER_LABEL } from '../src/lib/measurement-rules';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SOURCE = resolve(ROOT, 'templates/source/report-source.docx');
const OUTPUT = process.env.TEMPLATE_OUT
  ? resolve(process.env.TEMPLATE_OUT)
  : resolve(ROOT, 'templates/report-template.docx');
const FIELD_MAP = resolve(ROOT, 'templates/field-map.json');

/** Collapses whitespace so anchors survive stray spaces and NBSPs in the source. */
const norm = (s: string) => s.replace(/[\s ]+/g, ' ').trim();

// ── Anchors ─────────────────────────────────────────────────────────
// Text that identifies a block. Every rule is asserted to have matched, so a
// revision of the source that moves the goalposts fails the build loudly
// instead of silently shipping a half-templated document.

const ELF_PROTOCOL_TITLE = 'פרוטוקול רשמי - מדידת שדה מגנטי';
const RF_PROTOCOL_TITLE = 'פרוטוקול רשמי - מדידת צפיפות הספק';
const MEASUREMENTS_VALID = 'תוצאות המדידות נכונות למקום וזמן המדידה';
const NORMALIZATION_FACTOR = 'מקדם הנרמול שנקבע';
const NORMALIZATION_NOTE = 'מכיוון שהמדידות בוצעו';
const PHOTO_CAPTION = /^תמונה מס['׳]/;
const COMPANY_LINE = 'כרטיסי אשראי לישראל בע"מ';

/**
 * The signature cell of a people table.
 *
 * The template repeats one row per table, so a signature left inside that row
 * would be stamped on everyone in it. Each row injects its own instead.
 */
const SIGNATURE_CELL = '{@signatureXml}';

const hits = new Map<string, number>();
const record = (name: string) => hits.set(name, (hits.get(name) ?? 0) + 1);

/**
 * Fields already produced by a red mark.
 *
 * The marks run first, so a value marked in Word is a placeholder by the time
 * the built-in anchor rules look for its literal text. Those rules would then
 * report their anchor as missing and fail the build — the mark did the job, and
 * the rule has nothing left to do.
 */
const markedFields = new Set<string>();

// ── Scalar substitution rules ───────────────────────────────────────
// Applied to every paragraph and every table cell, matched on normalized text.

interface Rule {
  name: string;
  match: (text: string) => boolean;
  /** Replacement text, which may contain docxtemplater tags. */
  value: string;
}

const eq = (s: string) => (t: string) => t === s;
const starts = (s: string) => (t: string) => t.startsWith(s);

const RULES: Rule[] = [
  // Header — printed on every page, and none of it appears in the body. The
  // right-to-left mark is kept because the line mixes Hebrew with digits.
  { name: 'referenceNumber', match: starts('סימוכין'), value: 'סימוכין  {referenceNumber}' },
  { name: 'headerHebrewDate', match: (t) => t.includes('תמוז תשפ'), value: '‏{headerWeekday} {headerHebrewDate}' },
  { name: 'headerDate', match: (t) => /^‏?\d{1,2} [א-ת]+ \d{4}$/.test(t), value: '‏{headerDate}' },

  // Cover — recipient block. The contact line is assembled in the mapper, since
  // a private customer prints a bare name with no title and no separator.
  { name: 'recipient', match: (t) => t.startsWith('ירון חכם') && t.includes('רמ"ד'), value: '{recipientLine}' },
  { name: 'address', match: eq('תפוצות ישראל 13'), value: '{addressLine}' },
  { name: 'city', match: eq('גבעתיים'), value: '{city}' },
  { name: 'phone', match: starts('נייד :'), value: 'נייד : {phone}' },
  { name: 'email', match: starts('מייל:'), value: 'מייל: {email}' },

  // Cover — the three sentences that name the surveyed frequency ranges. All
  // are composed in `report-text.ts` from one `surveyScope` value, because the
  // source document had the ranges written into each of them by hand.
  { name: 'subject', match: starts('סקר בטיחות קרינה אלקטרומגנטית (אל מ"ג) בתדירויות'), value: '{subject}' },
  { name: 'openingSentence', match: starts('בתאריך 21/06/26 בוצעו מדידות'), value: '{openingSentence}' },
  { name: 'instrumentSentence', match: starts('המדידות בוצעו במכשיר מדידה תקני'), value: '{instrumentSentence}' },

  // Order details
  { name: 'requesterName', match: starts('שם המבקש'), value: `${REQUESTER_LABEL}: {requesterName}` },

  // Measurement characterization. Each of these lines ends in a full stop in the
  // source, so the template supplies it rather than every surveyor remembering
  // to type one — `sentenceValue` in the mapper strips a duplicate.
  { name: 'measurementDateTime', match: starts('תאריך ושעה'), value: 'תאריך ושעה: {measurementDateTime}.' },
  { name: 'location', match: starts('מקום:'), value: 'מקום: {location}.' },
  { name: 'siteCharacter', match: starts('אפיון המקום'), value: 'אפיון המקום: {siteCharacter}.' },
  { name: 'weather', match: starts('תנאי מזג אוויר'), value: 'תנאי מזג אוויר: {weather}.' },
  // ה-match מזהה את השורה במסמך *המקור*, שעדיין נושא את הניסוח הישן, וה-value הוא
  // מה שנכתב לתבנית — ולכן הכותרת המודפסת מתחלפת כאן בלי לגעת במקור.
  { name: 'fieldSource', match: starts('מקור שדה אל מ"ג'), value: `${FIELD_SOURCE_LABEL}: {fieldSource}.` },
  { name: 'measurementType', match: starts('סוג המדידות'), value: 'סוג המדידות: {measurementType}.' },

  // Conclusion 4. One word changes — נמוכים / גבוהים — and the scope of the
  // sentence changes with it, so the whole line is computed in the mapper.
  {
    name: 'occupiedPointsConclusion',
    match: starts('בכל נקודות המדידה, בהם יש שהייה קבועה'),
    value: '{occupiedPointsConclusion}',
  },

  // ELF instrument — the spec cell keeps one fact per line, so each line is
  // one field, pre-filled by the app with the device currently in use.
  { name: 'elfModelLine', match: starts('Electromagnetic field strength meter'), value: '{elfInstrument.modelLine}' },
  { name: 'elfSerialLine', match: starts('S.N:'), value: '{elfInstrument.serialLine}' },
  { name: 'elfRangeEn', match: starts('Frequency range : 30'), value: '{elfInstrument.frequencyRangeEn}' },
  { name: 'elfRangeHe', match: starts('טווח תדירות'), value: '{elfInstrument.frequencyRangeHe}' },
  { name: 'elfSensitivity', match: starts('רגישות:'), value: '{elfInstrument.sensitivity}' },
  { name: 'elfCalibration', match: eq('29.01.27'), value: '{elfInstrument.calibrationValidity}' },

  // RF instrument
  { name: 'rfModelLine', match: starts('מכשיר מתוצרת'), value: '{rfInstrument.modelLine}' },
  { name: 'rfDescriptionLine', match: starts('Professional High Frequency'), value: '{rfInstrument.descriptionLine}' },
  { name: 'rfSerialLine', match: starts('model HF-B8G'), value: '{rfInstrument.serialLine}' },
  { name: 'rfRangeEn', match: starts('Frequency range 10MHz'), value: '{rfInstrument.frequencyRangeEn}' },
  { name: 'rfCalibration', match: eq('04/08/26'), value: '{rfInstrument.calibrationValidity}' },
];

// ── Load ────────────────────────────────────────────────────────────

if (!existsSync(SOURCE)) {
  console.error(`מסמך המקור לא נמצא: ${SOURCE}`);
  console.error('העתק לשם את קובץ הדוח החתום ונסה שוב.');
  process.exit(1);
}

const zip = new PizZip(readFileSync(SOURCE));
const documentPart = zip.file('word/document.xml');
if (!documentPart) throw new Error('word/document.xml חסר בארכיון');
let xml = documentPart.asText();

console.log(`מסמך מקור: ${(xml.length / 1024).toFixed(0)} KB של XML`);

// Values marked red in Word become placeholders first, so a mark always wins
// over a built-in anchor rule for the same text.
xml = applyFieldMarks(xml);

xml = collapseProtocols(xml);
xml = replacePhotoAppendix(xml);
xml = loopPeopleTables(xml);
xml = loopConclusions(xml);
xml = conditionalCompanyLine(xml);
xml = applyScalarRules(xml, bodyRange(xml));
zip.file('word/document.xml', xml);

// Headers and footers carry placeholders too — the reference number is printed
// on every page from the header, and never appears in the body at all.
for (const part of Object.keys(zip.files).filter((p) => /^word\/(header|footer)\d+\.xml$/.test(p))) {
  const content = zip.file(part)?.asText();
  if (!content) continue;
  const rewritten = applyScalarRules(content, wholeOf(content));
  if (rewritten !== content) {
    zip.file(part, rewritten);
    console.log(`עודכן: ${part}`);
  }
}

const missing = RULES.filter((r) => !hits.has(r.name) && !satisfiedByMark(r));
if (missing.length) {
  console.error('\nהעוגנים הבאים לא נמצאו במסמך המקור:');
  for (const r of missing) console.error(`  • ${r.name}`);
  console.error('\nכנראה שהמסמך שונה. עדכן את העוגנים ב-scripts/build-template.ts');
  process.exit(1);
}

ensureContentTypesFirst(zip);
mkdirSync(dirname(OUTPUT), { recursive: true });
writeTemplate(OUTPUT, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));

console.log(`\nתבנית נכתבה: ${OUTPUT}`);
console.log('\nהחלפות שבוצעו:');
for (const [name, count] of [...hits].sort()) console.log(`  ${name.padEnd(24)} ${count}`);

/**
 * Writes the template, explaining the one failure Windows makes obscure.
 *
 * Word and most editors hold an exclusive lock on an open .docx, and the raw
 * `EBUSY` gives no hint that the fix is simply to close the file.
 */
function writeTemplate(path: string, bytes: Buffer): void {
  try {
    writeFileSync(path, bytes);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM') {
      console.error(`
לא ניתן לכתוב ל-${path} — הקובץ פתוח.`);
      console.error('סגרו אותו ב-Word או בעורך ונסו שוב.');
      process.exit(1);
    }
    throw err;
  }
}

/** True when a red mark already produced every field this rule would have. */
function satisfiedByMark(rule: Rule): boolean {
  const fields = [...rule.value.matchAll(/\{([#/@^]?)([\w.]+)\}/g)].map((m) => m[2]);
  return fields.length > 0 && fields.every((field) => markedFields.has(field));
}

/**
 * Applies the red marks a person made in Word.
 *
 * This is the path that does not require touching this script to add a field:
 * colour the value red, name it in `field-map.json`, rebuild. A mark with no
 * name fails the build rather than being skipped, so a mark cannot go missing
 * without anyone noticing.
 */
function applyFieldMarks(input: string): string {
  const marks = countRunsWithColor(input, MARKER_COLOR);
  if (marks === 0) return input;

  if (!existsSync(FIELD_MAP)) {
    console.error(`\nנמצאו ${marks} ריצות מסומנות באדום אך אין מפת שדות.`);
    console.error('הריצו `npm run scan:fields` כדי לייצר אותה.');
    process.exit(1);
  }

  const fieldMap: FieldMap = JSON.parse(readFileSync(FIELD_MAP, 'utf8'));
  const result = applyMarks(input, fieldMap, MARKER_COLOR);

  if (result.unmapped.length > 0) {
    console.error(`\n${result.unmapped.length} ערכים מסומנים ללא שם שדה ב-field-map.json:`);
    for (const text of result.unmapped) console.error(`  ${JSON.stringify(text)}`);
    console.error('\nמלאו אותם ונסו שוב. סימון בלי שם לא מיושם בשקט.');
    process.exit(1);
  }

  console.log(`סימוני אדום: ${result.applied.length} שדות הוחלו (${[...new Set(result.applied)].join(', ')})`);
  for (const field of result.applied) {
    record(`mark:${field}`);
    markedFields.add(field);
  }
  return result.xml;
}

// ════════════════════════════════════════════════════════════════════
// Structural passes
// ════════════════════════════════════════════════════════════════════

/**
 * Replaces the run of repeated protocol sections with a single loop.
 *
 * Each protocol occupies a fixed sequence of body blocks: a title paragraph, a
 * measurement table, then the "results are valid" and normalization notes. The
 * first occurrence becomes the loop body; the rest are dropped.
 */
function collapseProtocols(input: string): string {
  const blocks = splitBody(input);
  const text = blocks.map((b) => norm(textOf(input.slice(b.start, b.end))));

  const elfTitles = indicesWhere(text, (t) => t.startsWith(ELF_PROTOCOL_TITLE));
  const rfTitles = indicesWhere(text, (t) => t.startsWith(RF_PROTOCOL_TITLE));

  if (elfTitles.length === 0) throw new Error('לא נמצאו פרוטוקולי ELF במסמך המקור');
  if (rfTitles.length === 0) throw new Error('לא נמצאו פרוטוקולי RF במסמך המקור');
  console.log(`נמצאו ${elfTitles.length} פרוטוקולי ELF ו-${rfTitles.length} פרוטוקולי RF`);

  const elfSpans = elfTitles.map((i) => protocolSpan(blocks, text, i));
  const rfSpans = rfTitles.map((i) => protocolSpan(blocks, text, i));

  const edits: Edit[] = [];

  edits.push({
    start: blocks[elfSpans[0].from].start,
    end: blocks[elfSpans[0].to].end,
    replacement: buildProtocolLoop(input, blocks, elfSpans[0], 'elf'),
  });
  for (const span of elfSpans.slice(1)) {
    edits.push({ start: blocks[span.from].start, end: blocks[span.to].end, replacement: '' });
  }

  edits.push({
    start: blocks[rfSpans[0].from].start,
    end: blocks[rfSpans[0].to].end,
    replacement: buildProtocolLoop(input, blocks, rfSpans[0], 'rf'),
  });
  for (const span of rfSpans.slice(1)) {
    edits.push({ start: blocks[span.from].start, end: blocks[span.to].end, replacement: '' });
  }

  record('elfProtocolLoop');
  record('rfProtocolLoop');
  return applyEdits(input, edits);
}

interface Span {
  from: number;
  to: number;
  tableIndex: number;
}

/**
 * The block range covered by one protocol: its title, its table, and the
 * trailing notes that belong to it.
 */
function protocolSpan(blocks: BodyBlock[], text: string[], titleIndex: number): Span {
  let tableIndex = -1;
  for (let i = titleIndex + 1; i < blocks.length; i++) {
    if (blocks[i].kind === 'tbl') {
      tableIndex = i;
      break;
    }
    if (text[i] !== '') break; // something other than a blank paragraph intervened
  }
  if (tableIndex === -1) throw new Error(`פרוטוקול ללא טבלה באינדקס ${titleIndex}`);

  let to = tableIndex;
  for (let j = tableIndex + 1; j < blocks.length; j++) {
    const t = text[j];
    const isNote =
      t === '' ||
      t.startsWith(MEASUREMENTS_VALID) ||
      t.startsWith(NORMALIZATION_FACTOR) ||
      t.startsWith(NORMALIZATION_NOTE);
    if (!isNote) break;
    if (t !== '') to = j;
  }
  return { from: titleIndex, to, tableIndex };
}

/** Wraps a protocol span in its loop tags and templates the blocks inside. */
function buildProtocolLoop(input: string, blocks: BodyBlock[], span: Span, kind: 'elf' | 'rf'): string {
  const loopName = kind === 'elf' ? 'elfProtocols' : 'rfProtocols';
  const parts: string[] = [tagParagraph(`{#${loopName}}`)];

  for (let i = span.from; i <= span.to; i++) {
    const block = blocks[i];
    const fragment = input.slice(block.start, block.end);
    const t = norm(textOf(fragment));

    if (i === span.from) {
      parts.push(setParagraphText(fragment, '{title}'));
    } else if (i === span.tableIndex) {
      parts.push(kind === 'elf' ? templateElfTable(fragment) : templateRfTable(fragment));
    } else if (t.startsWith(NORMALIZATION_FACTOR)) {
      parts.push(setParagraphText(fragment, 'מקדם הנרמול שנקבע : {normalizationFactor}.'));
    } else if (t.startsWith(NORMALIZATION_NOTE)) {
      parts.push(setParagraphText(fragment, '{normalizationNote}'));
    } else {
      parts.push(fragment); // the "results are valid" note and blank paragraphs stay
    }
  }

  parts.push(tagParagraph(`{/${loopName}}`));
  return parts.join('');
}

/**
 * Rewrites a measurement table into a one-row loop.
 *
 * The first two rows are header bands and stay. Of the data rows only the first
 * is kept, carrying `{#rows}` in its leading cell and `{/rows}` in its trailing
 * one — with `paragraphLoop` enabled that duplicates the whole row per item.
 */
function templateMeasurementTable(
  tbl: string,
  cellValues: Array<string | null>,
  referenceLabelCell: { row: number; cell: number },
): string {
  const rows = collectRows(tbl);
  if (rows.length < 3) throw new Error('טבלת מדידות עם פחות מ-3 שורות');

  let header = tbl.slice(0, rows[1].end); // rows 0 and 1 are the two header bands
  header = setCellInRow(header, referenceLabelCell.row, referenceLabelCell.cell, '{referenceLabel}');

  const dataRow = setRowCells(tbl.slice(rows[2].start, rows[2].end), cellValues);
  const tail = tbl.slice(rows[rows.length - 1].end); // closing </w:tbl>

  return header + dataRow + tail;
}

/** ELF columns: №, description, distance, height, measured, normalized, occupancy, verdict. */
function templateElfTable(tbl: string): string {
  return templateMeasurementTable(
    tbl,
    ['{#rows}', '{description}', '{distance}', '{height}', '{measured}', '{normalized}', '{occupancy}', '{compliance}{/rows}'],
    { row: 0, cell: 2 },
  );
}

/** RF columns: №, description, occupancy, measured, threshold, verdict, distance, height. */
function templateRfTable(tbl: string): string {
  return templateMeasurementTable(
    tbl,
    ['{#rows}', '{description}', '{occupancy}', '{measured}', '{threshold}', '{compliance}', '{distance}', '{height}{/rows}'],
    { row: 0, cell: 6 },
  );
}

/**
 * Swaps the static photo appendix for `{@photosXml}`.
 *
 * Photographs differ per survey and docxtemplater cannot substitute an image
 * through an ordinary placeholder, so the appendix is generated as OOXML at
 * merge time and injected here as raw XML.
 */
function replacePhotoAppendix(input: string): string {
  const blocks = splitBody(input);
  const text = blocks.map((b) => norm(textOf(input.slice(b.start, b.end))));

  const captions = indicesWhere(text, (t) => PHOTO_CAPTION.test(t));
  if (captions.length === 0) throw new Error('לא נמצא נספח תמונות במסמך המקור');

  // Each photo is an image paragraph followed by its caption; the appendix
  // therefore starts at the image paragraph just above the first caption.
  const first = captions[0];
  const from = first > 0 && hasGraphics(input.slice(blocks[first - 1].start, blocks[first - 1].end)) ? first - 1 : first;
  const to = captions[captions.length - 1];

  console.log(`נספח תמונות: ${captions.length} תמונות (בלוקים ${from}–${to})`);
  record('photosAppendix');

  return applyEdits(input, [
    { start: blocks[from].start, end: blocks[to].end, replacement: tagParagraph('{@photosXml}') },
  ]);
}

/**
 * Turns the inspector and report-author tables into loops.
 *
 * Both have a header row followed by one row per person; keeping the first data
 * row and wrapping it makes the count dynamic.
 */
function loopPeopleTables(input: string): string {
  const blocks = splitBody(input);
  const text = blocks.map((b) => norm(textOf(input.slice(b.start, b.end))));

  const edits: Edit[] = [];

  const inspectors = blocks.findIndex((b, i) => b.kind === 'tbl' && text[i].includes('סוג היתר') && text[i].includes('מספר ההיתר'));
  if (inspectors === -1) throw new Error('טבלת הבודקים לא נמצאה');
  edits.push({
    start: blocks[inspectors].start,
    end: blocks[inspectors].end,
    replacement: loopPeopleTable(input.slice(blocks[inspectors].start, blocks[inspectors].end), 'inspectors', [
      '{name}',
      '{title}',
      '{permitType}',
      '{permitNumber}',
      '{permitValidity}',
      SIGNATURE_CELL,
    ]),
  });
  record('inspectorsLoop');

  const authors = blocks.findIndex(
    (b, i) => b.kind === 'tbl' && text[i].startsWith('שם ושם משפחה') && text[i].includes('תפקיד') && !text[i].includes('סוג היתר'),
  );
  if (authors === -1) throw new Error('טבלת עורכי הדוח לא נמצאה');
  edits.push({
    start: blocks[authors].start,
    end: blocks[authors].end,
    replacement: loopPeopleTable(input.slice(blocks[authors].start, blocks[authors].end), 'authors', [
      '{name}',
      '{role}',
      SIGNATURE_CELL,
    ]),
  });
  record('authorsLoop');

  return applyEdits(input, edits);
}

/**
 * Keeps a table's header plus one data row, wrapped in a loop.
 *
 * A `null` leaves that cell untouched — used for the signature cell, whose
 * image must survive intact.
 */
function loopPeopleTable(tbl: string, loopName: string, values: Array<string | null>): string {
  const rows = collectRows(tbl);
  if (rows.length < 2) throw new Error(`טבלת ${loopName} קטנה מדי`);

  const header = tbl.slice(0, rows[0].end);
  const dataRow = tbl.slice(rows[1].start, rows[1].end);
  const tail = tbl.slice(rows[rows.length - 1].end);

  const wrapped = values.slice();
  const firstIndex = wrapped.findIndex((v) => v !== null);
  const lastIndex = wrapped.length - 1 - [...wrapped].reverse().findIndex((v) => v !== null);
  wrapped[firstIndex] = `{#${loopName}}${wrapped[firstIndex]}`;
  wrapped[lastIndex] = `${wrapped[lastIndex]}{/${loopName}}`;

  return header + setRowCells(dataRow, wrapped, { replaceGraphics: true }) + tail;
}

/**
 * Makes the company line of the recipient block conditional.
 *
 * A private customer has no company, and the line must disappear rather than
 * render blank — an empty line inside the address block is visible on the page.
 * The condition tags go in paragraphs of their own so `paragraphLoop` removes
 * them along with the line they wrap.
 *
 * The paragraph itself is only re-texted, never rebuilt from scratch, so the
 * bold-and-underlined styling the company name already carries is preserved.
 */
function conditionalCompanyLine(input: string): string {
  const blocks = splitBody(input);
  const text = blocks.map((b) => norm(textOf(input.slice(b.start, b.end))));

  // The line is found by its literal text, or by the placeholder a red mark
  // already put there — either way it is the paragraph to make conditional.
  const index = blocks.findIndex(
    (b, i) => b.kind === 'p' && (text[i] === COMPANY_LINE || text[i] === '{companyName}'),
  );
  if (index === -1) throw new Error(`שורת שם החברה לא נמצאה: "${COMPANY_LINE}" או {companyName}`);

  record('companyLineConditional');

  return applyEdits(input, [
    {
      start: blocks[index].start,
      end: blocks[index].end,
      replacement:
        tagParagraph('{#isCompany}') +
        (text[index] === '{companyName}'
          ? input.slice(blocks[index].start, blocks[index].end)
          : setParagraphText(input.slice(blocks[index].start, blocks[index].end), '{companyName}')) +
        tagParagraph('{/isCompany}'),
    },
  ]);
}

/**
 * Turns the site-specific conclusion bullets into loops.
 *
 * Each conclusions section mixes fixed statute text — the exposure thresholds,
 * which are the same in every report — with findings that describe this
 * particular site. Only the latter become a loop; the thresholds stay in the
 * template, where a surveyor cannot mistype them.
 */
function loopConclusions(input: string): string {
  return applyEdits(input, [
    // Exactly the one conclusion that describes this site. Everything around it
    // — the thresholds, the closing lines — is identical in every report and
    // stays in the template, keeping the list at seven items.
    conclusionEdit(input, 'elfConclusions', 'בקפטריה בקומת הקרקע', 'המיגון יבוצע בהתאם לתוואי הכבל'),
    conclusionEdit(input, 'rfConclusions', 'בהשוואה לערכי הסף החדשים', 'בהשוואה לערכי הסף החדשים'),
  ]);
}

/**
 * Replaces the site-specific conclusion with a numbered item plus its body.
 *
 * The range is one numbered conclusion whose text runs on over several
 * paragraphs: the first carries the list number, the rest are continuation
 * text. Numbering every paragraph would renumber the fixed conclusions that
 * follow — in the source that turns seven items into eleven.
 */
function conclusionEdit(input: string, loopName: string, firstAnchor: string, lastAnchor: string): Edit {
  const blocks = splitBody(input);
  const text = blocks.map((b) => norm(textOf(input.slice(b.start, b.end))));

  const from = text.findIndex((t) => t.startsWith(firstAnchor));
  if (from === -1) throw new Error(`תחילת מקטע ${loopName} לא נמצאה: "${firstAnchor}"`);

  const to = text.findIndex((t, i) => i >= from && t.startsWith(lastAnchor));
  if (to === -1) throw new Error(`סוף מקטע ${loopName} לא נמצא: "${lastAnchor}"`);

  console.log(`מסקנות ${loopName}: ${to - from + 1} פסקאות → סעיף אחד`);
  record(`${loopName}Loop`);

  const field = loopName === 'elfConclusions' ? 'elfConclusion' : 'rfConclusion';
  const first = input.slice(blocks[from].start, blocks[from].end);
  // A single-paragraph range has no unnumbered sibling to copy, so the
  // continuation paragraph is the numbered one with its numbering removed.
  const continuation =
    to > from ? input.slice(blocks[from + 1].start, blocks[from + 1].end) : stripNumbering(first);

  return {
    start: blocks[from].start,
    end: blocks[to].end,
    replacement:
      setParagraphText(first, `{${field}First}`) +
      tagParagraph(`{#${field}Rest}`) +
      setParagraphText(continuation, '{.}') +
      tagParagraph(`{/${field}Rest}`),
  };
}

/** A copy of a paragraph with its list numbering removed. */
function stripNumbering(paragraph: string): string {
  return paragraph.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/g, '');
}

// ════════════════════════════════════════════════════════════════════
// Scalar pass
// ════════════════════════════════════════════════════════════════════

/** The whole part, for header and footer files which have no `<w:body>`. */
function wholeOf(content: string): { start: number; end: number } {
  return { start: 0, end: content.length };
}

/** Applies every rule to every paragraph and every table cell in a range. */
function applyScalarRules(input: string, range: { start: number; end: number }): string {
  const { start, end } = range;
  const body = input.slice(start, end);

  const targets: Target[] = [];
  collectTargets(body, 0, body.length, targets);

  let out = body;
  // Rewrite back-to-front so earlier offsets stay valid.
  for (let i = targets.length - 1; i >= 0; i--) {
    const { start: s, end: e, kind } = targets[i];
    const piece = out.slice(s, e);
    if (piece.includes('{')) continue; // already templated by a structural pass

    const t = norm(textOf(piece));
    if (t === '') continue;

    const rule = RULES.find((r) => r.match(t));
    if (!rule) continue;

    try {
      const replaced = kind === 'p' ? setParagraphText(piece, rule.value) : setCellText(piece, rule.value);
      out = out.slice(0, s) + replaced + out.slice(e);
      record(rule.name);
    } catch {
      // A paragraph holding an image cannot be rebuilt; leave it alone.
    }
  }

  return input.slice(0, start) + out + input.slice(end);
}

interface Target {
  start: number;
  end: number;
  kind: 'p' | 'tc';
}

/**
 * Collects the nodes to consider. A paragraph inside a table cell is reported
 * as part of its cell, so a two-line cell is treated as one value.
 */
function collectTargets(s: string, from: number, to: number, out: Target[]): void {
  let i = from;
  while (i < to) {
    if (s.startsWith('<w:tbl>', i) || s.startsWith('<w:tbl ', i)) {
      const tblEnd = findElementEnd(s, i, 'w:tbl');
      collectCells(s, i, tblEnd, out);
      i = tblEnd;
      continue;
    }
    if (s.startsWith('<w:p>', i) || s.startsWith('<w:p ', i)) {
      const e = findElementEnd(s, i, 'w:p');
      const inner = s.indexOf('>', i) + 1;
      // A paragraph can host a text box, whose own paragraphs are the real
      // content — that is how the page header is laid out. Descend rather than
      // treating the outer paragraph as one big leaf.
      if (/<w:p[ >]/.test(s.slice(inner, e))) {
        collectTargets(s, inner, e, out);
      } else {
        out.push({ start: i, end: e, kind: 'p' });
      }
      i = e;
      continue;
    }
    i++;
  }
}

function collectCells(s: string, from: number, to: number, out: Target[]): void {
  let i = from;
  while (i < to) {
    if (s.startsWith('<w:tc>', i) || s.startsWith('<w:tc ', i)) {
      const e = findElementEnd(s, i, 'w:tc');
      const nested = s.indexOf('<w:tbl', i + 1);
      if (nested !== -1 && nested < e) {
        collectTargets(s, i, e, out); // a cell containing a nested table
      } else {
        const paragraphs: Target[] = [];
        collectTargets(s, i, e, paragraphs);
        // A cell holding several paragraphs — the instrument spec blocks — keeps
        // one fact per line, so each line is addressed separately. A single
        // paragraph is addressed as the whole cell instead, which lets
        // `setCellText` drop stale trailing lines.
        if (paragraphs.length > 1) out.push(...paragraphs);
        else out.push({ start: i, end: e, kind: 'tc' });
      }
      i = e;
      continue;
    }
    i++;
  }
}

// ════════════════════════════════════════════════════════════════════
// Utilities
// ════════════════════════════════════════════════════════════════════

interface Edit {
  start: number;
  end: number;
  replacement: string;
}

/** Applies non-overlapping edits, back-to-front so offsets stay valid. */
function applyEdits(s: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = s;
  for (const e of sorted) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return out;
}

/** Top-level `<w:tr>` offsets within a table fragment. */
function collectRows(tbl: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < tbl.length) {
    if (i > 0 && (tbl.startsWith('<w:tbl>', i) || tbl.startsWith('<w:tbl ', i))) {
      i = findElementEnd(tbl, i, 'w:tbl'); // skip a nested table
      continue;
    }
    if (tbl.startsWith('<w:tr>', i) || tbl.startsWith('<w:tr ', i)) {
      const e = findElementEnd(tbl, i, 'w:tr');
      out.push({ start: i, end: e });
      i = e;
      continue;
    }
    i++;
  }
  return out;
}

/** Replaces the text of one cell, addressed by row and cell index. */
function setCellInRow(fragment: string, rowIndex: number, cellIndex: number, value: string): string {
  const rows = collectRows(fragment);
  if (rowIndex >= rows.length) return fragment;
  const row = rows[rowIndex];
  const rowXml = fragment.slice(row.start, row.end);
  const cells = splitCells(rowXml);
  if (cellIndex >= cells.length) return fragment;
  const { start, end } = cells[cellIndex];
  const rebuilt = rowXml.slice(0, start) + setCellText(rowXml.slice(start, end), value) + rowXml.slice(end);
  return fragment.slice(0, row.start) + rebuilt + fragment.slice(row.end);
}

function indicesWhere<T>(items: T[], pred: (t: T) => boolean): number[] {
  const out: number[] = [];
  items.forEach((item, i) => {
    if (pred(item)) out.push(i);
  });
  return out;
}
