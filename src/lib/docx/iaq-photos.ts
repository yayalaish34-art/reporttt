import PizZip from 'pizzip';
import { buildPhotosXml, type PhotoInput } from './photos';

/**
 * Builds the IAQ photograph appendix with the same layout used by radiation
 * reports: one large photograph per page, preceded by a bold 14pt Hebrew
 * heading whose number follows the photograph's current order.
 *
 * Keeping this as a delegation instead of a second OOXML implementation makes
 * changes to caption direction, sizing and page layout apply consistently to
 * both report types.
 */
export function buildIaqPhotosXml(zip: PizZip, photos: PhotoInput[]): string {
  return buildPhotosXml(zip, photos);
}
