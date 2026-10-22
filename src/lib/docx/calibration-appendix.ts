import { readFileSync } from 'node:fs';
import path from 'node:path';
import type PizZip from 'pizzip';
import { addImage, fitDimensions, inlineImageRun } from './images';
import { bodyRange, escapeXml } from './ooxml';
import type { SurveyScope } from '../report-text';

/**
 * The instrument calibration certificates, printed as the closing appendix.
 *
 * A radiation survey is only as good as the calibration of the meter that took it,
 * and the certificate is what proves the meter was in calibration on the day. It
 * belongs in the report rather than in a drawer: the reports are read by clients,
 * by regulators, and occasionally in court.
 *
 * Which certificate prints follows the survey that was carried out — the ELF meter's
 * for an ELF survey, the RF meter's for an RF survey, both for a combined one. An
 * ELF-only report that carried the RF meter's certificate would be attesting to an
 * instrument it never used, the same failure `stripRfAppendix` exists to prevent.
 *
 * The images ship in `public/`, not in the database: they change only when the
 * instruments are recalibrated (every 24 months), and a file in the repository is
 * both reviewable in a diff and impossible to lose with the volume.
 */

/** The tag the appendix is rendered into, added to the template at merge time. */
export const CALIBRATION_TAG = '{@calibrationXml}';

/**
 * Puts the tag at the very end of the body, so the certificates close the report.
 *
 * Added here rather than authored into the template for the same reason as
 * `applySiteAppendix`: it then applies to the template already in the database and
 * cannot be undone by re-uploading an older one.
 *
 * The tag goes *before* the trailing `<w:sectPr>`, which Word requires to be the
 * last element of the body — appending after it produces a file Word offers to
 * repair.
 */
export function appendCalibrationTag(xml: string): string {
  if (xml.includes(CALIBRATION_TAG)) return xml; // already present — never twice

  const { end } = bodyRange(xml);
  const sectPr = xml.lastIndexOf('<w:sectPr', end);
  const at = sectPr === -1 || sectPr > end ? end : sectPr;

  return xml.slice(0, at) + `<w:p><w:r><w:t>${CALIBRATION_TAG}</w:t></w:r></w:p>` + xml.slice(at);
}

/** Widest an appendix page may be rendered, in EMUs — the page's text column. */
const MAX_WIDTH_EMU = 5_486_400; // 6.0" — A4 portrait minus 1" margins

/** Tallest, so a portrait certificate cannot spill onto a second page. */
const MAX_HEIGHT_EMU = 8_229_600; // 9.0"

/** Keeps these drawing ids clear of the template's, the photos' and the signatures'. */
const DOC_PR_BASE = 2000;

interface Certificate {
  /** File in `public/`. */
  file: string;
  /** What the heading calls the instrument. */
  instrument: string;
  /** Which surveys it belongs to. */
  scopes: readonly ('elf' | 'rf')[];
}

const CERTIFICATES: Certificate[] = [
  { file: 'calibration-elf.png', instrument: 'מכשיר מדידת שדה מגנטי (ELF)', scopes: ['elf'] },
  { file: 'calibration-rf.png', instrument: 'מכשיר מדידת קרינת רדיו (RF)', scopes: ['rf'] },
];

/**
 * Appendix letters, continuing after ח' — the last one the template carries.
 *
 * Numbered at print time rather than fixed per certificate: a combined survey
 * prints two, and labelling both "נספח ט'" would give the report two appendices
 * with the same name.
 */
const APPENDIX_LETTERS = ["ט'", "י'", "יא'", "יב'"];

/** A page break, so each certificate opens a page of its own. */
const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** Reads a PNG's pixel dimensions from its IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  // Bytes 16–23 of a PNG are the IHDR width and height, big-endian.
  if (bytes.length < 24 || bytes.subarray(1, 4).toString() !== 'PNG') {
    throw new Error('קובץ תעודת הכיול אינו PNG תקין');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function headingParagraph(text: string): string {
  return (
    `<w:p><w:pPr><w:bidi/><w:jc w:val="right"/><w:rPr><w:rFonts w:cs="David"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:cs="David"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/><w:rtl/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

/**
 * Builds the calibration appendix for a scope, adding the images to the archive.
 *
 * Mutates `zip`, so it must run before `generate`. Returns an empty paragraph when
 * the scope has no certificate to print, which is what a `{@tag}` needs to render
 * to nothing rather than to the literal text.
 */
export function buildCalibrationXml(zip: PizZip, scope: SurveyScope): string {
  const wanted = CERTIFICATES.filter((c) =>
    scope === 'both' ? true : c.scopes.includes(scope as 'elf' | 'rf'),
  );
  if (wanted.length === 0) return '<w:p/>';

  const blocks: string[] = [];
  for (const [index, certificate] of wanted.entries()) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path.join(process.cwd(), 'public', certificate.file));
    } catch {
      // A missing certificate must not fail the whole report: the survey is still
      // valid and the surveyor can attach the page by hand. Skipped, not faked.
      continue;
    }

    // Lettered by position among the certificates actually printed, so an RF-only
    // report calls its single certificate ט' rather than skipping to י'.
    const letter = APPENDIX_LETTERS[blocks.length] ?? `ט'-${blocks.length + 1}`;
    const heading = `נספח ${letter}: תעודת כיול — ${certificate.instrument}`;

    const { width, height } = pngSize(bytes);
    const relationshipId = addImage(
      zip,
      { bytes, contentType: 'image/png', width, height },
      `calibration-${certificate.file.replace(/\.png$/, '')}`,
    );
    const { cx, cy } = fitDimensions(width, height, MAX_WIDTH_EMU, MAX_HEIGHT_EMU);

    blocks.push(
      PAGE_BREAK +
        headingParagraph(heading) +
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
        inlineImageRun({
          relationshipId,
          cx,
          cy,
          docPrId: DOC_PR_BASE + index + 1,
          name: certificate.file,
          description: heading,
        }) +
        `</w:p>`,
    );
  }

  return blocks.length ? blocks.join('') : '<w:p/>';
}
