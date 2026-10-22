/**
 * Builds the *tabled* asbestos template from Galit's own signed opinion.
 *
 * Galit issues the asbestos opinion in two shapes. The prose form — built by
 * `build-asbestos-template.ts` — states findings as sentences, which is how a
 * demolition survey of one building reads. This one carries a fifteen-row table per
 * building, which is how a maintenance survey of a campus reads: every building is put
 * to the same thirteen questions so that the buildings can be compared.
 *
 * The source is the שלוותה opinion, with the parts that vary marked in yellow. The two
 * tables in it are the same table filled in twice, so the first becomes a loop over the
 * buildings and the second is dropped.
 *
 *   npx tsx scripts/build-asbestos-tables-template.ts <source.docx> [out.docx]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.argv[2] ? resolve(process.argv[2]) : '';
const OUT = resolve(process.argv[3] ?? resolve(ROOT, 'templates/asbestos-tables-template.docx'));

if (!SOURCE || !existsSync(SOURCE)) {
  console.error('שימוש: npx tsx scripts/build-asbestos-tables-template.ts <source.docx> [out.docx]');
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

const paragraphs = xml.match(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
const textOf = (p: string): string =>
  (p.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('');

let replacements = 0;
const missing: string[] = [];

/** See `build-asbestos-template.ts` — same contract, same failure reporting. */
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

/** Replaces every highlighted run in a paragraph with one field. See the prose builder. */
function fillHighlights(paragraph: string, value: string): string {
  let used = false;
  return paragraph.replace(/<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g, (run) => {
    if (!/<w:highlight w:val="(?!none)/.test(run)) return run;
    const cleaned = run.replace(/<w:highlight w:val="[^"]*"\/>/g, '');
    if (used) return cleaned.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, '<w:t xml:space="preserve"></w:t>');
    used = true;
    let first = true;
    return cleaned.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, () => {
      if (!first) return '<w:t xml:space="preserve"></w:t>';
      first = false;
      return `<w:t xml:space="preserve">${value}</w:t>`;
    });
  });
}

/** Strips every remaining highlight, so no yellow reaches a client. */
function stripHighlights(s: string): string {
  return s.replace(/<w:highlight w:val="[^"]*"\/>/g, '');
}

console.log('\nבניית תבנית האסבסט — גרסת הטבלאות\n');

// ── Cover ───────────────────────────────────────────────────────────
/*
 * The cover title is split across two paragraphs — Word broke the line where the survey
 * kind ends and the building begins. Both carry highlights, so both are templated: the
 * first takes the whole sentence, the second is emptied rather than left holding a real
 * hospital's name.
 */
/*
 * The cover title, which spans two paragraphs.
 *
 * The first of them also holds the page's border graphic — a `<w:pict>` with a
 * `<v:textbox>` inside it — and the words "סקר אסבסט" appear in both. Rewriting the one
 * with the picture in it tore a run out of the textbox and produced a document Word
 * offers to repair, so the graphic paragraph is left alone and the whole title is written
 * into the plain second line.
 */
rewrite('בבית חולים שלוותה מרחוב', 'שער — כותרת הדוח', (p) =>
  fillHighlights(p, 'סקר אסבסט {asbestosKind} ב{siteLabel}'),
);
// The date sits on its own line under the title — "נובמבר 2025", split across two runs.
rewrite('2025', 'שער — תאריך הדוח', (p) => fillHighlights(p, '{reportDate}'));
rewrite('מזמין הסקר', 'שער — מזמין הסקר', (p) => fillHighlights(p, '{clientName}'));

// ── נושא חוות הדעת ──────────────────────────────────────────────────
rewrite('נערכה חוות דעת זו', 'נושא חוות הדעת', (p) => fillHighlights(p, '{clientName} מ{siteAddressBare}'));

// ── הבסיס לחוות הדעת ────────────────────────────────────────────────
rewrite('ביקור ב', 'הבסיס — ביקור באתר', (p) => fillHighlights(p, '{siteAddress}.'));

// ── תיאור המקום וסביבתו ─────────────────────────────────────────────
rewrite('בית חולים ציבורי', 'תיאור המקום', (p) => fillHighlights(p, '{siteDescription}'));
rewrite('אלמנטים עשויים אסבסט:', 'תיאור המקום — מבוא למבנים', (p) => fillHighlights(p, '{surroundings}'));

/**
 * The two lines naming the buildings ("ביתן 3", "ביתן 16") are dropped.
 *
 * They list what the tables below already name, one row each, so leaving them would ask
 * the surveyor for the same fact twice and let the two disagree.
 */
for (const anchor of ['ביתן 3', 'ביתן 16']) {
  const line = paragraphs.find((p) => textOf(p).trim() === anchor);
  if (line) {
    xml = xml.replace(line, '');
    replacements++;
    console.log(`  ✓ הוסרה שורת "${anchor}" — הטבלה נושאת את השם`);
  }
}

// ── נספח התמונות ────────────────────────────────────────────────────
{
  const captionParagraph = paragraphs.find((p) => textOf(p).includes("תמונה מס'"));
  const legendParagraph = paragraphs.find((p) => textOf(p).includes('צילום אוויר'));
  if (!captionParagraph || !legendParagraph) {
    missing.push('נספח התמונות — לא נמצאה פסקת הכיתוב');
  } else {
    const start = xml.indexOf(captionParagraph);
    const end = xml.indexOf(legendParagraph) + legendParagraph.length;
    if (start >= 0 && end > start) {
      xml = xml.slice(0, start) + '<w:p><w:r><w:t>{@photosXml}</w:t></w:r></w:p>' + xml.slice(end);
      replacements++;
      console.log('  ✓ נספח התמונות — {@photosXml}');
    } else {
      missing.push('נספח התמונות — טווח הפסקאות לא אותר');
    }
  }
}

/**
 * The building table becomes a loop.
 *
 * The source holds the same table twice, once per building. The first is templated and
 * wrapped in `{#buildings}…{/buildings}`; the second is removed, because a template that
 * shipped two tables would print two for every survey however many buildings it covered.
 *
 * Only the *answer* cell of each row is replaced. The label cell is the question the
 * surveyor is answering — "מופע אסבסט (גגות, סככה פתוחה, קיר חיצוני/פנימי וכו')" — and
 * it is part of the form, not part of the data.
 *
 * The three rows with a single cell are section headings inside the table
 * ("תיאור המבנים המכילים אסבסט", "מצב חומרי מבנה המכילים אסבסט") and the closing
 * "הנחיות לביצוע" row, which carries its answer in the same cell as its label.
 */
const FIELD_BY_ROW: Record<number, string> = {
  1: '{name}',
  2: '{use}',
  3: '{appearance}',
  4: '{barrier}',
  5: '{area}',
  6: '{moisture}',
  8: '{sheetCondition}',
  9: '{edgeCondition}',
  10: '{debris}',
  11: '{painted}',
  12: '{roofCover}',
  13: '{friable}',
};

/**
 * The cells of one row, as offsets.
 *
 * A regex cannot do this: `<w:tc>[\s\S]*?<\/w:tc>` stops at the first closing tag, and a
 * cell containing a nested table has one of those inside it. Matching the wrong extent
 * put a field *after* a cell's closing tag and produced XML Word refuses to open — which
 * is exactly the bug this replaced.
 */
function cellsOf(row: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const opener = /<w:tc(?: [^>]*)?>/g;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(row))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < row.length && depth > 0) {
      const nextOpen = row.indexOf('<w:tc', i);
      const nextClose = row.indexOf('</w:tc>', i);
      if (nextClose === -1) break;
      // `<w:tcPr>` and `<w:tcW>` start with `<w:tc` too; only a real cell counts.
      const isCell = nextOpen !== -1 && /^<w:tc(?: [^>]*)?>/.test(row.slice(nextOpen));
      if (isCell && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 5;
      } else {
        depth--;
        i = nextClose + '</w:tc>'.length;
      }
    }
    out.push({ start: m.index, end: i });
    opener.lastIndex = i;
  }
  return out;
}

/** Replaces a cell's text with one value, keeping the cell's own formatting. */
function setCellText(cell: string, value: string): string {
  let first = true;
  const filled = cell.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, () => {
    if (!first) return '<w:t xml:space="preserve"></w:t>';
    first = false;
    return `<w:t xml:space="preserve">${value}</w:t>`;
  });
  // A cell whose answer was empty in the source has no <w:t> to replace; give the
  // paragraph a run so the field has somewhere to land.
  if (filled === cell && !/<w:t(?:\s[^>]*)?>/.test(cell)) {
    return cell.replace(/(<w:p(?: [^>]*)?>)/, `$1<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`);
  }
  return filled;
}

{
  const tables = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
  if (tables.length < 2) {
    missing.push(`טבלאות המבנים — נמצאו ${tables.length} טבלאות, נדרשות שתיים`);
  } else {
    const first = tables[0]!;
    const second = tables[1]!;
    const rows = first.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? [];

    if (rows.length !== 15) {
      missing.push(`טבלת המבנים — ${rows.length} שורות במקום 15`);
    } else {
      let templated = first;

      for (const [index, field] of Object.entries(FIELD_BY_ROW)) {
        const row = rows[Number(index)]!;
        const spans = cellsOf(row);
        if (spans.length < 2) {
          missing.push(`שורה ${index} — ${spans.length} תאים, נדרשים שניים`);
          continue;
        }
        // The answer is the last cell; the first carries the question.
        const span = spans[spans.length - 1]!;
        const answer = row.slice(span.start, span.end);
        const nextRow =
          row.slice(0, span.start) + stripHighlights(setCellText(answer, field)) + row.slice(span.end);
        templated = templated.replace(row, nextRow);
      }

      // The closing row carries its label and its answer in one cell.
      const closing = rows[14]!;
      const closingSpans = cellsOf(closing);
      const closingSpan = closingSpans[0]!;
      const closingCell = closing.slice(closingSpan.start, closingSpan.end);
      const closingNext =
        closing.slice(0, closingSpan.start) +
        stripHighlights(fillHighlights(closingCell, '{instructions}')) +
        closing.slice(closingSpan.end);
      templated = templated.replace(closing, closingNext);

      // Any highlight left inside the table was an instruction to this script.
      templated = stripHighlights(templated);

      /*
       * The loop tags go *inside* the table's first and last rows, not in paragraphs
       * around it.
       *
       * docxtemplater's paragraphLoop expands the block between the tags, and a block
       * that starts in a paragraph, swallows a whole <w:tbl> and ends in another
       * paragraph is not something it can duplicate without breaking the XML — it says
       * so, by name, and refuses to render. Putting each tag in a cell of a row that is
       * already inside the table keeps the loop within one element, and the repeated
       * unit becomes the table itself.
       */
      const firstRow = (templated.match(/<w:tr[\s\S]*?<\/w:tr>/) ?? [''])[0];
      const allRows = templated.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? [];
      const lastRow = allRows[allRows.length - 1] ?? '';

      /*
       * Inserted after the paragraph's properties, not immediately after its opening tag.
       *
       * `<w:pPr>` must be the first child of a `<w:p>`; a run placed in front of it makes
       * the document invalid and Word offers to repair the file. So the run goes after
       * `</w:pPr>` where one exists, and directly after `<w:p …>` where the paragraph has
       * no properties at all.
       */
      const firstParagraph = firstRow.search(/<w:p(?: [^>]*)?>/);
      const propsEnd = firstRow.indexOf('</w:pPr>', firstParagraph);
      const openRun = '<w:r><w:t xml:space="preserve">{#buildings}</w:t></w:r>';
      const at =
        propsEnd !== -1
          ? propsEnd + '</w:pPr>'.length
          : firstRow.indexOf('>', firstParagraph) + 1;
      const withOpen =
        firstParagraph === -1 ? firstRow : firstRow.slice(0, at) + openRun + firstRow.slice(at);
      // Appended inside the last cell's final paragraph, before it closes. Matching the
      // *last* `</w:p>` of the row rather than the first keeps the run inside a paragraph
      // — inserting it between `</w:p>` and `</w:tc>` produced a run with no paragraph
      // around it, which is not valid WordprocessingML.
      const closeAt = lastRow.lastIndexOf('</w:p>');
      const withClose =
        closeAt === -1
          ? lastRow
          : lastRow.slice(0, closeAt) +
            '<w:r><w:t xml:space="preserve">{/buildings}</w:t></w:r>' +
            lastRow.slice(closeAt);

      if (withOpen === firstRow || withClose === lastRow) {
        missing.push('טבלת המבנים — לא ניתן היה למקם את תגי הלולאה בתוך הטבלה');
      }

      templated = templated.replace(firstRow, withOpen).replace(lastRow, withClose);

      /**
       * Each building's photographs, on the page after its own table.
       *
       * The loop's closing tag moves out of the table and onto a paragraph below it,
       * so the repeated block is "the table, then this building's pictures" rather
       * than the table alone. That is where a reader looks for them: having just read
       * fifteen rows about a roof, the picture of that roof belongs overleaf, not at
       * the end of the document among nine others to be matched up by name.
       *
       * `{@photosXml}` is raw XML built in code — the pictures have to be written
       * into the archive and referenced by id, which a template tag cannot do. It
       * renders to a bare paragraph for a building with no photographs, so the tables
       * of an unphotographed survey still follow one another without blank pages.
       */
      const closedInsideTable =
        templated.slice(0, templated.lastIndexOf('</w:tbl>')).lastIndexOf('{/buildings}') !== -1;
      if (closedInsideTable) {
        templated =
          templated.replace('<w:r><w:t xml:space="preserve">{/buildings}</w:t></w:r>', '') +
          '<w:p><w:r><w:t xml:space="preserve">{@photosXml}</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t xml:space="preserve">{/buildings}</w:t></w:r></w:p>';
      }

      xml = xml.replace(first, templated);
      xml = xml.replace(second, '');
      replacements++;
      console.log('  ✓ טבלת המבנים — לולאת {#buildings} עם 13 שדות ותמונות');
    }
  }
}

/**
 * The caption under the second table names one of the source's buildings.
 *
 * Photographs are the generated appendix now, so a hand-typed caption here would print a
 * real hospital's wing on every report that used this template.
 */
{
  const caption = paragraphs.find((p) => textOf(p).includes('חזית מזרחית'));
  if (caption) {
    xml = xml.replace(caption, '');
    replacements++;
    console.log('  ✓ הוסר כיתוב תמונה שנשא שם מבנה מהמקור');
  }
}

// ── סיכום והנחיות לביצוע ────────────────────────────────────────────
/**
 * The closing paragraphs become one repeating block.
 *
 * The source has four, each naming the same buildings again. How many there are and what
 * they say is the surveyor's judgement, so they are a loop rather than four fields.
 */
{
  const summaryLines = paragraphs.filter((p) => {
    const t = textOf(p);
    return (
      t.includes('קירות חיצוניים עשויים אסבסט צמנט') ||
      t.includes('יש לתלות במקום גלוי לעין') ||
      t.includes('יש לצבוע קירות חיצוניים') ||
      t.includes('יש להזמין סוקר מוסמך')
    );
  });

  if (summaryLines.length === 0) {
    missing.push('סיכום — לא נמצאו שורות ההנחיות');
  } else {
    /*
     * The loop tags wrap the paragraph rather than sitting inside it.
     *
     * Written inline, docxtemplater repeats the text within one paragraph and four
     * instructions come out run together on a single bullet. With the tags in bare
     * paragraphs on either side, the bulleted paragraph between them is the loop body and
     * each instruction gets its own bullet.
     */
    const firstLine = summaryLines[0]!;
    const body = fillHighlights(firstLine, '{text}');
    xml = xml.replace(
      firstLine,
      `<w:p><w:r><w:t>{#summaryLines}</w:t></w:r></w:p>${body}<w:p><w:r><w:t>{/summaryLines}</w:t></w:r></w:p>`,
    );
    for (const extra of summaryLines.slice(1)) xml = xml.replace(extra, '');
    replacements++;
    console.log(`  ✓ סיכום — לולאת {#summaryLines} (${summaryLines.length} שורות במקור)`);
  }
}

// ── Anything still marked was missed ────────────────────────────────
const leftover = (xml.match(/<w:highlight w:val="(?!none)/g) ?? []).length;
if (leftover > 0) {
  console.log(`\n  ⚠ נותרו ${leftover} סימוני צהוב — הם יוסרו, אך בדוק שלא פוספס שדה`);
  xml = stripHighlights(xml);
}

zip.file('word/document.xml', xml);
writeFileSync(OUT, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));

console.log(`\n${replacements} החלפות`);
if (missing.length > 0) {
  console.error('\nלא הושלם:');
  for (const m of missing) console.error(`  ✗ ${m}`);
  process.exit(1);
}
console.log(`נכתב: ${OUT}\n`);
