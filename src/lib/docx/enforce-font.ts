import type PizZip from 'pizzip';

/**
 * Forces every piece of text in the archive onto the David face.
 *
 * Reports have been authored over the years in different versions of Word on
 * different machines, so the templates in the SQLite store carry a scatter of
 * defaults — Arial, Times New Roman, whatever the user who built the file was
 * on at the time. Explicit David runs are already written by the appendix /
 * photo / site-appendix generators, but anything carried through from the
 * template kept whichever font was baked in, and the delivered PDF printed in
 * two or three faces.
 *
 * Rather than republish every template with David as the default, this walks
 * the finished archive and makes David the universal face: the document default
 * in `word/styles.xml`, every named style's own font, and every inline `<w:rPr>`
 * override in the body, headers and footers. The transform runs on the
 * post-merge archive, so later edits (uploaded templates, Word-authored
 * sections) are brought in line without the author having to remember.
 */

const DAVID_RFONTS = '<w:rFonts w:ascii="David" w:hAnsi="David" w:cs="David" w:eastAsia="David"/>';

export function enforceDavidFont(zip: PizZip): void {
  const files = (zip as unknown as { files?: Record<string, { asText?: () => string }> }).files;
  if (!files) return;

  for (const path of Object.keys(files)) {
    if (!/^word\/(document|styles|header\d*|footer\d*|endnotes|footnotes|comments)\.xml$/.test(path)) {
      continue;
    }
    const entry = zip.file(path);
    if (!entry) continue;
    const xml = entry.asText();
    const next = path.endsWith('/styles.xml') ? patchStyles(xml) : patchDocumentPart(xml);
    if (next !== xml) zip.file(path, next);
  }
}

/**
 * Replaces or injects the David font inside every `<w:rPr>` of a document part.
 *
 * `<w:rPr>` carries a run's formatting; `<w:rFonts>` names its face. A run that
 * already carried an `rFonts` is rewritten to David; a run with properties but
 * no font declaration gets one injected after the opening `<w:rPr>` tag.
 *
 * Self-closing `<w:rPr/>` is left alone — it is "no properties", so writing a
 * font into it would be adding properties this run deliberately did not have.
 */
function patchDocumentPart(xml: string): string {
  return xml.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (_, inner: string) => {
    const stripped = inner.replace(/<w:rFonts\b[^/]*\/>/g, '').replace(/<w:rFonts\b[^>]*>[\s\S]*?<\/w:rFonts>/g, '');
    return `<w:rPr>${DAVID_RFONTS}${stripped}</w:rPr>`;
  });
}

/**
 * Patches `word/styles.xml`:
 *
 * 1. The document default — `<w:docDefaults><w:rPrDefault><w:rPr>` — is given
 *    the David `rFonts`, which cascades to every run that does not override.
 * 2. Every named `<w:style type="paragraph|character|…">`'s own `<w:rPr>` is
 *    rewritten the same way, so a style explicitly set to another face is
 *    brought into line too.
 *
 * The run-property rewrite is the same as the body one; only the document
 * default needs extra care because it may be missing entirely in older
 * templates and has to be inserted around `<w:rPrDefault>`.
 */
function patchStyles(xml: string): string {
  let out = patchDocumentPart(xml);

  // Ensure docDefaults carries an rPrDefault with David — a template that never
  // declared one gets one injected, which costs nothing when the body already
  // has David baked in and saves the day when it does not.
  if (/<w:docDefaults>[\s\S]*?<w:rPrDefault>[\s\S]*?<w:rPr>/.test(out)) {
    // Already handled by patchDocumentPart — rPr inside rPrDefault was rewritten.
  } else if (/<w:docDefaults>[\s\S]*?<w:rPrDefault\s*\/>/.test(out)) {
    out = out.replace(
      /<w:rPrDefault\s*\/>/,
      `<w:rPrDefault><w:rPr>${DAVID_RFONTS}</w:rPr></w:rPrDefault>`,
    );
  } else if (/<w:docDefaults>/.test(out)) {
    out = out.replace(
      '<w:docDefaults>',
      `<w:docDefaults><w:rPrDefault><w:rPr>${DAVID_RFONTS}</w:rPr></w:rPrDefault>`,
    );
  } else {
    // No docDefaults at all — insert at the top of the styles document.
    out = out.replace(
      /<w:styles(\s[^>]*)?>/,
      (match) =>
        `${match}<w:docDefaults><w:rPrDefault><w:rPr>${DAVID_RFONTS}</w:rPr></w:rPrDefault></w:docDefaults>`,
    );
  }

  return out;
}
