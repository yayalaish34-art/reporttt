import { ReportSchema, type Report } from './report-schema';
import { todayIso } from './hebrew-date';

/**
 * A realistic report, taken from the survey the template was built from.
 *
 * Used by the smoke test and as the "load example" action in the app. Real
 * values matter here: RTL text mixed with numbers and units is exactly where
 * a template renders correctly against "test" and wrongly against the truth.
 */
export function sampleReport(): Report {
  return ReportSchema.parse({
    referenceNumber: '2126062303',
    reportDate: todayIso(),

    customerType: 'company',
    recipientName: 'ירון חכם',
    recipientTitle: 'רמ"ד אחזקה ובינוי',
    companyName: 'כרטיסי אשראי לישראל בע"מ',
    addressLine: 'תפוצות ישראל 13',
    city: 'גבעתיים',
    phone: '052-2857557',
    email: 'yaron.haham@icc.co.il',

    // The subject and opening sentence are left on automatic, so they are
    // composed from the scope and the site name at merge time.
    surveyScope: 'both',
    siteName: 'משרדי חברת כ.א.ל, מוקד בני ברק',

    requesterName: 'ירון חכם',

    measurementDate: '21/06/26',
    measurementDateTime: '21/06/26, 11:00',
    location: 'מצדה 3, בני ברק',
    siteCharacter: 'משרדים',
    weather: 'קיצי בהיר',
    fieldSource: 'לוח חשמל',
    measurementType: 'מדידות שדה מגנטי',

    // Signature ids are filled in by `seed-report-signatures.ts`, which matches
    // each person to their signature in the library.
    inspectors: [
      { name: 'יורם גבאי', title: 'בודק קרינה', permitType: 'ELF', permitNumber: '2031-01-4', permitValidity: '27/3/29' },
      { name: 'יורם גבאי', title: 'בודק קרינה', permitType: 'RF', permitNumber: '2031-01-5', permitValidity: '27/3/29' },
    ],

    authors: [
      { name: 'יורם גבאי', role: 'עורך הדו"ח' },
      { name: 'יורם גבאי', role: 'מאשר הדו"ח' },
    ],

    elfInstrument: {
      modelLine: 'Electromagnetic field strength meter: AARONIA AG MODEL NUMBER : SPECTRAN NF-3020',
      serialLine: 'S.N: 37401',
      frequencyRangeEn: 'Frequency range : 30 -2000 HZ',
      frequencyRangeHe: 'טווח תדירות: 30–2000 Hz',
      sensitivity: 'רגישות: שדה מגנטי – 0.01 mG–2G',
      calibrationValidity: '29.01.27',
    },

    rfInstrument: {
      modelLine: 'מכשיר מתוצרת LATNEX',
      descriptionLine: 'Professional High Frequency and RF meter',
      serialLine: 'model HF-B8G s/n 230500026',
      frequencyRangeEn: 'Frequency range 10MHz 8GHz',
      calibrationValidity: '04/08/26',
    },

    elfProtocols: [
      {
        title: 'פרוטוקול רשמי - מדידת שדה מגנטי ELF בקומה 26',
        referenceLabel: 'ללוח חשמל דרומי',
        normalizationFactor: '1',
        normalizationNote: 'מכיוון שהמדידות בוצעו בעומס אופייני נקבע נרמול לבדיקה על 1.',
        rows: [
          { description: 'חזית הלוח', distance: '0.3', height: '1', measured: '4.8', normalized: '4.8', occupancy: 'לא קבועה', compliance: 'לא חורג' },
          { description: 'חזית הלוח', distance: '0.5', height: '1', measured: '3.4', normalized: '3.4', occupancy: 'לא קבועה', compliance: 'לא חורג' },
          { description: 'חזית הלוח', distance: '1', height: '1', measured: '1.8', normalized: '1.8', occupancy: 'לא קבועה', compliance: 'לא חורג' },
          { description: 'עמדת ישיבה הקרובה מס\' 26-127', distance: '2', height: '1', measured: '0.36', normalized: '0.36', occupancy: 'קבועה', compliance: 'לא חורג' },
          { description: 'חדר תקשורת מאחורי הלוח', distance: '0.3', height: '1', measured: '11.5', normalized: '11.5', occupancy: 'לא קבועה', compliance: 'לא חורג, חשיפה רגעית' },
        ],
      },
      {
        title: 'פרוטוקול רשמי - מדידת שדה מגנטי ELF בקומה 26',
        referenceLabel: 'ללוח חשמל צפוני',
        normalizationFactor: '1',
        normalizationNote: 'מכיוון שהמדידות בוצעו בעומס אופייני נקבע נרמול לבדיקה על 1.',
        rows: [
          { description: 'חזית הלוח', distance: '0.3', height: '1', measured: '2', normalized: '2', occupancy: 'לא קבועה', compliance: 'לא חורג' },
          { description: 'חזית הלוח', distance: '0.5', height: '1', measured: '0.75', normalized: '0.75', occupancy: 'לא קבועה', compliance: 'לא חורג' },
          { description: 'חדר 2636 מאחורי הלוח', distance: '0.3', height: '1', measured: '0.86', normalized: '0.86', occupancy: 'קבועה', compliance: 'לא חורג' },
        ],
      },
      {
        title: 'פרוטוקול רשמי - מדידת שדה מגנטי ELF בקומה 1',
        referenceLabel: 'ללוח חשמל חדר אוכל',
        normalizationFactor: '1',
        normalizationNote: 'מכיוון שהמדידות בוצעו בעומס אופייני נקבע נרמול לבדיקה על 1.',
        rows: [
          { description: 'חזית הלוח', distance: '0.3', height: '1', measured: '12.4', normalized: '12.4', occupancy: 'לא קבועה', compliance: 'לא חורג, חשיפה רגעית' },
          { description: 'עמדת ישיבה הקרובה', distance: '1.5', height: '1', measured: '1.1', normalized: '1.1', occupancy: 'קבועה', compliance: 'לא חורג' },
          { description: 'מאחורי הלוח', distance: '0.3', height: '1', measured: '17', normalized: '17', occupancy: 'לא קבועה', compliance: 'לא חורג, חשיפה רגעית' },
        ],
      },
    ],

    rfProtocols: [
      {
        title: 'פרוטוקול רשמי - מדידת צפיפות הספק קרינה אלקטרומגנטית RF – קומה 26',
        referenceLabel: 'לארון תקשורת',
        rows: [
          { description: 'סמוך לארון', occupancy: 'רציף', measured: '0.16', threshold: '40', compliance: 'עומד', distance: '0.3', height: '1' },
          { description: 'סמוך לארון', occupancy: 'רציף', measured: '0.13', threshold: '40', compliance: 'עומד', distance: '0.5', height: '1' },
          { description: 'סמוך לארון', occupancy: 'רציף', measured: '0.11', threshold: '40', compliance: 'עומד', distance: '1', height: '1' },
        ],
      },
      {
        title: 'פרוטוקול רשמי - מדידת צפיפות הספק קרינה אלקטרומגנטית RF – קומה 25',
        referenceLabel: 'לארון תקשורת',
        rows: [
          { description: 'סמוך לארון', occupancy: 'רציף', measured: '0.2', threshold: '40', compliance: 'עומד', distance: '0.3', height: '1' },
          { description: 'סמוך לארון', occupancy: 'רציף', measured: '0.1', threshold: '40', compliance: 'עומד', distance: '1', height: '1' },
        ],
      },
    ],

    photos: [],
  });
}
