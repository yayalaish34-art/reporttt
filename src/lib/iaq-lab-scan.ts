import { MEASUREMENT_KEYS, MEASUREMENT_LABELS, type MeasurementKey } from './iaq-schema';

/**
 * קורא טבלת מדידות של דוח איכות אוויר תוך-מבנית מתוך תמונה.
 *
 * אותו דגם של mold-lab-scan: המודל *מתעתק*, לא מפרש. כל שורה בטבלה המצולמת
 * היא נקודת דיגום אחת; כל עמודה היא פרמטר (CO₂, CO, NO₂, SO₂, TVOC, פורמלדהיד,
 * טמפרטורה, לחות). אם בתא יש מספר — מחזירים את המחרוזת כפי שהיא מודפסת
 * (כולל "<" או ">"). אם התא ריק — מחזירים null לאותו פרמטר, לא 0.
 *
 * יחידות: המכשירים של גלית (Graywolf DSII-8 + FM-801) נותנים ppm לכל הגזים,
 * °C לטמפרטורה, % ללחות. הערכים שחוזרים כבר באותן יחידות שבהן מאוחסן הדוח.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_VISION_MODEL = 'gpt-5';
const TIMEOUT_MS = 180_000;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export class IaqLabScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IaqLabScanError';
  }
}

export function iaqLabScanAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** שורה בטבלה הסרוקה — שם הנקודה + ערכים לכל פרמטר (null כשהתא ריק). */
export interface ScannedIaqRow {
  /** שם הנקודה כפי שהוא מופיע בטבלה; מחרוזת ריקה אם לא מופיע. */
  name: string;
  /** ערכים פר-פרמטר — number או null (לא 0!) אם התא ריק. */
  values: Partial<Record<MeasurementKey, number | null>>;
}

export interface ScannedIaqResult {
  rows: ScannedIaqRow[];
}

const SYSTEM_PROMPT = `אתה מתמלל גיליון תוצאות בדיקה של "גלית — החברה לאיכות הסביבה". הגיליון מודפס מראש עם 10 שורות ממוספרות, ובדיקות יומיות ממולאות **בכתב יד**. התפקיד שלך: לקרוא כל תא של כל שורה, להמיר יחידות היכן שנדרש, ולהחזיר את הערכים בדיוק כפי שרשומים.

## מבנה הגיליון (RTL — קוראים מימין לשמאל)

העמודות הן, מימין לשמאל (יכול להיות שבראש העמוד השמאלית ביותר, מעל "חלקיקים", רשום "O₃" או "03" שהם ערכי אוזון):
1. **שעה**
2. **מיקום** — שם הנקודה, בכתב יד בעברית.
3. **CO₂ (ppm)** — פחמן דו-חמצני. דוגמאות: "617", "438", "429". **ללא המרה.**
4. **CO (ppm)** — פחמן חד-חמצני. דוגמאות: "1.8", "2.2". **ללא המרה.**
5. **O₂ (%)** — חמצן. דוגמאות: "20.9", "21.0". **ללא המרה.** 20.9% זה אוויר רגיל.
6. **H₂S (ppm)** — מימן גופרתי. הגיליון כולל 0 בדרך-כלל. **ללא המרה. 0 הוא ערך אמיתי שחייב להופיע בפלט (לא null).**
7. **NO₂ (ppm)** — חנקן דו-חמצני. הגיליון כולל 0 בדרך-כלל. **ללא המרה. 0 הוא ערך אמיתי שחייב להופיע בפלט (לא null).**
8. **SO₂ (ppm)** — גופרית דו-חמצנית. אותו דין כמו NO₂.
9. **TVOC** — שתי כותרות משנה: "mg/m³" ו-"ppb". בפועל יש בתא **ערך אחד** (למשל "189"). ה-FM-801 כותב ppb. **ערך זה הוא ppb → חלק ב-1000 כדי להמיר ל-ppm (189 → 0.189).**
10. **לחות יחסית (%)** — דוגמאות: "71.3", "66.3". **ללא המרה.**
11. **טמפ' יבשה (°C)** — טמפרטורה. דוגמאות: "23.4", "25.6". **ללא המרה.** (אם רשומה גם "טמפ' אפקטיבית" בעמודה הבאה — התעלם ממנה.)
12. **טמפ' אפקטיבית (°C)** — ← **דלג.**
13. **עצמת תאור (LUX)** — ← **דלג.**
14. **זרימת אויר (M/S)** — ← **דלג.**
15. **פורמ-אלדהיד (PPb)** — פורמלדהיד. דוגמאות: "20", "13". **זה ppb → חלק ב-1000 כדי להמיר ל-ppm (20 → 0.02).**
    ⚠️ לעיתים התא מכיל גם ערך בסוגריים (למשל "(2.32)" או "20(2.32)") — זה ערך שני במכשיר אחר. **קח את המספר השלם מחוץ לסוגריים**, לא את זה שבסוגריים.
16. **חלקיקים** — **שלושה ערכים לכל שורה: PM2.5, PM10, ו-TPM** (סך כל החלקיקים). התא בדרך-כלל כתוב בפורמט "X (Y) Z" או "X / (Y) / Z" או דומה. כל שלושת הערכים ביחידות µg/m³.
    - **pm25** = החלקיקים העדינים (PM2.5). בדרך-כלל הערך **הקטן ביותר**, או זה שבסוגריים.
    - **pm10** = החלקיקים הנשימים (PM10). ערך בינוני.
    - **tpm** = סך כל החלקיקים הכוללים (Total Particulate Matter / TSP). בדרך-כלל הערך **הגדול ביותר** (למשל "250", "1500").
    - **מיון כלל**: ממיין לפי גודל — pm25 ≤ pm10 ≤ tpm. אם רשום ב-mg/m³ → המר ל-µg/m³ על ידי כפל ב-1000.
    - אם מופיעים רק 2 ערכים: הקטן ל-pm25, הגדול ל-pm10, השאר tpm כ-null. אם רק 1 — ל-pm10.
    - אם ברור שהערכים לא מגיעים לפי הסדר הזה (למשל ה-TPM רשום ראשון בעמודה) — תעדיף את הגדלים: ערך 1000+ הוא TPM, ערך 10-200 הוא PM10, ערך 0-5 הוא PM2.5.
17. **O₃ / אוזון (ppm)** — אוזון. דוגמה: "0.03", "0". אם רשום ב-ppb (0, 03, 30) — חלק ב-1000. **ללא המרה אם ppm. 0 הוא ערך אמיתי.**

## הפלט שאתה מחזיר

מערך של עד **10 שורות** בדיוק באותו סדר של הגיליון. לכל שורה, החזר אובייקט עם:
- "name" — תוכן תא "מיקום" (כתב יד; אם לא מופיע — "").
- "values" — אובייקט עם המפתחות: co2, co, o2, h2s, no2, so2, ozone, tvoc, formaldehyde, pm25, pm10, tpm, temperature, humidity.

**חוקים**:
- שורה 1 תמיד נמצאת בפלט — אפילו אם רק חלק מהערכים ברורים. "אין מידע" לא מתקבל.
- תא ריק / "—" / "ND" → null.
- "0" → **0** (לא null!). זה ממצא חוקי בעמודות NO₂, SO₂, H₂S, O₃.
- פסיק עשרוני (23,5) → 23.5. פסיק אלפים (1,050) → 1050.
- "<0.01" → 0.01. ">1500" → 1500.
- המר TVOC ו-formaldehyde ואוזון (אם ppb) מ-ppb ל-ppm בחלוקה ב-1000 — **לא לשכוח**.
- קרא את כל 10 השורות שבגיליון. אל תעצור אחרי 2–3.
- מספרים בכתב יד שאינם קריאים לחלוטין (רק מהם) → null, אך השורה עצמה חייבת לחזור עם שאר ערכיה.
- "LUX", "זרימת אויר", "טמפ' אפקטיבית" — **אל תחזיר אותם**, אין להם מקום ב-schema.

**תהליך חובה — עשה את זה בראש לפני ההחזרה**:
לכל שורה 1 עד 10, רשום לעצמך את כל הערכים שאתה רואה בה (CO₂, CO, O₂, H₂S, NO₂, SO₂, אוזון, TVOC, לחות, טמפ' יבשה, פורמלדהיד, PM2.5, PM10, TPM) **בדיוק כפי שרשומים בגיליון** — לפני המרת היחידות. ואז המר, ואז החזר. בלי השלב הזה אתה נוטה לקרוא מספר שגוי מהתא השכן.

## דוגמה לפלט (שורה אחת)

לשורה בכתב יד שבה: CO₂=617, CO=1.8, O₂=20.9, H₂S=0, NO₂=0, SO₂=0, אוזון=0, TVOC=189 (ppb), לחות=71.3, טמפ' יבשה=23.4, פורמלדהיד=20 (ppb), חלקיקים="2.32 (11) 250" (PM2.5=2.32, PM10=11, TPM=250 µg/m³), ושם מיקום "זאב מגן ילדים":

{"name":"זאב מגן ילדים","values":{"co2":617,"co":1.8,"o2":20.9,"h2s":0,"no2":0,"so2":0,"ozone":0,"tvoc":0.189,"formaldehyde":0.02,"pm25":2.32,"pm10":11,"tpm":250,"temperature":23.4,"humidity":71.3}}

החזר JSON בלבד:
{"rows":[{"name":"...","values":{...}}, ...]}`;

export async function scanIaqLabImages(
  images: Array<{ bytes: Buffer; contentType: string }>,
): Promise<{ rows: ScannedIaqRow[]; pages: number; emptyPages: number }> {
  const empty: ScannedIaqResult = { rows: [] };
  const perPage = await Promise.all(
    images.map(async ({ bytes, contentType }) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const page = await scanIaqLabImage(bytes, contentType).catch(() => empty);
        if (page.rows.length > 0) return page;
      }
      return empty;
    }),
  );

  const rows: ScannedIaqRow[] = [];
  for (const page of perPage) rows.push(...page.rows);

  const emptyPages = perPage.filter((p) => p.rows.length === 0).length;
  if (rows.length === 0) {
    throw new IaqLabScanError(
      'לא זוהתה טבלת תוצאות בתמונה. צלמו קרוב יותר, רק את הטבלה, בלי כפל צילום.',
    );
  }

  return { rows, pages: images.length, emptyPages };
}

export async function scanIaqLabImage(
  bytes: Buffer,
  contentType: string,
): Promise<ScannedIaqResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new IaqLabScanError('לא הוגדר מפתח OpenAI בשרת.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new IaqLabScanError('התמונה גדולה מדי (מעל 20MB).');

  const model = process.env.OPENAI_VISION_MODEL || DEFAULT_VISION_MODEL;
  const dataUri = `data:${contentType};base64,${bytes.toString('base64')}`;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'תמלל את טבלת מדידות איכות האוויר שבתמונה. החזר JSON בלבד.' },
          { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
        ],
      },
    ],
    max_completion_tokens: 16000,
    response_format: { type: 'json_object' },
  };
  // "high" כי זה OCR של כתב-יד בטבלה צפופה — ההבדל בין "189" ל-"169" ובין "0" ל-"6"
  // הוא כולו באיכות הקריאה. "low" קורא שתי שורות ומוותר על השאר.
  if (/^(gpt-5|o\d)/.test(model)) body.reasoning_effort = 'high';

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
    throw new IaqLabScanError(
      (err as Error)?.name === 'AbortError'
        ? 'קריאת התמונה נמשכה זמן רב מדי. נסו שוב, או חתכו את התמונה לטבלת הערכים בלבד.'
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
      /* status line is enough */
    }
    throw new IaqLabScanError(`OpenAI השיב ${response.status}: ${detail}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new IaqLabScanError('המודל לא החזיר תוכן.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new IaqLabScanError('המודל לא החזיר JSON תקין.');
  }

  const raw = (parsed as { rows?: unknown }).rows;
  if (!Array.isArray(raw)) throw new IaqLabScanError('המודל לא החזיר שורות.');

  return {
    rows: raw.map(normalizeRow).filter((r): r is ScannedIaqRow => r !== null),
  };
}

/** מנקה שורה אחת — null לכל ערך שאינו מספר תקין. */
function normalizeRow(value: unknown): ScannedIaqRow | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const valuesRaw = (row.values ?? {}) as Record<string, unknown>;

  const values: Partial<Record<MeasurementKey, number | null>> = {};
  let hasAny = false;
  for (const k of MEASUREMENT_KEYS) {
    const v = valuesRaw[k];
    const num = coerceNumber(v);
    values[k] = num;
    if (num !== null) hasAny = true;
  }
  // שורה בלי שם ובלי אף ערך — ניטור ריק. דלג.
  if (!name && !hasAny) return null;
  return { name, values };
}

function coerceNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  // ND / N/D / "—" / "<LOD" — null. **"0" כן נחשב קריאה אמיתית** (לא-גילוי של
  // NO₂/SO₂ נרשם כ-"0" והמסקנה של ה-rules תתרגם אותו ל-"לא נמצאה…").
  if (/^(nd|n\/d|—|-)$/i.test(trimmed)) return null;
  const cleaned = trimmed.replace(/^[<>]/, '').replace(/,/g, '.').replace(/[^\d.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

/** תוויות עברית לפרמטרים — לנוחות הצד-קליינט שרוצה להציג "4 ערכים נקראו: CO₂, …". */
export const SCANNED_LABELS = MEASUREMENT_LABELS;
