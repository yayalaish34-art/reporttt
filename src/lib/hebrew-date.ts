/**
 * Hebrew date formatting for the page header.
 *
 * The header of every page carries three things the report is dated by: the
 * weekday, the Hebrew calendar date, and the Gregorian date. `Intl` gets the
 * weekday and the month names right — including אדר א׳/אדר ב׳ in a leap year —
 * but renders the day and year as Western digits, so the numerals are spelled
 * out here.
 */

/**
 * The source reports use the ASCII apostrophe and quote rather than the Hebrew
 * geresh (׳) and gershayim (״). Matching that keeps a newly generated report
 * visually identical to the ones already in the client's files.
 */
const GERESH = "'";
const GERSHAYIM = '"';

const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

/**
 * Spells a number in Hebrew numerals: 8 → ח׳, 15 → ט״ו, 786 → תשפ״ו.
 *
 * 15 and 16 are written ט״ו and ט״ז rather than the arithmetically obvious
 * י״ה and י״ו, which would spell two names of God.
 */
export function hebrewNumeral(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value);

  const letters: string[] = [];
  let remaining = value;

  // Above 400 there is no single letter, so ת repeats: 500 → תק, 900 → תתק.
  while (remaining >= 400) {
    letters.push('ת');
    remaining -= 400;
  }
  if (remaining >= 100) {
    letters.push(HUNDREDS[Math.floor(remaining / 100)]);
    remaining %= 100;
  }
  if (remaining === 15 || remaining === 16) {
    letters.push('ט', remaining === 15 ? 'ו' : 'ז');
    remaining = 0;
  }
  if (remaining >= 10) {
    letters.push(TENS[Math.floor(remaining / 10)]);
    remaining %= 10;
  }
  if (remaining > 0) {
    letters.push(ONES[remaining]);
  }

  if (letters.length === 0) return String(value);
  if (letters.length === 1) return letters[0] + GERESH;
  return letters.slice(0, -1).join('') + GERSHAYIM + letters[letters.length - 1];
}

/** A part of a formatted date, by type. */
function parts(date: Date, calendar?: string): Record<string, string> {
  const locale = calendar ? `he-IL-u-ca-${calendar}` : 'he-IL';
  const formatted = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jerusalem',
  }).formatToParts(date);

  const out: Record<string, string> = {};
  for (const part of formatted) {
    if (part.type !== 'literal') out[part.type] = part.value;
  }
  return out;
}

/** The weekday, e.g. "יום שלישי". */
export function hebrewWeekday(date: Date): string {
  return new Intl.DateTimeFormat('he-IL', { weekday: 'long', timeZone: 'Asia/Jerusalem' }).format(date);
}

/**
 * The Hebrew calendar date, e.g. "ח' תמוז תשפ"ו".
 *
 * The year drops its thousands the way Hebrew dates are conventionally written:
 * 5786 is תשפ״ו, not ה׳תשפ״ו.
 */
export function hebrewCalendarDate(date: Date): string {
  const { day, month, year } = parts(date, 'hebrew');

  const dayNumber = Number(day);
  const yearNumber = Number(year);
  const dayText = Number.isFinite(dayNumber) ? hebrewNumeral(dayNumber) : day;
  const yearText = Number.isFinite(yearNumber) ? hebrewNumeral(yearNumber % 1000) : year;

  return `${dayText} ${month} ${yearText}`;
}

/**
 * The Gregorian date in Hebrew, e.g. "23 יוני 2026".
 *
 * `Intl` would render this as "23 ביוני 2026"; the reports omit the prefix, so
 * the month is taken from the parts and joined without it.
 */
export function gregorianDateHebrew(date: Date): string {
  const { day, month, year } = parts(date);
  return `${day} ${month} ${year}`;
}

/** The short numeric form the body of the report uses, e.g. "23/06/26". */
export function shortDate(date: Date): string {
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: 'Asia/Jerusalem',
  })
    .format(date)
    .replace(/\./g, '/');
}

/** Today's date as `YYYY-MM-DD` in Israel, for defaulting a new report. */
export function todayIso(): string {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Jerusalem',
  }).format(new Date());
  return formatted; // en-CA yields YYYY-MM-DD
}

/**
 * Parses a `YYYY-MM-DD` value into a date at noon UTC.
 *
 * Noon rather than midnight so that shifting into the Asia/Jerusalem timezone
 * cannot roll the date onto the previous day.
 */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  return Number.isNaN(date.getTime()) ? null : date;
}
