/**
 * Smoke test for the IAQ report's radiation-style photograph appendix.
 *
 * Uses four newly-created images so the test proves that the old customer's
 * photographs are replaced, numbered in order, and rendered one large image
 * per page below a large RTL heading.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PizZip from 'pizzip';
import sharp from 'sharp';
import { buildIaqPhotosXml } from '../src/lib/docx/iaq-photos';
import { mergeDocx } from '../src/lib/docx/merge-docx';
import type { PhotoInput } from '../src/lib/docx/photos';
import { activeTemplateBytes } from '../src/lib/docx/template-store';
import { buildIaqMergeData } from '../src/lib/iaq-mapper';
import { IaqReportSchema } from '../src/lib/iaq-schema';

const report = IaqReportSchema.parse({
  referenceNumber: '2610110002',
  recipientName: 'בדיקת תמונות',
  address: 'רחוב לדוגמה 2',
  city: 'חולון',
  surveyDate: '11/10/2026',
  locations: [{ id: 'a', name: 'סלון' }],
  results: { a: { co2: 700, temperature: 24, humidity: 50 } },
});

const colors = [
  { r: 78, g: 121, b: 167 },
  { r: 89, g: 161, b: 79 },
  { r: 242, g: 142, b: 43 },
  { r: 225, g: 87, b: 89 },
];
const photos: PhotoInput[] = await Promise.all(
  colors.map(async (background, index) => ({
    bytes: await sharp({
      create: { width: 900, height: 600, channels: 3, background },
    })
      .png()
      .toBuffer(),
    contentType: 'image/png',
    width: 900,
    height: 600,
    caption: `אזור בדיקה ${index + 1}`,
  })),
);

const zip = new PizZip(activeTemplateBytes('iaq'));
const photosXml = buildIaqPhotosXml(zip, photos);
const withPhotos = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
const bytes = mergeDocx(withPhotos, { ...buildIaqMergeData(report), photosXml });
const output = new PizZip(bytes);
const documentXml = output.file('word/document.xml')?.asText() ?? '';
const media = Object.keys(output.files).filter((name) => /word\/media\/report-photo-\d+\.png$/.test(name));

if (media.length !== 4) throw new Error(`נמצאו ${media.length} תמונות במקום 4`);
if (/\{@?photosXml\}/.test(documentXml)) throw new Error('תג התמונות לא הוחלף');
if (photosXml.includes('<w:tbl>')) throw new Error('התמונות עדיין מסודרות ברשת במקום בעמוד נפרד');

const pageBreaks = photosXml.match(/<w:br w:type="page"\/>/g)?.length ?? 0;
if (pageBreaks !== 4) {
  throw new Error(`נמצאו ${pageBreaks} מעברי עמוד במקום מעבר לפני כל אחת מ-4 התמונות`);
}

const expectedCaptionStyle =
  '<w:bidi/><w:jc w:val="center"/><w:spacing w:after="160"/>';
if (!photosXml.includes(expectedCaptionStyle)) {
  throw new Error('כותרת התמונה אינה ממורכזת או אינה מוגדרת מימין לשמאל');
}
if (!photosXml.includes('<w:rFonts w:ascii="David" w:hAnsi="David" w:cs="David"/>')) {
  throw new Error('כותרת התמונה אינה בגופן David');
}
if (!photosXml.includes('<w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/><w:rtl/>')) {
  throw new Error('כותרת התמונה אינה מודגשת בגודל 14pt ובכיוון RTL');
}
if (!photosXml.includes('<wp:extent cx="5486400" cy="3657600"/>')) {
  throw new Error('התמונה אינה מנצלת את רוחב עמוד הנספח כמו בדוח הקרינה');
}

for (let index = 1; index <= 4; index += 1) {
  const caption = `תמונה מס&apos; ${index} : אזור בדיקה ${index}`;
  const captionAt = photosXml.indexOf(caption);
  if (captionAt < 0 || !documentXml.includes(caption)) {
    throw new Error(`המספור או הכיתוב של תמונה ${index} חסר`);
  }
  const imageAt = photosXml.indexOf(`name="Photo ${index}"`);
  if (imageAt < 0 || captionAt > imageAt) {
    throw new Error(`הכותרת של תמונה ${index} אינה מופיעה מעל התמונה`);
  }
}

mkdirSync(resolve('out'), { recursive: true });
writeFileSync(resolve('out/smoke-iaq-photos.docx'), bytes);
console.log(`✓ IAQ photo smoke עובר — ${media.length} תמונות, ${bytes.length} בייטים`);
