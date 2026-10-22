import { escapeXml } from './ooxml';
import { findMarkedRegions, MARKER_COLOR, type MarkedRegion } from './marked-runs';
import type { FieldMap } from '../field-map';

/**
 * Replaces every red-marked value with its placeholder.
 *
 * The marking says "this is dynamic"; the field map says which field. Both come
 * from outside the code — one from Word, one from a JSON file a human edits —
 * which is the point: neither requires touching the build script to add a field.
 */

export interface ApplyResult {
  xml: string;
  /** Field name per region replaced, in document order. */
  applied: string[];
  /** Marked text with no field name against it. */
  unmapped: string[];
}

export function applyMarks(xml: string, fieldMap: FieldMap, color = MARKER_COLOR): ApplyResult {
  const regions = findMarkedRegions(xml, color);
  const applied: string[] = [];
  const unmapped: string[] = [];

  // Back-to-front so earlier offsets stay valid as the string is rewritten.
  let out = xml;
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i];
    // A name written inside the mark wins: it is the most direct statement of
    // intent available, and needs no lookup table to interpret.
    const field = explicitFieldName(region.text) ?? fieldMap[region.text.trim()];
    if (!field) {
      unmapped.push(region.text.trim());
      continue;
    }

    out = out.slice(0, region.start) + placeholderRun(region, field) + out.slice(region.end);
    applied.push(field);
  }

  applied.reverse();
  unmapped.reverse();
  return { xml: out, applied, unmapped };
}

/**
 * One run holding the placeholder, styled like the value it replaces.
 *
 * The mark itself is stripped: it said "this is dynamic", and leaving it in
 * would print every merged value highlighted or in red. Whitespace around the
 * value belongs to the sentence, not the value, so it stays outside the
 * placeholder — "אפיון המקום: משרדים." must not become "אפיון המקום:{x}".
 */
function placeholderRun(region: MarkedRegion, field: string): string {
  const leading = region.text.match(/^\s*/)?.[0] ?? '';
  const trailing = region.text.match(/\s*$/)?.[0] ?? '';
  const rPr = stripMarks(firstRunProps(region));

  const text = `${leading}{${field}}${trailing}`;
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/** The `<w:rPr>` of the region's first run, so the placeholder inherits its look. */
function firstRunProps(region: MarkedRegion): string {
  const match = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(region.raw);
  return match ? match[0] : '';
}

/**
 * Removes the marking, keeping every other bit of formatting.
 *
 * Bold, underline, size and font all describe how the value should print and
 * must survive. The colour and the highlight were the instruction, not the
 * styling.
 */
function stripMarks(rPr: string): string {
  if (!rPr) return '';
  const stripped = rPr
    .replace(/<w:color[^>]*\/>/g, '')
    .replace(/<w:highlight[^>]*\/>/g, '');
  return stripped === '<w:rPr></w:rPr>' ? '' : stripped;
}

/**
 * The field name written inside the mark, if there is one.
 *
 * Marking says where; naming says what, and for a field the system has never
 * seen there is nothing to infer a name from. Writing `{siteName}` inside the
 * mark settles it on the spot, instead of leaving a blank in a JSON file to
 * come back to.
 */
export function explicitFieldName(text: string): string | null {
  const match = /^\s*\{([#/@^]?[\w.]+)\}\s*$/.exec(text);
  return match ? match[1] : null;
}
