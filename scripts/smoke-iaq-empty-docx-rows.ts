/**
 * שורות ברירת-המחדל של עורך IAQ נשארות בטיוטה. רק נקודות שבהן הוזן שם או
 * ערך מספרי כלשהו רשאיות להגיע לנתוני המיזוג, ובכל טבלת מדד יודפסו רק
 * הנקודות שבהן אותו מדד אכן נמדד.
 */
import PizZip from 'pizzip';
import { buildIaqMergeData } from '../src/lib/iaq-mapper';
import { IaqReportSchema } from '../src/lib/iaq-schema';
import { generateIaqReport } from '../src/lib/iaq-service';
import { textOf } from '../src/lib/docx/ooxml';

const report = IaqReportSchema.parse({
  referenceNumber: 'EMPTY-ROWS-TEST',
  reportDate: '14/10/2026',
  recipientName: 'לקוח בדיקה',
  address: 'רחוב הבדיקה 1',
  city: 'חולון',
  surveyDate: '14/10/2026',
  surveyTime: '10:00',
  requestDate: '14/10/2026',
  weather: 'בהיר',
  presentAt: 'נציג הלקוח',
  siteCharacter: 'משרד',
  reason: 'בדיקת עשן לסינון שורות',
  airConditioning: 'מזגן עילי',
  calibrationGraywolf: '01.01.2027',
  calibrationFormaldehyde: '01.01.2027',
  locations: [
    { id: 'blank-before', name: '   ' },
    { id: 'measured', name: 'חדר ישיבות' },
    { id: 'blank-with-object', name: '' },
    { id: 'named-only', name: 'מחסן שטרם נמדד' },
    { id: 'unnamed-measured', name: '' },
  ],
  results: {
    // הסכמה מרחיבה אובייקטים ריקים לכל המדדים עם null. עצם קיומם במפה
    // אסור שתהפוך את נקודת ברירת-המחדל לשורה בדוח.
    'blank-before': {},
    measured: { co2: 777, temperature: 24.5 },
    'blank-with-object': {},
    'named-only': {},
    'unnamed-measured': { co2: 666 },
  },
  summaryText: 'תקציר בדיקה',
  recommendations: 'המלצת בדיקה',
  photos: [],
});

const data = buildIaqMergeData(report) as {
  locations: Array<{ index: number; name: string }>;
  locationsText: string;
  locationCount: number;
  co2Rows: Array<{ index: number; location: string; value: string }>;
  temperatureRows: Array<{ index: number; location: string; value: string }>;
  coRows: Array<{ index: number; location: string; value: string }>;
};

let failed = 0;
function check(ok: boolean, message: string): void {
  if (ok) return;
  console.error(`❌ ${message}`);
  failed++;
}

check(data.locationCount === 3, `נספרו ${data.locationCount} נקודות במקום 3`);
check(
  data.locations.map((location) => location.name).join('|') ===
    'חדר ישיבות|מחסן שטרם נמדד|—',
  'רשימת הנקודות כוללת שורה ריקה או חסרה נקודה עם נתון',
);
check(!data.locationsText.includes('1. —'), 'שורת ברירת-מחדל ריקה הודפסה כנקודה הראשונה');
check(data.co2Rows.length === 2, `בטבלת CO₂ נמצאו ${data.co2Rows.length} שורות במקום 2`);
check(
  data.co2Rows.map((row) => `${row.index}:${row.location}:${row.value}`).join('|') ===
    '1:חדר ישיבות:777|3:—:666',
  'טבלת CO₂ אינה מסננת ערכים ריקים או שמספור הנקודות השתבש',
);
check(
  data.temperatureRows.length === 1 && data.temperatureRows[0]?.value === '24.5',
  'טבלת הטמפרטורה כוללת נקודה שבה הטמפרטורה לא נמדדה',
);
check(data.coRows.length === 0, 'טבלת CO כוללת שורות אף שלא הוזנה אף מדידת CO');

// בדיקת קצה-לקצה: אותם נתוני מיזוג נכנסים בפועל ל-DOCX.
const { bytes } = await generateIaqReport(report);
const documentXml = new PizZip(bytes).file('word/document.xml')?.asText() ?? '';
const tables = documentXml.match(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g) ?? [];
const co2Table = tables.find((table) => {
  const text = textOf(table);
  return text.includes('777') && text.includes('666');
});
check(Boolean(co2Table), 'טבלת CO₂ עם שתי המדידות לא נמצאה ב-DOCX');
if (co2Table) {
  const rows = co2Table.match(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g) ?? [];
  check(rows.length === 3, `ב-DOCX יש ${rows.length} שורות בטבלת CO₂ במקום כותרת + 2 מדידות`);
}

if (failed > 0) {
  console.error(`${failed} בדיקות סינון IAQ נכשלו`);
  process.exit(1);
}

console.log(`✓ IAQ empty DOCX rows smoke עובר — ${bytes.length} bytes, 2 שורות CO₂ מתוך 5 שורות עורך`);
