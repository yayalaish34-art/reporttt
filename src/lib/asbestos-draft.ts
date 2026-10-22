import { AiDraftError, aiDraftingAvailable, callOpenAi } from './ai-text';
import type { AsbestosReport, FindingRow } from './asbestos-schema';
import { realFindings, totalArea } from './asbestos-rules';

/**
 * Wording the findings section of an asbestos opinion from the surveyor's own data.
 *
 * The findings used to be typed as finished sentences — the surveyor wrote
 * "3 צינורות ביוב עשויים אסבסט בתוך קירות הבניין כל אחד 9 מטרים סה״כ 27 מטרים" into a
 * box, one per bullet. That is a sentence with a fixed grammar being retyped per job,
 * which is exactly where wording drifts: the same finding reads four ways across four
 * reports, and a reader cannot tell whether the differences mean anything.
 *
 * So the surveyor records the *facts* — what the element is, how many, where, what size,
 * what condition — and the model writes the sentence in the signed opinion's own voice.
 * One bullet per finding, in the order they were recorded.
 *
 * Nothing here invents. The model is given the facts and told, at length, that it may
 * only rearrange them into a sentence; every number it prints has to be one it was
 * handed. A finding with no element named is skipped rather than guessed at, and a
 * failure falls back to whatever the surveyor typed, so a model that is unreachable
 * costs wording rather than a report.
 */

export interface AsbestosDraft {
  /** One sentence per finding, in the order the findings were recorded. */
  bullets: string[];
  /**
   * The closing section: exactly three bullets.
   *
   * The summary used to be assembled in the template from a total and two standing
   * sentences, which produced two lines for a survey of any size — "נמצאו אלמנטים
   * בגודל כולל של כ-27 מ״ר" and the demolition boilerplate, and nothing about what the
   * client should actually do. Three is the shape Galit's signed opinions use: what was
   * found, what it means, and what to do about it.
   */
  summaryBullets: string[];
  /**
   * The soil sentence, when a finding is buried or inside a wall.
   *
   * Empty when nothing is buried — the template only prints it inside `{#hasBuried}`,
   * and a sentence composed for a survey that found nothing buried would be a claim
   * about contamination nobody made.
   */
  buriedSentence: string;
}

/** The facts of one finding, as they are handed to the model. */
function describeFinding(finding: FindingRow, index: number): string {
  const parts = [
    `ממצא ${index + 1}:`,
    finding.element.trim() ? `  אלמנט: ${finding.element.trim()}` : '',
    finding.quantity.trim() ? `  כמות: ${finding.quantity.trim()}` : '',
    finding.placement.trim() ? `  מיקום: ${finding.placement.trim()}` : '',
    finding.dimensions.trim() ? `  מידות: ${finding.dimensions.trim()}` : '',
    finding.condition.trim() ? `  מצב: ${finding.condition.trim()}` : '',
    finding.area.trim() ? `  שטח: ${finding.area.trim()} מ״ר` : '',
    finding.buried === 'כן' ? '  קבור או בתוך קיר: כן' : '',
    // The surveyor's own wording, when there is any, is the strongest signal of how this
    // particular finding should read — so it is offered as a draft rather than ignored.
    finding.text.trim() ? `  ניסוח קיים של הסוקר: ${finding.text.trim()}` : '',
  ];
  return parts.filter(Boolean).join('\n');
}

/**
 * Whether a finding carries enough to be worded at all.
 *
 * The element is the subject of the sentence; without it there is no sentence to write,
 * only a guess about what was found. Such a row keeps whatever the surveyor typed.
 */
function isDraftable(finding: FindingRow): boolean {
  return finding.element.trim() !== '';
}

const SYSTEM_PROMPT = `אתה מנסח את סעיף "ממצאי הבדיקה" בחוות דעת של סקר אסבסט מטעם "גלית החברה לאיכות הסביבה בע"מ".

חוות הדעת ניתנת במקום עדות בבית משפט. הניסוח שלך נכנס למסמך חתום, ולכן הוא חייב להיות מדויק לעובדות שנמסרו לך ותו לא.

אתה מקבל רשימת ממצאים. לכל ממצא יש חלק מהשדות: אלמנט, כמות, מיקום, מידות, מצב, שטח, והאם הוא קבור. עליך להחזיר משפט אחד לכל ממצא.

כללים מחייבים לגבי התוכן:
- השתמש אך ורק בעובדות שנמסרו. אל תמציא מספרים, מידות, מיקומים או כמויות.
- אל תחשב ואל תסכם מספרים בעצמך. אם נמסר "כל אחד 9 מטרים" וכמות 3 — מותר לכתוב "סה\\"כ 27 מטרים" רק אם הסכום נמסר לך בשדה השטח. אחרת אל תסכם.
- אל תוסיף הערכת סיכון, המלצה או אזהרה. הסעיף הזה מתאר מה נמצא, לא מה לעשות.
- אל תכתוב על סוגי סיבים, ריכוזים או תוצאות מעבדה — זהו סקר ויזואלי בלבד.
- שדה שלא נמסר פשוט לא מופיע במשפט. אל תמלא אותו בניחוש.

כללים מחייבים לגבי הצורה:
- משפט אחד לכל ממצא, ולא יותר.
- הסגנון: תיאור עובדתי יבש, בלשון עבר או בהווה תיאורי, כמו במסמכים החתומים של החברה.
- דוגמה לסגנון הנדרש: "3 צינורות ביוב עשויים אסבסט בתוך קירות הבניין כל אחד 9 מטרים סה\\"כ 27 מטרים"
- דוגמה נוספת: "ארובה עשויה אסבסט על גבי חזית מערבית 8 צול 8 מטרים (5 מ\\"ר)"
- אזכר תמיד שהאלמנט עשוי אסבסט.
- סדר המשפט: כמות, אלמנט, "עשוי/עשויה/עשויים אסבסט", מיקום, מידות, ואם נמסר שטח — בסוגריים בסוף.
- שדה המצב אינו נדחף לתוך רצף המידות. אם הוא נמסר ואינו "תקין" — הוסף אותו כפסוקית בסוף, למשל "הלוחות סדוקים". אם הוא "תקין" או "לא ניתן לראות" — אל תכתוב אותו כלל, זהו מצב ברירת המחדל שאינו מוסיף מידע.
- אל תשרשר שדות זה לצד זה בלי מילות קישור. המשפט חייב להיקרא כמשפט עברי תקין, לא כרשימת ערכים.
- עברית בלבד, בלי ניקוד, בלי מירכאות מסביב למשפט.

בנוסף, אם נמסר לך שממצא כלשהו קבור או בתוך קיר — כתוב משפט אחד על הפוטנציאל לנוכחות אסבסט בקרקע, בסגנון: "בעקבות הימצאות צינורות ביוב עשויים אסבסט קיים פוטנציאל להימצאות נוכחות אסבסט בקרקע." המשפט חייב לנקוב באלמנט הקבור שנמסר לך. אם שום ממצא אינו קבור — החזר מחרוזת ריקה.

עליך לכתוב גם את סעיף "סיכום" — בדיוק שלוש נקודות, לא פחות ולא יותר:

**הנחיית עובי לסעיף הסיכום**:
חוות דעת אסבסט חתומה היא מסמך משפטי שעובר ללקוח ולרשויות. סעיף הסיכום צריך להיות **מעובה**: כל אחת משלוש הנקודות כוללת כמה משפטים מהותיים — לא משפט בודד יבש — כך שבסך הכול הסעיף גדל בכ-4 שורות דפוס נוספות מעבר למינימום. אין להמציא ממצאים חדשים, רק להרחיב בהקשר המקצועי של אותה נקודה (איזכור "החוק למניעת מפגעי אסבסט ואבק מזיק, התשע"א 2011", הפניה לקבלן אסבסט מורשה שרשום במשרד להגנת הסביבה, אתר מורשה לסילוק, חובת ניטור תקופתי, הימנעות מקידוח ושבירה).

נקודה 1 — מה נמצא: סיכום עובדתי של הממצאים, כולל השטח הכולל שנמסר לך. למשל: "במבנה מרחוב X נמצאו 4 לוחות גג עשויים אסבסט צמנט בשטח כולל של כ-27 מ\"ר." הרחב בעוד 1–2 משפטים: בפירוט ממה מורכב השטח (סוגי האלמנטים, מיקומם הכללי במבנה), וציון שסקר האסבסט בוצע ויזואלית לפי מתודולוגיית החברה.
נקודה 2 — מה המשמעות: מצב החומר ומה נובע ממנו. אסבסט צמנט שלם ותקין מנוהל במקומו ואינו מסוכן כל עוד אינו מופר; אסבסט סדוק, שבור או מתפורר עלול לשחרר סיבים ומחייב טיפול; אסבסט פריך מחייב קבלן אסבסט פריך מורשה. בסס את המשפט על שדה המצב שנמסר לך, והרחב בעוד 1–2 משפטים על ההבדל בין אסבסט צמנט לאסבסט פריך, על כך שסיבי אסבסט משתחררים לאוויר רק בהפרה פיזית של החומר (קידוח, שבירה, גירוד), ועל חשיבות ההימנעות מכל פעולה כזו עד להסרה.
נקודה 3 — מה לעשות: המלצה מעשית אחת, מבוססת על הממצאים. אם החומר תקין — ניטור תקופתי ושמירה על שלמותו, והימנעות מקידוח או שבירה. אם החומר פגום — תיקון או פינוי בידי קבלן אסבסט מורשה ואתר מורשה לסילוק, על פי "החוק למניעת מפגעי אסבסט ואבק מזיק, התשע\"א 2011". הרחב בעוד 1–2 משפטים על החובה לתעד את הפינוי (תעודת סילוק, מניפסט פסולת), על הצורך להציג רישיון קבלן אסבסט תקף של המשרד להגנת הסביבה, ועל כך שחברת גלית זמינה לליווי מקצועי ולסקר חוזר לאחר הטיפול.

כללים לסעיף הסיכום:
- שלוש נקודות בדיוק. אל תחזיר שתיים ואל תחזיר ארבע.
- כל נקודה היא פסקה מעובה: לפחות 3 משפטים ממש, ומסתיימת בנקודה. אסור להסתפק במשפט אחד.
- אל תמציא מספרים. השתמש רק בשטח ובכמויות שנמסרו לך.
- אל תחזור על אותו תוכן בשתי נקודות — כל ההרחבה בנקודה 2 שונה מההרחבה בנקודה 3.
- אם נמסר שממצא קבור — שלב את אזהרת הקרקע בנקודה 2 או 3 כמשפט נוסף בתוך אותה פסקה, ואל תכתוב אותה כנקודה רביעית.
- אל תזכיר בדיקות מעבדה, סוגי סיבים או ריכוזים.

החזר JSON בלבד:
{"bullets": ["...", "..."], "buriedSentence": "...", "summaryBullets": ["...", "...", "..."]}`;

function userPrompt(report: AsbestosReport, findings: FindingRow[]): string {
  const lines = [
    report.siteAddress.trim() ? `האתר: ${report.siteAddress.trim()}.` : '',
    report.siteDescription.trim() ? `תיאור המקום: ${report.siteDescription.trim()}` : '',
    report.asbestosKind.trim() ? `סוג האסבסט בסקר: ${report.asbestosKind.trim()}.` : '',
    '',
    `מספר הממצאים: ${findings.length}. החזר בדיוק ${findings.length} משפטים, לפי הסדר.`,
    // The total is summed in code from the findings' areas — the model must quote it
    // rather than add the numbers up itself, which is where invented totals come from.
    totalArea(report) ? `השטח הכולל שחושב מהממצאים: ${totalArea(report)}. השתמש בו כפי שהוא.` : '',
    '',
    ...findings.map(describeFinding),
  ];
  return lines.filter((l) => l !== undefined).join('\n');
}

/**
 * A three-bullet summary written in code, for when the model cannot be used.
 *
 * Not a placeholder: an opinion produced with no OpenAI key still goes to a client, so
 * these have to be sentences the company would sign. They say the same three things the
 * drafted version does — what was found, what it means, what to do — from the facts the
 * survey already holds, and they stay deliberately cautious where the model would be
 * specific.
 */
function fallbackSummary(report: AsbestosReport, findings: FindingRow[]): string[] {
  const where = report.siteAddress.trim();
  const site = where ? `במבנה מרחוב ${where}` : 'במבנה';
  const total = totalArea(report);
  const damaged = findings.some((f) => ['סדוק', 'שבור', 'מתפורר'].includes(f.condition.trim()));
  const buried = findings.some((f) => f.buried === 'כן');

  // The fallback runs when OpenAI is unavailable, but the delivered opinion still has
  // to read like a signed professional document — so each of the three bullets is a
  // small paragraph (3–4 sentences) with the same supporting context the AI prompt
  // asks for: methodology, the asbestos-cement vs friable distinction, the legal
  // obligation to use a licensed contractor, and the suggestion to document the
  // removal. The sum of the extra lines is roughly four printed lines across the
  // section, matching what the signed opinions normally carry.
  const found =
    (total
      ? `${site} נמצאו אלמנטים עשויים אסבסט בגודל כולל של כ-${total}.`
      : `${site} נמצאו אלמנטים עשויים אסבסט.`) +
    ' הממצאים לעיל פורטו אחד-אחד בסעיף "ממצאי הבדיקה" בחוות דעת זו, לפי מיקומם במבנה ולפי אופי האלמנט.' +
    ' הסקר בוצע באופן ויזואלי בלבד על ידי בודק מוסמך מטעם חברת גלית, ללא ביצוע קידוחים או דגימות הרסניות, ולפי מתודולוגיית הסקר של המשרד להגנת הסביבה.';

  const meaning =
    (damaged
      ? 'חלק מהאלמנטים אינם במצב תקין, ולפיכך קיים פוטנציאל לשחרור סיבי אסבסט לסביבה.'
      : 'האלמנטים נמצאו במצב תקין, וכל עוד אינם מופרים — סיכון שחרור הסיבים לסביבה נמוך.') +
    ' סיבי אסבסט אינם משתחררים לאוויר כל עוד החומר שלם; הם משתחררים בעיקר בהפרה פיזית של החומר — קידוח, ניסור, שבירה, גירוד או שחיקה.' +
    ' בשל כך יש להימנע מכל פעולה כזו על האלמנטים הנ"ל, ולהגביל גישה לאזורים שבהם האלמנטים מצויים במצב ירוד עד להסרתם בידי גורם מוסמך.';

  const actionCore = damaged
    ? 'יש לפנות את האלמנטים הפגומים בידי קבלן אסבסט מורשה ולאתר מורשה לסילוק, על פי "החוק למניעת מפגעי אסבסט ואבק מזיק, התשע"א 2011".'
    : 'יש לקיים ניטור ובקרה תקופתיים, לשמור על שלמות החומר ולהימנע מקידוח, ניסור או שבירה שלו.';
  const actionExtras =
    ' לפני תחילת עבודה יש לוודא רישיון קבלן אסבסט תקף של המשרד להגנת הסביבה, ולאחר הפינוי לשמור את תעודת הסילוק (מניפסט פסולת) כחלק מתיעוד הנכס.' +
    ' חברת גלית זמינה לליווי מקצועי לאורך הטיפול, לאימות ביצועו ולסקר חוזר לאחר ההסרה — להצגה בפני הרשויות ובפני צדדים שלישיים.';
  const action = `${actionCore}${actionExtras}`;

  // The soil warning rides on the closing bullet rather than becoming a fourth one.
  return [found, meaning, buried ? `${action} כמו כן, בעקבות הימצאות אלמנטים קבורים קיים פוטנציאל לנוכחות אסבסט בקרקע, ומומלץ לבצע סקר קרקע לפני כל עבודת חפירה או שינוע עפר באתר.` : action];
}

/**
 * Drafts the findings section, or returns the surveyor's own wording unchanged.
 *
 * Never throws: this runs inside document generation, and a surveyor who pressed "סיום"
 * is owed a document. Whatever cannot be drafted keeps the text that is already there.
 */
export async function draftAsbestosFindings(report: AsbestosReport): Promise<AsbestosDraft> {
  const findings = realFindings(report);
  const fallback: AsbestosDraft = {
    bullets: findings.map((f) => f.text.trim()),
    buriedSentence: report.buriedSentence,
    summaryBullets: fallbackSummary(report, findings),
  };

  if (!aiDraftingAvailable() || findings.length === 0) return fallback;
  // Nothing structured to work from — every row is prose the surveyor typed.
  if (!findings.some(isDraftable)) return fallback;

  let content: string;
  try {
    content = await callOpenAi(SYSTEM_PROMPT, userPrompt(report, findings));
  } catch (err) {
    console.error('ניסוח ממצאי האסבסט נכשל — נשאר נוסח הסוקר', err);
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    console.error('ניסוח ממצאי האסבסט החזיר JSON לא תקין — נשאר נוסח הסוקר');
    return fallback;
  }

  const raw = (parsed as { bullets?: unknown }).bullets;
  const bullets = Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string').map((x) => x.trim())
    : [];

  /*
   * One bullet per finding, however many the model returned.
   *
   * A model that returns four sentences for three findings would add a finding to a
   * signed opinion; one that returns two would drop one. Both are corrected here against
   * the surveyor's own text rather than trusted, because the count is a fact about the
   * survey and not something the wording gets to decide.
   */
  const aligned = findings.map((finding, i) => {
    const drafted = bullets[i];
    if (!isDraftable(finding) || !drafted) return finding.text.trim();
    return drafted;
  });

  const buried = (parsed as { buriedSentence?: unknown }).buriedSentence;
  const buriedSentence =
    typeof buried === 'string' && buried.trim() !== ''
      ? buried.trim()
      : // The model returns an empty string when nothing is buried, which is correct —
        // but a survey that *does* have buried findings and got nothing back keeps the
        // standing sentence rather than losing the warning.
        findings.some((f) => f.buried === 'כן')
        ? report.buriedSentence
        : '';

  /*
   * Exactly three summary bullets, or none of the model's.
   *
   * The count is the whole point of the section — "what was found, what it means, what
   * to do" — so a reply with two or four is not a summary that happens to be the wrong
   * length, it is a different section. Rather than pad or truncate one into shape, the
   * code-written version stands, which is a summary that reads correctly.
   */
  const rawSummary = (parsed as { summaryBullets?: unknown }).summaryBullets;
  const summary = Array.isArray(rawSummary)
    ? rawSummary
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.replace(/^[•\-\s]+/, '').trim())
        .filter(Boolean)
    : [];

  return {
    bullets: aligned,
    buriedSentence,
    summaryBullets: summary.length === 3 ? summary : fallbackSummary(report, findings),
  };
}

export { AiDraftError };
