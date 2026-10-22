/**
 * Reads the laboratory's results off a photograph of its screen.
 *
 * The detectors come back from the laboratory as a table in the TaslImage
 * software, and what reaches the office is a phone photo of that window. Typing
 * thirty rows of "detector 19715 read 41 ± 11" off a photograph is where a
 * radon report actually goes wrong: a transposed digit in a concentration is
 * invisible in the finished document and changes what the client is told to do.
 *
 * So the photograph is read by a model and returned as data, and the surveyor
 * checks it against the picture instead of transcribing it. What matters here
 * is that the model is asked to *transcribe*, never to interpret: no unit
 * conversion, no rounding, no filling in a smudged digit. A row it cannot read
 * is reported as unreadable, which the surveyor can fix in one field, rather
 * than guessed at, which they would have no way of noticing.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/** Vision needs a model that can see; the drafting default cannot be assumed to. */
const DEFAULT_VISION_MODEL = 'gpt-5';

/** A photograph of a screen is a slow read — it is a whole table of small digits. */
const TIMEOUT_MS = 120_000;

/** Guards the request before it is sent: a phone photo is large. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export class LabScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabScanError';
  }
}

export interface LabScanRow {
  /** The detector's number, digits only — "..\\IMG0019715" reads as "19715". */
  detectorNumber: string;
  /** The concentration as printed, before the ± sign. */
  concentration: string;
  /** The figure after the ± sign, as printed. */
  uncertainty: string;
  /** The Status column, so a row the laboratory flagged is not silently used. */
  status: string;
  /** True when the model could not read the row with confidence. */
  unreadable: boolean;
}

export function labScanAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

const SYSTEM_PROMPT = `אתה מתמלל טבלאות מתוך צילומי מסך של תוכנת מעבדה למדידת ראדון (TaslImage).

התפקיד שלך הוא תעתוק בלבד. אתה לא מפרש, לא ממיר יחידות, לא מעגל ולא משלים ספרות.

בטבלה שבתמונה יש שורה לכל גלאי. מכל שורה קרא:
- עמודת Device — ערך בצורה "..\\IMG0019715". החזר את הספרות בלבד, בלי אפסים מובילים מיותרים: "19715".
- עמודת KBq_m3_h — ערך בצורה "41 ± 11". החזר את המספר שלפני ה-± כ-concentration, ואת המספר שאחריו כ-uncertainty. שמור על הסימן: "-0" הוא "-0".
- עמודת Status — החזר כפי שכתוב, למשל "OK".

התמונה שאתה מקבל היא חתך אופקי מתוך טבלה ארוכה יותר, ולכן היא מכילה רק חלק מהשורות. זה תקין ומצופה.

כללים מחייבים:
- אל תמציא שורות ואל תשלים שורות שנחתכו בקצה התמונה — פשוט דלג עליהן.
- שורה שאינך קורא בוודאות — החזר אותה עם "unreadable": true ועם מה שהצלחת לקרוא. אל תנחש ספרה.
- **אל תסרב לתמלל.** אם חלק מהשורות ברורות וחלק לא, החזר את הברורות וסמן את השאר. החזרת רשימה ריקה בגלל שורות מטושטשות בודדות היא תשובה שגויה — עדיף להחזיר שלוש שורות נכונות מאשר אפס.
- אל תבקש תמונה טובה יותר ואל תוסיף הערות. החזר JSON בלבד.
- אל תמיין ואל תסנן. החזר את השורות בסדר שבו הן מופיעות.
- אל תמיר יחידות ואל תחשב אחוזים. המספרים חוזרים בדיוק כפי שהם מודפסים.

החזר JSON בלבד:
{"rows": [{"detectorNumber": "19715", "concentration": "41", "uncertainty": "11", "status": "OK", "unreadable": false}]}`;

/**
 * Reads a photograph that has been cut into horizontal bands, and merges them.
 *
 * The bands are not an optimisation. OpenAI renders an image down to about
 * 1024×768 before the model sees it, so a whole screen photographed at 2048px
 * arrives with the digits already destroyed — asked to read it, the model
 * correctly refuses. A band of the same photo is rendered at 2048 across
 * instead, because it is wide and short, and the same digits become legible.
 * The browser does the cutting, where there is a canvas to do it with.
 *
 * Bands overlap, so a row split across a cut appears whole in one of them. The
 * first reading of a detector wins and later duplicates are dropped, which is
 * what makes the overlap free.
 *
 * A band that comes back empty is retried once: the refusal is a judgement
 * about legibility, and it is not always the same judgement twice.
 */
export async function scanLabImages(
  images: Array<{ bytes: Buffer; contentType: string }>,
): Promise<{ rows: LabScanRow[]; bands: number; emptyBands: number }> {
  const results = await Promise.all(
    images.map(async ({ bytes, contentType }) => {
      // Two retries rather than one: an empty band is the model declining to
      // read a photograph it finds marginal, and that judgement varies between
      // identical calls. Three attempts turns a band that reads two times in
      // five into one that almost always reads.
      for (let attempt = 0; attempt < 3; attempt++) {
        const rows = await scanLabImage(bytes, contentType).catch(() => [] as LabScanRow[]);
        if (rows.length > 0) return rows;
      }
      return [] as LabScanRow[];
    }),
  );

  const merged = new Map<string, LabScanRow>();
  for (const rows of results) {
    for (const row of rows) {
      if (!merged.has(row.detectorNumber)) merged.set(row.detectorNumber, row);
    }
  }

  const emptyBands = results.filter((r) => r.length === 0).length;
  if (merged.size === 0) {
    throw new LabScanError(
      'לא זוהו שורות בתמונה. צלמו את הטבלה מקרוב יותר, או חתכו את התמונה כך שתכיל רק את הטבלה.',
    );
  }

  return { rows: [...merged.values()], bands: images.length, emptyBands };
}

/**
 * Reads one image and returns its rows.
 *
 * The image goes as a data URI rather than a URL: it never leaves this process
 * for anywhere but OpenAI, and there is nothing to clean up afterwards.
 */
export async function scanLabImage(bytes: Buffer, contentType: string): Promise<LabScanRow[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new LabScanError('לא הוגדר מפתח OpenAI בשרת.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new LabScanError('התמונה גדולה מדי (מעל 20MB).');

  const model = process.env.OPENAI_VISION_MODEL || DEFAULT_VISION_MODEL;
  const dataUri = `data:${contentType};base64,${bytes.toString('base64')}`;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'תמלל את כל שורות הטבלה שבתמונה. החזר JSON בלבד.',
          },
          // "high" detail: the digits are small on a photographed screen, and at
          // the default the model reads 41 as 47 often enough to matter.
          { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
        ],
      },
    ],
    max_completion_tokens: 8000,
    response_format: { type: 'json_object' },
  };

  // Transcription is not a reasoning task, but it is not a trivial one either:
  // at minimal effort the model skips rows near the bottom of a long table.
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
    throw new LabScanError(
      (err as Error)?.name === 'AbortError'
        ? 'קריאת התמונה נמשכה זמן רב מדי. נסו שוב, או חתכו את התמונה לטבלה בלבד.'
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
    throw new LabScanError(`OpenAI השיב ${response.status}: ${detail}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new LabScanError('המודל לא החזיר תוכן.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new LabScanError('המודל לא החזיר JSON תקין.');
  }

  const raw = (parsed as { rows?: unknown }).rows;
  if (!Array.isArray(raw)) throw new LabScanError('המודל לא החזיר שורות.');

  // An empty answer is a legitimate outcome for one band — the caller retries
  // and merges, and only an empty *set* of bands is a failure.
  return raw.map(normalizeRow).filter((r): r is LabScanRow => r !== null);
}

/**
 * Takes one row of the model's answer and makes it safe to show.
 *
 * A row without a detector number is dropped: it cannot be matched to anything
 * and would sit in the list as a puzzle. Everything else is kept as text —
 * parsing the numbers here would be the interpretation this whole path exists
 * to avoid.
 */
function normalizeRow(value: unknown): LabScanRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;

  const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

  // "..\IMG0019715" → "19715", and a leading-zero form → the same.
  const detectorNumber = asText(row.detectorNumber).replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
  if (!detectorNumber) return null;

  return {
    detectorNumber,
    concentration: asText(row.concentration),
    uncertainty: asText(row.uncertainty),
    status: asText(row.status),
    unreadable: row.unreadable === true,
  };
}
