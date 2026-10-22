import { splitBody, textOf } from './ooxml';
import { setParagraphText, tagParagraph } from './authoring';
import { applyEdits, type Edit } from './protocol-loops';

/**
 * Turning the marked conclusion sentences into loops.
 *
 * A conclusions section mixes fixed statute text — the exposure thresholds,
 * which are identical in every report — with findings that describe this
 * particular site. Only the findings vary, and in the source document they were
 * written out by hand, so a report issued from it described the previous
 * client's cafeteria.
 *
 * Which sentences are findings is not something to infer: it is a judgement
 * about the report's meaning. The marking in the document is that judgement,
 * made by the person who knows, so a contiguous run of marked paragraphs
 * becomes the loop body.
 */

/** Marks the section a run of paragraphs belongs to. */
export type ConclusionKind = 'elf' | 'rf';

export interface ConclusionResult {
  xml: string;
  /** Number of paragraphs collapsed into each loop. */
  collapsed: Array<{ kind: ConclusionKind; count: number; first: string }>;
}

const norm = (s: string) => s.replace(/[\s ]+/g, ' ').trim();

/**
 * Replaces each contiguous run of marked paragraphs with a loop over one of them.
 *
 * The surviving paragraph keeps the original's properties, so list numbering and
 * indentation carry over to however many findings are supplied. Which loop a run
 * belongs to is decided by the heading above it: everything before the RF
 * instrument section is ELF.
 */
export function collapseMarkedConclusions(
  xml: string,
  isMarked: (paragraphXml: string) => boolean,
  rfSectionStart: number,
): ConclusionResult {
  const blocks = splitBody(xml);
  // Marks appear all over the document — on cover values, on photo captions.
  // Only those inside a conclusions section are findings, so the search is
  // confined to those sections rather than sweeping the whole body.
  const sections = conclusionSections(xml, blocks);
  const collapsed: ConclusionResult['collapsed'] = [];
  const edits: Edit[] = [];

  let runStart = -1;
  let runEnd = -1;

  const flush = () => {
    if (runStart === -1) return;

    const kind: ConclusionKind = blocks[runStart].start >= rfSectionStart ? 'rf' : 'elf';
    const field = kind === 'elf' ? 'elfConclusion' : 'rfConclusion';
    const first = xml.slice(blocks[runStart].start, blocks[runStart].end);

    // The run is one numbered item whose body runs on over several paragraphs:
    // the first carries the list number, the rest are continuation text. Giving
    // every paragraph the number would renumber the fixed items after it — in
    // the source that turned seven conclusions into eleven.
    const continuation =
      runEnd > runStart
        ? xml.slice(blocks[runStart + 1].start, blocks[runStart + 1].end)
        : stripNumbering(first);

    edits.push({
      start: blocks[runStart].start,
      end: blocks[runEnd].end,
      replacement:
        setParagraphText(first, `{${field}First}`) +
        tagParagraph(`{#${field}Rest}`) +
        setParagraphText(continuation, '{.}') +
        tagParagraph(`{/${field}Rest}`),
    });

    collapsed.push({
      kind,
      count: runEnd - runStart + 1,
      first: norm(textOf(first)).slice(0, 60),
    });
    runStart = -1;
    runEnd = -1;
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind !== 'p' || !sections.some((s) => i > s.from && i <= s.to)) {
      flush();
      continue;
    }

    const fragment = xml.slice(block.start, block.end);
    const text = norm(textOf(fragment));

    // A blank paragraph between two marked ones does not break the run; it is
    // spacing, not a sentence.
    if (text === '' && runStart !== -1) continue;

    if (isMarked(fragment) && text !== '') {
      if (runStart === -1) runStart = i;
      runEnd = i;
      continue;
    }
    flush();
  }
  flush();

  return { xml: applyEdits(xml, edits), collapsed };
}

/**
 * A copy of a paragraph with its list numbering removed.
 *
 * Used when a marked run is a single paragraph and there is no unnumbered
 * sibling to copy: the continuation paragraphs still must not be numbered.
 */
function stripNumbering(paragraph: string): string {
  return paragraph.replace(/<w:numPr>[\s\S]*?<\/w:numPr>/g, '');
}

/**
 * Block ranges covered by a conclusions section.
 *
 * A section starts at a "מסקנות" heading and runs until the document moves on —
 * a table, an appendix, a photo caption or the next survey heading. Without
 * this bound the search would treat every marked value on the cover as a
 * conclusion.
 */
function conclusionSections(
  xml: string,
  blocks: ReturnType<typeof splitBody>,
): Array<{ from: number; to: number }> {
  const text = blocks.map((b) => norm(textOf(xml.slice(b.start, b.end))));
  const ends = /^(נספח|תמונה מס|סקר בטיחות|המלצות|הסבר לתוצאות|אפיון|פרוטוקול רשמי|ניתוח תוצאות)/;

  const sections: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < blocks.length; i++) {
    if (text[i] !== 'מסקנות') continue;

    let to = i;
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocks[j].kind === 'tbl' || ends.test(text[j])) break;
      to = j;
    }
    sections.push({ from: i, to });
  }
  return sections;
}

/** Offset where the RF half of the report begins, used to route each run. */
export function findRfSectionStart(xml: string): number {
  const blocks = splitBody(xml);
  for (const block of blocks) {
    const text = norm(textOf(xml.slice(block.start, block.end)));
    if (text.startsWith('סקר בטיחות קרינה אלקטרומגנטית בתדירויות רדיו')) return block.start;
  }
  // No RF heading: treat the whole document as ELF rather than guessing.
  return Number.MAX_SAFE_INTEGER;
}
