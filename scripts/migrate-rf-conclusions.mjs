/**
 * Replaces the RF conclusions of the active radiation template with the five
 * dictated lines, marked as one highlighted slot.
 *
 * Why this is needed: the RF conclusions in the template were a single sentence
 * whose middle was highlighted — a fragment slot. A fragment can only ever be
 * reworded in place, so the five-line conclusion the surveyor wants had nowhere
 * to go. Rewriting the passage as five whole highlighted paragraphs gives the
 * build a slot of five to reword, and gives Word a readable example report.
 *
 * Operates on a template file given as argv[2] and writes argv[3]; the database
 * is not touched. The result is uploaded through /api/templates/upload.
 */
import fs from 'node:fs';
import PizZip from 'pizzip';

const IN = process.argv[2];
const OUT = process.argv[3];
if (!IN || !OUT) throw new Error('usage: node migrate-rf-conclusions.mjs <in.docx> <out.docx>');

/** The RF conclusions for a compliant survey, as dictated. */
const RF = [
  'בבדיקות הקרינה שבוצעו באתר נמדדו בכל נקודות המדידה ערכי קרינה הנמוכים מערכי הסף שנקבעו על ידי המשרד להגנת הסביבה.',
  'בהתאם לתוצאות המדידה, לא נמצאה באף אחת מנקודות המדידה חריגה מערכי הסף הרלוונטיים לחשיפת הציבור לקרינה בלתי מייננת.',
  'הערכים שנמדדו נמוכים גם מערכי הסף הבריאותיים שנקבעו בהמלצות הוועדה הבינלאומית להגנה מפני קרינה בלתי מייננת (ICNIRP).',
  'לאור תוצאות הבדיקה, רמות הקרינה שנמדדו באתר עומדות בדרישות ובהמלצות המשרד להגנת הסביבה, ולא נמצא במועד הבדיקה מפגע קרינה החורג מערכי הסף הרלוונטיים.',
  'לאור קרבת האתר לאנטנות שידור, ובהתחשב בכך שבמערכות תקשורת עשויים להתבצע מעת לעת שינויים בציוד, בתצורת האנטנות, בכיווני השידור ובהספקי השידור, מומלץ לבצע בדיקת קרינה תקופתית אחת לשנה, וכן לאחר שינוי מהותי במערך האנטנות או בציוד השידור הסמוך לאתר.',
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textOf = (p) =>
  (p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')).join('').trim();

/** Rebuilds a paragraph with new text, keeping its properties and marking it. */
function paragraphWith(model, text) {
  const pPr = model.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  let rPr = model.match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1] ?? '';
  // Drop any highlight the model already carried, then add exactly one.
  rPr = rPr.replace(/<w:highlight[^/]*\/>/g, '');
  rPr = rPr
    ? rPr.replace('</w:rPr>', '<w:highlight w:val="yellow"/></w:rPr>')
    : '<w:rPr><w:highlight w:val="yellow"/></w:rPr>';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

const zip = new PizZip(fs.readFileSync(IN));
let xml = zip.file('word/document.xml').asText();
const paras = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];

// The RF conclusions are the LAST "מסקנות" heading — the ELF ones come first.
let heading = -1;
paras.forEach((m, i) => {
  if (textOf(m[0]) === 'מסקנות') heading = i;
});
if (heading === -1) throw new Error('RF conclusions heading not found');

// The passage runs from the heading to the closing "בהסתמך על המחקרים" line,
// which is fixed prose that stays. Anchored on text, not on an index.
const closing = paras.findIndex((m, i) => i > heading && /^בהסתמך על המחקרים/.test(textOf(m[0])));
if (closing === -1) throw new Error('closing paragraph not found');

const from = heading + 1;
const to = closing - 1;
if (to < from) throw new Error('nothing to replace between heading and closing line');

console.log(`מחליף פסקאות ${from}–${to} ב-${RF.length} פסקאות מודגשות:`);
for (let i = from; i <= to; i++) console.log(`  יוצא: ${textOf(paras[i][0]).slice(0, 80)}`);

const model = paras[from][0];
const replacement = RF.map((t) => paragraphWith(model, t)).join('');
xml = xml.slice(0, paras[from].index) + replacement + xml.slice(paras[to].index + paras[to][0].length);

zip.file('word/document.xml', xml);
fs.writeFileSync(OUT, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`\nנכתב: ${OUT}`);
