import type { IaqLocation, IaqReport, MeasurementKey } from './iaq-schema';
import { MEASUREMENT_KEYS, MEASUREMENT_LABELS } from './iaq-schema';

/**
 * ספים ומסקנות אוטומטיות לדוח איכות אוויר תוך-מבנית.
 *
 * המקורות — התקנים שהדוח עצמו מצטט (ASHRAE, Health Canada, EPA/ACGIH, ECA).
 * המטרה: בכל פרק להסיק אוטומטית אם המדידות עברו את הסף, ולהוליד משפט מסקנה
 * בעברית בלי שהבודק יצטרך לנסח כלום. הוא עדיין יכול לערוך את ה-summaryText.
 */

export interface MeasurementConclusion {
  /** אם לפחות ערך אחד חרג */
  exceeded: boolean;
  /** אם לא נמדד בשום נקודה */
  noData: boolean;
  /** משפט מסקנה מוכן לטבלה */
  text: string;
}

type IaqRows = Pick<IaqReport, 'locations' | 'results'>;

/** ערכי ה-ASHRAE לטמפרטורה בקיץ ובחורף (°C). */
const TEMP_SUMMER = { min: 23, max: 26 };
const TEMP_WINTER = { min: 20, max: 23.5 };

/** לחות יחסית מומלצת ע"פ ASHRAE 55-1992. */
const HUMIDITY = { min: 30, max: 60 };

/** האם היום בטווח הקיץ (יוני–ספטמבר) או לא. */
function isSummer(dateStr: string): boolean {
  const match = /\b(\d{1,2})[/.-](\d{1,2})/.exec(dateStr);
  if (!match) return true; // ברירת מחדל קיץ — התבנית הייחוסית נכתבה לקיץ
  const month = Number(match[2]);
  return month >= 5 && month <= 10;
}

/** אוסף הערכים הממשיים (לא null, לא NaN) למדד נתון בכל הנקודות. */
export function measurementValues(report: IaqReport, key: MeasurementKey): number[] {
  const out: number[] = [];
  for (const loc of report.locations) {
    const row = report.results[loc.id];
    const value = row?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  }
  return out;
}

/**
 * האם נקודת דיגום מכילה מידע שהבודק הזין בפועל.
 *
 * העורך מחזיק מראש שורות ריקות ולעיתים גם יוצר עבורן אובייקט תוצאות שכל
 * ערכיו null. עצם קיום האובייקט אינו הופך את השורה לנתון. שם שהוזן או
 * מדידה מספרית ממשית כן הופכים אותה לנקודה רלוונטית.
 */
export function hasIaqLocationData(report: IaqRows, location: IaqLocation): boolean {
  if (location.name.trim() !== '') return true;
  const result = report.results[location.id];
  return result
    ? MEASUREMENT_KEYS.some((key) => {
        const value = result[key];
        return typeof value === 'number' && Number.isFinite(value);
      })
    : false;
}

/** נקודות רלוונטיות לפלט ולניסוח, ללא שורות ברירת-מחדל ריקות. */
export function iaqReportLocations(report: IaqRows): IaqLocation[] {
  return report.locations.filter((location) => hasIaqLocationData(report, location));
}

/** True when a sampling row contains at least one real numeric measurement. */
export function hasIaqLocationMeasurement(report: IaqRows, location: IaqLocation): boolean {
  const result = report.results[location.id];
  return result
    ? MEASUREMENT_KEYS.some((key) => {
        const value = result[key];
        return typeof value === 'number' && Number.isFinite(value);
      })
    : false;
}

/**
 * Builds the only report shape that may be used for AI drafting.
 *
 * Rows without measurements are removed even when a location name was typed,
 * and each retained result object contains numeric cells only. In particular,
 * `0` is retained while `null`, `undefined` and non-finite values are omitted.
 */
export function compactIaqDraftReport(report: IaqReport): IaqReport {
  const locations = report.locations.filter((location) =>
    hasIaqLocationMeasurement(report, location),
  );
  const results = Object.fromEntries(
    locations.map((location) => [
      location.id,
      Object.fromEntries(
        MEASUREMENT_KEYS.flatMap((key) => {
          const value = report.results[location.id]?.[key];
          return typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : [];
        }),
      ),
    ]),
  ) as IaqReport['results'];

  return { ...report, locations, results };
}

export type IaqDraftRequestPayload = Omit<IaqReport, 'locations' | 'results'> & {
  locations: Array<{ id: string; name?: string }>;
  results: Record<string, Partial<Record<MeasurementKey, number>>>;
};

/**
 * Removes blank table cells before the browser sends the drafting request.
 * An unnamed measured row is represented by its id only, never by `name: ''`.
 */
export function compactIaqDraftRequest(report: IaqReport): IaqDraftRequestPayload {
  const compact = compactIaqDraftReport(report);
  return {
    ...compact,
    locations: compact.locations.map((location) => {
      const name = location.name.trim();
      return name ? { id: location.id, name } : { id: location.id };
    }),
    results: compact.results as Record<string, Partial<Record<MeasurementKey, number>>>,
  };
}

/** האם למדד נתון יש מדידה כלשהי. */
export function hasMeasurement(report: IaqReport, key: MeasurementKey): boolean {
  return measurementValues(report, key).length > 0;
}

/** מסקנה לפרמטר יחיד. */
export function concludeMeasurement(
  report: IaqReport,
  key: MeasurementKey,
): MeasurementConclusion {
  const values = measurementValues(report, key);
  if (values.length === 0) {
    return { exceeded: false, noData: true, text: 'לא נמדד.' };
  }

  const max = Math.max(...values);

  switch (key) {
    case 'co2': {
      // ASHRAE: 350–1050 ppm נחשב לתקין (רקע + 700).
      const exceeded = max > 1050;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? 'ריכוז הפחמן הדו-חמצני היה גבוה מהמומלץ ע"י האיגוד האמריקאי של מהנדסי החימום, הקירור ומיזוג האוויר (ASHRAE) ברקע לפחות אחת מהנקודות שנבדקו.'
          : 'ריכוז הפחמן הדו-חמצני בכל המקומות היה בהתאם למומלץ על ידי האיגוד האמריקאי של מהנדסי החימום, הקירור ומיזוג האוויר (ASHRAE).',
      };
    }
    case 'co': {
      // Health Canada ASTER: 25 ppm.
      const exceeded = max > 25;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? 'ריכוז הפחמן החד-חמצני חרג מהסף המומלץ (ASTER 25 ppm) של מחלקת הבריאות הקנדית (Health Canada) בלפחות אחת מהנקודות שנבדקו.'
          : 'ריכוז הפחמן החד-חמצני היה בהתאם למומלץ בתקן בכל המקומות שנבדקו. וזאת על פי קווי ההנחיה שנקבעו על ידי מחלקת הבריאות הקנדית (Health Canada) לתקני איכות האוויר התוך-מבנית.',
      };
    }
    case 'no2': {
      // Health Canada: ALTER 0.05 ppm, ASTER 0.09 ppm. ה-ASTER הוא הסף הקצר-טווח.
      const exceeded = max > 0.09;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? 'ריכוז החנקן הדו-חמצני חרג מהסף הקצר-טווח ASTER (0.09 ppm) של מחלקת הבריאות הקנדית (Health Canada) בלפחות אחת מהנקודות שנבדקו.'
          : max === 0
            ? 'לא נמצא חנקן דו-חמצני בכל המקומות שנבדקו.'
            : 'ריכוז החנקן הדו-חמצני בכל המקומות שנבדקו היה בהתאם לתקן לטווח קצר המומלץ על פי מדד ASTER בהתאם לקווי ההנחיה שנקבעו על ידי מחלקת הבריאות הקנדית (Health Canada) לתקני איכות האוויר התוך-מבנית.',
      };
    }
    case 'o2': {
      // חמצן באוויר רגיל ~20.9%. OSHA מגדיר "חוסר חמצן" מתחת ל-19.5% ו"עודף
      // חמצן" מעל 23.5%. חריגה מכל צד מסוכנת.
      const low = values.some((v) => v < 19.5);
      const high = values.some((v) => v > 23.5);
      const exceeded = low || high;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? low
            ? 'ריכוז החמצן היה נמוך מהסף הבטיחותי של OSHA (19.5%) בלפחות אחת מהנקודות שנבדקו.'
            : 'ריכוז החמצן היה גבוה מהסף הבטיחותי של OSHA (23.5%) בלפחות אחת מהנקודות שנבדקו.'
          : 'ריכוז החמצן בכל המקומות שנבדקו היה בטווח התקין (19.5%–23.5%) ע"פ OSHA.',
      };
    }
    case 'h2s': {
      // ACGIH TLV-TWA 1 ppm (8h); ASTER קצר-טווח ~10 ppm. ריח כבר ב-0.03 ppm.
      const exceeded = max > 1;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? 'ריכוז מימן גופרתי (H₂S) חרג מהסף TLV-TWA של ACGIH (1 ppm) בלפחות אחת מהנקודות שנבדקו.'
          : max === 0
            ? 'לא נמצא מימן גופרתי בכל המקומות שנבדקו.'
            : 'ריכוז מימן גופרתי בכל המקומות שנבדקו היה בהתאם לסף TLV-TWA (1 ppm) של ACGIH.',
      };
    }
    case 'so2': {
      // ALTER 0.019 ppm, ASTER 0.38 ppm.
      const exceeded = max > 0.38;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? 'ריכוז הגופרית הדו-חמצנית חרג מהסף הקצר-טווח ASTER (0.38 ppm) של מחלקת הבריאות הקנדית (Health Canada) בלפחות אחת מהנקודות שנבדקו.'
          : max === 0
            ? 'לא נמצאה גופרית דו-חמצנית בכל המקומות שנבדקו.'
            : 'ריכוז הגופרית הדו-חמצנית בכל המקומות שנבדקו היה בהתאם לתקן לטווח קצר על פי מדד ASTER בהתאם לקווי ההנחיה שנקבעו על ידי מחלקת הבריאות הקנדית (Health Canada) לתקני איכות האוויר התוך-מבנית.',
      };
    }
    case 'tvoc': {
      // ECA 1992: עד 0.087 ppm "טווח נוחות", 0.087-1.304 נוחות עם אזהרה,
      // 1.304-10.87 אי-נוחות, מעל 10.87 רעילות.
      if (max > 10.87) {
        return {
          exceeded: true,
          noData: false,
          text: 'ריכוז התרכובות האורגניות הנדיפות היה בטווח הרעילות (ECA 1992) בלפחות אחת מהנקודות שנבדקו.',
        };
      }
      if (max > 1.304) {
        return {
          exceeded: true,
          noData: false,
          text: 'ריכוז התרכובות האורגניות הנדיפות היה בטווח אי הנוחות (ECA 1992) בלפחות אחת מהנקודות שנבדקו.',
        };
      }
      if (max > 0.087) {
        return {
          exceeded: false,
          noData: false,
          text: 'ריכוז התרכובות האורגניות הנדיפות היה בטווח הנוחות, בהתאם לחוק שיתוף הפעולה האירופאי (ECA 1992), אך תיתכן אי-נוחות בשילוב עם גורמי זיהום אחרים.',
        };
      }
      return {
        exceeded: false,
        noData: false,
        text: 'ריכוז סך כל התרכובות האורגניות הנדיפות בכל המקומות שנבדקו היה בטווח הנוחות. וזאת על פי חוק שיתוף הפעולה האירופאי: "קווי הנחיה עבור דרישות האוורור בבניינים" (ECA, 1992).',
      };
    }
    case 'formaldehyde': {
      // Health Canada 1 hour: 0.1 ppm (ו-8 שעות: 0.04).
      const exceeded = max > 0.1;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? 'ריכוז הפורמלדהיד חרג מהסף שעתי של מחלקת הבריאות הקנדית (Health Canada) בלפחות אחת מהנקודות שנבדקו.'
          : 'ריכוז הפורמלדהיד במקומות שנבדקו היה בהתאם למומלץ על ידי מחלקת הבריאות של מינסוטה (MDH) ועל ידי מחלקת הבריאות הקנדית (Health Canada).',
      };
    }
    case 'ozone': {
      // Health Canada residential ozone (short-term): 0.12 ppm; WHO 8h: 0.1 ppm.
      // ה-WHO הוא השמרני יותר ולכן זה הסף שבו משתמשים.
      const exceeded = max > 0.1;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? 'ריכוז האוזון חרג מהסף הממושך (0.1 ppm) של ארגון הבריאות העולמי (WHO) בלפחות אחת מהנקודות שנבדקו.'
          : max === 0
            ? 'לא נמצא אוזון בכל המקומות שנבדקו.'
            : 'ריכוז האוזון בכל המקומות שנבדקו היה בהתאם לסף שנקבע בקווי ההנחיה של ארגון הבריאות העולמי (WHO) ולהמלצות מחלקת הבריאות הקנדית (Health Canada) לתקני איכות האוויר התוך-מבנית.',
      };
    }
    case 'pm25': {
      // חוק אוויר נקי בישראל: PM2.5 יומי 37.5 µg/m³. WHO 15, EPA 35.
      const exceeded = max > 37.5;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? 'ריכוז החלקיקים העדינים (PM2.5) חרג מהסף היומי שנקבע בחוק אוויר נקי בישראל (37.5 µg/m³) בלפחות אחת מהנקודות שנבדקו.'
          : 'ריכוז החלקיקים העדינים (PM2.5) בכל המקומות שנבדקו היה בהתאם לסף היומי שנקבע בחוק אוויר נקי בישראל (37.5 µg/m³).',
      };
    }
    case 'pm10': {
      // חוק אוויר נקי בישראל: PM10 יומי 130 µg/m³. WHO 45, EPA 150.
      const exceeded = max > 130;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? 'ריכוז החלקיקים הנשימים (PM10) חרג מהסף היומי שנקבע בחוק אוויר נקי בישראל (130 µg/m³) בלפחות אחת מהנקודות שנבדקו.'
          : 'ריכוז החלקיקים הנשימים (PM10) בכל המקומות שנבדקו היה בהתאם לסף היומי שנקבע בחוק אוויר נקי בישראל (130 µg/m³).',
      };
    }
    case 'tpm': {
      // חלקיקים כוללים (TSP/TPM) — אין סף תוך-מבני ייעודי בישראל. OSHA PEL
      // ל-"inhalable particulate not otherwise regulated" הוא 15 mg/m³ ליום —
      // כלומר 15,000 µg/m³. זה סף שמרני-גבוה שעובד לרוב ה-dustmeters היד-ניידים.
      const exceeded = max > 15000;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? 'ריכוז החלקיקים הכוללים (TPM) חרג מסף ה-OSHA PEL (15 mg/m³) בלפחות אחת מהנקודות שנבדקו.'
          : 'ריכוז החלקיקים הכוללים (TPM) בכל המקומות שנבדקו היה בהתאם לסף ה-OSHA PEL (15 mg/m³).',
      };
    }
    case 'temperature': {
      const range = isSummer(report.surveyDate) ? TEMP_SUMMER : TEMP_WINTER;
      const seasonLabel = isSummer(report.surveyDate) ? 'הקיץ' : 'החורף';
      const high = values.some((v) => v > range.max);
      const low = values.some((v) => v < range.min);
      const exceeded = high || low;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? `הטמפרטורה שנמדדה הייתה מחוץ לטווח המומלץ לחודשי ${seasonLabel} (${range.min}°–${range.max}°C) ע"פ תקן ASHRAE 55 בלפחות אחת מהנקודות שנבדקו.`
          : `הטמפרטורה שנמדדה הייתה בהתאם לטווח המומלץ לחודשי ${seasonLabel} ע"פ תקן ASHRAE 55 של האיגוד האמריקאי של מהנדסי החימום, הקירור ומיזוג האוויר.`,
      };
    }
    case 'humidity': {
      const high = values.some((v) => v > HUMIDITY.max);
      const low = values.some((v) => v < HUMIDITY.min);
      const exceeded = high || low;
      return {
        exceeded,
        noData: false,
        text: exceeded
          ? high
            ? 'הלחות היחסית במקומות שנבדקו הייתה גבוהה מהמומלץ בתקן ASHRAE 55 של האיגוד האמריקאי של מהנדסי החימום, הקירור ומיזוג האוויר בלפחות אחת מהנקודות.'
            : 'הלחות היחסית במקומות שנבדקו הייתה נמוכה מהמומלץ בתקן ASHRAE 55 של האיגוד האמריקאי של מהנדסי החימום, הקירור ומיזוג האוויר בלפחות אחת מהנקודות.'
          : 'הלחות היחסית בכל המקומות שנבדקו הייתה בטווח המומלץ (30%–60%) ע"פ תקן ASHRAE 55.',
      };
    }
    default: {
      return { exceeded: false, noData: true, text: '' };
    }
  }
}

/**
 * שורות המסקנה הראשיות שנדפסות ב"מסקנות" של התקציר — אחת לפרמטר שבו הייתה מדידה
 * כלשהי. פרמטר שלא נמדד בכלל נשמט כדי שהתקציר יישאר ממוקד במה שנבדק.
 */
export function summaryConclusions(report: IaqReport): string[] {
  const out: string[] = [];
  for (const key of Object.keys(MEASUREMENT_LABELS) as MeasurementKey[]) {
    if (!hasMeasurement(report, key)) continue;
    out.push(concludeMeasurement(report, key).text);
  }
  return out;
}

/**
 * האם לפחות פרמטר אחד חרג. משמש לצבע חירום על הכפתור "הפק דוח".
 */
export function hasAnyExceedance(report: IaqReport): boolean {
  for (const key of Object.keys(MEASUREMENT_LABELS) as MeasurementKey[]) {
    if (concludeMeasurement(report, key).exceeded) return true;
  }
  return false;
}
