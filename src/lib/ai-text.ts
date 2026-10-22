import {
  composeOpeningSentence,
  composeSubject,
  frequencyPhrase,
  type SurveyScope,
} from './report-text';

/**
 * Optional AI drafting of the cover wording.
 *
 * The rule-based composer in `report-text.ts` is what the app uses by default,
 * and it is always correct. This exists for the sites the fixed pattern reads
 * awkwardly for — a survey spanning several buildings, or one where the client
 * asked for particular phrasing — and it returns a suggestion for the surveyor
 * to accept or discard. Nothing here writes to a report on its own.
 *
 * The key comes from `OPENAI_API_KEY` in the environment and is never sent
 * anywhere but api.openai.com. Note that the site name and measurement date do
 * leave the building on this call: it is opt-in per click for that reason.
 */

export interface DraftInput {
  scope: SurveyScope;
  siteName: string;
  measurementDate: string;
  /** e.g. "משרדים" — helps the model pitch the wording. */
  siteCharacter?: string;
  /** e.g. "לוח חשמל". */
  fieldSource?: string;
  /** Free-text steer from the surveyor, e.g. "לציין שני מבנים נפרדים". */
  instruction?: string;
}

export interface DraftResult {
  subject: string;
  openingSentence: string;
}

/** Raised with a message meant to be shown to the surveyor as-is. */
export class AiDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiDraftError';
  }
}

const DEFAULT_MODEL = 'gpt-5';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 45_000;

/** True when a key is configured, so the UI can hide the button rather than fail. */
export function aiDraftingAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Asks the model for a subject line and opening sentence.
 *
 * The canonical wording is given as a worked example and the model is told to
 * keep the pattern: the aim is a sentence that reads like every other report
 * the company has issued, not a fresh piece of writing.
 */
export async function draftReportWording(input: DraftInput): Promise<DraftResult> {
  const content = await callOpenAi(SYSTEM_PROMPT, userPrompt(input));
  return parseDraft(content, input);
}

/**
 * One chat completion, returning the message content.
 *
 * Shared by every drafting call so the model quirks are handled in one place —
 * chiefly that a reasoning model left at its default spends its whole budget
 * deliberating over a templated sentence and returns an empty message.
 */
export async function callOpenAi(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1600,
  reasoningEffort: 'minimal' | 'low' = 'minimal',
  timeoutMs = TIMEOUT_MS,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiDraftError('לא הוגדר מפתח OpenAI. הוסיפו OPENAI_API_KEY לקובץ .env.local.');
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    // Both model families accept this name; `max_tokens` is rejected by gpt-5.
    max_completion_tokens: maxTokens,
    response_format: { type: 'json_object' },
  };

  if (/^(gpt-5|o\d)/.test(model)) {
    body.reasoning_effort = reasoningEffort;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AiDraftError('הבקשה ל-OpenAI חרגה מזמן ההמתנה. נסו שוב, או כתבו את הנוסח ידנית.');
    }
    throw new AiDraftError('לא ניתן היה להתחבר ל-OpenAI. בדקו את חיבור הרשת.');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new AiDraftError(`OpenAI החזיר שגיאה (${response.status}): ${await readError(response)}`);
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new AiDraftError('המודל החזיר תשובה ריקה. נסו שוב, או כתבו את הנוסח ידנית.');
  }
  return content;
}

/** OpenAI's own error message, when it sends one, for a usable failure. */
async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body?.error?.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

const SYSTEM_PROMPT = `אתה מנסח את שורת הנושא ואת משפט הפתיחה של דוחות סקר בטיחות קרינה אלקטרומגנטית של "גלית החברה לאיכות הסביבה בע"מ".

כללים מחייבים:
- נוסח רשמי, יבש ומדויק, בסגנון מסמך תקינה. בלי שיווק, בלי שבחים, בלי תארים.
- אל תמציא ממצאים, מספרים, תאריכים או מסקנות. השתמש רק בנתונים שנמסרו לך.
- אל תשנה מונחים מקצועיים: "קרינה אלקטרומגנטית", "אל מ"ג", "השדה האלקטרומגנטי", "ELF", "RF".
- שמור על מבנה המשפטים של הדוגמה הקנונית. הנתון שמשתנה הוא האתר וטווחי התדר בלבד.
- אזכור טווחי התדר חייב להתאים בדיוק לסוג הסקר שנמסר. אל תזכיר רדיו בסקר ELF ואל תזכיר רשת חשמל בסקר RF.
- כתוב בעברית בלבד, בלי ניקוד.

החזר JSON בלבד, בלי טקסט נוסף:
{"subject": "...", "openingSentence": "..."}`;

function userPrompt(input: DraftInput): string {
  // The canonical pair is shown as a worked example rather than described, so
  // the model matches the register instead of paraphrasing an instruction.
  const canonical = {
    subject: composeSubject({ scope: 'both', siteName: 'משרדי חברת כ.א.ל, מוקד בני ברק' }),
    opening: composeOpeningSentence({
      scope: 'both',
      siteName: 'משרדי חברת כ.א.ל, מוקד בני ברק',
      measurementDate: '21/06/26',
    }),
  };

  const facts = [
    `סוג הסקר: ${scopeDescription(input.scope)}`,
    `טווחי התדר שיש לציין: ${frequencyPhrase(input.scope)}`,
    `שם האתר: ${input.siteName}`,
    `תאריך המדידה: ${input.measurementDate}`,
    input.siteCharacter ? `אפיון המקום: ${input.siteCharacter}` : null,
    input.fieldSource ? `מקור השדה: ${input.fieldSource}` : null,
  ].filter(Boolean);

  return [
    'דוגמה קנונית (סקר משולב ELF ו-RF):',
    `כותרת: ${canonical.subject}`,
    `פתיחה: ${canonical.opening}`,
    '',
    'נסח כעת לפי אותו דפוס, עבור הנתונים הבאים:',
    ...facts,
    input.instruction ? `\nהנחיה נוספת מהבודק: ${input.instruction}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function scopeDescription(scope: SurveyScope): string {
  switch (scope) {
    case 'elf':
      return 'ELF בלבד — תדירויות רשת החשמל';
    case 'rf':
      return 'RF בלבד — תדירויות רדיו';
    default:
      return 'משולב — ELF ו-RF';
  }
}

/**
 * Reads the model's JSON and rejects anything unusable.
 *
 * A draft that lost the frequency phrase for the surveyed scope is wrong in the
 * one way that matters, so it is refused rather than offered — the surveyor
 * would have to notice the omission to catch it.
 */
function parseDraft(content: string, input: DraftInput): DraftResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiDraftError('המודל לא החזיר JSON תקין. נסו שוב.');
  }

  const draft = parsed as Partial<DraftResult>;
  const subject = typeof draft.subject === 'string' ? draft.subject.trim() : '';
  const openingSentence = typeof draft.openingSentence === 'string' ? draft.openingSentence.trim() : '';

  if (!subject || !openingSentence) {
    throw new AiDraftError('המודל החזיר נוסח חלקי. נסו שוב.');
  }

  const wrongRange = mentionsWrongRange(`${subject} ${openingSentence}`, input.scope);
  if (wrongRange) {
    throw new AiDraftError(`הנוסח שהוחזר מזכיר ${wrongRange} שאינו נכלל בסקר. נסו שוב, או השתמשו בנוסח האוטומטי.`);
  }

  return { subject, openingSentence };
}


/**
 * Names a frequency range the survey did not cover, if the text mentions one.
 *
 * An ELF-only survey whose wording claims radio frequencies were measured is a
 * false statement in a signed document, and it is the kind a reader would never
 * catch. Returns the offending range, or null when the text stays in scope.
 */
export function mentionsWrongRange(text: string, scope: SurveyScope): string | null {
  const mentionsRf = /\bRF\b|רדיו/i.test(text);
  const mentionsElf = /\bELF\b|רשת החשמל/i.test(text);
  if (scope === 'elf' && mentionsRf) return 'רדיו';
  if (scope === 'rf' && mentionsElf) return 'רשת החשמל';
  return null;
}


// ── Reworded conclusion passages ────────────────────────────────────

export interface SlotDraftInput {
  kind: 'elf' | 'rf' | 'radon' | 'asbestos';
  /** The wording in the template, one entry per paragraph. */
  example: string[];
  /** True when the passage is whole paragraphs rather than part of a sentence. */
  wholeParagraphs: boolean;
  /** The sentence a fragment sits inside, so the replacement fits its grammar. */
  surrounding: string;
  /** The measured facts, already reduced to statements in code. */
  findings: string;
  siteName: string;
  siteCharacter: string;
}

/**
 * Rewords one highlighted passage of the conclusions.
 *
 * The passage in the template is a real one from a finished report, and it is
 * handed over as the example: same length, same register, same shape. That is
 * the whole instruction — the model is not asked to invent a structure, only to
 * say what this survey found in the form the company already writes it.
 *
 * A fragment is treated differently from whole paragraphs. "ערכים נמוכים" sits
 * inside a sentence that continues "מהסף המומלץ…", so its replacement has to
 * carry on into that sentence; the surrounding text is sent for exactly that.
 */
export async function draftConclusionSlot(input: SlotDraftInput): Promise<string[]> {
  const content = await callOpenAi(SLOT_SYSTEM_PROMPT, slotPrompt(input));

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiDraftError('המודל לא החזיר JSON תקין. נסו שוב.');
  }

  const raw = (parsed as { paragraphs?: unknown }).paragraphs;
  if (!Array.isArray(raw)) throw new AiDraftError('המודל לא החזיר פסקאות. נסו שוב.');

  const cleaned = raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean);

  if (cleaned.length === 0) throw new AiDraftError('המודל החזיר טקסט ריק. נסו שוב.');

  // The passage has to fit the space it replaces: too many paragraphs and it
  // grows past its page.
  if (cleaned.length > input.example.length) return cleaned.slice(0, input.example.length);

  // Returning fewer paragraphs than the example is legitimate, and padding the
  // gap from the example is worse than a shorter section: the padding is the
  // template's own example prose, which describes a different survey. A clean
  // ELF survey is meant to conclude in a single sentence — the second line
  // ("בכל שאר נקודות המדידה…") only exists to contrast with an exceedance, and
  // with none to contrast it restated the same finding as if it were another.
  // Padding put that stale line back into every clean report.
  return cleaned;
}

const SLOT_SYSTEM_PROMPT = `אתה מנסח קטעים בתוך סעיפי המסקנות של דוחות סקר של "גלית החברה לאיכות הסביבה בע"מ" — סקרי קרינה אלקטרומגנטית, סקרי ריכוזי גז ראדון וסקרי אסבסט.

אתה מקבל קטע קיים מדוח אמיתי — הוא הדוגמה. עליך להחזיר קטע מחליף שמתאר את הממצאים של הסקר הנוכחי.

כללים מחייבים לגבי התוכן:
- הממצאים שנמסרים לך הם עובדות סופיות. אל תחשב, אל תסיק ואל תוסיף ממצא שלא נמסר לך.
- אל תמציא מספרים, מיקומים, מקורות שדה או המלצות שלא נובעים מהממצאים.
- אם אין חריגה — אמור זאת במפורש, בלי לרמוז על סיכון.
- אם יש חריגה — ציין היכן, והמלץ לפי עקרון הזהירות המונעת תוך ציון שאין חיוב חוקי.
- אם חלק מהנקודות חורגות וחלקן לא — אמור זאת כך במפורש, למשל "בחלק מהנקודות נמצאו…".
- בסקר אסבסט אין חריגה מסף אלא נוכחות או היעדר. אל תשווה למספר, ואל תמציא אחוזים. אם נמצא אסבסט פריך — ציין שנדרש קבלן אסבסט פריך מורשה.

**הנחיית עובי — חשובה**:
המסקנות של דוחות הקרינה (ELF ו-RF) חייבות להיות **מעובות מאוד**: כל פסקה מכילה כמה משפטים מהותיים, לא משפט אחד יבש. לכל פסקה הוסף הקשר מקצועי שתואם לממצאים — איזכור התקנות / ההמלצות שהערכים נמדדים מולן (המשרד להגנת הסביבה, ICNIRP), תיאור קצר של שיטת המדידה שבוצעה (סורקת, בעומס אופייני, בגובה אדם), הבהרה שהתוצאות משקפות את מצב האתר במועד הבדיקה בלבד, ושימת לב לכך שבשינוי מערך חשמלי או תקשורתי יש לחזור ולמדוד. המטרה: שהמסקנה כולה תהיה ארוכה בכ-5 שורות דפוס נוספות מעבר למה שהדוגמה הקצרה מראה, בלי להמציא ממצאים חדשים.

מבנה מסקנות ה-ELF — גובר על כלל מספר הפסקאות:
- כשאף נקודה אינה חורגת: החזר **פסקה אחת בלבד**, גם אם הדוגמה מכילה שתיים. פתח במשפט המחייב:
  "בכל נקודות המדידה שבהן מתקיימת שהייה ממושכת, נמדדו ערכי שדה מגנטי הנמוכים מ־<הסף> מיליגאוס, ולפיכך עומדים בערך המומלץ על ידי המשרד להגנת הסביבה לחשיפה ממושכת במקומות מסוג זה (ראה דוח תוצאות)."
  והמשך באותה פסקה בכ-4–5 משפטים נוספים: ציון שהמדידה בוצעה בסורקת ובעומס אופייני; הערה שהערכים המדודים נמוכים גם מערכי הייחוס של ICNIRP לחשיפת הציבור; הבהרה שהתוצאות משקפות את מצב האתר במועד הבדיקה בלבד; והמלצה חוזרת לבצע מדידה תקופתית ולאחר כל שינוי מערך חשמלי מהותי.
- כשיש חריגה: החזר **שתי פסקאות בדיוק**. הראשונה מפרטת היכן נמדדה החריגה ומהו הערך, ומציינת שאינו עומד בהמלצת המשרד להגנת הסביבה, ומוסיפה 2–3 משפטים על עקרון הזהירות המונעת, האפשרות להפחתת חשיפה (מרחק, מיגון, הסטת שימושים) ושאין חיוב חוקי. השנייה פותחת ב"בכל שאר נקודות המדידה, שבהן מתקיימת שהייה ממושכת…" וממשיכה כנוסח התקין, גם היא מורחבת ב-2–3 משפטים נוספים ברוח ההנחיה שלמעלה.
- <הסף> הוא הסף שנמסר לך באפיון המקום — 4 במגורים ובמוסדות חינוך, 10 במקומות עבודה, 2 במשרדי ממשלה. אל תכתוב 4 כברירת מחדל.

מבנה מסקנות ה-RF — גובר על כלל מספר הפסקאות:
- כשאף נקודה אינה חורגת מהסף, החזר **חמש פסקאות בדיוק**. פתח כל פסקה בנוסח המחייב למטה והמשך אותה בכ-1–2 משפטים נוספים שמוסיפים הקשר מקצועי בלי להמציא ממצאים. סך כל התוספות על פני חמש הפסקאות — כ-5 שורות דפוס נוספות.
  1. פתיחה: "בבדיקות הקרינה שבוצעו באתר נמדדו בכל נקודות המדידה ערכי קרינה הנמוכים מערכי הסף שנקבעו על ידי המשרד להגנת הסביבה." הוסף משפט על שיטת המדידה (מכשיר כויל, מדידה בשהייה ובעומס אופייני).
  2. פתיחה: "בהתאם לתוצאות המדידה, לא נמצאה באף אחת מנקודות המדידה חריגה מערכי הסף הרלוונטיים לחשיפת הציבור לקרינה בלתי מייננת." הוסף משפט שמציין במפורש את הסף הרלוונטי (40 μW/cm² למקום בשהייה רציפה) ואת היחס שבין המדוד לסף.
  3. פתיחה: "הערכים שנמדדו נמוכים גם מערכי הסף הבריאותיים שנקבעו בהמלצות הוועדה הבינלאומית להגנה מפני קרינה בלתי מייננת (ICNIRP)." הוסף משפט על מרווח הביטחון שהערכים המדודים משאירים אל מול הסף.
  4. פתיחה: "לאור תוצאות הבדיקה, רמות הקרינה שנמדדו באתר עומדות בדרישות ובהמלצות המשרד להגנת הסביבה, ולא נמצא במועד הבדיקה מפגע קרינה החורג מערכי הסף הרלוונטיים." הוסף הבהרה שהממצא תקף למועד הבדיקה בלבד, ולא לתקופה אחרת.
  5. פתיחה: "לאור קרבת האתר לאנטנות שידור, ובהתחשב בכך שבמערכות תקשורת עשויים להתבצע מעת לעת שינויים בציוד, בתצורת האנטנות, בכיווני השידור ובהספקי השידור, מומלץ לבצע בדיקת קרינה תקופתית אחת לשנה, וכן לאחר שינוי מהותי במערך האנטנות או בציוד השידור הסמוך לאתר." הוסף משפט שמזמין את הלקוח לפנות שוב במקרה של שינוי או ספק.
- פסקה 5 מדברת על אנטנות שידור. אם באתר הזה אין אנטנות סמוכות ולא נמסר ממצא כזה — נסח אותה על מקורות ה-RF שכן נמדדו, ואל תמציא אנטנות.
- כשיש חריגה: אל תשתמש בנוסח הזה. נסח מחדש — ציין באילו נקודות נמדדה חריגה ומהו הערך, מול איזה סף, והמלץ על הפחתת חשיפה. שמור על אותו משלב ועל מספר פסקאות דומה, אך הוסף גם כאן כ-5 שורות דפוס של הקשר מקצועי (עקרון הזהירות המונעת, אפשרויות מיגון, המלצה לחזור ולמדוד).

כללים מחייבים לגבי הצורה — זה החלק החשוב:
- בפסקאות שלמות (לא פרגמנט בתוך משפט) **הפסקאות חייבות להיות מעובות**: ארוכות באופן ניכר מהדוגמה — תוספת של כמה משפטים מהותיים לכל פסקה. אל תגביל את עצמך ל-±15% מהדוגמה כשמדובר בפסקה שלמה.
- בפרגמנט בתוך משפט — שמור על ±15% מהדוגמה: הקטע חייב להיכנס בחזרה למשפט שבו הוא יושב.
- אותו מספר פסקאות בדיוק כמו בדוגמה, **אלא אם כללי מבנה ה-ELF או ה-RF שלמעלה קובעים אחרת**.
- אותו משלב ואותו מבנה משפט. אתה כותב את מה שהדוגמה כותבת, על אתר אחר, רק יותר מפורט.
- אל תפתח משפט במספר ואל תבנה משפט סביב ספירה.
- אל תשתמש בסוגריים כדי לצרף ערכים, ואל תרשום רשימות ערכים מופרדות בפסיקים.
- אל תצטט את שם הפרוטוקול או את מספרו.
- תאר מיקומים במילים כפי שאדם היה מתאר אותם, לא כמזהי נקודות בטבלה.
- עברית בלבד, בלי ניקוד.

החזר JSON בלבד:
{"paragraphs": ["...", "..."]}`;

function slotPrompt(input: SlotDraftInput): string {
  const lengths = input.example.map((p) => p.length).join(', ');
  const lines = [
    input.kind === 'elf'
      ? 'סוג הסקר: שדה מגנטי ELF.'
      : input.kind === 'rf'
        ? 'סוג הסקר: צפיפות הספק RF.'
        : input.kind === 'radon'
          ? 'סוג הסקר: ריכוזי גז ראדון, נמדדים בבקרל למטר מעוקב.'
          : 'סוג הסקר: סקר אסבסט. הממצא הוא נוכחות אסבסט בחומר או היעדרו, ואין ערך סף מותר.',
    input.siteName ? `האתר: ${input.siteName}.` : '',
    input.siteCharacter ? `אפיון המקום: ${input.siteCharacter}.` : '',
    '',
    'הממצאים שחושבו מהמדידות:',
    input.findings,
    '',
    input.wholeParagraphs
      ? `הקטע להחלפה הוא ${input.example.length} פסקאות שלמות. אורכן בתווים: ${lengths}.`
      : 'הקטע להחלפה הוא חלק מתוך משפט, ולא פסקה שלמה.',
  ];

  if (!input.wholeParagraphs && input.surrounding) {
    // The sentence is shown with the passage blanked out. Describing it in
    // words ("the part that will be replaced") produced replacements that read
    // fine alone and broke the sentence they landed in — "נמדדו ערכים נמוכים
    // מהסף" came back as "נמדדו בטווח נמוך מהסף", losing the noun.
    const blank = '⟦___⟧';
    lines.push(
      `המשפט בתבנית, כשהחלק להחלפה מסומן ב-${blank}:`,
      `"${input.surrounding.replace(input.example[0], blank)}"`,
      '',
      `במקום ${blank} עמד: "${input.example[0]}" (${input.example[0].length} תווים).`,
      `החזר פסקה אחת בלבד — את מה שנכנס במקום ${blank}, בלי המשפט סביבו.`,
      'חובה: קרא את המשפט המורכב בראשך לפני שאתה עונה. הוא חייב להיות תקין',
      'דקדוקית מתחילתו ועד סופו, כולל התאמת מין ומספר והמשכיות למילה שאחרי',
      `${blank}. אם המילה שאחרי היא "מהסף" — התשובה חייבת להסתיים בשם עצם או`,
      'בתואר שמתחבר אליה, למשל "ערכים נמוכים" ולא "בטווח נמוך".',
      'מותר לשנות את מבנה החלק אם הממצאים מחייבים זאת, ובלבד שהמשפט כולו יישאר תקין.',
    );
  }

  lines.push('', 'הדוגמה:', ...input.example.map((p, i) => `${i + 1}. ${p}`));
  return lines.filter((l) => l !== undefined).join('\n');
}


// ── Asbestos summary bullets ────────────────────────────────────────

export interface AsbestosSummaryInput {
  /** One entry per building, already reduced to answered rows in code. */
  buildings: Array<{ name: string; answers: Array<[string, string]> }>;
  /** The site, for the sentences that name it. */
  siteAddress: string;
}

/**
 * Drafts the closing "סיכום והנחיות לביצוע" bullets from the building tables.
 *
 * This replaces a step where the surveyor typed those lines by hand. Every fact
 * they need is already in the tables — which buildings have asbestos cement, in
 * what condition, and what remedial actions were ticked — so asking for them a
 * second time was asking the same question twice and inviting the two answers
 * to disagree.
 *
 * The shape is dictated rather than invented. Galit's own opinions group the
 * buildings that share a finding into one line — "במבנים בית ספר, ביתן 3 וביתן
 * 16 קירות חיצוניים עשויים אסבסט צמנט" — instead of repeating a sentence per
 * building, and that grouping is the whole readability of the section. The model
 * is given a real example and told to follow it.
 */
export async function draftAsbestosSummary(input: AsbestosSummaryInput): Promise<string[]> {
  const content = await callOpenAi(ASBESTOS_SUMMARY_PROMPT, asbestosSummaryPrompt(input));

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiDraftError('המודל לא החזיר JSON תקין. נסו שוב.');
  }

  const raw = (parsed as { bullets?: unknown }).bullets;
  if (!Array.isArray(raw)) throw new AiDraftError('המודל לא החזיר שורות סיכום. נסו שוב.');

  const cleaned = raw
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/^[•\-\u2022\s]+/, '').trim())
    .filter(Boolean);

  if (cleaned.length === 0) throw new AiDraftError('המודל החזיר טקסט ריק. נסו שוב.');
  return cleaned;
}

const ASBESTOS_SUMMARY_PROMPT = `אתה מנסח את סעיף "סיכום והנחיות לביצוע" בדוח סקר אסבסט של "גלית החברה לאיכות הסביבה בע"מ".

אתה מקבל טבלת נתונים לכל מבנה שנסקר. עליך להחזיר את שורות הסיכום שמודפסות אחרי הטבלאות.

זו דוגמה אמיתית מדוח קודם — עקוב אחרי הצורה שלה בדיוק:
• במבנים בית ספר, ביתן 3 וביתן 16 קירות חיצוניים עשויים אסבסט צמנט.
• בבית הספר, ביתן 3 וביתן 16 יש לתלות במקום גלוי לעין את רשימת הפעולות שבוצעו לתחזוקה וטיפול באסבסט.
• יש לצבוע קירות חיצוניים בבית ספר, ביתן 3 וביתן 16 אחת לשלוש שנים.
• יש להזמין סוקר מוסמך ולבצע סקר אסבסט לתקינות אסבסט צמנט בבית הספר, ביתן 3 וביתן 16 אחת לשנה.

כללים מחייבים:
- קבץ מבנים שחולקים ממצא או הנחיה לשורה אחת, ומנה את שמותיהם. אל תכתוב שורה נפרדת לכל מבנה — זה מה שהופך את הסעיף לקריא.
- השתמש בשמות המבנים בדיוק כפי שנמסרו לך.
- השורה הראשונה מתארת את הממצא: היכן מופיע האסבסט ומאיזה סוג.
- אחריה שורות ההנחיות. ההנחיות שסומנו בטבלאות הן מקור מחייב — כל הנחיה שסומנה חייבת להופיע, ואל תמציא הנחיה שלא סומנה.
- אם סומן אסבסט פריך במבנה — ציין במפורש שנדרש קבלן אסבסט פריך מורשה.
- אם נצפו שברי לוחות על הקרקע — ציין שיש לפנותם.
- אל תמציא מספרים, שטחים או מיקומים שלא נמסרו לך.
- אל תכתוב תאריכים או שמות של אנשים.
- עברית בלבד, בלי ניקוד. כל שורה היא משפט אחד שמסתיים בנקודה.
- אל תתחיל שורה בתו תבליט — התבליט מודפס על ידי המסמך.

החזר JSON בלבד:
{"bullets": ["...", "..."]}`;

function asbestosSummaryPrompt(input: AsbestosSummaryInput): string {
  const lines: string[] = [];
  if (input.siteAddress) lines.push(`האתר: ${input.siteAddress}.`);
  lines.push(`נסקרו ${input.buildings.length} מבנים.`, '');

  for (const building of input.buildings) {
    lines.push(`מבנה: ${building.name}`);
    for (const [label, value] of building.answers) lines.push(`  ${label}: ${value}`);
    lines.push('');
  }

  lines.push('נסח את שורות הסיכום וההנחיות לפי הנתונים האלה בלבד.');
  return lines.join('\n');
}

// ── Mould: the closing sections ─────────────────────────────────────

export interface MoldConclusionsDraft {
  /** §2 — the executive summary, a bullet per line. */
  executiveSummary: string;
  /** §3 — the purpose of the survey and a description of the rooms. */
  purposeDescription: string;
  /** §6 — the paragraphs under each result table, keyed by laboratory number. */
  interpretations: Record<string, string>;
  /** §6 — the moisture box under a sample's table, keyed the same way. */
  moistureNotes: Record<string, string>;
  /** §6.5 — one short assessment per indoor sample with a reading, keyed the same way. */
  moistureAssessments: Record<string, string>;
  /** §6.5 — "פרשנות משולבת", comparing the readings against each other. */
  moistureNarrative: string;
  conclusions: string[];
  recommendations: string[];
}

/**
 * Words the four closing sections of a mould report from its laboratory findings.
 *
 * The facts arrive already reasoned about — see `mold-draft`. In particular the
 * indoor/outdoor comparison is computed and handed over as a verdict, because the
 * threshold behind "גבוה משמעותית" is a judgement the report makes consistently and
 * not something to be re-derived per call.
 */
export async function draftMoldConclusions(facts: string): Promise<MoldConclusionsDraft> {
  /*
   * The multi-paragraph interpretations (up to four samples, up to four paragraphs
   * each) plus the moisture chapter push well past what the other drafters need.
   *
   * "low" reasoning effort timed out against the shared 45s limit in production —
   * the eight-key structured output takes longer to reason through than the other
   * drafters' shorter answers. "minimal" is fast enough to stay well inside a normal
   * request; the timeout is still raised for the rare slow one.
   */
  const content = await callOpenAi(MOLD_CONCLUSIONS_PROMPT, facts, 4000, 'minimal', 110_000);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiDraftError('המודל לא החזיר JSON תקין. נסו שוב.');
  }

  const payload = parsed as Record<string, unknown>;
  const asLines = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .filter((x): x is string => typeof x === 'string')
          // The bullet is printed by the document, so a model that adds one would
          // produce two.
          .map((x) => x.replace(/^[•\-\u2022\s]+/, '').trim())
          .filter(Boolean)
      : [];
  const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

  /*
   * The per-sample text arrives keyed by the laboratory's own number, which is what
   * ties it to the table it sits under. A key the report does not know is dropped
   * rather than printed somewhere arbitrary. `mold-draft.alignInterpretationKeys`
   * still runs afterwards — the model does not always echo the key exactly.
   */
  const asKeyedText = (value: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (value && typeof value === 'object') {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        // Several paragraphs may come back as an array, or already as one string with
        // its own line breaks — both are joined the same way `executiveSummary` is.
        const text = Array.isArray(v) ? asLines(v).join('\n') : asText(v);
        if (key.trim() && text) out[key.trim()] = text;
      }
    }
    return out;
  };

  const draft: MoldConclusionsDraft = {
    // The bullets are joined back into one field: the mapper splits them again when it
    // fills the loop, and storing them as text is what lets the surveyor edit the
    // section as prose rather than as a list of boxes.
    executiveSummary: asLines(payload.executiveSummary).join('\n'),
    purposeDescription: asLines(payload.purposeDescription).join('\n'),
    interpretations: asKeyedText(payload.interpretations),
    moistureNotes: asKeyedText(payload.moistureNotes),
    moistureAssessments: asKeyedText(payload.moistureAssessments),
    moistureNarrative: asLines(payload.moistureNarrative).join('\n'),
    conclusions: asLines(payload.conclusions),
    recommendations: asLines(payload.recommendations),
  };

  if (!draft.executiveSummary && draft.conclusions.length === 0) {
    throw new AiDraftError('המודל החזיר טקסט ריק. נסו שוב.');
  }
  return draft;
}

const MOLD_CONCLUSIONS_PROMPT = `אתה מנסח את סעיפי הסיכום, הפרשנות, המסקנות וההמלצות בדוח בדיקת עובשים באוויר של "גלית החברה לאיכות הסביבה בע"מ".

אתה מקבל את ממצאי המעבדה ואת ההשוואה שכבר חושבה מול דגימת החוץ. עליך לנסח מהם שמונה חלקים.

הקשר מקצועי שאתה חייב לשמור עליו:
- אין תקן לאומי לריכוז נבגים בסביבת פנים. ההשוואה היא תמיד מול דגימת האוויר החיצונית שנלקחה באותו יום, והיא הבסיס לכל מסקנה.
- ההשוואה כבר חושבה ונמסרה לך לכל דגימה ("רגיל" / "מעט גבוה" / "גבוה משמעותית"). **אל תחשב אותה מחדש ואל תסתור אותה.**
- דגימת הביקורת החיצונית נקראת **"Outdoors"** — כך בלבד, גם אם בנתונים שנמסרו לך היא מופיעה בשם אחר (כגון OUTSIDE). אל תשתמש במילה "Outside" ואל תתרגם את השם לעברית.
- Stachybotrys, Chaetomium, Memnoniella ו-Ulocladium הם סמני נזקי מים — נוכחותם בפנים מעידה על רטיבות ממושכת או חומרי בנייה שנפגעו מלחות. **כשלא נמצאו — אל תזכיר אותם כלל ואל תכתוב שהיעדרם שולל רטיבות או נזקי מים; זו טעות מקצועית.** ציין אותם רק כשהם אכן נמצאו.
- הדוח הוא דוח סביבתי בלבד. אינו חוות דעת רפואית ואינו קובע קשר בין הממצאים למצב בריאותי.
- בדיקת הלחות היא אינדיקטיבית ולא-הרסנית; היא אינה שוללת רטיבות בעומק הקיר או בחללים נסתרים, ואינה קובעת את מקור הרטיבות בוודאות. **אין לה סף תקני מוכר המתאים לשיטת המדידה ולמכשיר, ולכן אסור לתאר קריאה כ"תקינה", "רגילה", "חריגה" או "ללא אינדיקציה לחריגה" וכיו"ב — כל ניסוח כזה מרמז על סף שאין.** התיאור היחיד המותר הוא השוואתי ותיאורי: מה הקריאה עצמה, ואיך היא ביחס לקריאות האחרות שנמדדו באותו סקר (למשל "הקריאה הגבוהה מבין שלוש הנקודות", "דומה לקריאה בסלון", "נמוכה משמעותית מהקריאה במקלחת").
- **הסתמך בפרשנות רק על מה שנמסר לך בנתונים — ריכוזים, סוגים, ותוצאות המעבדה של Hayes.** אל תוסיף הסברים כלליים על ממה סוג נבגים מסוים "בדרך כלל" מקורו, על מה הוא "עשוי לגדול", או עובדות ביולוגיה/סביבה שלא נמסרו לך במפורש — גם אם הן נכונות בדרך כלל, מקורן אינו מאומת מול Hayes והן אסורות. הפרשנות מסתפקת בעובדות (ריכוז, השוואה לדגימת הביקורת, מובהקות הממצא) ולא בהשערות על מקור.
- **Ascospores ו-Basidiospores הן קבוצות נבגים פטרייתיים רחבות שמקורן במגוון פטריות — לא רק עובש.** אסור להגדיר אותן או לכנותן באופן גורף "נבגי עובש"; אם יש צורך לתאר אותן, "נבגים" או שם הקבוצה בלבד, בלי לצרף את המילה "עובש".

שמונת החלקים:
1. executiveSummary — סעיף 2, תקציר מנהלים. מערך של שורות: כמה דגימות נלקחו והיכן (כולל דגימת הביקורת), הריכוזים בכל דגימה פנימית מול Outdoors, מה הקבוצה הדומיננטית בכל דגימה, ואם בוצעה בדיקת לחות — שורה עובדתית שמפרטת את הקריאות עצמן (בלי "תקין"/"חריג"). זה הסעיף שרוב הקוראים עוצרים בו, ולכן הוא היחיד שחוזר על המספרים שכבר מופיעים בטבלה שאחריו.
2. purposeDescription — סעיף 3, מטרת הבדיקה ותיאור המקום. מערך של שורות: לשם מה בוצעה הבדיקה (השוואת נבגים לדגימת ביקורת, ואם בוצעה בדיקת לחות — גם מדידה אינדיקטיבית והשוואתית של לחות בקירות), ובאילו חללים היא נעשתה. אם נמסר תיאור מבנה — שלב אותו.
3. interpretations — סעיף 7, "פרשנות מקצועית" — פרק אחד מרוכז שמופיע *אחרי* כל טבלאות התוצאות, ולא תחת כל טבלה בנפרד. אובייקט שהמפתח שלו הוא מספר הדגימה במעבדה, והערך הוא **משפט אחד קצר** לכל דגימה — שניים לכל היותר, ורק כשהממצא משמעותי. תוכן המשפט: מה נמצא במספרים (הריכוז, ולפני איזו קבוצה) והמשמעות ביחס ל-Outdoors — לא יותר. לדוגמה, לממצא מזערי ושגרתי: "בדגימת האוויר בחדר השינה התגלה ריכוז מזערי של נבגים מקבוצת Aspergillus/Penicillium." לממצא משמעותי מותר משפט שני שמסביר במה הוא בולט (הריכוז הגבוה במיוחד, או סמן נזקי מים שנמצא בו). **אל תסביר מקור או ביולוגיה של הסוג** — ראו הכלל למעלה. עבור Outdoors עצמה: משפט אחד שהיא הבסיס להשוואה, בלי לתאר את הרכבה כ"טיפוסי" או "אופייני" (זו קביעה ביולוגית שלא נמסרה לך). דגימה שאין לגביה שום דבר משמעותי לומר מעבר למספרים שכבר מופיעים בטבלה — מותר להשמיט לגמרי (אל תחזיר מפתח בשבילה).
   **המפתח הוא בדיוק המחרוזת שבסוגריים המרובעים שלפני שם החדר בנתונים שנמסרו לך** — למשל בשורה "[807-1] Room 124-4: ..." המפתח הוא "807-1", ולא "Room 124-4".
4. moistureNotes — רק אם בוצעה בדיקת לחות. אובייקט באותם מפתחות. לכל דגימה פנימית שקיבלה קריאת לחות: משפט אחד קצר, עובדתי והשוואתי בלבד — הקריאה כפי שנמסרה, ואיך היא ביחס לקריאות האחרות (לא "תקין"/"חריג", ראו הכלל למעלה). לדגימת Outdoors: משפט אחד שאומר שלא נמדדה לחות בנקודה זו כי מדובר בדגימת אוויר חיצונית. דגימה פנימית שלא נמסרה לה קריאה — אל תחזיר עבורה מפתח כלל.
5. moistureAssessments — רק אם בוצעה בדיקת לחות, ורק לדגימות הפנימיות שקיבלו קריאה. אובייקט באותם מפתחות; הערך הוא תווית קצרה של שורה אחת לעמודת "הערכה" בטבלת הסיכום, **השוואתית בלבד** — למשל "דומה לקריאה בחדר השינה", "הגבוהה מבין שלוש הנקודות שנמדדו", "נמוכה משמעותית משתי הנקודות האחרות". אסור להשתמש במילים "תקין", "חריג", "רגיל" או בכל ניסוח שמרמז על סף.
6. moistureNarrative — רק אם בוצעה בדיקת לחות. מערך של שורה או שתיים: השוואה עובדתית בין הקריאות עצמן (למשל שתיים דומות ונמוכות ואחת גבוהה יחסית להן), בלי לקבוע אם קריאה כלשהי "תקינה" או "חריגה". סיים במשפט שהמדידות אינדיקטיביות והשוואתיות בלבד, לא-הרסניות, ואינן שוללות רטיבות בעומק הקיר או בחללים נסתרים.
7. conclusions — סעיף 9 (אחרי הפרשנות המקצועית). שורות מסקנה, אחת לכל דגימה פנימית עם הריכוז שלה במספרים לעומת Outdoors, ואחר כך שורה על סמני נזקי מים **רק אם נמצאו** (ראו הכלל למעלה — לעולם לא שורה על אי-מציאתם), שורה על תמצית בדיקת הלחות אם בוצעה (עובדתית, בלי תקין/חריג), ושורה מסכמת שהתוצאות משקפות את מצב המקום במועד הדיגום בלבד ואינן חוות דעת רפואית.
8. recommendations — סעיף 10. שורות המלצה: מה לעשות בפועל.

כללים מחייבים:
- **הסתמך אך ורק על הנתונים שנמסרו לך.** אל תמציא ריכוזים, אורגניזמים, חדרים, קריאות לחות או תיאורי מבנה שלא נמסרו.
- אם נמסרה "דגימת חוץ (ביקורת)" — היא נלקחה והיא בסיס ההשוואה, ותמיד נקראת Outdoors (ראו למעלה). אסור לכתוב שלא נלקחה דגימת חוץ.
- ציין מספרים בדיוק כפי שנמסרו, כולל הסימנים "<" ו-">".
- אם נמסר שלא בוצעה בדיקת לחות — אל תזכיר לחות, מוקדי רטיבות או מדידות לחות באף חלק, כולל ב-executiveSummary וב-conclusions. במקרה זה החזר moistureNotes ו-moistureAssessments כאובייקטים ריקים {} ו-moistureNarrative כמערך ריק [].
- אם לא נמצא ממצא חריג — אל תמליץ על טיפול בעובש. דוח נקי הוא תוצאה לגיטימית, ואסור לנסח אותו כאילו נמצאה בעיה.
- בהמלצות: אין להסתפק בצביעה או בניקוי שטחי לפני איתור מקור הרטיבות וטיפול בו; יש לוודא ייבוש מלא לפני עבודות גמר.
- אזכר שהתוצאות משקפות את מצב המקום במועד הדיגום בלבד.
- הבדיקה אינה כוללת אנליזת מיקוטוקסינים ואינה מזהה מינים. אל תכתוב שנמצאו רעלנים או מין עובש מסוים.
- Aspergillus/Penicillium מדווח כקבוצה מורפולוגית ולא ברמת המין.
- ממצא יחיד של נבג אחד אינו מספיק כשלעצמו לקבוע שקיים מוקד גידול פעיל — וכאשר הספירה הגולמית נמוכה מאוד (נבג אחד או שניים), ציין זאת כדי שאחוז 100% מתוך מעט נבגים לא ייקרא בטעות כריכוז גבוה.
- עברית בלבד, בלי ניקוד. כל שורה במסקנות ובהמלצות היא משפט אחד שמסתיים בנקודה. כל משפט בפרשנות ובהערות הלחות מסתיים בנקודה.
- אל תתחיל שורה בתו תבליט — התבליט מודפס על ידי המסמך.
- אל תכתוב תאריכים או שמות של אנשים.

החזר JSON בלבד:
{"executiveSummary": ["...", "..."], "purposeDescription": ["...", "..."], "interpretations": {"807-1": "..."}, "moistureNotes": {"807-1": "..."}, "moistureAssessments": {"807-1": "..."}, "moistureNarrative": ["...", "..."], "conclusions": ["...", "..."], "recommendations": ["...", "..."]}`;
