'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addIaqPhoto,
  createIaqReport,
  deleteIaqPhoto,
  deleteIaqReport,
  generateIaqReport,
  loadIaqReport,
  nextIaqReference,
  saveIaqReport,
} from '@/lib/iaq-service';
import { crmApiConfigured, fileReportOnCustomerCard } from '@/lib/crm-filing';
import {
  DraftIaqReportSchema,
  IaqReportSchema,
  parseIssuableIaqReport,
  type IaqReport,
} from '@/lib/iaq-schema';
import { iaqPrefillFromQuote } from '@/lib/iaq-quote-import';
import { acceptPhoto } from '@/lib/photo-intake';
import { keepStoredPhotos } from '@/lib/keep-photos';
import {
  aiDraftingAvailable,
  draftIaqReport,
  withoutEmptyIaqDraftRows,
  type IaqDraft,
} from '@/lib/iaq-draft';
import { AiDraftError } from '@/lib/ai-text';
import { hasMeasurement } from '@/lib/iaq-rules';
import { MEASUREMENT_KEYS } from '@/lib/iaq-schema';
import { lookupWeather, WeatherLookupError } from '@/lib/weather-service';
import { iaqCurrentDateTime } from '@/lib/iaq-date-defaults';

export interface IaqActionResult {
  ok: boolean;
  error?: string;
  issues?: string[];
}

/**
 * דוח ריק עם ברירות מחדל סבירות — כולל 10 נקודות דיגום ריקות שהבודק רק צריך
 * למלא שם לכל אחת (כמו בכל שאר הדוחות: אסבסט, עובש, קרינה, ראדון — הם לא
 * דורשים ללחוץ "+ הוסף שורה" עשר פעמים). את מי שלא השתמשו — פשוט משאירים ריק
 * והעורך לא מדפיס אותם בדוח (מסננים ב-mapper).
 */
const DEFAULT_LOCATION_COUNT = 10;

function blankIaqReport(prefill: Partial<IaqReport> = {}): IaqReport {
  const current = iaqCurrentDateTime();
  const locations = Array.from({ length: DEFAULT_LOCATION_COUNT }, (_, i) => ({
    id: `loc_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
    name: '',
  }));
  return IaqReportSchema.parse({
    ...prefill,
    referenceNumber: nextIaqReference(),
    reportDate: current.date,
    requestDate: prefill.requestDate || current.date,
    surveyDate: prefill.surveyDate || current.date,
    surveyTime: prefill.surveyTime || current.time,
    locations,
    results: {},
    photos: [],
  });
}

export async function createBlankIaqReport(): Promise<never> {
  const id = createIaqReport(blankIaqReport());
  revalidatePath('/iaq');
  redirect(`/iaq/${id}`);
}

export async function createBlankIaqReportId(): Promise<string> {
  return createIaqReport(blankIaqReport());
}

/** פותח דוח שכבר מולא מהצעת המחיר ומהפגישה המקושרת אליה ב-CRM. */
export async function createIaqReportFromQuote(form: FormData): Promise<never> {
  const quoteId = String(form.get('quoteId') ?? '').trim();
  let prefill: Partial<IaqReport>;
  try {
    prefill = await iaqPrefillFromQuote(quoteId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ייבוא הצעת המחיר נכשל';
    redirect(`/iaq?quoteError=${encodeURIComponent(message)}`);
  }
  const id = createIaqReport(blankIaqReport(prefill));
  revalidatePath('/iaq');
  redirect(`/iaq/${id}`);
}

export async function removeIaqReport(id: string): Promise<void> {
  deleteIaqReport(id);
  revalidatePath('/iaq');
}

/** אוטו-שמירה — לא קורא ל-revalidate; רץ בכל שינוי. */
export async function persistIaqReportDraft(
  id: string,
  data: unknown,
): Promise<IaqActionResult> {
  const parsed = DraftIaqReportSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'הטיוטה לא נשמרה',
      issues: parsed.error.issues.map((i) => i.message),
    };
  }

  try {
    saveIaqReport(id, {
      ...parsed.data,
      photos: keepStoredPhotos('iaq_photos', id, parsed.data.photos ?? []),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }
}

/** שמירה סופית — נבדק מול הסכמה המחמירה. */
export async function persistIaqReport(id: string, data: unknown): Promise<IaqActionResult> {
  let parsed: IaqReport;
  try {
    parsed = parseIssuableIaqReport(data);
  } catch (err) {
    return {
      ok: false,
      error: 'הדוח לא נשמר — יש שדות חסרים',
      issues: err instanceof Error ? [err.message] : [],
    };
  }

  try {
    saveIaqReport(id, {
      ...parsed,
      photos: keepStoredPhotos('iaq_photos', id, parsed.photos),
    });
    revalidatePath('/iaq');
    revalidatePath(`/iaq/${id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }
}

export interface IaqFinishResult extends IaqActionResult {
  filed?: boolean;
}

/**
 * סיום — שומר, מפיק DOCX, ומתייק בכרטיס הלקוח (אם הוגדר CRM).
 */
export async function finishIaqReport(id: string, data: unknown): Promise<IaqFinishResult> {
  let parsed: IaqReport;
  try {
    parsed = parseIssuableIaqReport(data);
  } catch (err) {
    return {
      ok: false,
      error: 'הדוח לא הושלם — יש שדות חסרים',
      issues: err instanceof Error ? [err.message] : [],
    };
  }

  const report = { ...parsed, photos: keepStoredPhotos('iaq_photos', id, parsed.photos) };
  try {
    saveIaqReport(id, report);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }

  const customerId = (report as unknown as { customerId?: string }).customerId;
  if (!customerId || !crmApiConfigured()) {
    revalidatePath('/iaq');
    return {
      ok: true,
      error: customerId
        ? 'הדוח נשמר. חיבור ל-CRM לא הוגדר, ולכן לא תויק בכרטיס.'
        : 'הדוח נשמר. לא משויך לקוח מהספרייה, ולכן לא תויק בכרטיס.',
    };
  }

  try {
    const { bytes, fileName } = await generateIaqReport(report, id);
    await fileReportOnCustomerCard(report as never, bytes, fileName);
    revalidatePath('/iaq');
    return { ok: true, filed: true };
  } catch (err) {
    console.error('תיוק דוח איכות אוויר בכרטיס הלקוח נכשל', err);
    return {
      ok: false,
      error: `הדוח נשמר, אך התיוק בכרטיס הלקוח נכשל: ${err instanceof Error ? err.message : 'שגיאה'}`,
    };
  }
}

export async function readIaqReport(id: string): Promise<IaqReport | null> {
  return loadIaqReport(id);
}

// ── מזג אוויר אוטומטי ────────────────────────────────────────────────

export interface WeatherActionResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/**
 * שולף נתונים מטאורולוגיים עבור יום הבדיקה (עיר + תאריך + שעות) מ-Open-Meteo
 * ומחזיר טקסט מוכן לשדה weather. בלי API key, בלי התקנה.
 */
export async function fetchWeather(input: {
  city: string;
  surveyDate: string;
  surveyTime?: string;
}): Promise<WeatherActionResult> {
  try {
    const result = await lookupWeather(input);
    if (!result) return { ok: false, error: 'לא התקבלו נתונים מ-Open-Meteo' };
    return { ok: true, text: result.text };
  } catch (err) {
    const message =
      err instanceof WeatherLookupError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'שליפת מזג האוויר נכשלה';
    return { ok: false, error: message };
  }
}

// ── ניסוח AI ────────────────────────────────────────────────────────

export interface IaqDraftActionResult extends IaqActionResult {
  draft?: IaqDraft;
}

/**
 * מנסח תקציר והמלצות מתוך הדוח הנוכחי (כפי שהוא בעורך, לא כפי שהוא ב-DB —
 * לא רוצים לנסח גרסה בת שלוש הקשות). שומר באוטו-שמירה הרגילה; לא כותב כאן
 * חזרה בעצמנו — מחזיר את הטיוטה והבודק עורך-לפני-שהוא-מאשר, כמו בעובש.
 */
export async function draftIaqSections(data: unknown): Promise<IaqDraftActionResult> {
  const parsed = DraftIaqReportSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'הדוח לא תקין — תקנו שגיאות ונסו שוב' };
  }
  // Ten placeholder rows are created up front. Only rows with at least one
  // finite measurement participate in drafting; name-only rows and blank cells
  // stay out of the AI request. A numeric zero is deliberately retained.
  const report = withoutEmptyIaqDraftRows(parsed.data as IaqReport);

  const anyMeasurement = MEASUREMENT_KEYS.some((k) => hasMeasurement(report, k));
  if (!anyMeasurement) {
    return { ok: false, error: 'אין מדידות לנסח מהן. הזינו ערכים לפחות בנקודה אחת.' };
  }

  if (!aiDraftingAvailable()) {
    return { ok: false, error: 'ניסוח אוטומטי אינו זמין — לא הוגדר מפתח OpenAI בשרת.' };
  }

  try {
    const draft = await draftIaqReport(report);
    return { ok: true, draft };
  } catch (err) {
    const message = err instanceof AiDraftError ? err.message : 'הניסוח נכשל';
    return { ok: false, error: message };
  }
}

// ── Photographs ─────────────────────────────────────────────────────

export interface IaqPhotoResult extends IaqActionResult {
  photo?: { imageId: string; caption: string };
}

/** זהה לדוח הקרינה: שם קובץ מכוון הוא הצעת כיתוב שימושית, בלי הסיומת. */
function captionFromFileName(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
}

export async function uploadIaqPhoto(
  reportId: string,
  form: FormData,
): Promise<IaqPhotoResult> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'לא נבחר קובץ' };
  }

  const uploaded = Buffer.from(await file.arrayBuffer());
  const accepted = await acceptPhoto(uploaded);
  if (!accepted) {
    return {
      ok: false,
      error: `לא ניתן לקרוא את הקובץ: ${file.name}. נתמכים JPEG, PNG, HEIC, GIF, BMP ו-WebP.`,
    };
  }
  const { bytes, size } = accepted;

  const draft = form.get('report');
  const parsed =
    typeof draft === 'string' ? DraftIaqReportSchema.safeParse(JSON.parse(draft)) : null;
  const report = parsed?.success ? parsed.data : loadIaqReport(reportId);
  if (!report) return { ok: false, error: 'הדוח לא נמצא' };

  const imageId = addIaqPhoto(reportId, bytes, size.contentType, size.width, size.height);
  const photo = { imageId, caption: captionFromFileName(file.name) };
  (report.photos ?? []).push(photo);
  saveIaqReport(reportId, report as IaqReport);

  revalidatePath(`/iaq/${reportId}`);
  return { ok: true, photo };
}

export async function removeIaqPhoto(
  reportId: string,
  imageId: string,
): Promise<IaqActionResult> {
  const report = loadIaqReport(reportId);
  if (!report) return { ok: false, error: 'הדוח לא נמצא' };

  report.photos = report.photos.filter((p) => p.imageId !== imageId);
  saveIaqReport(reportId, report);
  deleteIaqPhoto(imageId);

  revalidatePath(`/iaq/${reportId}`);
  return { ok: true };
}
