import { findElementEnd, textOf } from './ooxml';

/**
 * Finding text a human marked in Word.
 *
 * Marking a value in colour is a far better way to say "this is dynamic" than
 * matching its literal text in a build script: the person doing it can see the
 * document, and the mark survives the value being reworded.
 *
 * Word splits a marked phrase across several `<w:r>` runs whenever formatting
 * or the spell-checker intervenes — the disclaimer paragraph in the source is
 * seven runs of one sentence — so adjacent marked runs are grouped back into
 * one region before anything is done with them.
 */

/**
 * How a person says "this value is dynamic".
 *
 * Highlight is the recommended mark. A finished report never ships with
 * highlighted text, so a highlight can only mean an instruction to the build —
 * whereas a colour is real formatting, and this document already prints a
 * disclaimer paragraph in dark red as content. With highlight there is never a
 * question of whether the mark was meant to print.
 *
 * Red text is accepted as well, for anyone who prefers it. It must be pure red
 * (`FF0000`, Word's "Red"), never `C00000` ("Dark Red"), which is content here.
 */
export const MARKER_COLOR = 'FF0000';

/** Dark red — real content in the source, and so refused as a marker. */
export const RESERVED_COLOR = 'C00000';

/**
 * Highlight colours treated as a mark.
 *
 * Every Word highlight counts. Asking someone to remember one specific shade
 * is a rule they will break, and there is no competing meaning for a highlight
 * in this document.
 */
export const MARKER_HIGHLIGHTS = [
  'yellow', 'green', 'cyan', 'magenta', 'blue', 'red', 'darkBlue', 'darkCyan',
  'darkGreen', 'darkMagenta', 'darkRed', 'darkYellow', 'darkGray', 'lightGray', 'black',
];

export interface MarkedRegion {
  /** The visible text of the whole region, runs joined. */
  text: string;
  /** Absolute offsets of the region within the part it came from. */
  start: number;
  end: number;
  /** How many runs the region spans, useful when reporting oddities. */
  runCount: number;
  /** The region's own XML, so a replacement can inherit its formatting. */
  raw: string;
  /** Text of the paragraph the region sits in, for context when naming it. */
  paragraphText: string;
}

/** True when a run's properties carry the given colour. */
function runHasColor(runXml: string, color: string): boolean {
  const rPr = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  if (!rPr) return false;
  return new RegExp(`<w:color w:val="${color}"`, 'i').test(rPr[0]);
}

/** True when a run carries any highlight. */
function runIsHighlighted(runXml: string): boolean {
  const rPr = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
  if (!rPr) return false;
  const match = /<w:highlight w:val="([^"]+)"/i.exec(rPr[0]);
  return match ? match[1] !== 'none' : false;
}

/** True when a run is marked, by highlight or by the marker colour. */
function runIsMarked(runXml: string, color: string): boolean {
  return runIsHighlighted(runXml) || runHasColor(runXml, color);
}

/**
 * Every region of the document marked in `color`.
 *
 * Regions are reported in document order, and adjacent marked runs — with only
 * whitespace or bookmarks between them — are merged into one.
 */
export function findMarkedRegions(xml: string, color = MARKER_COLOR): MarkedRegion[] {
  const regions: MarkedRegion[] = [];

  // Walk paragraph by paragraph so a region can never span a paragraph break,
  // and so each one can carry its paragraph's text as naming context.
  let i = 0;
  while (i < xml.length) {
    if (!xml.startsWith('<w:p>', i) && !xml.startsWith('<w:p ', i)) {
      i++;
      continue;
    }
    const paragraphEnd = findElementEnd(xml, i, 'w:p');
    const paragraph = xml.slice(i, paragraphEnd);
    const paragraphText = textOf(paragraph);

    collectFromParagraph(paragraph, i, color, paragraphText, regions);
    i = paragraphEnd;
  }

  return regions;
}

/** Groups the marked runs of one paragraph into regions. */
function collectFromParagraph(
  paragraph: string,
  paragraphOffset: number,
  color: string,
  paragraphText: string,
  out: MarkedRegion[],
): void {
  interface Run {
    start: number;
    end: number;
    marked: boolean;
  }
  const runs: Run[] = [];

  let i = 0;
  while (i < paragraph.length) {
    if (paragraph.startsWith('<w:r>', i) || paragraph.startsWith('<w:r ', i)) {
      const end = findElementEnd(paragraph, i, 'w:r');
      const run = paragraph.slice(i, end);
      // A run with no text carries no value to replace, so it neither starts a
      // region nor breaks one — a marked phrase often has a bookmark or a
      // proofing mark sitting inside it.
      if (run.includes('<w:t')) {
        runs.push({ start: i, end, marked: runIsMarked(run, color) });
      }
      i = end;
      continue;
    }
    i++;
  }

  let current: Run[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const start = current[0].start;
    const end = current[current.length - 1].end;
    const raw = paragraph.slice(start, end);
    const text = current.map((r) => textOf(paragraph.slice(r.start, r.end))).join('');
    // A region of pure whitespace is a stray mark, not a field.
    if (text.trim() !== '') {
      out.push({
        text,
        start: paragraphOffset + start,
        end: paragraphOffset + end,
        runCount: current.length,
        raw,
        paragraphText,
      });
    }
    current = [];
  };

  for (const run of runs) {
    if (run.marked) current.push(run);
    else flush();
  }
  flush();
}

/** Counts the runs carrying any highlight. */
export function countHighlightedRuns(xml: string): number {
  let count = 0;
  for (const m of xml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
    if (runIsHighlighted(m[0])) count++;
  }
  return count;
}

/** Counts the runs carrying a colour, used to warn about the reserved one. */
export function countRunsWithColor(xml: string, color: string): number {
  let count = 0;
  for (const m of xml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
    if (runHasColor(m[0], color)) count++;
  }
  return count;
}

/**
 * Removes a marking colour from the runs that make up a template tag.
 *
 * A mark says "this value is dynamic". Once the value has become a placeholder
 * the mark has done its job, and leaving it on would colour every merged value
 * in the finished report — the marking itself would print.
 *
 * Works a paragraph at a time rather than a run at a time, because Word splits
 * `{recipientLine}` into `{`, `recipientLine` and `}` as separate runs; a
 * per-run rule strips the first and leaves the rest coloured.
 *
 * Paragraphs with no complete tag are left alone and reported instead: marked
 * text that never became a placeholder is either content the colour was used
 * for legitimately, or a mark nobody acted on, and silently stripping it would
 * hide both.
 */
export function stripMarkFromTaggedRuns(xml: string, color: string): { xml: string; stripped: number } {
  let stripped = 0;

  const out = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    // A complete tag somewhere in the paragraph is what makes it dynamic; the
    // pieces of that tag may be spread over any number of runs.
    if (!/\{[^}]*\}/.test(textOf(paragraph))) return paragraph;

    return paragraph.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, (run) => {
      if (!runHasColor(run, color) && !runIsHighlighted(run)) return run;

      const cleaned = run.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, (rPr) =>
        rPr
          .replace(new RegExp(`<w:color w:val="${color}"[^>]*/>`, 'gi'), '')
          .replace(/<w:highlight[^>]*\/>/g, ''),
      );
      if (cleaned !== run) stripped++;
      return cleaned;
    });
  });

  return { xml: out, stripped };
}
