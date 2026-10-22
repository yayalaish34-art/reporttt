import { escapeXml, findElementEnd, textOf } from './ooxml';

/**
 * Helpers for *writing* OOXML — used by the template build script to turn a
 * finished report into a template with placeholders.
 *
 * The recurring problem these solve: Word splits one typed word across several
 * `<w:r>` runs whenever formatting changes or the spell-checker interferes, so
 * a naive string replace of "ירון חכם" finds nothing. Everything here works at
 * paragraph or cell granularity instead, rebuilding the element around a single
 * run and inheriting the original formatting.
 */

/** True when a fragment holds an image, which must never be rebuilt away. */
export function hasGraphics(fragment: string): boolean {
  return /<w:drawing[ >]|<w:pict[ >]|<w:object[ >]/.test(fragment);
}

/**
 * True when a fragment holds a Word field — a page number, a date, a
 * cross-reference.
 *
 * A field is spread across several runs held together by `fldChar` markers.
 * Rebuilding such a paragraph around a single run would flatten the field into
 * whatever value happened to be cached in the file, so the header's "עמוד 17
 * מתוך 17" would freeze at 17 on every page.
 */
export function hasField(fragment: string): boolean {
  return /<w:fldChar[ />]|<w:instrText[ >]|<w:fldSimple[ >]/.test(fragment);
}

/** The opening tag of an element, e.g. `<w:p w14:paraId="...">`. */
function openTagOf(fragment: string): string {
  const m = fragment.match(/^<[^>]*>/);
  if (!m) throw new Error('fragment does not start with a tag');
  return m[0];
}

/** The `<w:pPr>` block of a paragraph, or '' — carries alignment and RTL. */
function paragraphProps(p: string): string {
  const m = p.match(/^<w:p(?:\s[^>]*)?>\s*(<w:pPr>[\s\S]*?<\/w:pPr>)/);
  return m ? m[1] : '';
}

/**
 * The `<w:rPr>` of the first run that actually carries text — the font, size
 * and boldness the replacement value should inherit.
 */
function runProps(fragment: string): string {
  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  for (const m of fragment.matchAll(runRe)) {
    if (m[1].includes('<w:t')) {
      const rPr = m[1].match(/^\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/);
      return rPr ? rPr[1] : '';
    }
  }
  return '';
}

/**
 * Rebuilds a paragraph so its entire visible text is `text`, in one run.
 *
 * Paragraph properties and the first run's character properties are preserved,
 * so the placeholder inherits exactly the styling the original value had — which
 * is what the merged value will then be styled with.
 */
export function setParagraphText(p: string, text: string): string {
  if (hasGraphics(p)) {
    throw new Error('refusing to rebuild a paragraph containing an image');
  }
  if (hasField(p)) {
    throw new Error('refusing to rebuild a paragraph containing a field');
  }
  const open = openTagOf(p);
  const pPr = paragraphProps(p);
  const rPr = runProps(p);
  return `${open}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/**
 * Replaces the text of a paragraph while leaving any image in place: the first
 * text run receives the whole value and every other text run is emptied.
 *
 * Used for the few paragraphs that mix a signature image with a caption.
 */
export function retextParagraph(p: string, text: string): string {
  let first = true;
  return p.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (_all, open: string, _body, close: string) => {
    if (first) {
      first = false;
      const withSpace = open.includes('xml:space') ? open : open.replace(/>$/, ' xml:space="preserve">');
      return `${withSpace}${escapeXml(text)}${close}`;
    }
    return `${open}${close}`;
  });
}

/** Absolute offsets of the top-level paragraphs inside a table cell. */
function cellParagraphs(tc: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < tc.length) {
    // Skip nested tables — their paragraphs are not this cell's paragraphs.
    if (tc.startsWith('<w:tbl>', i) || tc.startsWith('<w:tbl ', i)) {
      i = findElementEnd(tc, i, 'w:tbl');
      continue;
    }
    if (tc.startsWith('<w:p>', i) || tc.startsWith('<w:p ', i)) {
      const e = findElementEnd(tc, i, 'w:p');
      out.push({ start: i, end: e });
      i = e;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * Sets the text of a table cell.
 *
 * The first paragraph carries the value; any further paragraphs are dropped so
 * a two-line cell does not keep a stale second line. Cells holding an image —
 * the signature cells — are left structurally intact and only re-texted.
 */
export function setCellText(tc: string, text: string, options: { replaceGraphics?: boolean } = {}): string {
  const paras = cellParagraphs(tc);
  if (paras.length === 0) return tc;

  const first = paras[0];
  const tail = paras[paras.length - 1].end;

  if (hasGraphics(tc) && !options.replaceGraphics) {
    return tc.slice(0, first.start) + retextParagraph(tc.slice(first.start, first.end), text) + tc.slice(first.end);
  }

  // `replaceGraphics` is how the signature cells are emptied of their baked-in
  // image and given a placeholder instead — the one case where discarding a
  // picture is the point rather than an accident.
  const rebuilt = options.replaceGraphics
    ? rebuildParagraph(tc.slice(first.start, first.end), text)
    : setParagraphText(tc.slice(first.start, first.end), text);

  return tc.slice(0, first.start) + rebuilt + tc.slice(tail);
}

/**
 * Rebuilds a paragraph around `text`, discarding whatever it held.
 *
 * Unlike `setParagraphText` this does not refuse a paragraph containing a
 * picture, so callers must mean it.
 */
function rebuildParagraph(p: string, text: string): string {
  const open = openTagOf(p);
  const pPr = paragraphProps(p);
  return `${open}${pPr}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/** Absolute offsets of the cells of a table row. */
export function splitCells(tr: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < tr.length) {
    if (tr.startsWith('<w:tbl>', i) || tr.startsWith('<w:tbl ', i)) {
      i = findElementEnd(tr, i, 'w:tbl');
      continue;
    }
    if (tr.startsWith('<w:tc>', i) || tr.startsWith('<w:tc ', i)) {
      const e = findElementEnd(tr, i, 'w:tc');
      out.push({ start: i, end: e });
      i = e;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * Writes one value per cell into a row, right to left in document order.
 *
 * `values[i]` goes into cell `i`; a `null` leaves that cell untouched, which is
 * how the auto-numbered first column keeps its numbering.
 */
export function setRowCells(
  tr: string,
  values: Array<string | null>,
  options: { replaceGraphics?: boolean } = {},
): string {
  const cells = splitCells(tr);
  let out = tr;
  // Rewrite back-to-front so earlier offsets stay valid.
  for (let i = Math.min(cells.length, values.length) - 1; i >= 0; i--) {
    const value = values[i];
    if (value === null) continue;
    const { start, end } = cells[i];
    out = out.slice(0, start) + setCellText(out.slice(start, end), value, options) + out.slice(end);
  }
  return out;
}

/** A standalone paragraph carrying only a template tag, e.g. `{#items}`. */
export function tagParagraph(tag: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(tag)}</w:t></w:r></w:p>`;
}

export { textOf };
