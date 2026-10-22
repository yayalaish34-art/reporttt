import { splitBody, textOf, type BodyBlock } from './ooxml';
import type { SurveyScope } from '../report-text';

/**
 * Drops the survey section that was not measured.
 *
 * The document carries both surveys in full: an ELF half and an RF half, each with its
 * own heading, instrument specification, method text, results tables and conclusions.
 * Only the tables and the conclusion lists are loops, so an ELF-only survey rendered
 * from the untouched template still printed the whole RF half — the heading, the LATNEX
 * meter and its calibration date, the method paragraphs, an empty "תוצאות:", the
 * µW/cm² threshold explanation and an RF "מסקנות".
 *
 * That is not a cosmetic problem. The report is a compliance document, and printing an
 * instrument specification and a set of thresholds for a measurement nobody took states
 * something untrue about what was surveyed.
 *
 * The cut is made on the rendered XML rather than in the template, so it applies to the
 * template already in the database and cannot be undone by a rebuild.
 */

/** The heading each survey section opens with, matched on its distinctive words. */
const SECTION_HEADINGS: Record<'elf' | 'rf', RegExp> = {
  elf: /^סקר בטיחות קרינה אלקטרומגנטית מרשת החשמל\s*\(ELF\)/,
  rf: /^סקר בטיחות קרינה אלקטרומגנטית בתדירויות רדיו\s*\(RF\)/,
};

/**
 * Where a survey section starts and ends, as block indices.
 *
 * A section runs from its own heading to the block before the next section's heading,
 * or to the end of the surveys if it is the last one. What follows the RF section is the
 * photographs and the appendices, which belong to neither survey — so the RF section's
 * end is found by looking for what comes after it rather than by running to the end of
 * the document.
 */
const AFTER_SURVEYS = /^(נספחים|נספח\s)/;

function findSection(blocks: BodyBlock[], xml: string, kind: 'elf' | 'rf'): { from: number; to: number } | null {
  const text = blocks.map((b) => textOf(xml.slice(b.start, b.end)).trim());

  const from = text.findIndex((t) => SECTION_HEADINGS[kind].test(t));
  if (from === -1) return null;

  // The other section's heading, or the appendices, whichever comes first after this one.
  const other = kind === 'elf' ? SECTION_HEADINGS.rf : SECTION_HEADINGS.elf;
  let to = blocks.length - 1;
  for (let i = from + 1; i < blocks.length; i++) {
    if (other.test(text[i]) || AFTER_SURVEYS.test(text[i])) {
      to = i - 1;
      break;
    }
    // The photographs are injected by a raw-XML tag that sits after both surveys.
    if (text[i].includes('{@photosXml}')) {
      to = i - 1;
      break;
    }
  }

  // Never swallow the trailing section properties: Word needs them.
  while (to > from && blocks[to].kind === 'sectPr') to--;
  return { from, to };
}

/**
 * Removes the section for the survey this report did not carry out.
 *
 * A combined survey keeps both and this does nothing. A scope naming one survey drops
 * the other outright.
 *
 * The appendix at the end of the report, which recommends a periodic "ELF + RF" check,
 * is deliberately left alone: it is general advice about inspections rather than a
 * statement about what this survey measured, and it reads identically in every report.
 */
export function stripUnusedSurvey(xml: string, scope: SurveyScope): string {
  if (scope === 'both') return xml;

  const drop = scope === 'elf' ? 'rf' : 'elf';
  const blocks = splitBody(xml);
  const span = findSection(blocks, xml, drop);
  if (!span) return xml; // heading not found — leave the document as authored

  return xml.slice(0, blocks[span.from].start) + xml.slice(blocks[span.to].end);
}

/**
 * Appendix ו — the RF threshold graph.
 *
 * A full page holding one picture: "גרף סיפי הקרינה - RF", the ICNIRP curve of power
 * density against frequency. It belongs to the RF survey alone, and an ELF-only report
 * printed it anyway — an appendix of radio-frequency thresholds at the back of a survey
 * that measured no radio frequencies.
 *
 * Cut separately from `stripUnusedSurvey` because it does not sit inside either survey
 * section: the appendices come after both, and that function deliberately stops at them.
 */
const RF_APPENDIX_HEADING = /^נספח\s+ו'/;

/** The appendix that follows it, which is where the cut ends. */
const NEXT_APPENDIX = /^נספח\s+ז'/;

/**
 * Removes Appendix ו from a survey that measured no RF.
 *
 * Only for an ELF-only scope: a combined survey and an RF-only survey both keep it. A
 * document whose appendix cannot be located is returned untouched — printing an extra
 * appendix is a far better failure than cutting a span that was not found.
 */
export function stripRfAppendix(xml: string, scope: SurveyScope): string {
  if (scope !== 'elf') return xml;

  const blocks = splitBody(xml);
  const text = blocks.map((b) => textOf(xml.slice(b.start, b.end)).trim());

  const from = text.findIndex((t) => RF_APPENDIX_HEADING.test(t));
  if (from === -1) return xml;

  const next = text.findIndex((t, i) => i > from && NEXT_APPENDIX.test(t));
  if (next === -1) return xml; // no following appendix to bound the cut — leave it alone

  let to = next - 1;
  // Never swallow the trailing section properties: Word needs them.
  while (to > from && blocks[to].kind === 'sectPr') to--;
  if (to < from) return xml;

  return xml.slice(0, blocks[from].start) + xml.slice(blocks[to].end);
}
