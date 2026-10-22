import { splitBody, textOf, escapeXml } from './ooxml';
import { conclusionPreambleFor } from '../measurement-rules';

/**
 * Rewrites the two fixed sentences that open the ELF conclusions.
 *
 * The conclusions begin with a short statement of the rules the measurements were judged
 * against, before the survey's own findings are argued. The template carries one version
 * of those sentences — the workplace's — written into the document as plain paragraphs:
 *
 *   "חשיפה רגעית מרבית המותרת … הינה 2000 מיליגאוס."
 *   "רמת הקרינה המומלצת לחשיפה ממושכת … במקומות עבודה הינה עד 10 מילי גאוס …"
 *
 * Both are wrong for a school. A surveyor who characterised the site as "מוסדות חינוך"
 * still had the report tell the client that the standard is the workplace's 10 mG over
 * eight hours, while the tables beside it had judged every reading against 4 — the
 * document contradicting itself on the one number the client acts on.
 *
 * The instantaneous line is corrected at the same time: 1,000 mG, not 2,000.
 *
 * Rewritten on the merged XML rather than in the template, for the same reason as
 * `stripUnusedSurvey` and `applySiteAppendix`: it applies to the template already in the
 * database and cannot be undone by a rebuild.
 */

/**
 * The two sentences, matched on their opening words.
 *
 * Anchored on the distinctive opening rather than on the whole sentence, so a line whose
 * numbers or wording were edited in Word is still recognised and replaced. The order
 * matters only in that each is replaced where it is found.
 */
const PREAMBLE_LINES: { match: RegExp; key: 'instantaneous' | 'longTerm' }[] = [
  { match: /^חשיפה\s+רגעית\s+מרבית/, key: 'instantaneous' },
  { match: /^רמת\s+הקרינה\s+המומלצת\s+לחשיפה\s+ממושכת/, key: 'longTerm' },
];

/** Where the ELF conclusions start, so the search does not wander into the appendices. */
const CONCLUSIONS_HEADING = /^מסקנות\s*$/;

/**
 * Rebuilds one paragraph, keeping the setting of the paragraph it replaces.
 *
 * The two sentences are numbered list items in the template, so their paragraph
 * properties carry the numbering that prints "1." and "2." beside them. Reusing the
 * original `<w:pPr>` keeps the list intact — writing a fresh paragraph would drop the
 * numbering and leave the conclusions with two unnumbered lines among numbered ones.
 */
function rewritten(original: string, text: string): string {
  const props = original.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? '';
  // The run properties of the first run, so the replacement sets in the same face and
  // size as the sentence it stands in for.
  const runProps = original.match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/)?.[1] ?? '';
  return (
    '<w:p>' +
    props +
    '<w:r>' +
    runProps +
    '<w:t xml:space="preserve">' +
    escapeXml(text) +
    '</w:t></w:r></w:p>'
  );
}

/**
 * Replaces the preamble sentences with the ones that fit the site.
 *
 * A document whose conclusions cannot be located is returned untouched — printing the
 * template's own wording is what every report did until now, and is a better failure
 * than a conclusions section with two sentences missing.
 */
export function applyConclusionPreamble(xml: string, siteCharacter: string): string {
  const wording = conclusionPreambleFor(siteCharacter);
  const blocks = splitBody(xml);
  const text = blocks.map((b) => textOf(xml.slice(b.start, b.end)).trim());

  const start = text.findIndex((t) => CONCLUSIONS_HEADING.test(t));
  if (start === -1) return xml;

  // Rebuilt back to front so that each splice leaves the earlier offsets valid.
  const edits: { block: (typeof blocks)[number]; text: string }[] = [];
  for (let i = start + 1; i < blocks.length && i < start + 12; i++) {
    const line = PREAMBLE_LINES.find((l) => l.match.test(text[i]));
    if (line) edits.push({ block: blocks[i], text: wording[line.key] });
  }

  let result = xml;
  for (const edit of edits.reverse()) {
    const original = xml.slice(edit.block.start, edit.block.end);
    result =
      result.slice(0, edit.block.start) + rewritten(original, edit.text) + result.slice(edit.block.end);
  }
  return result;
}
