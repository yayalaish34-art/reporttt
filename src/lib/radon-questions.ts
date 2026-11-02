import type { RadonReport } from './radon-schema';

/**
 * The questions asked about a radon survey, and how each answer prints.
 *
 * Asked once per installation and printed in the report's "הערות לגבי הבדיקה" table.
 * That table's answers used to be fixed text in the template, so every report made the
 * same claims about every site.
 */

export type NoteField = {
  [K in keyof RadonReport]: K extends `note${string}` ? K : never;
}[keyof RadonReport];

interface AnswerOption {
  label: string;
  /** What the report prints, where it is shorter than what the surveyor reads. */
  prints?: string;
}

export interface RadonQuestion {
  field: NoteField;
  question: string;
  options: readonly AnswerOption[];
  /** Asks "אילו?" under a yes, and prints the answer beside it. */
  detail?: boolean;
}

const YES_NO = [{ label: 'כן' }, { label: 'לא' }] as const;
const YES_NO_UNKNOWN = [...YES_NO, { label: 'לא ידוע' }] as const;

export const RADON_QUESTIONS: readonly RadonQuestion[] = [
  { field: 'noteForm4', question: 'האם הבדיקה בוצעה עבור אישור כניסה לבית חדש (טופס 4)?', options: YES_NO },
  { field: 'noteMitigation', question: 'האם הבדיקה בוצעה עבור עבודות להפחתת ריכוז ראדון?', options: YES_NO },
  {
    field: 'notePlacedBy',
    question: 'האם הנחת ואסיפת גלאים בוצעו ע"י בעל ההיתר (ב) או מקבל השירות (מ)?',
    options: [
      { label: 'בעל ההיתר הניח ואסף', prints: 'ב/ב' },
      { label: 'בעל ההיתר הניח, מקבל השירות אסף', prints: 'ב/מ' },
      { label: 'מקבל השירות הניח, בעל ההיתר אסף', prints: 'מ/ב' },
      { label: 'מקבל השירות הניח ואסף', prints: 'מ/מ' },
    ],
  },
  {
    field: 'noteSkipShort',
    question: 'האם מקבל השירות מאשר לבצע ישר בדיקה ארוכה, ללא בדיקה קצרה?',
    options: [...YES_NO, { label: 'לא מתאים' }],
  },
  { field: 'noteSensitiveArea', question: 'האם האתר נמצא באזור רגיש לראדון?', options: YES_NO_UNKNOWN },
  { field: 'noteExtension', question: 'האם בבית בוצעו עבודות הרחבה בשיטה בלתי תקינה?', options: YES_NO_UNKNOWN },
  {
    field: 'noteSealing',
    question: 'ערכה של רמת האיטום בחדר',
    options: [
      { label: 'נורמלי', prints: 'נ' },
      { label: 'כמעט הרמטי', prints: 'כ"ה' },
      { label: 'הרמטי', prints: 'ה' },
    ],
  },
  { field: 'noteRoomType', question: 'האם החדר אטום או רגיל?', options: [{ label: 'רגיל' }, { label: 'אטום' }] },
  { field: 'noteVentOpenings', question: 'האם קיימים בחדר פתחי אוורור, חוץ מדלת וחלון? אילו?', options: YES_NO_UNKNOWN, detail: true },
  { field: 'noteVentSystems', question: 'האם קיימות בחדר מערכות אוורור? אילו?', options: YES_NO_UNKNOWN, detail: true },
  { field: 'noteRadonPaths', question: 'האם קיימים בחדר מסלולים לחדירת ראדון קרקעי? אילו?', options: YES_NO_UNKNOWN, detail: true },
  { field: 'noteSolutions', question: 'האם קיימים בחדר פתרונות להקטנת ריכוז ראדון? אילו?', options: YES_NO_UNKNOWN, detail: true },
  { field: 'noteApproved', question: 'האם בעל ההיתר מאשר ביצוע בדיקה?', options: YES_NO },
];

export type RadonAnswers = Partial<Record<NoteField, { answer: string; detail: string }>>;

/** The questions still unanswered. */
export function unansweredQuestions(answers: RadonAnswers): number {
  return RADON_QUESTIONS.filter((q) => !answers[q.field]?.answer).length;
}

/**
 * The answers as the report prints them.
 *
 * An unanswered question prints blank rather than falling back to the schema's default,
 * so the report does not state something nobody said about this site.
 */
export function printedAnswers(answers: RadonAnswers): Record<NoteField, string> {
  const printed = {} as Record<NoteField, string>;
  for (const { field, options, detail } of RADON_QUESTIONS) {
    const given = answers[field];
    const answer = given?.answer ?? '';
    const shown = options.find((option) => option.label === answer)?.prints ?? answer;
    printed[field] = detail && answer === 'כן' && given?.detail.trim() ? `כן — ${given.detail.trim()}` : shown;
  }
  return printed;
}
