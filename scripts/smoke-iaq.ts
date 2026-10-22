/**
 * סמוק: מרנדר דוח IAQ עם 2 נקודות ומדידות דגימה, מוודא שה-tags נפתרים
 * ושהערכים ממש מופיעים ב-DOCX המוכן.
 */
import { generateIaqReport, iaqDocumentText } from '../src/lib/iaq-service';
import { IaqReportSchema } from '../src/lib/iaq-schema';
import { summaryConclusions } from '../src/lib/iaq-rules';
import { textOf } from '../src/lib/docx/ooxml';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PizZip from 'pizzip';

const report = IaqReportSchema.parse({
  referenceNumber: '2610110001',
  reportDate: '14/10/2026',
  customerType: 'private',
  recipientName: 'דגימה לבדיקה',
  contactPhone: '050-0000000',
  address: 'הרצל 1',
  city: 'תל אביב',
  surveyDate: '11/10/2026',
  surveyTime: '10:00-11:30',
  requestDate: '09/10/2026',
  weather: 'סתיו, נעים',
  presentAt: 'הבדיקה בוצעה בנוכחות הדייר',
  siteCharacter: 'דירת 3 חדרים בקומה 2',
  reason: 'דיווח על ריח חריג מהמטבח',
  airConditioning: 'מזגן מרכזי',
  calibrationGraywolf: '11.07.2027',
  calibrationFormaldehyde: '09.12.2027',
  locations: [
    { id: 'a', name: 'סלון' },
    { id: 'b', name: 'חדר שינה' },
  ],
  results: {
    a: {
      co2: 820,
      co: 2.1,
      no2: 0,
      so2: 0,
      ozone: 0,
      tvoc: 0.09,
      formaldehyde: 0.02,
      pm25: 10,
      tpm: 100,
      temperature: 25.3,
      humidity: 65,
    },
    b: { co2: 650, co: null, no2: null, so2: null, tvoc: null, formaldehyde: null, temperature: 24.1, humidity: 52 },
  },
  summaryText: '',
  recommendations: 'לאוורר את המטבח ולהוציא חומרי ניקוי לאזור מוסך.',
  photos: [],
});

const { bytes, fileName } = await generateIaqReport(report);
mkdirSync(resolve('out'), { recursive: true });
writeFileSync(resolve('out/smoke-iaq.docx'), bytes);
const text = iaqDocumentText(bytes);
const documentXml = new PizZip(bytes).file('word/document.xml')?.asText() ?? '';

/* הדפסה של מפת בדיקות — חייב שיופיעו, אסור שיופיעו, ושהערכים האמיתיים נדפסים */
const must = [
  'דגימה לבדיקה',               // שם הלקוח
  'הרצל 1, תל אביב',              // כתובת מלאה
  '2610110001',                   // סימוכין
  '14 באוקטובר 2026',            // תאריך הדוח בשער — לא תאריך הבדיקה
  'מדידות פחמן דו-חמצני (CO2)', // הכותרת המקורית נשמרת מהדוח של גלית
  'סלון',                        // שם נקודה
  'חדר שינה',                    // שם נקודה שנייה
  '820',                          // ערך CO₂
  '650',                          // ערך CO₂
  '25.3',                         // ערך טמפ'
  'גבוהה מהמומלץ',              // מסקנת לחות (אוטומטית)
];
const forbidden = [
  'אלה ניאזוב',                  // אסור שפרטי דוח המקור יזלגו לדוח החדש
  "שנקר 24 א'",
  '052-6791368',
  '422',                         // ערך הדוגמה בטבלת המקור
  '{',                            // סוגריים מסולסלים = tag שלא נפתר
];

let failed = 0;
for (const m of must) {
  if (!text.includes(m)) { console.error(`❌ חסר: "${m}"`); failed++; }
}
for (const f of forbidden) {
  if (text.includes(f)) { console.error(`❌ מופיע ולא צריך: "${f}"`); failed++; }
}

const paragraphs = documentXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
for (const conclusion of summaryConclusions(report)) {
  const paragraph = paragraphs.find((candidate) => textOf(candidate).includes(conclusion));
  if (!paragraph) {
    console.error(`❌ פסקת מסקנה חסרה: "${conclusion.slice(0, 45)}…"`);
    failed++;
    continue;
  }
  const correctlyStyled =
    /<w:bidi\b/.test(paragraph) &&
    /<w:numId w:val="2"\/>/.test(paragraph) &&
    /<w:rFonts[^>]*w:cs="David"/.test(paragraph) &&
    /<w:sz w:val="28"\/>/.test(paragraph) &&
    /<w:szCs w:val="28"\/>/.test(paragraph);
  if (!correctlyStyled) {
    console.error(`❌ עיצוב מסקנה אינו RTL / David 14: "${conclusion.slice(0, 45)}…"`);
    failed++;
  }
}

if (failed === 0) {
  console.log(`✓ IAQ smoke עובר — DOCX ${bytes.length} בייטים, ${fileName}`);
} else {
  console.error(`${failed} בדיקות נכשלו`);
  process.exit(1);
}
