/**
 * Collapses the ELF and RF measurement tables of a template into loops.
 *
 * For a document that is already part-templated by hand — the cover fields
 * filled in, but every protocol still written out in full. It keeps one
 * protocol of each kind, wraps it in `{#elfProtocols}` / `{#rfProtocols}`, and
 * turns its table into a `{#rows}` loop, so the number of floors surveyed stops
 * being fixed by the document.
 *
 * Only the protocol tables are touched. The inspector and author tables, the
 * conclusions and everything else are left exactly as they are.
 *
 *   npx tsx scripts/collapse-protocols.ts <input.docx> [output.docx]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import PizZip from 'pizzip';
import { collapseProtocols, replacePhotoAppendix } from '../src/lib/docx/protocol-loops';
import { collapseMarkedConclusions, findRfSectionStart } from '../src/lib/docx/conclusion-loops';
import { ensureContentTypesFirst } from '../src/lib/docx/merge-docx';
import { countHighlightedRuns, countRunsWithColor, stripMarkFromTaggedRuns } from '../src/lib/docx/marked-runs';
import { splitBody, textOf } from '../src/lib/docx/ooxml';
import { setParagraphText } from '../src/lib/docx/authoring';

const input = process.argv[2];
if (!input) {
  console.error('שימוש: npx tsx scripts/collapse-protocols.ts <input.docx> [output.docx]');
  process.exit(1);
}

const inputPath = resolve(input);
if (!existsSync(inputPath)) {
  console.error(`הקובץ לא נמצא: ${inputPath}`);
  process.exit(1);
}

const outputPath = process.argv[3]
  ? resolve(process.argv[3])
  : join(dirname(inputPath), `${basename(inputPath, extname(inputPath))}-collapsed.docx`);

const zip = new PizZip(readFileSync(inputPath));
const documentPart = zip.file('word/document.xml');
if (!documentPart) throw new Error('word/document.xml חסר בארכיון');

const before = documentPart.asText();
console.log(`קלט: ${inputPath}`);
report('לפני', before);

/**
 * Fixed labels that were marked but are not fields.
 *
 * "לכבוד" heads the address block of every report and never changes. It was
 * marked along with the values under it; unmarking is the whole fix.
 */
const FIXED_LABELS = ['לכבוד'];

/** The colour used to mark dynamic values in this document. */
const MARK_COLOR = process.env.MARK_COLOR ?? '0070C0';

const collapsed = collapseProtocols(before);
const { elfCount, rfCount } = collapsed;

// The placeholders inherited the marking colour from the values they replaced.
// Left in, every merged value would print in that colour.
// Marked sentences in the conclusions describe this site's findings and vary
// from report to report; the fixed statute text around them does not.
const conclusions = collapseMarkedConclusions(
  collapsed.xml,
  (paragraph) => new RegExp(`<w:color w:val="${MARK_COLOR}"`, 'i').test(paragraph),
  findRfSectionStart(collapsed.xml),
);

// Labels are marked too but are not fields — "לכבוד" heads the address block in
// every report. They are unmarked rather than turned into placeholders.
const unmarked = templateConclusionFour(unmarkFixedLabels(conclusions.xml, MARK_COLOR));

// The photo appendix becomes one injection point. Captions and their numbering
// are generated at merge time from the photos actually attached.
const photos = replacePhotoAppendix(unmarked);

const cleaned = stripMarkFromTaggedRuns(photos.xml, MARK_COLOR);
const xml = cleaned.xml;

if (elfCount === 0 && rfCount === 0) {
  console.error('\nלא נמצאו פרוטוקולי ELF או RF במסמך. אין מה לכווץ.');
  process.exit(1);
}
console.log(`\nכווץ: ${elfCount} פרוטוקולי ELF ו-${rfCount} פרוטוקולי RF → לולאה אחת מכל סוג`);
console.log(`הוסר סימון מ-${cleaned.stripped} ריצות שנושאות placeholder`);
if (photos.count > 0) {
  console.log(`נספח תמונות: ${photos.count} תמונות קבועות → {@photosXml}`);
}

if (conclusions.collapsed.length > 0) {
  console.log('\nמסקנות שכווצו ללולאה:');
  for (const c of conclusions.collapsed) {
    console.log(`   ${c.kind.toUpperCase().padEnd(4)} ${c.count} משפטים  "${c.first}…"`);
  }
}

// Text still carrying the colour never became a placeholder. It is either
// content the colour was legitimately used for, or a mark nobody acted on —
// worth naming either way rather than stripping in silence.
const samples = markedSamples(xml, MARK_COLOR);
const stillMarked = countRunsWithColor(xml, MARK_COLOR) + countHighlightedRuns(xml);
if (stillMarked > 0) {
  console.log(`\nנותרו ${stillMarked} ריצות מסומנות שאינן placeholder — הן יודפסו בצבע:`);
  for (const sample of samples.slice(0, 12)) console.log(`   ${JSON.stringify(sample)}`);
  if (samples.length > 12) console.log(`   … ועוד ${samples.length - 12}`);
  console.log('\n   אם אלה שדות — הריצו `npm run scan:fields` על הפלט.');
  console.log('   אם זה תוכן שאמור להיות צבעוני — אין מה לעשות.');
}

zip.file('word/document.xml', xml);
ensureContentTypesFirst(zip);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));

report('אחרי', xml);
console.log(`\nנכתב: ${outputPath}`);

/**
 * Conclusion 4 states whether the occupied points came out below the threshold.
 *
 * One word changes — נמוכים / גבוהים — and the scope of the sentence changes
 * with it, so the whole line is replaced and computed at merge time.
 */
function templateConclusionFour(docXml: string): string {
  const blocks = splitBody(docXml);
  const index = blocks.findIndex((b) =>
    textOf(docXml.slice(b.start, b.end)).replace(/\s+/g, ' ').trim().startsWith('בכל נקודות המדידה, בהם יש שהייה קבועה'),
  );
  if (index === -1) {
    console.log('הערה: סעיף 4 ("בכל נקודות המדידה…") לא נמצא — מדלג.');
    return docXml;
  }

  console.log('סעיף 4 → {occupiedPointsConclusion}');
  const paragraph = docXml.slice(blocks[index].start, blocks[index].end);
  return (
    docXml.slice(0, blocks[index].start) +
    setParagraphText(paragraph, '{occupiedPointsConclusion}') +
    docXml.slice(blocks[index].end)
  );
}

function unmarkFixedLabels(docXml: string, color: string): string {
  return docXml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!FIXED_LABELS.includes(textOf(paragraph).trim())) return paragraph;
    return paragraph.replace(new RegExp(`<w:color w:val="${color}"[^>]*/>`, 'gi'), '');
  });
}

/** The text of runs still carrying the mark, for reporting what was left. */
function markedSamples(docXml: string, color: string): string[] {
  const out: string[] = [];
  for (const m of docXml.matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)) {
    if (!new RegExp(`<w:color w:val="${color}"`, 'i').test(m[0])) continue;
    const t = textOf(m[0]).trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** A one-line picture of the document's protocol structure. */
function report(label: string, docXml: string): void {
  const blocks = splitBody(docXml);
  const text = blocks.map((b) => textOf(docXml.slice(b.start, b.end)).replace(/\s+/g, ' ').trim());
  const tags = [...new Set((text.join(' ').match(/\{[^}]{1,30}\}/g) ?? []))];

  console.log(`\n── ${label}`);
  console.log(`   טבלאות: ${(docXml.match(/<w:tbl>/g) ?? []).length}`);
  console.log(`   פרוטוקולי ELF: ${text.filter((t) => t.startsWith('פרוטוקול רשמי - מדידת שדה מגנטי')).length}`);
  console.log(`   פרוטוקולי RF:  ${text.filter((t) => t.startsWith('פרוטוקול רשמי - מדידת צפיפות')).length}`);
  console.log(`   לולאות: ${tags.filter((t) => /^\{[#/]/.test(t)).join(' ') || '—'}`);
}
