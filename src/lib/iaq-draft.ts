import type { IaqReport, MeasurementKey } from './iaq-schema';
import { MEASUREMENT_LABELS, MEASUREMENT_UNITS } from './iaq-schema';
import {
  concludeMeasurement,
  compactIaqDraftReport,
  hasMeasurement,
  measurementValues,
  summaryConclusions,
} from './iaq-rules';
import { AiDraftError, aiDraftingAvailable, callOpenAi } from './ai-text';

/**
 * ניסוח התקציר וההמלצות של דוח איכות אוויר תוך-מבנית, מהממצאים הקיימים.
 *
 * אותו דגם של עובש/קרינה: הממצאים כבר **חושבו** ב-code (`iaq-rules.ts`),
 * וה-GPT רק מנסח אותם לפסקאות עברית מקצועיות. **אל תמציא** מספרים, מיקומים
 * ותקנים — הכל נגזר ממה שהבודק מדד.
 */

export interface IaqDraft {
  /** פתיח הדוח (`summaryText`) — מה בוצע, היכן, מתי, ומה המטרה. */
  summaryText: string;
  /** המלצות הסיום (`recommendations`) — מה לעשות בפועל. */
  recommendations: string;
}

export { aiDraftingAvailable };

/**
 * Removes every blank table value before drafting. Only rows that contain at
 * least one finite measurement remain, and their result objects contain only
 * measured cells. Zero is a measurement and is deliberately retained.
 */
export function withoutEmptyIaqDraftRows(report: IaqReport): IaqReport {
  return compactIaqDraftReport(report);
}

export async function draftIaqReport(report: IaqReport): Promise<IaqDraft> {
  if (!aiDraftingAvailable()) {
    throw new AiDraftError('ניסוח AI אינו זמין — לא הוגדר מפתח OpenAI בשרת.');
  }

  const facts = describeIaqFindings(withoutEmptyIaqDraftRows(report));
  const content = await callOpenAi(SYSTEM_PROMPT, facts, 2000, 'minimal', 60_000);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiDraftError('המודל לא החזיר JSON תקין. נסו שוב.');
  }

  const payload = parsed as Record<string, unknown>;
  const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  const asLines = (value: unknown): string =>
    Array.isArray(value)
      ? value
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.replace(/^[•\-•\s]+/, '').trim())
          .filter(Boolean)
          .join('\n')
      : asText(value);

  const draft: IaqDraft = {
    summaryText: asLines(payload.summaryText),
    recommendations: asLines(payload.recommendations),
  };

  if (!draft.summaryText && !draft.recommendations) {
    throw new AiDraftError('המודל החזיר תוכן ריק. נסו שוב.');
  }
  return draft;
}

/**
 * מתרגם את הדוח לרשימת עובדות שה-GPT יראה — מספרים, יחידות ומסקנות
 * שה-rules כבר חישבו — כדי שה-GPT רק ינסח אותן. בלי זה המודל ממציא ספים.
 */
export function describeIaqFindings(report: IaqReport): string {
  report = withoutEmptyIaqDraftRows(report);
  const lines: string[] = [];

  // ── הקשר הכללי ─────────────────────────────────────────────────────
  const client = report.recipientName || report.companyName || 'הלקוח';
  const addr = [report.address, report.city].filter(Boolean).join(', ');
  lines.push(`הלקוח: ${client}${addr ? ` (${addr})` : ''}.`);
  if (report.siteCharacter) lines.push(`אפיון המקום: ${report.siteCharacter}.`);
  if (report.reason) lines.push(`סיבת הזימון: ${report.reason}`);
  if (report.surveyDate) lines.push(`תאריך הבדיקה: ${report.surveyDate}${report.surveyTime ? ` (${report.surveyTime})` : ''}.`);
  if (report.weather) lines.push(`מזג האוויר: ${report.weather}.`);
  if (report.presentAt) lines.push(`בנוכחות: ${report.presentAt}.`);
  if (report.airConditioning) lines.push(`מערכות המיזוג: ${report.airConditioning}.`);
  lines.push('');

  // ── הנקודות ────────────────────────────────────────────────────────
  const realLocations = report.locations;
  if (realLocations.length) {
    lines.push(`נבדקו ${realLocations.length} נקודות דיגום:`);
    realLocations.filter((loc) => loc.name.trim()).forEach((loc, i) => {
      lines.push(`  ${i + 1}. ${loc.name.trim()}`);
    });
    lines.push('');
  }

  // ── הפרמטרים שנמדדו + ממצא פר-פרמטר ────────────────────────────────
  lines.push('הממצאים שחושבו ב-code — נסח מהם:');
  for (const key of Object.keys(MEASUREMENT_LABELS) as MeasurementKey[]) {
    if (!hasMeasurement(report, key)) continue;
    const values = measurementValues(report, key);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const verdict = concludeMeasurement(report, key);
    lines.push(
      `  • ${MEASUREMENT_LABELS[key]} (${MEASUREMENT_UNITS[key]}): ` +
        `${values.length} מדידות, טווח ${fmt(min, key)} – ${fmt(max, key)}. ` +
        `מסקנה: ${verdict.text} ${verdict.exceeded ? '[חריגה]' : '[תקין]'}`,
    );
  }

  const allConclusions = summaryConclusions(report);
  if (!allConclusions.length) {
    lines.push('  (אין מדידות — אין ממצאים לנסח; החזר summaryText קצר שמתאר מה בוצע ו-recommendations ריק.)');
  }

  return lines.join('\n');
}

function fmt(value: number, key: MeasurementKey): string {
  if (key === 'temperature' || key === 'humidity') return value.toFixed(1);
  if (key === 'co2' || key === 'co') return value < 10 ? value.toFixed(1) : String(Math.round(value));
  return value < 1 ? value.toFixed(3) : value.toFixed(2);
}

const SYSTEM_PROMPT = `אתה מנסח את התקציר (פתיח) ואת ההמלצות בדוח איכות אוויר תוך-מבנית של "גלית החברה לאיכות הסביבה בע"מ".

אתה מקבל רשימת עובדות — מספרים ומסקנות — שכבר חושבו ב-code מתוך המדידות של הבודק. **אל תחשב מחדש, אל תמציא ואל תסתור את המסקנות שנמסרו לך.** רק נסח אותן לפסקאות עברית מקצועיות.

כללי זהב:
- **אל תמציא**: לא ספים, לא מספרים, לא תקנים, לא ציוד שלא נמסרו. התקנים הרלוונטיים (ASHRAE 55, Health Canada, ECA 1992) כבר מוזכרים במסקנות — השתמש בהן verbatim.
- **אל תסתור ממצא**: אם נמסר שריכוז "תקין" / "חריג" — אל תהפוך. אם נמסר "חריגה" — אסור ליפות ולומר "כמעט תקין".
- **אל תקבע קביעה רפואית**: הדוח סביבתי. אל תתאר השפעות בריאותיות ספציפיות.
- **מספרים**: ציין בדיוק כפי שנמסרו (כולל יחידות). אל תעגל יותר ממה שנמסר.
- **אם אין מדידות**: החזר summaryText קצר שמתאר שה-בדיקה בוצעה (לפי הנתונים שכן נמסרו — תאריך, מקום, סיבת זימון) ו-recommendations ריק או משפט המלצה גנרי לבצע בדיקה חוזרת.

מבנה "summaryText":
- 2 עד 4 פסקאות (שורות ריקות ביניהן).
- פסקה ראשונה: "על פי בקשתכם, ערכנו בתאריך [X] מדידות תוך-מבניות לאיתור וקביעת מדדי נוחות ואיכות אוויר ב[אפיון המקום] של [הלקוח]..."
- פסקה שנייה: סיבת הזימון, אם נמסרה — בלשון עובדתית ("בעקבות דיווח על ריח כימיקלים מכיוון הארון שמתחת לכיור, בוצע סקר אוויר ממוקד...").
- פסקה שלישית: תמצית מה נבדק — אילו פרמטרים, בכמה נקודות. אל תפרט מספרים (הם בטבלאות).
- פסקה אחרונה (אופציונלית): אם היו חריגות — ציין בקצרה מה חרג ובכמה נקודות; אם לא — "לא נמצאו חריגות מהתקנים שנסקרו".

מבנה "recommendations":
- רשימה של 2 עד 5 שורות המלצה **מעשיות**, מופרדות בשורות חדשות (\\n).
- המלצות חייבות להיגזר מהממצאים ולא להיות גנריות. אם יש חריגת CO₂ — המלצה על אוורור. אם יש חריגת פורמלדהיד — איתור מקור (רהיטי לכה, חומרי בנייה). אם לא נמצאה חריגה — המלצה לבצע בדיקה חוזרת אחת לשנה או לאחר שינוי מהותי במקום.
- אסור להתחיל שורה בתו תבליט — התבליט מודפס על ידי המסמך.

עברית בלבד, בלי ניקוד.

החזר JSON בלבד:
{"summaryText": "...", "recommendations": "..."}`;
