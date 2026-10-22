import { findMarkedRegions, type MarkedRegion } from './marked-runs';
import { textOf } from './ooxml';

/**
 * The passages of the conclusions that a report rewords for itself.
 *
 * Which passages those are is decided in the template, by highlighting them in
 * Word — not by placeholders. The conclusions read as finished prose whichever
 * way you look at them: opened in Word they are a complete example report, and
 * merged they carry this survey's own findings in the same shape.
 *
 * That replaced an earlier design of `{elfConclusionFirst}` and friends, which
 * forced the surveyor to think in fields and left the template unreadable as a
 * document.
 */

/** How many surrounding characters a slot reports, for the model's context. */
const CONTEXT_CHARS = 220;

export interface ConclusionSlot {
  /**
   * Which survey's findings should word this slot.
   *
   * `collectConclusionSlots` only ever produces the two electromagnetic kinds;
   * radon and asbestos build their slots themselves, because the ELF/RF split
   * below is a question that has no answer in either of those reports.
   */
  kind: 'elf' | 'rf' | 'radon' | 'asbestos';
  /**
   * The paragraphs the slot covers.
   *
   * A run of consecutive fully-highlighted paragraphs is one slot of several
   * paragraphs — the cafeteria passage is five. A highlight covering only part
   * of a paragraph is a slot of one, and its replacement has to fit back into
   * the sentence around it.
   */
  regions: MarkedRegion[];
  /** The existing wording, one entry per paragraph. Doubles as the example. */
  example: string[];
  /** True when the highlight covers whole paragraphs rather than a fragment. */
  wholeParagraphs: boolean;
  /** The sentence a fragment sits inside, so a replacement can fit its grammar. */
  surrounding: string;
}

/** Where the RF conclusions begin, so a slot can tell which survey it belongs to. */
function rfSectionOffset(xml: string): number {
  const headings: number[] = [];
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)];
  for (const match of paragraphs) {
    if (textOf(match[0]).trim() === 'מסקנות') headings.push(match.index ?? 0);
  }
  // Two headings: the ELF conclusions and the RF ones. With only one, treat
  // everything as ELF rather than guessing a boundary that is not there.
  return headings.length >= 2 ? headings[headings.length - 1] : Number.POSITIVE_INFINITY;
}

/**
 * Groups the highlighted runs of a document into the slots to be reworded.
 *
 * Consecutive whole-paragraph regions merge into one slot: the five paragraphs
 * of the example passage are a single argument, and wording them separately
 * would produce five openings that do not follow one another.
 */
export function collectConclusionSlots(xml: string): ConclusionSlot[] {
  const regions = findMarkedRegions(xml);
  const boundary = rfSectionOffset(xml);
  const slots: ConclusionSlot[] = [];

  for (const region of regions) {
    const whole = region.text.trim() === region.paragraphText.trim();
    const kind: 'elf' | 'rf' = region.start >= boundary ? 'rf' : 'elf';
    const previous = slots[slots.length - 1];

    if (whole && previous?.wholeParagraphs && previous.kind === kind) {
      previous.regions.push(region);
      previous.example.push(region.text.trim());
      continue;
    }

    slots.push({
      kind,
      regions: [region],
      example: [region.text.trim()],
      wholeParagraphs: whole,
      surrounding: whole
        ? ''
        : region.paragraphText.trim().slice(0, CONTEXT_CHARS),
    });
  }

  return slots;
}

/**
 * Writes the reworded text back and takes the highlight off.
 *
 * The highlight is an instruction to this code, not something a customer should
 * ever see, so it comes off in the produced document. Everything else the run
 * carries — the bold, the underline, the size — stays, because the passage has
 * to look the same as the one it replaced.
 *
 * Replacements are applied from the end of the document backwards so that the
 * offsets of the regions still to come are not shifted by the ones already done.
 */
/**
 * The `<w:p>` element a region sits inside, as absolute offsets.
 *
 * Returns null when the paragraph cannot be delimited, so a caller that meant to
 * remove one leaves the document untouched instead of cutting at a guessed point.
 */
function enclosingParagraph(
  xml: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  const open = Math.max(xml.lastIndexOf('<w:p>', start), xml.lastIndexOf('<w:p ', start));
  if (open === -1) return null;
  const close = xml.indexOf('</w:p>', end);
  if (close === -1) return null;
  return { start: open, end: close + '</w:p>'.length };
}

export function applyConclusionSlots(
  xml: string,
  slots: ConclusionSlot[],
  replacements: string[][],
): string {
  const edits: Array<{ start: number; end: number; xml: string }> = [];

  slots.forEach((slot, slotIndex) => {
    const texts = replacements[slotIndex] ?? [];
    slot.regions.forEach((region, i) => {
      const text = texts[i];
      if (typeof text === 'string' && text.trim() !== '') {
        edits.push({ start: region.start, end: region.end, xml: rewriteRegion(region.raw, text.trim()) });
        return;
      }

      // No replacement for a highlighted paragraph. Leaving it alone printed the
      // template's own example prose — a finding from a different survey — in the
      // delivered report, and the highlight is not there to be published. A clean
      // ELF survey legitimately concludes in one sentence, so the paragraph that
      // has nothing to say is removed rather than kept.
      //
      // Only whole-paragraph slots may be dropped: a fragment's region sits inside
      // a sentence, and deleting it would leave that sentence missing a clause.
      //
      // The whole <w:p> goes, not just the region: a region spans runs, so
      // emptying it would leave the paragraph itself behind — and since these are
      // numbered list items, that prints as a bare number on an empty line.
      if (slot.wholeParagraphs) {
        const bounds = enclosingParagraph(xml, region.start, region.end);
        if (bounds) edits.push({ start: bounds.start, end: bounds.end, xml: '' });
      }
    });
  });

  edits.sort((a, b) => b.start - a.start);
  let result = xml;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.xml + result.slice(edit.end);
  }
  return stripParagraphMarkHighlights(result);
}

/**
 * Takes the highlight off paragraph marks as well.
 *
 * A highlight can sit on the paragraph mark rather than on any text. It holds
 * no content, but Word still paints the end of the line — so a document whose
 * runs came out clean still showed yellow to whoever opened it.
 */
function stripParagraphMarkHighlights(xml: string): string {
  return xml.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/g, (block) =>
    block.replace(/<w:highlight w:val="[^"]*"\s*\/>/g, ''),
  );
}

/**
 * Rebuilds a region's XML around new text.
 *
 * The first run keeps its properties and takes the whole replacement; the rest
 * are emptied, because a region's runs are a splitting artefact of how Word
 * saved the file, not a structure worth preserving.
 */
function rewriteRegion(raw: string, text: string): string {
  const runs = [...raw.matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)].map((m) => m[0]);
  if (runs.length === 0) return raw;

  const first = stripHighlight(setRunText(runs[0], text));
  const rest = runs.slice(1).map((run) => stripHighlight(setRunText(run, '')));
  // Anything between the runs — bookmarks, proofing marks — is dropped with them.
  return [first, ...rest].join('');
}

/** Replaces a run's text, keeping its properties. */
function setRunText(run: string, text: string): string {
  const rPr = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? '';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<w:r>${rPr}<w:t xml:space="preserve">${escaped}</w:t></w:r>`;
}

/** Removes the highlight, leaving bold, underline and size untouched. */
function stripHighlight(run: string): string {
  return run.replace(/<w:highlight w:val="[^"]*"\s*\/>/g, '');
}
