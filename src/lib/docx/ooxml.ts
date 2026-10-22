/**
 * Low-level helpers for working with the XML inside a .docx archive.
 *
 * A .docx is a ZIP of XML parts. Everything here operates on the raw string of
 * `word/document.xml` (or a header/footer part) — no DOM, because Word's XML is
 * huge and we only ever need structural slicing.
 */

/**
 * Finds the index just past the closing tag of the element starting at `start`.
 * Handles nesting (a `w:tbl` inside a `w:tbl` cell, for example).
 *
 * Returns `s.length` if the document is malformed and no close is found.
 */
export function findElementEnd(s: string, start: number, tag: string): number {
  const openSelf = `<${tag}>`;
  const openAttr = `<${tag} `;
  const close = `</${tag}>`;
  let depth = 0;
  let i = start;
  while (i < s.length) {
    if (s.startsWith(openSelf, i) || s.startsWith(openAttr, i)) {
      // A self-closing <w:tbl/> would open and close in one go; skip it.
      const gt = s.indexOf('>', i);
      if (gt !== -1 && s[gt - 1] === '/') {
        i = gt + 1;
        if (depth === 0) return i;
        continue;
      }
      depth++;
      i += tag.length + 1;
      continue;
    }
    if (s.startsWith(close, i)) {
      depth--;
      i += close.length;
      if (depth === 0) return i;
      continue;
    }
    i++;
  }
  return s.length;
}

export interface BodyBlock {
  /** `p` = paragraph, `tbl` = table, `sectPr` = the trailing section properties. */
  kind: 'p' | 'tbl' | 'sectPr';
  start: number;
  end: number;
}

/** Offsets of `<w:body>`'s inner content within the full document XML. */
export function bodyRange(xml: string): { start: number; end: number } {
  const open = xml.indexOf('<w:body>');
  if (open === -1) throw new Error('document.xml has no <w:body>');
  const end = xml.lastIndexOf('</w:body>');
  return { start: open + '<w:body>'.length, end };
}

/**
 * Splits the body into its top-level blocks. Word only allows paragraphs,
 * tables and a final sectPr at body level, so this is a complete partition.
 *
 * Offsets are absolute within `xml`, not relative to the body.
 */
export function splitBody(xml: string): BodyBlock[] {
  const { start, end } = bodyRange(xml);
  const blocks: BodyBlock[] = [];
  let i = start;
  while (i < end) {
    if (xml.startsWith('<w:p>', i) || xml.startsWith('<w:p ', i)) {
      const e = findElementEnd(xml, i, 'w:p');
      blocks.push({ kind: 'p', start: i, end: e });
      i = e;
      continue;
    }
    if (xml.startsWith('<w:tbl>', i) || xml.startsWith('<w:tbl ', i)) {
      const e = findElementEnd(xml, i, 'w:tbl');
      blocks.push({ kind: 'tbl', start: i, end: e });
      i = e;
      continue;
    }
    if (xml.startsWith('<w:sectPr', i)) {
      blocks.push({ kind: 'sectPr', start: i, end });
      break;
    }
    i++;
  }
  return blocks;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/**
 * The visible text of an XML fragment, concatenating every `<w:t>` run.
 *
 * Word splits a single typed word across several runs whenever formatting or
 * the spell-checker intervenes, so this is the only reliable way to ask "what
 * does this paragraph say?".
 */
export function textOf(fragment: string): string {
  const parts = fragment.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) ?? [];
  return parts
    .map((m) => m.replace(/^<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>$/, ''))
    .join('')
    .replace(/&(amp|lt|gt|quot|apos);/g, (e) => ENTITIES[e]);
}

/** Escapes a string for insertion into XML text or an attribute value. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
