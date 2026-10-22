import { AiDraftError } from './ai-text';

/**
 * Turns a spoken note into the sentence a report prints.
 *
 * The descriptive fields of a survey — what the place is, what surrounds it — are the
 * ones a surveyor is worst placed to type. They are written standing in a car park with
 * a meter in one hand, and they are exactly the fields where a phone keyboard turns a
 * sentence into three words and a full stop.
 *
 * Speaking them is the natural way to record them. Two steps: the audio is transcribed
 * verbatim, and the transcript is then tidied into the register the document uses —
 * spoken Hebrew is full of "אה", restarts and "כאילו", none of which belongs in an
 * expert opinion.
 *
 * The tidy step is deliberately conservative. It may drop filler and fix an ending; it
 * may not add a fact, an assessment or a measurement. A surveyor who says "בערך שלושה
 * מטר" gets "כשלושה מטרים", not "3 מטרים" — the hedge is theirs and the report keeps it.
 */

const TRANSCRIBE_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/**
 * `gpt-4o-transcribe` rather than whisper-1: it is markedly better on Hebrew, and on
 * recordings made outdoors with traffic behind them.
 */
const TRANSCRIBE_MODEL = 'gpt-4o-transcribe';
const TIDY_MODEL = 'gpt-5';
const TIMEOUT_MS = 60_000;

/** How long a note may be. A field description is a sentence or two, not a monologue. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export function transcriptionAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * The kinds of field a note can be dictated into.
 *
 * Each carries its own example, because "what the building is" and "what is around it"
 * are different sentences and a tidy pass with no target reads like neither.
 */
export type DictationField = 'siteDescription' | 'surroundings' | 'moldSiteDescription';

const FIELD_GUIDANCE: Record<DictationField, { label: string; example: string }> = {
  siteDescription: {
    label: 'תיאור המקום — מה המבנה ומה השימוש בו',
    example: 'בניין מגורים בן 3 קומות ו-2 כניסות בלב שכונת מגורים בתל אביב.',
  },
  surroundings: {
    label: 'סביבת המבנה — איך הוא יושב ביחס למה שסביבו',
    example: 'בין הבניין הנ"ל למבנים הסמוכים בין 6 מטרים ל-20 מטרים.',
  },
  /*
   * The mould report's own §3, which asks a different question from the asbestos one.
   *
   * There the description is what the building is and what it is used for. Here it is
   * which rooms were sampled and what distinguishes them — windows, air conditioning,
   * ventilation — because that is what explains why one room came back high and the
   * one beside it did not. The example steers the tidy pass towards that shape.
   *
   * The first line is kept short on purpose: it is also printed on the cover, so a
   * paragraph there would run across the title page.
   */
  moldSiteDescription: {
    label: 'תיאור המקום — אילו חללים נדגמו ומה מאפיין אותם',
    example:
      'משרדי רשות המחקר – בניין הסנאט.\n' +
      'חדרים 124-1 עד 124-3 כוללים חלון ומזגן עילי נפרד.\n' +
      'חדרים 124-4 עד 124-6 הם ללא חלונות.',
  },
};

/** Verbatim transcription. Nothing is interpreted at this stage. */
async function transcribe(audio: Blob, fileName: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AiDraftError('לא הוגדר מפתח OpenAI.');

  const form = new FormData();
  form.set('file', audio, fileName);
  form.set('model', TRANSCRIBE_MODEL);
  // Hebrew is stated rather than detected: a short note with a few English words in it
  // — "אסבסט צמנט" beside a brand name — is otherwise sometimes taken for English.
  form.set('language', 'he');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TRANSCRIBE_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AiDraftError(`התמלול נכשל (${res.status}). ${detail.slice(0, 160)}`);
    }
    const data = (await res.json()) as { text?: unknown };
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (text === '') throw new AiDraftError('לא זוהה דיבור בהקלטה. נסו שוב.');
    return text;
  } catch (err) {
    if (err instanceof AiDraftError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AiDraftError('התמלול לקח יותר מדי זמן. נסו הקלטה קצרה יותר.');
    }
    throw new AiDraftError('התמלול נכשל. בדקו את החיבור ונסו שוב.');
  } finally {
    clearTimeout(timer);
  }
}

const TIDY_SYSTEM_PROMPT = `אתה מנקה תמלול של הערה מוקלטת, כדי שתיכנס לחוות דעת של סוקר אסבסט מוסמך.

התמלול הוא דיבור חופשי שהוקלט בשטח. עליך להחזיר אותו כמשפט או שניים בעברית כתובה תקנית.

מותר לך:
- להסיר מילות מילוי: אה, אמ, כאילו, יעני, אוקיי, סבבה.
- להסיר התחלות שבורות וחזרות של אותה מילה.
- לתקן תחביר, פיסוק וסיומות.
- לנסח בלשון תיאורית עניינית, כמו במסמך רשמי.

אסור לך בהחלט:
- להוסיף עובדה, מספר, מידה או מיקום שלא נאמרו.
- להסיר עובדה שנאמרה.
- להוסיף הערכה, המלצה, אזהרה או מסקנה.
- לחדד אומדן. אם נאמר "בערך שלושה מטר" כתוב "כשלושה מטרים" ולא "3 מטרים" — ההסתייגות היא של הסוקר.
- לענות על השאלה במקום הסוקר. אם ההקלטה חלקית, החזר את מה שנאמר בלבד.

עברית בלבד, בלי ניקוד, בלי מירכאות מסביב לתשובה.

החזר JSON בלבד:
{"text": "..."}`;

async function tidy(raw: string, field: DictationField): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return raw;

  const guidance = FIELD_GUIDANCE[field];
  const userMessage = [
    `השדה: ${guidance.label}.`,
    `דוגמה לסגנון הנדרש בשדה הזה: "${guidance.example}"`,
    '',
    'התמלול הגולמי:',
    raw,
  ].join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || TIDY_MODEL,
        messages: [
          { role: 'system', content: TIDY_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_completion_tokens: 800,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return raw;

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return raw;

    const parsed = JSON.parse(content) as { text?: unknown };
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    return text || raw;
  } catch {
    // The transcript is already useful; a tidy pass that fails costs polish, not the note.
    return raw;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A spoken note, transcribed and tidied into the field's own register.
 *
 * Returns both, so the caller can show what was actually said if the tidy pass produced
 * something the surveyor did not mean.
 */
export async function dictateField(
  audio: Blob,
  fileName: string,
  field: DictationField,
): Promise<{ text: string; raw: string }> {
  const raw = await transcribe(audio, fileName);
  const text = await tidy(raw, field);
  return { text, raw };
}
