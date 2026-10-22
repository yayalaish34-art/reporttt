/**
 * Builds the asbestos template from Galit's own signed opinion.
 *
 * The source is a real, finished חוות דעת — the one for וייסבורג 11 — with the
 * parts that change from job to job marked in yellow by the surveyor. This turns
 * those marks into merge fields and leaves everything else exactly as it is:
 * the letterhead, the ISO paragraph, the surveyor's licence block, the closing
 * details and every image survive untouched, because they are the document.
 *
 * Working from the real document rather than authoring a new one is the whole
 * point. The wording of an expert opinion given in place of court testimony is
 * not ours to improve, and a template retyped from scratch would differ from the
 * signed original in ways nobody would notice until it mattered.
 *
 * The address is the reason this is a script and not a hand edit. It appears six
 * times in the source, and the surveyor was highlighting the *same fact* each
 * time — so all six become one field, asked once.
 *
 *   npx tsx scripts/build-asbestos-template.ts <source.docx> [out.docx]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.argv[2] ? resolve(process.argv[2]) : '';
const OUT = resolve(process.argv[3] ?? resolve(ROOT, 'templates/asbestos-template.docx'));

if (!SOURCE || !existsSync(SOURCE)) {
  console.error('שימוש: npx tsx scripts/build-asbestos-template.ts <source.docx> [out.docx]');
  console.error('הקובץ חייב להיות .docx — קובץ .doc ישן יש להמיר תחילה ב-Word.');
  process.exit(1);
}

const zip = new PizZip(readFileSync(SOURCE));
const documentFile = zip.file('word/document.xml');
if (!documentFile) {
  console.error('הארכיון אינו מסמך Word — word/document.xml חסר.');
  process.exit(1);
}

let xml = documentFile.asText();

/**
 * A paragraph, addressed by the text it contains.
 *
 * Paragraph indexes would be shorter to write and would break the first time
 * anyone opened the source in Word and pressed Enter. Matching on the wording
 * fails loudly instead — the report at the end says which anchors were not
 * found, so a template built against a moved paragraph cannot ship silently.
 */
const paragraphs = xml.match(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];

const textOf = (p: string): string =>
  (p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
    .map((t) => t.replace(/<[^>]+>/g, ''))
    .join('');

let replacements = 0;
const missing: string[] = [];

/**
 * Rewrites one paragraph, found by a distinctive fragment of its own text.
 *
 * `build` receives the paragraph's XML and returns the replacement. Returning
 * the input unchanged is treated as a miss, so a rule that silently matched
 * nothing is reported rather than assumed to have worked.
 */
function rewrite(anchor: string, label: string, build: (xmlOfParagraph: string) => string): void {
  const found = paragraphs.find((p) => textOf(p).includes(anchor));
  if (!found) {
    missing.push(`${label} — לא נמצאה פסקה שמכילה "${anchor}"`);
    return;
  }
  const next = build(found);
  if (next === found) {
    missing.push(`${label} — הפסקה נמצאה אך לא שונתה`);
    return;
  }
  xml = xml.replace(found, next);
  replacements++;
  console.log(`  ✓ ${label}`);
}

/**
 * Replaces the text of every highlighted run in a paragraph.
 *
 * The first highlighted run receives `value`; the rest are emptied. That is what
 * collapses "«בבניין מרחוב »«וייסבורג 11, תל אביב נמצאו…»«48 מ"ר.»" — three runs
 * Word split a single sentence into — down to one field without disturbing the
 * unhighlighted text between them.
 *
 * The highlight itself is stripped as it goes. It was an instruction to this
 * script; leaving it in would put yellow marks in front of a client, and would
 * also offer the passage to the conclusions rewriter, which must only ever see
 * passages meant for it.
 */
function fillHighlights(paragraph: string, value: string): string {
  let used = false;
  return paragraph.replace(/<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g, (run) => {
    if (!/<w:highlight w:val="(?!none)/.test(run)) return run;

    const cleaned = run.replace(/<w:highlight w:val="[^"]*"\/>/g, '');
    if (used) {
      // A run that carried part of the old sentence and now carries nothing.
      return cleaned.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/g, '<w:t xml:space="preserve"></w:t>');
    }
    used = true;

    let first = true;
    return cleaned.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/g, () => {
      if (!first) return '<w:t xml:space="preserve"></w:t>';
      first = false;
      return `<w:t xml:space="preserve">${value}</w:t>`;
    });
  });
}

/**
 * Wraps a whole paragraph in a section, so a false condition removes the line itself.
 *
 * The bullet lives on the paragraph, not on its text, so emptying the text is not enough:
 * a survey with nothing buried printed a bullet with nothing after it, in the middle of
 * its summary. With the tags in bare paragraphs on either side, docxtemplater's
 * `paragraphLoop` treats the paragraph between them as the body and drops the whole line.
 */
function conditionalParagraph(anchor: string, label: string, flag: string, body: string): void {
  const found = paragraphs.find((p) => textOf(p).includes(anchor));
  if (!found) {
    missing.push(`${label} — לא נמצאה פסקה שמכילה "${anchor}"`);
    return;
  }
  const filled = fillHighlights(found, body);
  xml = xml.replace(
    found,
    `<w:p><w:r><w:t>{#${flag}}</w:t></w:r></w:p>${filled}<w:p><w:r><w:t>{/${flag}}</w:t></w:r></w:p>`,
  );
  replacements++;
  console.log(`  ✓ ${label}`);
}

console.log('\nבניית תבנית האסבסט\n');

// ── Cover ───────────────────────────────────────────────────────────
// "סקר אסבסט" / "צמנט למבנה מרחוב <כתובת>" — the second line carries the
// address, and the word "צמנט" is highlighted because a survey is not always
// for cement. Both become fields.
rewrite('צמנט', 'שער — סוג האסבסט והכתובת', (p) => fillHighlights(p, '{asbestosKind} ל{siteLabel}'));
rewrite('מזמין הסקר', 'שער — מזמין הסקר', (p) => fillHighlights(p, '{clientName}'));

// ── נושא חוות הדעת ──────────────────────────────────────────────────
// One sentence carrying both the client and the address.
rewrite('נערכה חוות דעת זו', 'נושא חוות הדעת', (p) =>
  p
    .replace(/<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g, (run) => {
      if (!/<w:highlight w:val="(?!none)/.test(run)) return run;
      const cleaned = run.replace(/<w:highlight w:val="[^"]*"\/>/g, '');
      const text = (cleaned.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ''))
        .join('');
      // The two highlighted spans in this sentence are different facts, so it
      // cannot go through `fillHighlights` — that collapses them into one.
      const value = text.includes('חברת') ? '{clientName}' : '{siteAddressBare}';
      let first = true;
      return cleaned.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/g, () => {
        if (!first) return '<w:t xml:space="preserve"></w:t>';
        first = false;
        return `<w:t xml:space="preserve">${value}</w:t>`;
      });
    }),
);

// ── הבסיס לחוות הדעת ────────────────────────────────────────────────
rewrite('ביקור במבנה מרחוב', 'הבסיס — ביקור במבנה', (p) => fillHighlights(p, '{siteAddress}.'));

// ── תיאור המקום וסביבתו ─────────────────────────────────────────────
// Two highlighted lines, replaced by one field the surveyor writes freely: how
// a building sits in its surroundings is not a form, and the source itself is
// two sentences of ordinary prose.
rewrite('בניין מגורים בן', 'תיאור המקום', (p) => fillHighlights(p, '{siteDescription}'));
rewrite('למבנים הסמוכים', 'תיאור המקום — מרחקים', (p) => fillHighlights(p, '{surroundings}'));

// ── הסקר — נספח התמונות ─────────────────────────────────────────────
/**
 * The photo section becomes the appendix tag.
 *
 * The source carries one photograph with a hand-typed "תמונה מס' 1:" above it.
 * A survey has as many photographs as it has findings, and numbering them by
 * hand is how a report ends up with two number 3s. `{@photosXml}` is built in
 * code — one photograph per page, numbered as they are written.
 *
 * The caption paragraph and the anchored picture are both removed; everything
 * the appendix needs is generated.
 */
{
  const captionParagraph = paragraphs.find((p) => textOf(p).includes("תמונה מס'"));
  const legendParagraph = paragraphs.find((p) => textOf(p).includes('צילום אוויר'));

  if (!captionParagraph || !legendParagraph) {
    missing.push('נספח התמונות — לא נמצאה פסקת הכיתוב');
  } else {
    const start = xml.indexOf(captionParagraph);
    const legendEnd = xml.indexOf(legendParagraph) + legendParagraph.length;

    // Everything from the caption through the anchored picture, up to but not
    // including "ממצאי הבדיקה". Removing the range wholesale rather than the two
    // paragraphs alone is deliberate: the picture sits in its own empty
    // paragraphs between them, and leaving those behind would print a run of
    // blank lines where the appendix used to start.
    const findingsHeading = paragraphs.find((p) => textOf(p).includes('ממצאי הבדיקה'));
    const end = findingsHeading ? xml.indexOf(findingsHeading) : legendEnd;

    if (start >= 0 && end > start) {
      xml = xml.slice(0, start) + '<w:p><w:r><w:t>{@photosXml}</w:t></w:r></w:p>' + xml.slice(end);
      replacements++;
      console.log('  ✓ נספח התמונות — {@photosXml}');
    } else {
      missing.push('נספח התמונות — טווח הפסקאות לא אותר');
    }
  }
}

// ── ממצאי הבדיקה ────────────────────────────────────────────────────
rewrite('נתונים:', 'ממצאים — כותרת הנתונים', (p) => fillHighlights(p, '{siteAddress}'));

/**
 * The three findings lines become one repeating block.
 *
 * They are three in this report and will be another number in the next, so the
 * count cannot be baked into the template. The first line carries the loop and
 * the other two are dropped — docxtemplater repeats the paragraph that holds
 * `{#findings}` once per entry, keeping the bullet formatting of the original.
 */
{
  const findingLines = [
    paragraphs.find((p) => textOf(p).includes('צינורות ביוב עשויים אסבסט')),
    paragraphs.find((p) => textOf(p).includes('ארובה עשויה אסבסט')),
    paragraphs.find((p) => textOf(p).includes('עדניות עשויות אסבסט')),
  ];

  if (!findingLines[0]) {
    missing.push('ממצאים — לא נמצאה שורת הממצא הראשונה');
  } else {
    /*
     * The loop tags wrap the paragraph rather than sitting inside it.
     *
     * Written inline as `{#findings}{text}{/findings}`, docxtemplater repeats the *text*
     * within one paragraph — so three findings came out as three sentences run together
     * on a single bullet. With the tags in bare paragraphs on either side, the bulleted
     * paragraph between them is the loop body and each finding gets its own bullet.
     */
    const body = fillHighlights(findingLines[0], '{text}');
    xml = xml.replace(
      findingLines[0],
      `<w:p><w:r><w:t>{#findings}</w:t></w:r></w:p>${body}<w:p><w:r><w:t>{/findings}</w:t></w:r></w:p>`,
    );
    for (const extra of findingLines.slice(1)) if (extra) xml = xml.replace(extra, '');
    replacements++;
    console.log('  ✓ ממצאים — לולאת {#findings}');
  }
}

// ── סיכום ───────────────────────────────────────────────────────────
/**
 * The three closing sentences.
 *
 * The first states the building and the total area, and the total is a sum of
 * the findings rather than a number anyone should retype — `{totalArea}` is
 * computed. The second and third are conditional in the source's own logic:
 * the soil-contamination sentence follows from there being buried piping, and
 * the demolition sentence from anything being found at all. They are wrapped in
 * sections so a survey that found nothing does not print either.
 */
rewrite('נמצאו אלמנטים עשויים אסבסט', 'סיכום — סה"כ השטח', (p) =>
  fillHighlights(p, 'ב{siteLabel} נמצאו אלמנטים עשויים אסבסט בגודל כולל של כ-{totalArea}.'),
);
/*
 * The two conditional lines are wrapped *around* their paragraph, not written inside it.
 *
 * `{#hasBuried}{buriedSentence}{/hasBuried}` inside one paragraph empties the text when
 * the condition is false and leaves the paragraph behind — which, on a bulleted line, is
 * a bullet with nothing after it. A survey with nothing buried printed a blank bullet in
 * the middle of its summary, between the total and the removal sentence.
 */
conditionalParagraph(
  'פוטנציאל להימצאות נוכחות אסבסט בקרקע',
  'סיכום — אסבסט בקרקע',
  'hasBuried',
  '{buriedSentence}',
);
conditionalParagraph(
  'נוהל לפינוי אסבסט ואבק מזיק',
  'סיכום — פינוי לפני הריסה',
  'hasFindings',
  '{removalSentence}',
);

// ── Date on the cover ───────────────────────────────────────────────
// Not highlighted in the source — an oversight rather than a decision, since a
// template that always says "אוגוסט 2026" would date every future report to it.
{
  const dateParagraph = paragraphs.find((p) => textOf(p).trim() === 'אוגוסט 2026');
  if (dateParagraph) {
    let first = true;
    const next = dateParagraph.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/g, () => {
      if (!first) return '<w:t xml:space="preserve"></w:t>';
      first = false;
      return '<w:t xml:space="preserve">{reportDate}</w:t>';
    });
    xml = xml.replace(dateParagraph, next);
    replacements++;
    console.log('  ✓ שער — תאריך הדוח');
  } else {
    missing.push('שער — לא נמצאה פסקת התאריך');
  }
}

/**
 * Strips every highlight still standing.
 *
 * Two kinds survive the rules above and both would reach a client. The title
 * "סקר אסבסט" is marked because the surveyor was pointing at the whole heading
 * line while marking the address under it, but the words themselves never change
 * — there is nothing to turn into a field, only a mark to remove. And Word
 * carries a highlight on the paragraph mark itself (inside `w:pPr/w:rPr`), which
 * no run-level rule can see; those are the six left here.
 *
 * Done unconditionally at the end rather than case by case, because the rule is
 * absolute: yellow is an instruction to this script, and a signed opinion must
 * not go out with marks on it. It also matters to the generator — the
 * conclusions rewriter treats a highlighted passage as something to reword, so a
 * stray mark would hand the model a sentence nobody meant it to touch.
 */
{
  const before = (xml.match(/<w:highlight w:val="(?!none)[^"]*"\/>/g) ?? []).length;
  xml = xml.replace(/<w:highlight w:val="(?!none)[^"]*"\/>/g, '');
  if (before > 0) console.log(`  ✓ הוסרו ${before} סימוני הדגשה שנותרו`);
}

// ── Write ───────────────────────────────────────────────────────────
zip.file('word/document.xml', xml);
const bytes = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(OUT, bytes);

console.log(`\n${replacements} החלפות בוצעו.`);
if (missing.length > 0) {
  console.log('\nלא בוצעו:');
  for (const m of missing) console.log(`  ✗ ${m}`);
}
console.log(`\nנשמר: ${OUT}`);
console.log(`גודל:  ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);

// A template with an unresolved anchor renders a report with a stale sentence
// in it, so it fails the build rather than being written and forgotten.
process.exit(missing.length === 0 ? 0 : 1);
