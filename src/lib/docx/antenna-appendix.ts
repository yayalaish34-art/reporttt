/**
 * Antenna map appendix for the radiation report DOCX.
 *
 * Adds two sections after the measurement tables:
 *  1. A full-width PNG map of nearby cellular antenna sites (active + planned)
 *  2. A detailed table listing every antenna within the search radius
 *
 * Follows the same pattern as `calibration-appendix.ts`:
 *  – A rewrite function injects the raw-XML tag into the template XML
 *  – A prepare function embeds the image + builds the table XML
 *  – The tag is rendered at merge time
 *
 * The map PNG must be generated before the DOCX merge; the generator is in
 * `antenna-map-render.ts` (headless Chromium) or can be pre-supplied as bytes.
 */

import type PizZip from 'pizzip';
import { addImage, fitDimensions, inlineImageRun } from './images';
import { bodyRange, escapeXml } from './ooxml';
import type { AntennaSiteGroup, AntennaSearchResult } from '../antennas';
import { readImageSize } from '../image-size';

// ---------------------------------------------------------------------------
// Tag
// ---------------------------------------------------------------------------

/** The raw-XML tag injected into the template. */
export const ANTENNA_MAP_TAG = '{@antennaMapXml}';

/**
 * Injects the antenna-map tag into the document XML, before the calibration
 * certificates (which are the final appendix).
 *
 * Position: just before `{@calibrationXml}` if present, otherwise before the
 * trailing `<w:sectPr>`.
 */
export function appendAntennaMapTag(xml: string): string {
  if (xml.includes(ANTENNA_MAP_TAG)) return xml; // never twice

  // Try to go before calibration, so the antenna map is the penultimate appendix.
  const calIdx = xml.indexOf('{@calibrationXml}');
  if (calIdx > 0) {
    // Walk back to the start of the <w:p> that contains the tag.
    const pStart = xml.lastIndexOf('<w:p>', calIdx);
    const at = pStart > 0 ? pStart : calIdx;
    return xml.slice(0, at) +
      `<w:p><w:r><w:t>${ANTENNA_MAP_TAG}</w:t></w:r></w:p>` +
      xml.slice(at);
  }

  // Fallback: before the trailing sectPr.
  const { end } = bodyRange(xml);
  const sectPr = xml.lastIndexOf('<w:sectPr', end);
  const at = sectPr === -1 || sectPr > end ? end : sectPr;
  return xml.slice(0, at) +
    `<w:p><w:r><w:t>${ANTENNA_MAP_TAG}</w:t></w:r></w:p>` +
    xml.slice(at);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MAP_WIDTH_EMU = 5_486_400;   // 6.0"
const MAX_MAP_HEIGHT_EMU = 6_400_000;  // ~7.0" — leave room for heading
const DOC_PR_BASE = 3000;             // clear of photos (1000+), calibration (2000+)
const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** Appendix letters continuing after the calibration appendix (ט', י' are calibration). */
const APPENDIX_LETTER_MAP = "יא' יב' יג' יד' טו' טז' יז' יח' יט' כ'".split(' ');

// ---------------------------------------------------------------------------
// OOXML helpers
// ---------------------------------------------------------------------------

function heading(text: string): string {
  return (
    `<w:p><w:pPr><w:bidi/><w:jc w:val="right"/>` +
    `<w:rPr><w:rFonts w:cs="David"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:cs="David"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/><w:rtl/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function subheading(text: string): string {
  return (
    `<w:p><w:pPr><w:bidi/><w:jc w:val="right"/>` +
    `<w:rPr><w:rFonts w:cs="David"/><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:cs="David"/><w:b/><w:bCs/><w:sz w:val="24"/><w:szCs w:val="24"/><w:rtl/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function textParagraph(text: string, size = 22): string {
  return (
    `<w:p><w:pPr><w:bidi/><w:rPr><w:rFonts w:cs="David"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:cs="David"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:rtl/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function cellXml(text: string, bold = false, size = 20, align: 'center' | 'right' = 'center'): string {
  const bXml = bold ? '<w:b/><w:bCs/>' : '';
  return (
    `<w:tc>` +
    `<w:tcPr><w:vAlign w:val="center"/></w:tcPr>` +
    `<w:p><w:pPr><w:bidi/><w:jc w:val="${align}"/>` +
    `<w:rPr><w:rFonts w:cs="David"/>${bXml}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:cs="David"/>${bXml}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:rtl/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`
  );
}

/** Header cell: shaded, bold. */
function headerCellXml(text: string, widthPct?: number): string {
  const wPr = widthPct ? `<w:tcW w:w="${Math.round(widthPct * 50)}" w:type="pct"/>` : '';
  return (
    `<w:tc><w:tcPr>${wPr}<w:shd w:val="clear" w:color="auto" w:fill="1C4A6E"/>` +
    `<w:vAlign w:val="center"/></w:tcPr>` +
    `<w:p><w:pPr><w:bidi/><w:jc w:val="center"/>` +
    `<w:rPr><w:rFonts w:cs="David"/><w:b/><w:bCs/><w:color w:val="FFFFFF"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:cs="David"/><w:b/><w:bCs/><w:color w:val="FFFFFF"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:rtl/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`
  );
}

// ---------------------------------------------------------------------------
// Table builder
// ---------------------------------------------------------------------------

function buildAntennaTable(groups: AntennaSiteGroup[]): string {
  const all = groups.flatMap((g) => g.items.map((item) => ({ ...item, groupN: g.n, dist: g.dist })));

  // Header row
  const headers = [
    '#', 'חברה', 'כתובת', 'מרחק (מ\')', 'סוג אתר',
    'דורות', 'עוצמה µW/cm²', '% מסף', 'היתר קרינה',
    'היתר הקמה', 'היתר הפעלה', 'בדיקה אחרונה', 'סטטוס',
  ];
  let headerRow = '<w:tr>' +
    `<w:trPr><w:tblHeader/></w:trPr>` +
    headers.map((h) => headerCellXml(h)).join('') +
    '</w:tr>';

  // Data rows
  let dataRows = '';
  for (const a of all) {
    const isPlanned = a.status === 'planned';
    const statusText = isPlanned ? 'בהקמה' : 'פעיל';
    const tech = a.technology || (isPlanned ? '—' : '');
    const power = a.maxTheoreticalPower > 0 ? a.maxTheoreticalPower.toFixed(1) : '—';
    const pct = a.maxHealthThresholdPct > 0 ? a.maxHealthThresholdPct.toFixed(2) + '%' : '—';
    const permit = a.radiationPermit || '—';
    const construction = a.constructionPermitDate || (isPlanned ? a.applicationDate || '—' : '—');
    const operation = a.operationPermitDate || '—';
    const lastInspection = a.lastPeriodicInspection || '—';

    dataRows += '<w:tr>' +
      cellXml(String(a.groupN), true) +
      cellXml(a.company, false, 18, 'right') +
      cellXml(a.address + (a.city ? ', ' + a.city : ''), false, 18, 'right') +
      cellXml(String(a.dist)) +
      cellXml(a.siteType || '—', false, 18) +
      cellXml(tech, false, 18) +
      cellXml(power) +
      cellXml(pct) +
      cellXml(permit, false, 18) +
      cellXml(construction, false, 18) +
      cellXml(operation, false, 18) +
      cellXml(lastInspection, false, 18) +
      cellXml(statusText, true, 18) +
      '</w:tr>';
  }
  if (all.length === 0) {
    dataRows =
      '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="13"/><w:vAlign w:val="center"/></w:tcPr>' +
      '<w:p><w:pPr><w:bidi/><w:jc w:val="center"/></w:pPr>' +
      '<w:r><w:rPr><w:rFonts w:cs="David"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:rtl/></w:rPr>' +
      '<w:t>לא נמצאו אנטנות ברדיוס החיפוש שנבחר.</w:t></w:r></w:p></w:tc></w:tr>';
  }

  // Table properties: landscape, auto-fit, borders
  const tblPr =
    `<w:tblPr>` +
    `<w:tblStyle w:val="TableGrid"/>` +
    `<w:bidiVisual/>` +
    `<w:tblW w:w="5000" w:type="pct"/>` +
    `<w:jc w:val="center"/>` +
    `<w:tblBorders>` +
    `<w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
    `<w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
    `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
    `<w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
    `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
    `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>` +
    `</w:tblBorders>` +
    `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>` +
    `</w:tblPr>`;

  return `<w:tbl>${tblPr}<w:tblGrid/>` + headerRow + dataRows + `</w:tbl>`;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export interface AntennaMapInput {
  /** The PNG bytes of the rendered map. */
  mapPng: Buffer;
  /** The full search result with grouped antenna data. */
  searchResult: AntennaSearchResult;
  /** Appendix letter, e.g. "ז'" */
  appendixLetter?: string;
}

/**
 * Builds the antenna map appendix XML and adds the map image to the archive.
 *
 * Returns OOXML suitable for the `{@antennaMapXml}` raw tag.
 */
export function buildAntennaMapXml(zip: PizZip, input: AntennaMapInput): string {
  const { mapPng, searchResult, appendixLetter } = input;

  const letter = appendixLetter ?? "ז'";
  const blocks: string[] = [];

  // ── Page 1: Map image ──────────────────────────────────────────────
  const dims = readImageSize(mapPng);
  if (!dims) throw new Error('Cannot read antenna map PNG dimensions');
  const relId = addImage(
    zip,
    { bytes: mapPng, contentType: 'image/png', width: dims.width, height: dims.height },
    'antenna-map',
  );
  const { cx, cy } = fitDimensions(dims.width, dims.height, MAX_MAP_WIDTH_EMU, MAX_MAP_HEIGHT_EMU);

  blocks.push(
    PAGE_BREAK +
    heading(`נספח ${letter}: מפת אנטנות סלולריות באזור הנכס הנבדק`) +
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
    inlineImageRun({
      relationshipId: relId,
      cx, cy,
      docPrId: DOC_PR_BASE + 1,
      name: 'antenna-map.png',
      description: 'מפת אנטנות סלולריות ברדיוס ' + searchResult.radius + ' מ\'',
    }) +
    `</w:p>`,
  );

  // Caption under the map
  const activeCount = searchResult.groups.filter((g) => g.status === 'active').length;
  const plannedCount = searchResult.groups.filter((g) => g.status === 'planned').length;
  let caption: string;
  if (searchResult.groups.length === 0) {
    caption = `לא נמצאו אתרי אנטנות ברדיוס ${searchResult.radius.toLocaleString('he-IL')} מ' מנקודת הבדיקה.`;
  } else {
    caption = `נמצאו ${activeCount} אתרי אנטנות פעילים`;
    if (plannedCount > 0) caption += ` ו-${plannedCount} אתרים בהקמה`;
    caption += ` ברדיוס ${searchResult.radius.toLocaleString('he-IL')} מ' מנקודת הבדיקה.`;
  }
  blocks.push(textParagraph(caption, 20));
  blocks.push(textParagraph(
    'מקור: מאגר האנטנות הסלולריות הפעילות של המשרד להגנת הסביבה (data.gov.il). המרחקים בקו אווירי.',
    18,
  ));

  // ── Page 2: Detailed table ─────────────────────────────────────────
  const nextLetter = nextHebrewLetter(letter);
  blocks.push(
    PAGE_BREAK +
    heading(`נספח ${nextLetter}: פירוט אתרי אנטנות סלולריים באזור הנכס`) +
    subheading(`${searchResult.totalRecords} משדרים ב-${searchResult.groups.length} אתרים — מרחק עד ${searchResult.radius.toLocaleString('he-IL')} מ'`) +
    '<w:p/>' +
    buildAntennaTable(searchResult.groups),
  );

  return blocks.join('');
}

/** Advances a Hebrew appendix letter by one: ז' → ח', ט' → י'. */
function nextHebrewLetter(letter: string): string {
  const letters = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ז'", "ח'", "ט'", "י'",
    "יא'", "יב'", "יג'", "יד'", "טו'", "טז'", "יז'", "יח'", "יט'", "כ'"];
  const idx = letters.indexOf(letter);
  return idx >= 0 && idx < letters.length - 1 ? letters[idx + 1] : letter;
}
