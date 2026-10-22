import { z } from 'zod';

/**
 * דוח בדיקת איכות אוויר תוך-מבנית — הסכמה.
 *
 * מחלקה חמישית: עד 10 נקודות דיגום, מודדים ל-8 פרמטרים (CO₂, CO, NO₂, SO₂,
 * TVOC, פורמלדהיד, טמפרטורה, לחות יחסית). כל מדידה נקודתית ואופציונלית — ה-בודק
 * יכול להשאיר ריק מדידות שלא לקח. המסקנות נגזרות ממש כאן בצד הלקוח/שרת לפי
 * ספים, בלי ניסוח AI.
 */

/** מפתחי המדידות — נקבעים פעם אחת כאן ומוזרמים לכל המקומות. */
export const MEASUREMENT_KEYS = [
  'co2',
  'co',
  'o2',
  'h2s',
  'no2',
  'so2',
  'ozone',
  'tvoc',
  'formaldehyde',
  'pm25',
  'pm10',
  'tpm',
  'temperature',
  'humidity',
] as const;

export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number];

/** תוויות בעברית למסך ולטבלאות של כל פרמטר. */
export const MEASUREMENT_LABELS: Record<MeasurementKey, string> = {
  co2: 'פחמן דו-חמצני (CO₂)',
  co: 'פחמן חד-חמצני (CO)',
  o2: 'חמצן (O₂)',
  h2s: 'מימן גופרתי (H₂S)',
  no2: 'חנקן דו-חמצני (NO₂)',
  so2: 'גופרית דו-חמצנית (SO₂)',
  ozone: 'אוזון (O₃)',
  tvoc: 'תרכובות אורגניות נדיפות (TVOC)',
  formaldehyde: 'פורמלדהיד',
  pm25: 'חלקיקים עדינים (PM2.5)',
  pm10: 'חלקיקים נשימים (PM10)',
  tpm: 'חלקיקים כוללים (TPM)',
  temperature: 'טמפרטורה',
  humidity: 'לחות יחסית',
};

/** יחידת מידה לכל פרמטר, כפי שתירשם בכותרת העמודה בטבלת התוצאות. */
export const MEASUREMENT_UNITS: Record<MeasurementKey, string> = {
  co2: 'ppm (חל"מ)',
  co: 'ppm (חל"מ)',
  o2: '%',
  h2s: 'ppm (חל"מ)',
  no2: 'ppm (חל"מ)',
  so2: 'ppm (חל"מ)',
  ozone: 'ppm (חל"מ)',
  tvoc: 'ppm (חל"מ)',
  formaldehyde: 'ppm (חל"מ)',
  pm25: 'µg/m³',
  pm10: 'µg/m³',
  tpm: 'µg/m³',
  temperature: '°C',
  humidity: '%',
};

/** נקודת דיגום. השם הוא טקסט חופשי — "בארונית מתחת לכיור", "סלון מתחת למזגן" וכד'. */
export const IaqLocationSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
});
export type IaqLocation = z.infer<typeof IaqLocationSchema>;

/** ערך מדידה בודד בנקודה. null = לא נמדד. */
const measurementValue = z.number().finite().nullable();

/** מפת ערכים לכל נקודה: location.id → MeasurementKey → number|null. */
export const IaqResultsSchema = z.record(
  z.string(),
  z.object({
    co2: measurementValue.default(null),
    co: measurementValue.default(null),
    o2: measurementValue.default(null),
    h2s: measurementValue.default(null),
    no2: measurementValue.default(null),
    so2: measurementValue.default(null),
    ozone: measurementValue.default(null),
    tvoc: measurementValue.default(null),
    formaldehyde: measurementValue.default(null),
    pm25: measurementValue.default(null),
    pm10: measurementValue.default(null),
    tpm: measurementValue.default(null),
    temperature: measurementValue.default(null),
    humidity: measurementValue.default(null),
  }),
);
export type IaqResults = z.infer<typeof IaqResultsSchema>;

/** תמונה בנספח — ממש כמו בעובש/אסבסט. */
export const IaqPhotoSchema = z.object({
  imageId: z.string().min(1),
  caption: z.string().default(''),
});
export type IaqPhoto = z.infer<typeof IaqPhotoSchema>;

/**
 * הדוח המלא. שומר כ-JSON בעמודת `data` של `iaq_reports`.
 *
 * שדות שאפשר להשאיר ריקים בטיוטה (לפני סיום) — `DraftIaqReportSchema` למטה.
 */
export const IaqReportSchema = z.object({
  referenceNumber: z.string().min(1),

  /* תאריך ההנפקה שממנו נגזרות כותרות כל העמודים. */
  reportDate: z.string().default(''),

  /* קישור חזרה ל-CRM — יתויק אוטומטית בכרטיס הלקוח בסיום, כמו שאר הדוחות. */
  customerId: z.string().default(''),

  /* מקור הנתונים — נשמר כדי שיהיה ברור איזו הצעת מחיר מילאה את הדוח. */
  sourceQuoteId: z.string().default(''),
  sourceQuoteNumber: z.string().default(''),

  /* מזמין ומבצע */
  customerType: z.enum(['company', 'private']).default('private'),
  companyName: z.string().default(''),
  recipientName: z.string().default(''),
  clientName: z.string().default(''),
  contactPhone: z.string().default(''),
  contactEmail: z.string().default(''),
  address: z.string().default(''),
  city: z.string().default(''),

  /* פרטי הבדיקה */
  surveyDate: z.string().default(''),   // 19/08/2026
  surveyTime: z.string().default(''),   // 17:00-18:30
  requestDate: z.string().default(''),  // 12/08/2026
  weather: z.string().default(''),      // "קיץ, חם ובהיר"
  presentAt: z.string().default(''),    // "הבדיקה בוצעה בנוכחות ..."
  siteCharacter: z.string().default(''),// תיאור קצר של המקום
  reason: z.string().default(''),       // סיבת הזימון
  airConditioning: z.string().default(''),  // תיאור מערכות המיזוג

  /* מבצע הבדיקה */
  authorName: z.string().default('ד"ר אביחי מוכתר'),
  authorTitle: z.string().default('ד"ר (Ph.D.) למדעי החיים ומומחה לאיכות סביבה'),
  authorPhone: z.string().default('054-4274143'),
  authorEmail: z.string().default('avihay@galit.co.il'),

  /* תאריכי כיול של המכשירים (נדפסים ב"שיטת הבדיקה") */
  calibrationGraywolf: z.string().default(''),   // "11.07.2027" ל-DSII-8
  calibrationFormaldehyde: z.string().default(''), // "09.12.2027" ל-FM-801

  /* נקודות דיגום ותוצאות */
  locations: z.array(IaqLocationSchema).max(20).default([]),
  results: IaqResultsSchema.default({}),

  /* ניסוחים חופשיים — יש הצעה אוטומטית אבל ניתנים לעריכה */
  summaryText: z.string().default(''),        // תקציר (פתיח)
  recommendations: z.string().default(''),    // המלצות סיום

  /* נספח תמונות */
  photos: z.array(IaqPhotoSchema).default([]),
});
export type IaqReport = z.infer<typeof IaqReportSchema>;

/**
 * הגרסה הרופפת של הדוח — אוטו-שמירה בכל צעד.
 *
 * כל השדות אופציונליים, מלבד ה-id הפנימיים (מכיוון שהוא נוצר ב-blank).
 */
export const DraftIaqReportSchema = IaqReportSchema.partial().extend({
  referenceNumber: z.string().default(''),
  locations: z.array(IaqLocationSchema).default([]),
  results: IaqResultsSchema.default({}),
  photos: z.array(IaqPhotoSchema).default([]),
});
export type DraftIaqReport = z.infer<typeof DraftIaqReportSchema>;

/** דוח ריק בעת פתיחה. ה-reference מוחלף ע"י ה-service לפני השמירה. */
export function blankIaqReport(reference = ''): IaqReport {
  return IaqReportSchema.parse({
    referenceNumber: reference,
    locations: [],
    results: {},
    photos: [],
  });
}

/** פרסינג מחמיר להפקה — נזרקת שגיאה אם חסר שדה חובה. */
export function parseIssuableIaqReport(raw: unknown): IaqReport {
  return IaqReportSchema.parse(raw);
}
