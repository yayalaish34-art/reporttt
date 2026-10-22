/**
 * Builds the mould template from Galit's revised report.
 *
 * The source is `דוחח.docx` — the Technion report, reissued after the laboratory's
 * figures were re-checked. It replaces an earlier and quite different document (the
 * פעמונית report, written as prose around a covering letter), and the shape is the
 * point of the change: ten numbered sections, a table of particulars per block, and
 * one result table per sample rather than a single hard-coded one.
 *
 * Unlike the earlier source this one carries **no yellow highlighting at all**, so
 * there is no marking to read the varying passages off. What varies was settled with
 * the surveyor instead, and it falls into three groups:
 *
 *   - Filled by the system. The report number, the sampling date, the revision date,
 *     and everything the laboratory's own sheet supplies — the result tables, the
 *     summary table, the sample count. The whole reason for scanning the Hayes pages
 *     is that nobody should retype those.
 *   - Asked of the surveyor. Who commissioned the survey, where, when it was
 *     requested and when it was sampled, plus the four protocol details the source
 *     file never carried.
 *   - Left exactly as written. The accreditation statement, the principles of
 *     interpretation, the limitations, the references and the signature block. That
 *     text is what makes the document an opinion rather than a printout, and it is
 *     identical in every report.
 *
 *   npx tsx scripts/build-mold-template.ts <source.docx> [out.docx]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = process.argv[2] ? resolve(process.argv[2]) : '';
const OUT = resolve(process.argv[3] ?? resolve(ROOT, 'templates/mold-template.docx'));

if (!SOURCE || !existsSync(SOURCE)) {
  console.error('שימוש: npx tsx scripts/build-mold-template.ts <source.docx> [out.docx]');
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

let replacements = 0;
const missing: string[] = [];

const textOf = (fragment: string): string =>
  (fragment.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) ?? [])
    .map((t) => t.replace(/<[^>]+>/g, ''))
    .join('');

/**
 * The children of one element, paired by counting depth rather than by a lazy regex.
 *
 * `/<w:tc>[\s\S]*?<\/w:tc>/` looks right and is wrong: a cell can hold a table, so the
 * lazy match ends at the *inner* closing tag and every span after it is read from the
 * wrong offset. Rewriting one then writes a run outside any cell, which produces a
 * file Word refuses to open while its text still reads perfectly — the hardest kind of
 * corruption to notice. Depth counting is the only way to pair the tags correctly.
 */
function spansOf(fragment: string, tag: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const token = new RegExp(`<${tag}(?: [^>]*)?>|</${tag}>`, 'g');
  let depth = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = token.exec(fragment)) !== null) {
    if (!m[0].startsWith('</')) {
      if (depth === 0) start = m.index;
      depth++;
    } else {
      depth--;
      if (depth === 0 && start >= 0) {
        spans.push({ start, end: m.index + m[0].length });
        start = -1;
      }
    }
  }
  return spans;
}

const partsOf = (fragment: string, tag: string): string[] =>
  spansOf(fragment, tag).map(({ start, end }) => fragment.slice(start, end));

/**
 * Replaces one child by position.
 *
 * `fragment.replace(child, next)` is wrong here: two empty cells are byte-identical,
 * so `String.replace` rewrites the first of them every time. Splicing by index is
 * exact. Callers work right to left so an earlier replacement cannot shift a later
 * offset.
 */
function replacePart(fragment: string, tag: string, index: number, next: string): string {
  const span = spansOf(fragment, tag)[index];
  if (!span) return fragment;
  return fragment.slice(0, span.start) + next + fragment.slice(span.end);
}

/**
 * Puts `value` in a cell, whether or not it already carries text.
 *
 * A cell left blank holds a paragraph and no `<w:t>` at all, so a rule that only
 * rewrites existing text elements silently does nothing to it and the field never
 * appears. The run is inserted into the cell's first paragraph in that case.
 *
 * Note `<w:t(?:\s[^>]*)?>` rather than `<w:t[^>]*>`: the latter also matches `<w:tc>`,
 * because the `c` satisfies `[^>]*` — which ate the opening tag of every cell it was
 * pointed at and corrupted the document invisibly.
 */
function setCell(cell: string, value: string): string {
  if (/<w:t(?:\s[^>]*)?>/.test(cell)) {
    let first = true;
    return cell.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, () => {
      if (!first) return '<w:t xml:space="preserve"></w:t>';
      first = false;
      return `<w:t xml:space="preserve">${value}</w:t>`;
    });
  }
  return cell.replace(
    /(<w:p(?: [^>]*)?>(?:<w:pPr>[\s\S]*?<\/w:pPr>)?)/,
    `$1<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`,
  );
}

/** Rewrites a paragraph's text, collapsing it into the first run. */
function setParagraph(paragraph: string, value: string): string {
  let first = true;
  return paragraph.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, () => {
    if (!first) return '<w:t xml:space="preserve"></w:t>';
    first = false;
    return `<w:t xml:space="preserve">${value}</w:t>`;
  });
}

/** Wraps a row's first and last cells in a loop, so the row repeats. */
function loopRow(row: string, name: string): string {
  const cells = partsOf(row, 'w:tc');
  const firstCell = cells[0];
  const lastCell = cells[cells.length - 1];
  if (!firstCell || !lastCell) return row;
  // Last first, so rewriting the first cannot move it.
  let next = replacePart(
    row,
    'w:tc',
    cells.length - 1,
    lastCell.replace(/<\/w:t>(?![\s\S]*<\/w:t>)/, `{/${name}}</w:t>`),
  );
  return replacePart(next, 'w:tc', 0, firstCell.replace(/(<w:t(?:\s[^>]*)?>)/, `$1{#${name}}`));
}

/** Fills a row's cells with fields, right to left. */
function fillCells(row: string, fields: string[]): string {
  let next = row;
  for (let i = fields.length - 1; i >= 0; i--) {
    const cell = partsOf(next, 'w:tc')[i];
    const value = fields[i];
    if (cell && value) next = replacePart(next, 'w:tc', i, setCell(cell, value));
  }
  return next;
}

/** The tables of the document, in order. */
const tables = () => partsOf(xml, 'w:tbl');
const paragraphs = () => xml.match(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];

/**
 * Fills the value column of a two-column table of particulars.
 *
 * These tables read value-then-label, right to left — the label in the second cell is
 * the question and never changes, so only the first is ever rewritten. Rows the caller
 * does not name are left exactly as they are, which is how the standing answers (the
 * laboratory, the method, the pump) stay in the template rather than becoming fields.
 */
function fillParticulars(tableIndex: number, label: string, values: Record<string, string>): void {
  const table = tables()[tableIndex];
  if (!table) {
    missing.push(`${label} — טבלה ${tableIndex} לא נמצאה`);
    return;
  }

  let next = table;
  let filled = 0;
  const rows = partsOf(table, 'w:tr');
  // Right to left, so an earlier rewrite cannot move a later row's offsets.
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    const cells = partsOf(row, 'w:tc');
    const rowLabel = textOf(cells[1] ?? '').trim();
    const value = values[rowLabel];
    if (value === undefined || !cells[0]) continue;
    next = replacePart(next, 'w:tr', i, replacePart(row, 'w:tc', 0, setCell(cells[0], value)));
    filled++;
  }

  const wanted = Object.keys(values).length;
  if (filled !== wanted) {
    missing.push(`${label} — מולאו ${filled} מתוך ${wanted} שדות`);
    return;
  }
  xml = xml.replace(table, next);
  replacements++;
  console.log(`  ✓ ${label} — ${filled} שדות`);
}

console.log('\nבניית תבנית העובשים (הגרסה החדשה)\n');

// ── The cover ───────────────────────────────────────────────────────
{
  const rewrite = (anchor: string, label: string, value: string) => {
    const found = paragraphs().find((p) => textOf(p).trim() === anchor);
    if (!found) {
      missing.push(`${label} — לא נמצאה פסקה "${anchor}"`);
      return;
    }
    xml = xml.replace(found, setParagraph(found, value));
    replacements++;
    console.log(`  ✓ ${label}`);
  };

  rewrite('משרדי רשות המחקר – בניין הסנאט', 'שער — שם האתר', '{siteName}');
  rewrite('הטכניון – מכון טכנולוגי לישראל, חיפה', 'שער — הלקוח והעיר', '{siteSubtitle}');
}

/*
 * The document's own identity.
 *
 * Filled by the system rather than asked for: the reference is issued by the app, the
 * sampling date is the survey's own, and the revision date is simply the day the file
 * was produced. A date typed by hand here is the one that still says last month when
 * the report is reissued after a correction.
 */
fillParticulars(0, 'זיהוי הדוח', {
  'מספר דו״ח': '{referenceNumber}',
  'מועד הדיגום': '{surveyDate}',
  'מועד הפקת גרסה מתוקנת': '{revisionDate}',
});

/*
 * §1 — who commissioned the work, where, and when.
 *
 * The first four are the surveyor's to answer. The rest name the people and the
 * laboratory and carry the schema's defaults, so a report can be produced without
 * retyping them while still being editable when somebody else does the work.
 */
fillParticulars(1, '§1 פרטי העבודה', {
  'מזמין הבדיקה': '{clientName}',
  מיקום: '{siteAddress}',
  'תאריך הבקשה': '{requestDate}',
  'מועד הדיגום': '{surveyDate}',
  'מבצע הדיגום': '{samplerName}',
  'עורך הדוח': '{authorName}',
  'מספר דוח מעבדה': '{labReportNumber}',
  'מועד קבלת הדגימות במעבדה': '{labReceivedDate}',
  'מועד דיווח המעבדה': '{labReportedDate}',
});

/*
 * §4 — the sampling protocol.
 *
 * The sample count is computed, because it is a fact about the results that were read:
 * retyping it is how a report comes to claim nine samples above eight tables. The last
 * four print the source's own "יש להשלים מטופס השטח" until somebody fills them in —
 * that sentence is a standing note that the protocol is incomplete, and blanking it
 * would turn a known gap into an unremarkable empty cell.
 */
fillParticulars(3, '§4 פרוטוקול הדיגום', {
  'מספר דגימות': '{sampleCountLine}',
  'גובה נקודת הדיגום': '{samplingHeight}',
  'מצב מערכת המיזוג בעת הדיגום': '{hvacState}',
  'מצב חלונות ודלתות בעת הדיגום': '{openingsState}',
  'בדיקת/אימות ספיקה וכיול': '{flowVerification}',
});

// ── §2.1 — the summary table, one row per sample ────────────────────
/*
 * Ten rows in the source: a heading and nine samples. The nine become one repeating
 * row, because the next job will have a different number of them — which is the whole
 * reason this template is being rebuilt.
 *
 * The loop tags ride inside the row's first and last cells rather than in bare
 * paragraphs around it: that is what makes docxtemplater repeat the row while keeping
 * the table's borders and widths, where tags outside would split the table in two.
 */
{
  const table = tables()[2];
  const rows = table ? partsOf(table, 'w:tr') : [];
  const header = rows[0];
  const body = rows[1];
  if (!table || !header || !body) {
    missing.push('§2.1 — טבלת הסיכום לא אותרה');
  } else {
    const filled = loopRow(
      fillCells(body, ['{location}', '{totalCount}', '{aspergillus}', '{cladosporium}', '{note}']),
      'summaryRows',
    );
    // Rebuilt from its parts rather than patched: the eight dropped rows are
    // byte-identical in places, and `replace` would remove the same one repeatedly and
    // leave the document unbalanced.
    const open = table.slice(0, table.indexOf(header));
    xml = xml.replace(table, `${open}${header}${filled}</w:tbl>`);
    replacements++;
    console.log('  ✓ §2.1 — לולאת {#summaryRows}');
  }
}

// ── §6 — one result block per sample ────────────────────────────────
/*
 * The source carries nine: a heading, a table of the organisms found, and a sentence
 * of interpretation. All nine become one repeating block, so the document has as many
 * as the laboratory reported.
 *
 * Only the organisms actually found are listed — the earlier template printed the
 * laboratory's full roster of eighteen with blanks, and this one does not. That is the
 * revised report's own choice and it is kept: three lines a reader can take in beat
 * eighteen of which fifteen say nothing.
 */
{
  const all = paragraphs();
  const headings = all.filter((p) => /^6\.\d+\s/.test(textOf(p).trim()));
  const interpretations = all.filter((p) => textOf(p).trim().startsWith('פרשנות:'));
  const resultTables = tables().slice(5);

  const heading = headings[0];
  const table = resultTables[0];
  const rows = table ? partsOf(table, 'w:tr') : [];
  const header = rows[0];
  const body = rows[1];
  const totalRow = rows[rows.length - 1];

  if (!heading || !table || !header || !body || !totalRow) {
    missing.push('§6 — לא אותרו בלוקי התוצאות');
  } else {
    const headingTemplate = setParagraph(
      heading,
      '6.{index} {location} – דגימה {labNumber}',
    );

    const organismRow = loopRow(
      fillCells(body, ['{organism}', '{raw}', '{perCubicMetre}', '{percent}']),
      'organisms',
    );
    // The total is the sheet's own arithmetic, not a genus, so it stays outside the
    // loop and takes three fields of its own.
    const filledTotal = fillCells(totalRow, [
      '',
      '{totalRaw}',
      '{totalPerCubicMetre}',
      '{totalPercent}',
    ]);
    const open = table.slice(0, table.indexOf(header));
    const tableTemplate = `${open}${header}${organismRow}${filledTotal}</w:tbl>`;

    const interpretation = interpretations[0];
    const interpretationTemplate = interpretation
      ? setParagraph(interpretation, '{interpretation}')
      : '';

    // Everything from the first heading to the last interpretation is one block.
    const lastTable = resultTables[resultTables.length - 1]!;
    const endAnchor = interpretations[interpretations.length - 1] ?? lastTable;
    const start = xml.indexOf(heading);
    const end = xml.indexOf(endAnchor) + endAnchor.length;

    if (start >= 0 && end > start) {
      xml =
        xml.slice(0, start) +
        '<w:p><w:r><w:t>{#labBlocks}</w:t></w:r></w:p>' +
        headingTemplate +
        tableTemplate +
        interpretationTemplate +
        '<w:p><w:r><w:t>{/labBlocks}</w:t></w:r></w:p>' +
        xml.slice(end);
      replacements++;
      console.log(`  ✓ §6 — לולאת {#labBlocks} (${headings.length} בלוקים אוחדו לאחד)`);
    } else {
      missing.push('§6 — טווח הבלוקים לא אותר');
    }
  }
}

// ── The drafted prose ───────────────────────────────────────────────
/*
 * The passages the model writes from the results: the executive summary, the purpose
 * and description, the conclusions and the recommendations. Each is a run of bullets
 * whose count belongs to this job, so each becomes one loop.
 *
 * The standing text around them — §1.1 accreditation, §5 principles, §9 limitations,
 * §10 references and the signature block — is left exactly as written. It is what
 * makes the document an opinion rather than a printout.
 */
{
  const loopBetween = (
    afterHeading: string,
    beforeHeading: string,
    name: string,
    label: string,
  ) => {
    const all = paragraphs();
    const from = all.findIndex((p) => textOf(p).trim().startsWith(afterHeading));
    const to = all.findIndex((p) => textOf(p).trim().startsWith(beforeHeading));
    if (from < 0 || to < 0 || to <= from) {
      missing.push(`${label} — לא אותר הטווח בין "${afterHeading}" ל-"${beforeHeading}"`);
      return;
    }

    const body = all.slice(from + 1, to).filter((p) => textOf(p).trim() !== '');
    const first = body[0];
    const last = body[body.length - 1];
    if (!first || !last) {
      missing.push(`${label} — אין פסקאות בטווח`);
      return;
    }

    const start = xml.indexOf(first);
    const end = xml.indexOf(last) + last.length;
    if (start < 0 || end <= start) {
      missing.push(`${label} — טווח הפסקאות לא אותר במסמך`);
      return;
    }

    xml =
      xml.slice(0, start) +
      `<w:p><w:r><w:t>{#${name}}</w:t></w:r></w:p>` +
      setParagraph(first, '{text}') +
      `<w:p><w:r><w:t>{/${name}}</w:t></w:r></w:p>` +
      xml.slice(end);
    replacements++;
    console.log(`  ✓ ${label} — לולאת {#${name}}`);
  };

  loopBetween('2. תקציר מנהלים', '2.1 סיכום ריכוזים', 'executiveSummary', '§2 תקציר מנהלים');
  loopBetween('3. מטרת הבדיקה', '4. פרוטוקול הדיגום', 'purposeLines', '§3 מטרה ותיאור');
  loopBetween('7. מסקנות', '8. המלצות', 'conclusionLines', '§7 מסקנות');
  loopBetween('8. המלצות', '9. מגבלות הדוח', 'recommendationLines', '§8 המלצות');
}

// ── The laboratory's own pages ──────────────────────────────────────
/*
 * The appendix carries the scanned Hayes report, which every figure above was
 * transcribed from — so a reader who doubts a count can see the page it came off, in
 * the same file. Built in code, one image per page.
 */
{
  const anchor = paragraphs().find((p) =>
    textOf(p).trim().startsWith('להלן שלושת עמודי התוצאות'),
  );
  if (!anchor) {
    missing.push('נספח א׳ — לא נמצאה פסקת הפתיחה');
  } else {
    xml = xml.replace(anchor, `${anchor}<w:p><w:r><w:t>{@labSheetsXml}</w:t></w:r></w:p>`);
    replacements++;
    console.log('  ✓ נספח א׳ — {@labSheetsXml}');
  }
}

/**
 * Strips any highlight still standing.
 *
 * This source carries none, unlike the one it replaces. The sweep stays because the
 * template is editable in Word: the moment somebody marks a passage there, the mark
 * must not reach a client.
 */
{
  const before = (xml.match(/<w:highlight w:val="(?!none)[^"]*"\/>/g) ?? []).length;
  xml = xml.replace(/<w:highlight w:val="(?!none)[^"]*"\/>/g, '');
  if (before > 0) console.log(`  ✓ הוסרו ${before} סימוני הדגשה`);
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

// A template with an unresolved anchor renders a report with stale text in it, so it
// fails the build rather than being written and forgotten.
process.exit(missing.length === 0 ? 0 : 1);
