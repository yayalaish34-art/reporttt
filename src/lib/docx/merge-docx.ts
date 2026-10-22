import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { enforceDavidFont } from './enforce-font';

/**
 * Merges a Word template with data.
 *
 * The template is a normal .docx authored in Word, with `{fieldName}` written
 * directly into the text. docxtemplater rewrites `word/document.xml` in place;
 * everything else in the archive (styles, images, headers) is carried through
 * untouched.
 */
export interface MergeOptions {
  /**
   * Runs against the opened archive before rendering, and may add parts to it —
   * images, relationships, content types. Whatever it returns is merged into
   * the render data, which is how generated OOXML reaches a `{@raw}` tag.
   */
  prepare?: (zip: PizZip) => Record<string, unknown>;
  /**
   * Rewrites `word/document.xml` before it is rendered.
   *
   * For changes to the document's *structure* rather than its values — dropping a
   * section the report does not carry. It runs before the render so whatever it leaves
   * behind is what the placeholders are filled into, and so a removed section takes its
   * loops and placeholders with it rather than leaving them to render empty.
   */
  rewrite?: (xml: string) => string;
}

export function mergeDocx(
  templateBytes: Buffer | Uint8Array,
  data: Record<string, unknown>,
  options: MergeOptions = {},
): Buffer {
  const zip = new PizZip(Buffer.from(templateBytes));

  // Structural edits come first: `prepare` may inject XML keyed to what is still in the
  // document, and a section removed afterwards would take that injection with it.
  if (options.rewrite) {
    const path = 'word/document.xml';
    const file = zip.file(path);
    if (file) zip.file(path, options.rewrite(file.asText()));
  }

  // Parts added here are carried through the render untouched, so this is where
  // anything the template cannot express — a photograph — gets injected.
  const extra = options.prepare ? options.prepare(zip) : {};

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true, // {#items} may span whole paragraphs / table rows
    linebreaks: true, // "\n" in a value becomes a real line break in Word
    nullGetter: nullGetter, // a missing field renders empty, never "undefined"
  });

  try {
    doc.render({ ...data, ...extra });
  } catch (err) {
    throw describeRenderError(err);
  }

  const out = doc.getZip();
  // David is Galit's standing face across all four departments. Older templates
  // in the SQLite store carry a mixed bag of defaults; this walks the finished
  // archive and brings every run — body, headers, footers, named styles — onto
  // David. See `enforce-font.ts`.
  enforceDavidFont(out);
  ensureContentTypesFirst(out);

  return out.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * A field absent from the data renders as empty rather than as the string
 * "undefined". Without this a missing phone number ships to the customer as
 * "טלפון: undefined" and nobody notices until they complain.
 *
 * A raw-XML tag is the exception: it replaces the paragraph that holds it, so
 * an empty string would leave the body with a gap where a block-level element
 * has to be. It gets an empty paragraph instead.
 */
function nullGetter(part?: { module?: string }): string {
  return part?.module === 'rawxml' ? '<w:p/>' : '';
}

/**
 * Word rejects an archive whose `[Content_Types].xml` is not the first entry:
 * it reports "unreadable content" and offers to repair the file. The content is
 * perfectly valid — only the ZIP ordering is wrong.
 *
 * PizZip reorders entries while rendering, so this has to run after `render`
 * and before `generate`.
 */
export function ensureContentTypesFirst(zip: PizZip): void {
  const CT = '[Content_Types].xml';
  const files = (zip as unknown as { files?: Record<string, unknown> }).files;
  if (!files || !files[CT]) return;

  const keys = Object.keys(files);
  if (keys[0] === CT) return; // already first — nothing to do

  const reordered: Record<string, unknown> = { [CT]: files[CT] };
  for (const key of keys) {
    if (key !== CT) reordered[key] = files[key];
  }
  (zip as unknown as { files: Record<string, unknown> }).files = reordered;
}

/** Error thrown when a template fails to render, carrying per-tag detail. */
export class TemplateRenderError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[]) {
    super(message);
    this.name = 'TemplateRenderError';
    this.issues = issues;
  }
}

/**
 * docxtemplater reports template problems as a single opaque "Multi error".
 * The useful detail — which tag, in which context — is nested inside
 * `properties.errors`, so unwrap it into something a template author can act on.
 */
function describeRenderError(err: unknown): Error {
  const e = err as {
    message?: string;
    properties?: { errors?: Array<{ properties?: { explanation?: string; xtag?: string; id?: string } }> };
  };
  const nested = e?.properties?.errors;
  if (!Array.isArray(nested) || nested.length === 0) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const issues = nested.map((n) => {
    const p = n.properties ?? {};
    return p.explanation ?? `${p.id ?? 'error'} at tag {${p.xtag ?? '?'}}`;
  });
  return new TemplateRenderError(`התבנית נכשלה ברינדור (${issues.length} שגיאות)`, issues);
}
