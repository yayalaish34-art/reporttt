import PizZip from 'pizzip';
import { escapeXml } from './ooxml';
import { addImage, fitDimensions, inlineImageRun, type ImageInput } from './images';

/**
 * Builds the photo appendix, injected through the template's `{@photosXml}`
 * raw-XML tag.
 */

export interface PhotoInput extends ImageInput {
  /** Caption text, printed under the image without the "תמונה מס' N" prefix. */
  caption: string;
  /**
   * Prints the caption on its own, without the "תמונה מס' N" prefix.
   *
   * For pages that are not photographs of the site. The mould report's appendix carries
   * the laboratory's own sheets, and heading one of those "תמונה מס' 1" calls a
   * document a picture — wrong in a signed report, and confusing beside the survey
   * photographs, which are numbered that way and genuinely are pictures.
   */
  plainCaption?: boolean;
}

/** Widest a photo may be rendered, in EMUs. Matches the page's text column. */
const MAX_WIDTH_EMU = 5_486_400; // 6.0" — A4 portrait minus 1" margins

/** Tallest a photo may be rendered, so a portrait shot cannot span two pages. */
const MAX_HEIGHT_EMU = 6_400_800; // 7.0"

/** Keeps photo drawing ids clear of the template's own and of the signatures'. */
const DOC_PR_BASE = 1000;

/**
 * Writes the photos into the archive and returns the OOXML that displays them.
 *
 * Mutates `zip`, so it must run before `generate`.
 */
export function buildPhotosXml(zip: PizZip, photos: PhotoInput[]): string {
  if (photos.length === 0) return '<w:p/>';

  const body = photos
    .map((photo, index) => photoBlock(zip, photo, index + 1, `report-photo-${index + 1}`))
    /**
     * One photograph per page.
     *
     * Without an explicit break the appendix reflows: a short or wide picture
     * leaves room and the next one climbs onto the same page, so the pairing of
     * a photograph with its caption stops being obvious.
     *
     * The leading break is the same rule applied to the first photograph, which
     * used to be the exception: the template reached the appendix on a run of
     * empty paragraphs, so whether photo 1 got a page of its own depended on
     * how far down the signatures happened to end. A break says it outright. No
     * trailing one — that would end the report on a blank page.
     */
    .join(PAGE_BREAK);

  return PAGE_BREAK + body;
}

/**
 * One numbered, captioned photograph on a page of its own.
 *
 * Split out of the appendix so a photograph can also be placed where it belongs
 * rather than only at the end: the tabled asbestos opinion prints each building's
 * picture directly after that building's table, which is where a reader looks for
 * it. Both callers get the same caption, the same sizing and the same page break,
 * because a photograph should not look different depending on where it landed.
 *
 * `number` is what prints after "תמונה מס'". It is passed in rather than derived
 * because the caller knows the running order — the appendix counts its own list,
 * and the buildings loop counts buildings.
 *
 * `mediaName` must be unique across the document: it names the file written into
 * the archive, and two photographs sharing a name would leave one of them showing
 * the other's picture.
 *
 * Mutates `zip`, so it must run before `generate`.
 */
export function photoBlock(
  zip: PizZip,
  photo: PhotoInput,
  number: number,
  mediaName: string,
): string {
  const relationshipId = addImage(zip, photo, mediaName);
  const { cx, cy } = fitDimensions(photo.width, photo.height, MAX_WIDTH_EMU, MAX_HEIGHT_EMU);

  const image =
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
    inlineImageRun({
      relationshipId,
      cx,
      cy,
      docPrId: DOC_PR_BASE + number,
      name: `Photo ${number}`,
      description: photo.caption,
    }) +
    `</w:p>`;

  /**
   * The caption heads the page, at heading size.
   *
   * It used to sit under the photograph in the document's default body size,
   * which on a page filled by one picture read as a stray line at the very
   * bottom rather than as the title of what you had just looked at. Above it,
   * bold and at 14pt, it names the page before the picture explains it —
   * which is also the order the appendix is read in when someone is looking
   * for a particular photograph.
   *
   * `bidi` and `rtl` keep the Hebrew running right to left; without them the
   * leading "תמונה" would render after the number.
   */
  /**
   * David, like the rest of the report.
   *
   * Set explicitly rather than inherited: the caption is written here, not taken from a
   * paragraph in the template, so with no `rFonts` of its own it fell back to the
   * document's default face and the photograph pages were the one part of the report
   * set in a different font from every other page.
   *
   * `w:cs` is the one that governs Hebrew — the run is marked `rtl`, so the complex
   * script face is what actually prints. `ascii`/`hAnsi` cover the digits in
   * "תמונה מס' 3" so the whole caption sets in one face.
   */
  const captionFont = '<w:rFonts w:ascii="David" w:hAnsi="David" w:cs="David"/>';
  const label = photo.caption.trim();
  const caption =
    `<w:p><w:pPr><w:bidi/><w:jc w:val="center"/><w:spacing w:after="160"/>` +
    `<w:rPr>${captionFont}<w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/><w:rtl/></w:rPr></w:pPr>` +
    `<w:r><w:rPr>${captionFont}<w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/><w:rtl/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(
      photo.plainCaption
        ? label
        : label
          ? `תמונה מס' ${number} : ${label}`
          : `תמונה מס' ${number}`,
    )}</w:t>` +
    `</w:r></w:p>`;

  return caption + image;
}

/** A page break, for a caller placing photographs of its own. */
export const PHOTO_PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
