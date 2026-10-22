import PizZip from 'pizzip';
import { escapeXml } from './ooxml';

/**
 * Putting an image into a .docx by hand.
 *
 * docxtemplater cannot substitute an image through an ordinary placeholder —
 * that needs the paid image module — so both the photo appendix and the
 * signature cells inject their own. Every injection is three coordinated edits
 * to the archive, and all three have to agree or Word offers to repair the file:
 *
 *   1. the image bytes land in `word/media/`
 *   2. `[Content_Types].xml` learns the file extension
 *   3. `word/_rels/document.xml.rels` maps a relationship id to the file
 *
 * Only then can the drawing XML reference the image by that relationship id.
 */

/** EMUs (English Metric Units) per pixel at 96 DPI — Word's drawing unit. */
export const EMU_PER_PIXEL = 9525;

export interface ImageInput {
  bytes: Buffer;
  /** MIME type, used to pick the file extension and content-type override. */
  contentType: string;
  /** Pixel dimensions, needed to preserve the aspect ratio on the page. */
  width: number;
  height: number;
}

export const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
};

/**
 * Writes an image into the archive and returns its relationship id.
 *
 * Mutates `zip`, so it must run before `generate` — and, because it adds parts,
 * before `ensureContentTypesFirst`.
 */
export function addImage(zip: PizZip, image: ImageInput, fileName: string): string {
  const extension = IMAGE_EXTENSIONS[image.contentType.toLowerCase()];
  if (!extension) {
    throw new Error(`סוג תמונה לא נתמך: ${image.contentType}`);
  }

  const target = `${fileName}.${extension}`;
  zip.file(`word/media/${target}`, image.bytes, { binary: true });
  registerExtension(zip, extension);

  return addRelationship(zip, `media/${target}`);
}

/**
 * A run containing one inline image, sized in EMUs.
 *
 * `docPrId` must be unique within the document; the callers keep to their own
 * numeric ranges, clear of the ids Word assigned in the template.
 */
export function inlineImageRun(options: {
  relationshipId: string;
  cx: number;
  cy: number;
  docPrId: number;
  name: string;
  description?: string;
}): string {
  const { relationshipId, cx, cy, docPrId, name, description = '' } = options;

  return (
    `<w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="${escapeXml(name)}" descr="${escapeXml(description)}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

/**
 * Scales an image to fit a box while keeping its proportions.
 *
 * Word does not scale a drawing to its frame — it renders it at exactly the
 * `cx`/`cy` given, so an oversized image simply spills off the page or out of
 * its table cell.
 */
export function fitDimensions(
  pixelWidth: number,
  pixelHeight: number,
  maxWidthEmu: number,
  maxHeightEmu: number,
): { cx: number; cy: number } {
  const width = Math.max(1, pixelWidth) * EMU_PER_PIXEL;
  const height = Math.max(1, pixelHeight) * EMU_PER_PIXEL;
  const scale = Math.min(1, maxWidthEmu / width, maxHeightEmu / height);
  return { cx: Math.round(width * scale), cy: Math.round(height * scale) };
}

/**
 * Registers a relationship from the main document to a part, returning its id.
 *
 * Ids must be unique within the relationships part, so the next free `rIdN` is
 * taken rather than a fixed prefix — the template already uses several dozen.
 */
function addRelationship(zip: PizZip, target: string): string {
  const path = 'word/_rels/document.xml.rels';
  const file = zip.file(path);
  if (!file) throw new Error(`${path} חסר בארכיון`);

  const xml = file.asText();
  const used = [...xml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  const id = `rId${(used.length ? Math.max(...used) : 0) + 1}`;

  const relationship =
    `<Relationship Id="${id}" ` +
    `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ` +
    `Target="${escapeXml(target)}"/>`;

  zip.file(path, xml.replace('</Relationships>', `${relationship}</Relationships>`));
  return id;
}

/**
 * Declares an image file extension in `[Content_Types].xml`.
 *
 * Word refuses to open a document containing a part whose extension it has no
 * default content type for — the same "unreadable content" prompt a misordered
 * archive produces, from an unrelated cause.
 */
function registerExtension(zip: PizZip, extension: string): void {
  const path = '[Content_Types].xml';
  const file = zip.file(path);
  if (!file) throw new Error(`${path} חסר בארכיון`);

  const xml = file.asText();
  if (new RegExp(`Extension="${extension}"`, 'i').test(xml)) return; // already declared

  const contentType =
    Object.entries(IMAGE_EXTENSIONS).find(([, ext]) => ext === extension)?.[0] ?? `image/${extension}`;
  zip.file(path, xml.replace(/(<Types[^>]*>)/, `$1<Default Extension="${extension}" ContentType="${contentType}"/>`));
}
