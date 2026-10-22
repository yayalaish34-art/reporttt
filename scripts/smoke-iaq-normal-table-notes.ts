/**
 * Result conclusions remain below their tables, including a normal conclusion.
 * Global recommendations, however, belong only in the main recommendations
 * chapter and must not be repeated in the source document's old TVOC block. The
 * assertion renders through the active database template, exercising the
 * production compatibility rewrite as well.
 */
import PizZip from 'pizzip';
import { buildIaqMergeData } from '../src/lib/iaq-mapper';
import { concludeMeasurement } from '../src/lib/iaq-rules';
import { IaqReportSchema, type IaqReport } from '../src/lib/iaq-schema';
import { generateIaqReport, iaqDocumentText } from '../src/lib/iaq-service';
import { textOf } from '../src/lib/docx/ooxml';

const recommendationMarker = 'המלצת-עשן-ייחודית-לטבלת-TVOC';

function reportWith(tvoc: number, humidity: number): IaqReport {
  return IaqReportSchema.parse({
    referenceNumber: 'NORMAL-TABLE-NOTES',
    reportDate: '14/10/2026',
    recipientName: 'לקוח בדיקת הערות',
    address: 'רחוב הבדיקה 1',
    city: 'חולון',
    surveyDate: '14/10/2026',
    surveyTime: '10:00',
    requestDate: '14/10/2026',
    weather: 'בהיר',
    presentAt: 'נציג הלקוח',
    siteCharacter: 'משרד',
    reason: 'בדיקת עשן להערות שמתחת לטבלאות',
    airConditioning: 'מזגן עילי',
    calibrationGraywolf: '01.01.2027',
    calibrationFormaldehyde: '01.01.2027',
    locations: [{ id: 'room', name: 'חדר ישיבות' }],
    results: { room: { co2: 800, tvoc, humidity } },
    summaryText: 'תקציר בדיקת הערות',
    recommendations: recommendationMarker,
    photos: [],
  });
}

function occurrences(text: string, value: string): number {
  if (!value) return 0;
  return text.split(value).length - 1;
}

function exactParagraphCount(bytes: Buffer, value: string): number {
  const xml = new PizZip(bytes).file('word/document.xml')?.asText() ?? '';
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs.filter(
    (paragraph) => textOf(paragraph).replace(/\s+/g, ' ').trim() === value,
  ).length;
}

let failed = 0;
function check(ok: boolean, message: string): void {
  if (ok) return;
  console.error(`❌ ${message}`);
  failed++;
}

const normalTvoc = reportWith(0.05, 70);
const normalData = buildIaqMergeData(normalTvoc) as Record<string, unknown>;
const normalCo2Text = concludeMeasurement(normalTvoc, 'co2').text;
const normalTvocText = concludeMeasurement(normalTvoc, 'tvoc').text;
const exceededHumidityText = concludeMeasurement(normalTvoc, 'humidity').text;

check(
  normalData.co2Conclusion === normalCo2Text,
  'מסקנת CO₂ תקינה הוסרה מהפסקה שמתחת לטבלה',
);
check(
  normalData.tvocConclusion === normalTvocText,
  'מסקנת TVOC תקינה הוסרה מהפסקה שמתחת לטבלה',
);
check(
  normalData.humidityConclusion === exceededHumidityText,
  'טקסט החריגה של הלחות לא נשמר מתחת לטבלה',
);

const normalDocx = await generateIaqReport(normalTvoc);
const normalText = iaqDocumentText(normalDocx.bytes);
check(
  occurrences(normalText, normalCo2Text) === 2,
  'מסקנת CO₂ תקינה אינה מופיעה בפרק המסקנות וגם מתחת לטבלה',
);
check(
  occurrences(normalText, normalTvocText) === 2,
  'מסקנת TVOC תקינה אינה מופיעה בפרק המסקנות וגם מתחת לטבלה',
);
check(
  occurrences(normalText, exceededHumidityText) === 2,
  'טקסט חריגת הלחות לא מופיע בפרק המסקנות וגם מתחת לטבלה החריגה',
);
check(
  occurrences(normalText, recommendationMarker) === 1,
  'המלצות הסיום הודפסו גם מתחת לטבלת TVOC תקינה',
);
check(
  exactParagraphCount(normalDocx.bytes, 'המלצות') === 1,
  'כותרת המלצות ריקה נשארה מתחת לטבלת TVOC תקינה',
);

const exceededTvoc = reportWith(2, 50);
const exceededTvocText = concludeMeasurement(exceededTvoc, 'tvoc').text;
const exceededDocx = await generateIaqReport(exceededTvoc);
const exceededText = iaqDocumentText(exceededDocx.bytes);
check(
  occurrences(exceededText, exceededTvocText) === 2,
  'מסקנת חריגת TVOC אינה מופיעה בפרק המסקנות וגם מתחת לטבלה',
);
check(
  occurrences(exceededText, recommendationMarker) === 1,
  'המלצות הסיום הגלובליות שוכפלו מתחת לטבלת TVOC חריגה',
);
check(
  exactParagraphCount(exceededDocx.bytes, 'המלצות') === 1,
  'בלוק המלצות נוסף נשאר מתחת לטבלת TVOC חריגה',
);

if (failed > 0) {
  console.error(`${failed} בדיקות הערות מתחת לטבלאות IAQ נכשלו`);
  process.exit(1);
}

console.log(
  `✓ IAQ table recommendations smoke עובר — מסקנות נשמרות והמלצות מופיעות רק בפרק המרכזי (${normalDocx.bytes.length} bytes)`,
);
