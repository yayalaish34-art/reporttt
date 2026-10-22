import { findElementEnd, splitBody, textOf, type BodyBlock } from './ooxml';
import { setCellText, setParagraphText, setRowCells, splitCells, tagParagraph } from './authoring';

/**
 * Collapsing repeated measurement protocols into a loop.
 *
 * A survey report carries one protocol section per source per floor — the
 * signed example has 31 ELF and 11 RF, all the same shape. Keeping one of each
 * and wrapping it in a loop is what makes the count dynamic.
 *
 * Shared by the full template build and by the standalone collapse of a
 * part-finished template, because both need exactly this and getting it subtly
 * different in two places is how the two drift apart.
 */

export const ELF_PROTOCOL_TITLE = 'פרוטוקול רשמי - מדידת שדה מגנטי';
export const RF_PROTOCOL_TITLE = 'פרוטוקול רשמי - מדידת צפיפות הספק';
export const MEASUREMENTS_VALID = 'תוצאות המדידות נכונות למקום וזמן המדידה';
export const NORMALIZATION_FACTOR = 'מקדם הנרמול שנקבע';
export const NORMALIZATION_NOTE = 'מכיוון שהמדידות בוצעו';

/** Collapses whitespace so anchors survive stray spaces and NBSPs. */
const norm = (s: string) => s.replace(/[\s ]+/g, ' ').trim();

export interface CollapseResult {
  xml: string;
  elfCount: number;
  rfCount: number;
}

/**
 * Replaces each run of repeated protocol sections with a single loop.
 *
 * Each protocol occupies a fixed sequence of body blocks: a title paragraph, a
 * measurement table, then the "results are valid" and normalization notes. The
 * first occurrence of each kind becomes the loop body; the rest are dropped.
 *
 * A kind with no protocols in the document is skipped rather than treated as an
 * error — a report may legitimately survey only one of the two ranges.
 */
export function collapseProtocols(input: string): CollapseResult {
  const blocks = splitBody(input);
  const text = blocks.map((b) => norm(textOf(input.slice(b.start, b.end))));

  const elfTitles = indicesWhere(text, (t) => t.startsWith(ELF_PROTOCOL_TITLE));
  const rfTitles = indicesWhere(text, (t) => t.startsWith(RF_PROTOCOL_TITLE));

  const edits: Edit[] = [];
  for (const [titles, kind] of [
    [elfTitles, 'elf'],
    [rfTitles, 'rf'],
  ] as const) {
    if (titles.length === 0) continue;

    const spans = titles.map((i) => protocolSpan(blocks, text, i));
    edits.push({
      start: blocks[spans[0].from].start,
      end: blocks[spans[0].to].end,
      replacement: buildProtocolLoop(input, blocks, spans[0], kind),
    });
    for (const span of spans.slice(1)) {
      edits.push({ start: blocks[span.from].start, end: blocks[span.to].end, replacement: '' });
    }
  }

  return { xml: applyEdits(input, edits), elfCount: elfTitles.length, rfCount: rfTitles.length };
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
  // "בדיקה ביחס" is the same in every protocol and stays in the template; only
  // what follows it names the source, so that is all the surveyor types.
  header = setCellInRow(header, referenceLabelCell.row, referenceLabelCell.cell, 'בדיקה ביחס {referenceLabel}');

  // `replaceGraphics` also strips any marking colour the cell carried: the cell
  // is a placeholder now, and a leftover mark would print on every merged value.
  const dataRow = setRowCells(tbl.slice(rows[2].start, rows[2].end), cellValues);
  const tail = tbl.slice(rows[rows.length - 1].end); // closing </w:tbl>

  return header + dataRow + tail;
}

/** ELF columns: №, description, distance, height, measured, normalized, occupancy, verdict. */
export function templateElfTable(tbl: string): string {
  return templateMeasurementTable(
    tbl,
    ['{#rows}', '{description}', '{distance}', '{height}', '{measured}', '{normalized}', '{occupancy}', '{compliance}{/rows}'],
    { row: 0, cell: 2 },
  );
}

/** RF columns: №, description, occupancy, measured, threshold, verdict, distance, height. */
export function templateRfTable(tbl: string): string {
  return templateMeasurementTable(
    tbl,
    ['{#rows}', '{description}', '{occupancy}', '{measured}', '{threshold}', '{compliance}', '{distance}', '{height}{/rows}'],
    { row: 0, cell: 6 },
  );
}

/** Top-level `<w:tr>` offsets within a table fragment. */
export function collectRows(tbl: string): Array<{ start: number; end: number }> {
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
export function setCellInRow(fragment: string, rowIndex: number, cellIndex: number, value: string): string {
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

export interface Edit {
  start: number;
  end: number;
  replacement: string;
}

/** Applies non-overlapping edits, back-to-front so offsets stay valid. */
export function applyEdits(s: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = s;
  for (const e of sorted) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return out;
}

export function indicesWhere<T>(items: T[], pred: (t: T) => boolean): number[] {
  const out: number[] = [];
  items.forEach((item, i) => {
    if (pred(item)) out.push(i);
  });
  return out;
}

/** Caption of a photo in the appendix, e.g. "תמונה מס' 1 : לוח חשמל…". */
const PHOTO_CAPTION = /^תמונה מס['׳]/;

export interface PhotoAppendixResult {
  xml: string;
  /** How many captioned photos were replaced by the injection point. */
  count: number;
}

/**
 * Swaps the static photo appendix for a `{@photosXml}` injection point.
 *
 * Photographs differ per survey and docxtemplater cannot substitute an image
 * through an ordinary placeholder, so the appendix is generated as OOXML at
 * merge time. The numbering goes with it: captions are numbered as they are
 * generated, so nobody types "תמונה מס' 7" and nobody has to renumber the rest
 * after inserting a photo in the middle.
 */
export function replacePhotoAppendix(xml: string): PhotoAppendixResult {
  const blocks = splitBody(xml);
  const text = blocks.map((b) => norm(textOf(xml.slice(b.start, b.end))));

  const captions = indicesWhere(text, (t) => PHOTO_CAPTION.test(t));
  if (captions.length === 0) return { xml, count: 0 };

  // Each photo is an image paragraph followed by its caption, so the appendix
  // starts at the image paragraph just above the first caption.
  const first = captions[0];
  const hasImage = /<w:drawing[ >]|<w:pict[ >]/.test(xml.slice(blocks[first - 1]?.start ?? 0, blocks[first - 1]?.end ?? 0));
  const from = first > 0 && hasImage ? first - 1 : first;
  const to = captions[captions.length - 1];

  return {
    xml: applyEdits(xml, [
      { start: blocks[from].start, end: blocks[to].end, replacement: tagParagraph('{@photosXml}') },
    ]),
    count: captions.length,
  };
}
