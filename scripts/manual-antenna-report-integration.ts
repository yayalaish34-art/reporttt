/**
 * Manual end-to-end check for the automatically required antenna appendix.
 *
 * This intentionally does not belong to `npm test`: it calls Nominatim,
 * data.gov.il and OpenStreetMap, then launches a locally installed Chromium.
 *
 * Run from the project root:
 *   npx tsx scripts/manual-antenna-report-integration.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PizZip from 'pizzip';
import { textOf } from '../src/lib/docx/ooxml';
import { generateReport } from '../src/lib/report-service';
import { ReportSchema } from '../src/lib/report-schema';
import { sampleReport } from '../src/lib/sample-report';

const outputPath = resolve('out/manual-antenna-auto-report.docx');

const report = ReportSchema.parse({
  ...sampleReport(),
  antennaMapEnabled: false,
  fieldSource: 'אנטנות',
  antennaMapAddress: 'דרך בירם 37',
  antennaMapCity: 'חיפה',
  // Stable ITM point for the visual integration run. Avoids making the test
  // depend on Nominatim accepting the same Hebrew spelling on every run.
  antennaMapX: 199157.63,
  antennaMapY: 745872.15,
  antennaMapRadius: 500,
  antennaMapLabel: 'נקודת בדיקת האינטגרציה',
});

console.log(
  `מפיק דוח לכתובת ${report.antennaMapAddress}, ${report.antennaMapCity} ` +
    `כאשר antennaMapEnabled=false ומקור השדה=אנטנות…`,
);

const { bytes, fileName, durationMs } = await generateReport(report);
const zip = new PizZip(bytes);
const renderedMap = zip.file('word/media/antenna-map.png')?.asNodeBuffer();
const documentXml = zip.file('word/document.xml')?.asText() ?? '';
const bodyText = textOf(documentXml);
const paragraphs = documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
const paragraphTexts = paragraphs.map(textOf);
const antennaAppendixHeadings = paragraphTexts.filter(
  (text) => text.startsWith('נספח ') && text.includes('אנטנות'),
);

const tableXmlParts = documentXml.match(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g) ?? [];
const antennaHeaders = [
  '#',
  'חברה',
  'כתובת',
  "מרחק (מ')",
  'סוג אתר',
  'דורות',
  'עוצמה µW/cm²',
  '% מסף',
  'היתר קרינה',
  'היתר הקמה',
  'היתר הפעלה',
  'בדיקה אחרונה',
  'סטטוס',
];
const antennaTableXml = tableXmlParts.find((tableXml) => {
  const tableText = textOf(tableXml);
  return antennaHeaders.every((header) => tableText.includes(header));
});

let failures = 0;
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

console.log('\nבדיקות:');
check(documentXml.length > 0, 'word/document.xml קיים');
check(Boolean(renderedMap), 'תמונת מפת האנטנות הוטמעה במסמך');
check(
  antennaAppendixHeadings.length === 2,
  'הופקו שתי כותרות נספח אנטנות',
  antennaAppendixHeadings.join(' | ') || 'לא נמצאו כותרות',
);
check(
  antennaAppendixHeadings.some((heading) => heading.includes('מפת אנטנות סלולריות')),
  'קיימת כותרת נספח המפה',
);
check(
  antennaAppendixHeadings.some((heading) => heading.includes('פירוט אתרי אנטנות')),
  'קיימת כותרת נספח הפירוט',
);
check(Boolean(antennaTableXml), 'קיימת טבלת האנטנות עם כל 13 הכותרות');

const summaryMatch = bodyText.match(/(\d+) משדרים ב-(\d+) אתרים/);
const renderedDataRows = antennaTableXml
  ? Math.max(0, (antennaTableXml.match(/<w:tr(?:\s[^>]*)?>/g) ?? []).length - 1)
  : 0;
const expectedDataRows = summaryMatch ? Number(summaryMatch[1]) : -1;

check(Boolean(summaryMatch), 'נמצאה שורת סיכום של משדרים ואתרים');
check(expectedDataRows > 0, 'נמצא לפחות משדר אחד ברדיוס', String(expectedDataRows));
check(
  expectedDataRows === renderedDataRows,
  'כל המשדרים משורת הסיכום מופיעים כשורות בטבלה',
  `סיכום=${expectedDataRows}, שורות=${renderedDataRows}`,
);

mkdirSync(resolve('out'), { recursive: true });
writeFileSync(outputPath, bytes);
if (renderedMap) writeFileSync(resolve('out/manual-antenna-map.png'), renderedMap);

if (failures > 0) {
  console.error(`\n✗ ${failures} בדיקות נכשלו. קובץ הפלט נשמר לבדיקה: ${outputPath}`);
  process.exit(1);
}

console.log(
  `\n✓ בדיקת האינטגרציה עברה — ${fileName}, ${bytes.length.toLocaleString('he-IL')} בייט, ` +
    `${durationMs.toFixed(0)}ms\nקובץ לבדיקה חזותית: ${outputPath}`,
);
