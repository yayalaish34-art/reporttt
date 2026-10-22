import { splitBody, textOf, escapeXml, type BodyBlock } from './ooxml';
import { appendixForSite, type AppendixLine } from '../appendix-text';

/**
 * Replaces Appendix ח with the version that fits the site.
 *
 * The appendix recommends repeating the survey and argues why. The template carries the
 * workplace argument — the employer's duty of care, the Work Safety Ordinance, the
 * Electrical Equipment Regulations — written into the document as plain paragraphs. A
 * flat, a school and a government housing unit each need a different argument, and until
 * now all three received the workplace one: a family that had their home surveyed was
 * told about their employer's statutory obligations.
 *
 * Rewritten on the merged XML rather than in the template, for the same reason as
 * `stripUnusedSurvey`: it applies to the template already in the database and survives a
 * rebuild.
 */

/** The heading that opens the appendix, whichever version the template happens to hold. */
const APPENDIX_HEADING = /^המלצה לבדיקה תקופתית של קרינה בלתי מייננת/;

/**
 * Where the appendix ends.
 *
 * The signature block closes it, and "בברכה" is what opens that block. Matching the sign
 * off rather than counting paragraphs means an appendix edited in Word — a line added, a
 * clause reworded — is still replaced whole.
 */
const AFTER_APPENDIX = /^(בברכה|בכבוד רב)/;

/**
 * Builds one paragraph in the appendix's own setting: David 14pt, right to left.
 *
 * Taken from the paragraphs already in the document rather than invented, so a replaced
 * appendix sets identically to the surrounding pages.
 */
function paragraph(line: AppendixLine): string {
  const bold = line.bold ? '<w:b/><w:bCs/>' : '';
  const runProps =
    '<w:rPr><w:rFonts w:ascii="David" w:hAnsi="David" w:cs="David"/>' +
    bold +
    '<w:sz w:val="28"/><w:szCs w:val="28"/><w:rtl/></w:rPr>';
  return (
    '<w:p><w:pPr><w:bidi/>' +
    runProps +
    '</w:pPr><w:r>' +
    runProps +
    '<w:t xml:space="preserve">' +
    escapeXml(line.text) +
    '</w:t></w:r></w:p>'
  );
}

/** An empty paragraph, which is how the appendix spaces its sections. */
const BLANK = '<w:p/>';

/**
 * Swaps in the appendix for this report's site character.
 *
 * A document whose appendix cannot be located is returned untouched: a report that
 * prints the workplace text is what every report did until now, and is a far better
 * failure than one that prints no appendix at all.
 */
export function applySiteAppendix(xml: string, siteCharacter: string): string {
  const appendix = appendixForSite(siteCharacter);
  const blocks = splitBody(xml);
  const text = blocks.map((b) => textOf(xml.slice(b.start, b.end)).trim());

  const from = text.findIndex((t) => APPENDIX_HEADING.test(t));
  if (from === -1) return xml;

  // Up to the sign-off, or to the end of the surveys if there is none to find.
  let to = blocks.length - 1;
  for (let i = from + 1; i < blocks.length; i++) {
    if (AFTER_APPENDIX.test(text[i])) {
      to = i - 1;
      break;
    }
  }
  // Never swallow the trailing section properties: Word needs them.
  while (to > from && blocks[to].kind === 'sectPr') to--;
  if (to < from) return xml;

  const rendered = [
    paragraph({ text: appendix.heading, bold: true }),
    BLANK,
    ...appendix.body.flatMap((line) => [paragraph(line), BLANK]),
  ].join('');

  return xml.slice(0, blocks[from].start) + rendered + xml.slice(blocks[to].end);
}
