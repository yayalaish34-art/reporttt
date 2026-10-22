import {
  MEASUREMENT_KEYS,
  MEASUREMENT_LABELS,
  MEASUREMENT_UNITS,
  type IaqReport,
  type MeasurementKey,
} from './iaq-schema';
import {
  concludeMeasurement,
  hasMeasurement,
  iaqReportLocations,
  measurementValues,
  summaryConclusions,
} from './iaq-rules';
import { reportTitle } from './report-title';
import { hebrewCalendarDate, hebrewWeekday } from './hebrew-date';
import { escapeXml } from './docx/ooxml';

/**
 * ממיר דוח איכות אוויר תוך-מבנית לאובייקט שטוח ש-docxtemplater מרנדר.
 *
 * כל פרק מדידה נדפס רק אם יש בו מדידה. פרק ריק = כל הטבלה + הכותרת מתעלמות
 * דרך {#hasCo2}…{/hasCo2} בתבנית.
 */

/** עטיפה אחידה למספר שמופיע בטבלה — שומרת 3 ספרות אחרי הנקודה למדדים הקטנים. */
function fmtValue(value: number | null | undefined, key: MeasurementKey): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  // לטמפרטורה ולחות — 1 ספרה; למדדים הקטנים — 3; ל-CO2/CO/TVOC — ללא נקודה.
  if (key === 'temperature' || key === 'humidity') return value.toFixed(1);
  if (key === 'co2' || key === 'co') return value < 10 ? value.toFixed(1) : String(Math.round(value));
  return value < 1 ? value.toFixed(3) : value.toFixed(2);
}

/** בונה את מערך השורות של פרק מדידה אחד (עמודת מקום + עמודת ערך). */
function measurementRows(report: IaqReport, key: MeasurementKey) {
  return iaqReportLocations(report).flatMap((loc, index) => {
    const value = report.results[loc.id]?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return [];
    return [{
      index: index + 1,
      location: loc.name.trim() || '—',
      value: fmtValue(value, key),
    }];
  });
}

/** בלוק מידע לפרק מדידה אחד — כותרת, יחידה, שורות, מסקנה, ו-flag "יש נתונים". */
function measurementBlock(report: IaqReport, key: MeasurementKey) {
  const has = hasMeasurement(report, key);
  const conclusion = concludeMeasurement(report, key);
  const rows = has ? measurementRows(report, key) : [];
  return {
    key,
    label: MEASUREMENT_LABELS[key],
    unit: MEASUREMENT_UNITS[key],
    rows,
    conclusion: conclusion.text,
    exceeded: conclusion.exceeded,
    hasData: has,
  };
}

/** מספר הפרמטרים שנבדקו בפועל. */
function measuredCount(report: IaqReport): number {
  return MEASUREMENT_KEYS.filter((k) => hasMeasurement(report, k)).length;
}

/** נקודת זמן בטקסט פתיח — "19/08/2026". */
function readableDate(dateStr: string): string {
  return dateStr.trim() || '—';
}

/** Accepts the dotted/slashed dates used by the IAQ editor and ISO dates from old drafts. */
function parseIaqDate(value: string): Date | null {
  const text = value.trim();
  const local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (local) {
    const [, day, month, year] = local;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const [, year, month, day] = iso;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function fullGregorianDate(date: Date): string {
  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  }).format(date);
}

function conclusionsXml(lines: string[]): string {
  if (lines.length === 0) return '<w:p/>';
  return lines
    .map(
      (line) =>
        '<w:p><w:pPr><w:pStyle w:val="ae"/><w:bidi/>' +
        '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>' +
        '<w:spacing w:after="0" w:line="360" w:lineRule="auto"/>' +
        '<w:ind w:left="401" w:hanging="425"/><w:jc w:val="both"/>' +
        '<w:outlineLvl w:val="1"/><w:rPr>' +
        '<w:rFonts w:ascii="David" w:hAnsi="David" w:cs="David"/>' +
        '<w:sz w:val="28"/><w:szCs w:val="28"/><w:rtl/></w:rPr></w:pPr>' +
        '<w:r><w:rPr><w:rFonts w:ascii="David" w:hAnsi="David" w:cs="David"/>' +
        '<w:sz w:val="28"/><w:szCs w:val="28"/><w:rtl/></w:rPr>' +
        `<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
    )
    .join('');
}

/**
 * שם קובץ לדו"ח — "דוח איכות אוויר — <לקוח> — <סימוכין>.docx".
 */
export function iaqFileName(report: IaqReport): string {
  const title = reportTitle('iaq', report);
  const safe = title.replace(/[\\/:*?"<>|]/g, '').trim();
  return `${safe} - סימוכין ${report.referenceNumber || '000000'}.docx`;
}

/** כותרת כפי שהיא נשמרת ב-DB. */
export function iaqSubject(report: IaqReport): string {
  return reportTitle('iaq', report);
}

/**
 * כל המפתחות שהתבנית מצפה להם. סדר השדות קבוע כדי שתבנית חדשה תוכל להסתמך עליו.
 */
export function buildIaqMergeData(report: IaqReport): Record<string, unknown> {
  const blocks = MEASUREMENT_KEYS.map((k) => measurementBlock(report, k));
  const byKey: Record<string, ReturnType<typeof measurementBlock>> = {};
  for (const b of blocks) byKey[b.key] = b;

  const sumValues = (k: MeasurementKey) => measurementValues(report, k);
  const issueDate =
    parseIaqDate(report.reportDate) ?? parseIaqDate(report.surveyDate) ?? new Date();
  const surveyDate = parseIaqDate(report.surveyDate) ?? issueDate;
  const customerName =
    report.customerType === 'company'
      ? (report.companyName || report.recipientName)
      : (report.recipientName || report.companyName);
  const conclusions = summaryConclusions(report);
  const usedLocations = iaqReportLocations(report);

  return {
    /* הכותרת המקורית של Word, בכל עמוד */
    headerWeekday: hebrewWeekday(issueDate),
    headerHebrewDate: hebrewCalendarDate(issueDate),
    headerDate: fullGregorianDate(issueDate),
    // The cover is the report's issue date. The survey date is printed separately
    // in the order details and must not make a reissued report look stale.
    coverDate: fullGregorianDate(issueDate),

    /* כותרת + מזמין */
    referenceNumber: report.referenceNumber,
    reportTitle: iaqSubject(report),
    customerName,
    coverRecipientLine: report.siteCharacter.trim()
      ? `עבור ${customerName} ב${report.siteCharacter.trim()}`
      : `עבור ${customerName}`,
    recipientName: report.recipientName || '',
    companyName: report.companyName || '',
    clientName: report.clientName || report.recipientName || '',
    contactPhone: report.contactPhone || '',
    isCompany: report.customerType === 'company',

    /* כתובת */
    address: report.address || '',
    city: report.city || '',
    fullAddress: [report.address, report.city].filter(Boolean).join(', ') || '—',

    /* פרטי הבדיקה */
    surveyDate: readableDate(report.surveyDate),
    surveyTime: report.surveyTime || '—',
    requestDate: readableDate(report.requestDate),
    weather: report.weather || '—',
    presentAt: report.presentAt || '',
    siteCharacter: report.siteCharacter || '—',
    reason: report.reason || '',
    airConditioning: report.airConditioning || '—',

    /* מבצע */
    authorName: report.authorName,
    authorTitle: report.authorTitle,
    authorPhone: report.authorPhone,
    authorEmail: report.authorEmail,

    /* כיול מכשירים */
    calibrationGraywolf: report.calibrationGraywolf || '—',
    calibrationFormaldehyde: report.calibrationFormaldehyde || '—',

    /* נקודות דיגום (לרשימה טקסטואלית מעל הטבלאות) — מסננים שורות שהבודק
       לא נגע בהן, כדי שהעורך לא ידפיס "1. — / 2. —" עבור 10 שורות ברירת המחדל. */
    locations: usedLocations
      .map((loc, i) => ({ index: i + 1, name: loc.name || '—' })),
    locationsText: usedLocations.map((loc, i) => `${i + 1}. ${loc.name || '—'}`).join('\n'),
    locationCount: usedLocations.length,
    measuredCount: measuredCount(report),

    /* פרק לכל פרמטר — כל אחד עם hasX כדי להעלים את המקטע כשאין נתון */
    hasCo2: byKey.co2.hasData,
    co2Rows: byKey.co2.rows,
    co2Conclusion: byKey.co2.conclusion,
    co2Exceeded: byKey.co2.exceeded,

    hasCo: byKey.co.hasData,
    coRows: byKey.co.rows,
    coConclusion: byKey.co.conclusion,
    coExceeded: byKey.co.exceeded,

    hasNo2: byKey.no2.hasData,
    no2Rows: byKey.no2.rows,
    no2Conclusion: byKey.no2.conclusion,
    no2Exceeded: byKey.no2.exceeded,

    hasO2: byKey.o2.hasData,
    o2Rows: byKey.o2.rows,
    o2Conclusion: byKey.o2.conclusion,
    o2Exceeded: byKey.o2.exceeded,

    hasH2s: byKey.h2s.hasData,
    h2sRows: byKey.h2s.rows,
    h2sConclusion: byKey.h2s.conclusion,
    h2sExceeded: byKey.h2s.exceeded,

    hasSo2: byKey.so2.hasData,
    so2Rows: byKey.so2.rows,
    so2Conclusion: byKey.so2.conclusion,
    so2Exceeded: byKey.so2.exceeded,

    hasOzone: byKey.ozone.hasData,
    ozoneRows: byKey.ozone.rows,
    ozoneConclusion: byKey.ozone.conclusion,
    ozoneExceeded: byKey.ozone.exceeded,

    hasTvoc: byKey.tvoc.hasData,
    tvocRows: byKey.tvoc.rows,
    tvocConclusion: byKey.tvoc.conclusion,
    tvocExceeded: byKey.tvoc.exceeded,

    hasFormaldehyde: byKey.formaldehyde.hasData,
    formaldehydeRows: byKey.formaldehyde.rows,
    formaldehydeConclusion: byKey.formaldehyde.conclusion,
    formaldehydeExceeded: byKey.formaldehyde.exceeded,

    hasPm25: byKey.pm25.hasData,
    pm25Rows: byKey.pm25.rows,
    pm25Conclusion: byKey.pm25.conclusion,
    pm25Exceeded: byKey.pm25.exceeded,

    hasPm10: byKey.pm10.hasData,
    pm10Rows: byKey.pm10.rows,
    pm10Conclusion: byKey.pm10.conclusion,
    pm10Exceeded: byKey.pm10.exceeded,

    hasTpm: byKey.tpm.hasData,
    tpmRows: byKey.tpm.rows,
    tpmConclusion: byKey.tpm.conclusion,
    tpmExceeded: byKey.tpm.exceeded,

    hasTemperature: byKey.temperature.hasData,
    temperatureRows: byKey.temperature.rows,
    temperatureConclusion: byKey.temperature.conclusion,
    temperatureExceeded: byKey.temperature.exceeded,

    hasHumidity: byKey.humidity.hasData,
    humidityRows: byKey.humidity.rows,
    humidityConclusion: byKey.humidity.conclusion,
    humidityExceeded: byKey.humidity.exceeded,

    /* מסקנות — אחת לפרק עם נתונים — ו-תקציר / המלצות (עם הצעה אוטומטית) */
    summaryConclusions: conclusions.map((text) => ({ text })),
    summaryConclusionsXml: conclusionsXml(conclusions),
    summaryText: report.summaryText || defaultSummary(report),
    recommendations: report.recommendations || '—',

    /* חותמת של כפתור/תמונות שה-service מוסיף */
    signedByYoram: report.authorName.trim() === 'יורם גבאי',

    /* debug: גם סטטיסטיקה כללית, זמין לתבנית כנרטיב */
    co2Count: sumValues('co2').length,
    coCount: sumValues('co').length,
    o2Count: sumValues('o2').length,
    h2sCount: sumValues('h2s').length,
    no2Count: sumValues('no2').length,
    so2Count: sumValues('so2').length,
    ozoneCount: sumValues('ozone').length,
    tvocCount: sumValues('tvoc').length,
    formaldehydeCount: sumValues('formaldehyde').length,
    pm25Count: sumValues('pm25').length,
    pm10Count: sumValues('pm10').length,
    tpmCount: sumValues('tpm').length,
    temperatureCount: sumValues('temperature').length,
    humidityCount: sumValues('humidity').length,
  };
}

/** תקציר (פתיח) ברירת מחדל כשה-בודק לא כתב ידני. */
function defaultSummary(report: IaqReport): string {
  const parts: string[] = [];
  const addr = [report.address, report.city].filter(Boolean).join(', ');
  const client = report.recipientName || report.companyName || 'הלקוח';
  parts.push(
    `על פי בקשתכם, ערכנו בתאריך ${readableDate(report.surveyDate)} מדידות תוך מבניות לאיתור וקביעת מדדי נוחות ואיכות אוויר ב${report.siteCharacter || 'מקום הבדיקה'} של ${client}${addr ? `, ${addr}` : ''}.`,
  );
  if (report.reason.trim()) parts.push(report.reason.trim());
  parts.push(
    'הבדיקות נערכו באמצעות מכשור לקריאה ישירה, בהתאם לתקנים המקובלים והמפורטים בדוח זה. כל המדידות בוצעו בהתאם למקובל ולהנחיות הקיימות בתחום איכות האוויר בחללים סגורים — indoor air quality ו-indoor environment quality — כפי שבאים לידי ביטוי בתקני הארגונים הפדראליים בארה"ב, בקנדה ובתקנים בינלאומיים אחרים (EPA וארגון ACGIH).',
  );
  return parts.join(' ');
}
