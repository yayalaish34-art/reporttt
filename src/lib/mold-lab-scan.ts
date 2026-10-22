import { LAB_ORGANISMS, type LabResult } from './mold-schema';

/**
 * Reads the mould laboratory's results off a photograph of its report.
 *
 * The samples go to Hayes in the United States and come back as a PDF or a scan: a
 * block per sample, with the sample's particulars above a table of eighteen genera
 * and their counts. Typing that by hand is where a mould report goes wrong — a
 * transposed digit in "37,000 spores/m³" is invisible in the finished document and
 * changes what the customer is told to do about their child's bedroom.
 *
 * So the sheet is read by a model and returned as data, and the surveyor checks it
 * against the picture instead of transcribing it. The same rule as the radon scan
 * applies and matters more here, because these figures drive the conclusions: the
 * model is asked to *transcribe*, never to interpret. No unit conversion, no
 * rounding, no reconciling a total that does not add up, and no filling in a genus
 * the sheet leaves blank. A blank on the sheet means the laboratory did not find it,
 * which is a finding of its own — inventing a zero there would be inventing evidence.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/** Vision needs a model that can see; the drafting default cannot be assumed to. */
const DEFAULT_VISION_MODEL = 'gpt-5';

/** A full laboratory page is a slow read — several tables of small digits. */
const TIMEOUT_MS = 180_000;

/** Guards the request before it is sent: a scanned page is large. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export class MoldLabScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoldLabScanError';
  }
}

/**
 * The sheet's own particulars, printed in §1 rather than in a result block.
 *
 * They belong to the laboratory's report as a whole — its number, when it received the
 * samples and when it reported — so they are read once per page rather than per block.
 */
export interface LabSheetDetails {
  labReportNumber: string;
  /** "Collected" — when the samples were taken on site, as the laboratory recorded it. */
  labCollectedDate: string;
  labReceivedDate: string;
  labReportedDate: string;
}

export function moldLabScanAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

const SYSTEM_PROMPT = `אתה מתמלל טבלאות תוצאות מתוך דוח מעבדה של חברת Hayes לבדיקת עובשים באוויר.

התפקיד שלך הוא תעתוק בלבד. אתה לא מפרש, לא ממיר יחידות, לא מעגל, לא משלים ספרות ולא מתקן סכומים שלא מסתדרים.

בכל עמוד יש בלוק אחד או יותר. כל בלוק מתאר דגימה אחת ומכיל:

1. כותרת עם פרטי הדגימה:
   - מספר דגימה במעבדה (Lab Sample Number) — למשל "807-1"
   - שם הדגימה (Sample Name) — שם החדר, למשל "חדר בן" או "Bedroom"
   - נפח הדגימה (Volume) — למשל "150 ליטר" או "150 L"
   - מגבלת דיווח (Reporting Limit / LOD) — למשל "7"
   - רקע כללי (Background) — ערך בין 1 ל-5, או "ND"
   - מקטעים (Hyphal Fragments) — למשל "73"

2. טבלת אורגניזמים עם העמודות: ספירה גולמית (Raw Count), ספירה למטר מעוקב (Spores/m³), ואחוז מהסך הכל (% of Total).

רשימת האורגניזמים הקבועה של המעבדה, בסדר הזה:
${LAB_ORGANISMS.join('\n')}

כללים מחייבים:
- החזר שורה לכל אורגניזם מהרשימה שמופיע בטבלה, בסדר שבו הוא מופיע.
- **אורגניזם שהשורה שלו ריקה בגיליון — החזר אותו עם מחרוזות ריקות ("").** ריק פירושו שהמעבדה לא מצאה אותו, וזה ממצא בפני עצמו. אל תכתוב שם 0.
- שמור על סימני "<" ו-">" בדיוק כפי שהם מודפסים: "5600<" נשאר "5600<", "1%>" נשאר "1%>". הסימן נושא משמעות.
- שמור על מפרידי אלפים כפי שהם מודפסים.
- שורת "סה\\"כ" (Total) חוזרת בשדות totalRaw / totalPerCubicMetre / totalPercent — לא כאורגניזם.
- אל תמציא בלוקים ואל תשלים בלוק שנחתך בקצה התמונה — דלג עליו.
- **אל תסרב לתמלל.** אם חלק מהמספרים ברורים וחלק לא, החזר את הברורים והשאר ריק. החזרת רשימה ריקה בגלל טשטוש נקודתי היא תשובה שגויה.
- אל תבקש תמונה טובה יותר ואל תוסיף הערות. החזר JSON בלבד.

בנוסף לבלוקים, החזר גם את פרטי הגיליון עצמו, המופיעים בראש העמוד:
- labReportNumber — מספר דוח המעבדה (Report Number), למשל "#26042301".
- labCollectedDate — מועד איסוף הדגימות בשטח (Collected / Date Collected / Sampled). זהו יום הביקור בשטח, לא יום קבלתן במעבדה.
- labReceivedDate — מועד קבלת הדגימות במעבדה (Received / Date Received).
- labReportedDate — מועד דיווח התוצאות (Reported / Date Reported / Analyzed).
את התאריכים החזר בפורמט DD.MM.YYYY. שדה שאינו מופיע בגיליון — החזר מחרוזת ריקה. אל תנחש.

החזר JSON בלבד בצורה:
{"labReportNumber": "#26042301", "labCollectedDate": "12.08.2026", "labReceivedDate": "18.08.2026", "labReportedDate": "18.08.2026", "results": [{"labNumber": "807-1", "sampleName": "חדר בן", "volume": "150 ליטר", "reportingLimit": "7", "background": "3", "fragments": "73", "organisms": [{"organism": "Alternaria", "raw": "2", "perCubicMetre": "13", "percent": "1%>"}], "totalRaw": "5751<", "totalPerCubicMetre": "38009<", "totalPercent": "100%"}]}`;

/**
 * Reads one or more photographed pages and returns a result block per sample.
 *
 * Pages are read independently and concatenated rather than merged: unlike the radon
 * scan, where bands are slices of one table and overlap deliberately, each page here
 * carries whole samples. Two pages describing the same `labNumber` would be the same
 * sample photographed twice, so the first reading wins.
 *
 * A page that comes back empty is retried, for the reason the radon scan retries: an
 * empty answer is the model declining to read something it finds marginal, and that
 * judgement varies between identical calls.
 */
export async function scanMoldLabImages(
  images: Array<{ bytes: Buffer; contentType: string }>,
): Promise<{
  results: LabResult[];
  details: LabSheetDetails;
  pages: number;
  emptyPages: number;
}> {
  const empty = { results: [] as LabResult[], details: blankDetails() };
  const perPage = await Promise.all(
    images.map(async ({ bytes, contentType }) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const page = await scanMoldLabImage(bytes, contentType).catch(() => empty);
        if (page.results.length > 0) return page;
      }
      return empty;
    }),
  );

  /*
   * The sheet's particulars are taken from the first page that carries them.
   *
   * Every page of one laboratory report repeats the same header, so the first reading
   * is as good as any — and a page whose header was cut off contributes nothing rather
   * than blanking what an earlier page already read.
   */
  const details = blankDetails();
  for (const page of perPage) {
    if (!details.labReportNumber) details.labReportNumber = page.details.labReportNumber;
    if (!details.labCollectedDate) details.labCollectedDate = page.details.labCollectedDate;
    if (!details.labReceivedDate) details.labReceivedDate = page.details.labReceivedDate;
    if (!details.labReportedDate) details.labReportedDate = page.details.labReportedDate;
  }

  const merged = new Map<string, LabResult>();
  let unnumbered = 0;
  for (const { results } of perPage) {
    for (const result of results) {
      // A block whose number could not be read still belongs in the report — it is a
      // sample the laboratory analysed. Keyed uniquely so it cannot collide with
      // another unnumbered one and quietly replace it.
      const key = result.labNumber || `__unnumbered_${unnumbered++}`;
      if (!merged.has(key)) merged.set(key, result);
    }
  }

  const emptyPages = perPage.filter((p) => p.results.length === 0).length;
  if (merged.size === 0) {
    throw new MoldLabScanError(
      'לא זוהו תוצאות בתמונה. ודאו שהתמונה מכילה את טבלת התוצאות של המעבדה, וצלמו אותה מקרוב יותר.',
    );
  }

  return { results: [...merged.values()], details, pages: images.length, emptyPages };
}

const blankDetails = (): LabSheetDetails => ({
  labReportNumber: '',
  labCollectedDate: '',
  labReceivedDate: '',
  labReportedDate: '',
});

/**
 * Reads one image and returns the result blocks on it.
 *
 * The image goes as a data URI rather than a URL: it never leaves this process for
 * anywhere but OpenAI, and there is nothing to clean up afterwards.
 */
export async function scanMoldLabImage(
  bytes: Buffer,
  contentType: string,
): Promise<{ results: LabResult[]; details: LabSheetDetails }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new MoldLabScanError('לא הוגדר מפתח OpenAI בשרת.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new MoldLabScanError('התמונה גדולה מדי (מעל 20MB).');

  const model = process.env.OPENAI_VISION_MODEL || DEFAULT_VISION_MODEL;
  const dataUri = `data:${contentType};base64,${bytes.toString('base64')}`;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'תמלל את כל בלוקי התוצאות שבתמונה. החזר JSON בלבד.' },
          // "high" detail: these are small digits on a scanned page, and at the
          // default the model reads 37,000 as 87,000 often enough to matter.
          { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
        ],
      },
    ],
    // A full page is eighteen rows times however many samples it carries.
    max_completion_tokens: 16000,
    response_format: { type: 'json_object' },
  };

  // Transcription is not a reasoning task, but it is not trivial either: at minimal
  // effort the model skips rows near the bottom of a long table.
  if (/^(gpt-5|o\d)/.test(model)) body.reasoning_effort = 'low';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new MoldLabScanError(
      (err as Error)?.name === 'AbortError'
        ? 'קריאת התמונה נמשכה זמן רב מדי. נסו שוב, או חתכו את התמונה לטבלת התוצאות בלבד.'
        : 'לא ניתן היה לפנות ל-OpenAI.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const parsed = (await response.json()) as { error?: { message?: string } };
      detail = parsed?.error?.message ?? detail;
    } catch {
      /* the status line is enough */
    }
    throw new MoldLabScanError(`OpenAI השיב ${response.status}: ${detail}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new MoldLabScanError('המודל לא החזיר תוכן.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new MoldLabScanError('המודל לא החזיר JSON תקין.');
  }

  const raw = (parsed as { results?: unknown }).results;
  if (!Array.isArray(raw)) throw new MoldLabScanError('המודל לא החזיר תוצאות.');

  return {
    results: raw.map(normalizeResult).filter((r): r is LabResult => r !== null),
    details: {
      labReportNumber: asText((parsed as Record<string, unknown>).labReportNumber),
      labCollectedDate: asText((parsed as Record<string, unknown>).labCollectedDate),
      labReceivedDate: asText((parsed as Record<string, unknown>).labReceivedDate),
      labReportedDate: asText((parsed as Record<string, unknown>).labReportedDate),
    },
  };
}

const asText = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';

/**
 * Takes one result block from the model's answer and makes it safe to print.
 *
 * A block with nothing in it at all is dropped — it is the model having found a table
 * shape and no content, and it would sit in the report as an empty page. Everything
 * else is kept as text: parsing the numbers here would be the interpretation this
 * whole path exists to avoid.
 */
function normalizeResult(value: unknown): LabResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;

  const organisms = Array.isArray(row.organisms)
    ? row.organisms
        .map((o) => {
          if (typeof o !== 'object' || o === null) return null;
          const entry = o as Record<string, unknown>;
          const organism = asText(entry.organism);
          if (!organism) return null;
          return {
            organism,
            raw: asText(entry.raw),
            perCubicMetre: asText(entry.perCubicMetre),
            percent: asText(entry.percent),
          };
        })
        .filter((o): o is NonNullable<typeof o> => o !== null)
    : [];

  const result: LabResult = {
    labNumber: asText(row.labNumber),
    sampleName: asText(row.sampleName),
    volume: asText(row.volume),
    reportingLimit: asText(row.reportingLimit),
    background: asText(row.background),
    fragments: asText(row.fragments),
    organisms,
    totalRaw: asText(row.totalRaw),
    totalPerCubicMetre: asText(row.totalPerCubicMetre),
    totalPercent: asText(row.totalPercent),
  };

  const empty =
    !result.labNumber &&
    !result.sampleName &&
    !result.totalPerCubicMetre &&
    organisms.every((o) => !o.raw && !o.perCubicMetre && !o.percent);
  return empty ? null : result;
}
