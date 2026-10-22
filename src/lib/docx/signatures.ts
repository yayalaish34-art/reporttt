import PizZip from 'pizzip';
import { addImage, fitDimensions, inlineImageRun, type ImageInput } from './images';

/**
 * Signature images for the inspector and report-author tables.
 *
 * These cannot live in the template. The template keeps one row per table and
 * repeats it, so whatever signature were baked into that row would be stamped
 * on every person in the table — in the source document that meant the
 * approver's row carried the report author's signature.
 *
 * Each row therefore injects its own through a `{@signatureXml}` tag inside the
 * loop, and a person with no signature on file renders an empty cell rather
 * than someone else's mark.
 */

export interface SignatureInput extends ImageInput {
  /** Whose signature it is, used as the drawing's accessible name. */
  label: string;
}

/** The signature cell is narrow; these bound it to roughly its column. */
const MAX_WIDTH_EMU = 1_371_600; // 1.5"
const MAX_HEIGHT_EMU = 685_800; // 0.75"

/** Keeps signature drawing ids clear of the template's own and of the photos'. */
const DOC_PR_BASE = 2000;

/**
 * The XML for one signature cell.
 *
 * Returns an empty paragraph when there is no signature: a raw-XML tag replaces
 * the paragraph holding it, so the cell still needs a block-level element.
 */
export function buildSignatureXml(zip: PizZip, signature: SignatureInput | null, index: number): string {
  if (!signature) return '<w:p/>';

  const relationshipId = addImage(zip, signature, `report-signature-${index + 1}`);
  const { cx, cy } = fitDimensions(signature.width, signature.height, MAX_WIDTH_EMU, MAX_HEIGHT_EMU);

  return (
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
    inlineImageRun({
      relationshipId,
      cx,
      cy,
      docPrId: DOC_PR_BASE + index,
      name: `Signature ${index + 1}`,
      description: signature.label,
    }) +
    `</w:p>`
  );
}
