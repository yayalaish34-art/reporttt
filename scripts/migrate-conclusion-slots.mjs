/**
 * Migrates the radiation template from the old `{elfConclusionFirst}` placeholders
 * to the highlight-marked slots the code reads today.
 *
 * The code moved to marking dynamic passages with a Word highlight
 * (`collectConclusionSlots`), but the active template was never migrated with it:
 * it still carries the placeholder tags, and nothing populates those any more —
 * so the ELF and RF conclusions came out unworded.
 *
 * Each placeholder paragraph is rewritten as real example prose, highlighted, so
 * the template reads as a finished report in Word and the build recognises the
 * passage to reword. Paragraph properties are preserved verbatim, which is what
 * keeps the numbering (`<w:numPr>`) that prints "1." "2." beside each line.
 *
 * Writes a new .docx next to the template; it does not touch the database.
 */
import fs from 'node:fs';
import path from 'node:path';
import PizZip from 'pizzip';
import { DatabaseSync } from 'node:sqlite';

const OUT = path.resolve('templates/report-template-slots.docx');
const DB = path.resolve('data/reports.db');

/** The ELF conclusions: the clean-survey wording, one paragraph. */
const ELF = [
  'בכל נקודות המדידה שבהן מתקיימת שהייה ממושכת, נמדדו ערכי שדה מגנטי הנמוכים מ־4 מיליגאוס, ולפיכך עומדים בערך המומלץ על ידי המשרד להגנת הסביבה לחשיפה ממושכת במקומות מסוג זה (ראה דוח תוצאות).',
  'בכל שאר נקודות המדידה, שבהן מתקיימת שהייה ממושכת, נמדדו ערכי שדה מגנטי הנמוכים מ־4 מיליגאוס, ולפיכך עומדים בערך המומלץ על ידי המשרד להגנת הסביבה לחשיפה ממושכת במקומות מסוג זה (ראה דוח תוצאות).',
];

/** The RF conclusions, as dictated: five numbered lines for a compliant survey. */
const RF = [
  'בבדיקות הקרינה שבוצעו באתר נמדדו בכל נקודות המדידה ערכי קרינה הנמוכים מערכי הסף שנקבעו על ידי המשרד להגנת הסביבה.',
  'בהתאם לתוצאות המדידה, לא נמצאה באף אחת מנקודות המדידה חריגה מערכי הסף הרלוונטיים לחשיפת הציבור לקרינה בלתי מייננת.',
  'הערכים שנמדדו נמוכים גם מערכי הסף הבריאותיים שנקבעו בהמלצות הוועדה הבינלאומית להגנה מפני קרינה בלתי מייננת (ICNIRP).',
  'לאור תוצאות הבדיקה, רמות הקרינה שנמדדו באתר עומדות בדרישות ובהמלצות המשרד להגנת הסביבה, ולא נמצא במועד הבדיקה מפגע קרינה החורג מערכי הסף הרלוונטיים.',
  'לאור קרבת האתר לאנטנות שידור, ובהתחשב בכך שבמערכות תקשורת עשויים להתבצע מעת לעת שינויים בציוד, בתצורת האנטנות, בכיווני השידור ובהספקי השידור, מומלץ לבצע בדיקת קרינה תקופתית אחת לשנה, וכן לאחר שינוי מהותי במערך האנטנות או בציוד השידור הסמוך לאתר.',
];

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Rebuilds a paragraph with new text, keeping its properties and adding the highlight. */
function paragraphWith(original, text) {
  const pPr = original.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  // The run properties of the paragraph's first run, so the replacement sets in
  // the same face and size as the line it stands in for.
  let rPr = original.match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1] ?? '<w:rPr/>';
  // The highlight is what marks the passage as dynamic for the build.
  rPr = rPr.includes('<w:highlight')
    ? rPr
    : rPr === '<w:rPr/>'
      ? '<w:rPr><w:highlight w:val="yellow"/></w:rPr>'
      : rPr.replace('</w:rPr>', '<w:highlight w:val="yellow"/></w:rPr>');
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

const db = new DatabaseSync(DB);
const row = db.prepare("SELECT bytes, name FROM templates WHERE kind='radiation' AND is_active=1").get();
if (!row) throw new Error('no active radiation template');

const zip = new PizZip(Buffer.from(row.bytes));
let xml = zip.file('word/document.xml').asText();

const paras = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
const textOf = (p) =>
  (p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')).join('').trim();

// Find the placeholder runs by their tag, so this does not depend on indices.
const find = (tag) => paras.findIndex((m) => textOf(m[0]) === tag);

const groups = [
  { first: '{occupiedPointsConclusion}', open: '{#elfConclusionRest}', close: '{/elfConclusionRest}', lines: ELF },
  { first: '{rfPointsConclusion}', open: '{#rfConclusionRest}', close: '{/rfConclusionRest}', lines: RF },
];

const edits = [];
for (const g of groups) {
  const from = find(g.first);
  const to = find(g.close);
  if (from === -1 || to === -1) throw new Error(`placeholders not found for ${g.first}`);

  // The template's own numbered paragraph is the model for every replacement line,
  // so all of them keep the list numbering.
  const model = paras[from][0];
  const replacement = g.lines.map((t) => paragraphWith(model, t)).join('');
  edits.push({ start: paras[from].index, end: paras[to].index + paras[to][0].length, xml: replacement });
  console.log(`${g.first} → ${g.lines.length} פסקאות מודגשות`);
}

// Back to front, so earlier offsets stay valid.
edits.sort((a, b) => b.start - a.start);
for (const e of edits) xml = xml.slice(0, e.start) + e.xml + xml.slice(e.end);

zip.file('word/document.xml', xml);
fs.writeFileSync(OUT, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`\nנכתב: ${OUT}`);
