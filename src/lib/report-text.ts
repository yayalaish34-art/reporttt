/**
 * Composes the report's opening wording from the survey data.
 *
 * Three sentences on the cover page all turn on one fact — which frequency
 * ranges were surveyed — and in the source document all three had it written in
 * by hand. An ELF-only survey issued from that document would claim on its
 * cover to have measured radio frequencies too.
 *
 * The composition is rule-based rather than generated. This is a compliance
 * document: the phrasing is fixed, the regulator expects it, and a sentence
 * that varies between reports invites the question of which one was right.
 * The AI drafting in `ai-text.ts` sits on top as an opt-in assist, never as the
 * default path.
 */

/** Which frequency ranges the survey covered. */
export type SurveyScope = 'elf' | 'rf' | 'both';

export const SCOPE_OPTIONS: Array<{ value: SurveyScope; label: string; description: string }> = [
  { value: 'both', label: 'משולב', description: 'רשת החשמל ורדיו' },
  { value: 'elf', label: 'ELF בלבד', description: 'תדירויות רשת החשמל' },
  { value: 'rf', label: 'RF בלבד', description: 'תדירויות רדיו' },
];

/** The frequency ranges, as they are named in running text. */
export function frequencyPhrase(scope: SurveyScope): string {
  switch (scope) {
    case 'elf':
      return 'בתדירויות רשת החשמל';
    case 'rf':
      return 'בתדירויות רדיו';
    default:
      return 'בתדירויות רשת החשמל ורדיו';
  }
}

/** The instrument classes, as they are named on the cover. */
export function instrumentPhrase(scope: SurveyScope): string {
  switch (scope) {
    case 'elf':
      return 'ELF';
    case 'rf':
      return 'RF';
    default:
      return 'ELF ו- RF';
  }
}

export interface WordingInput {
  scope: SurveyScope;
  /** e.g. "משרדי חברת כ.א.ל, מוקד בני ברק". */
  siteName: string;
  /** e.g. "21/06/26". */
  measurementDate: string;
}

/**
 * The subject line of the cover letter.
 *
 * "ב" is prefixed to the site name directly; Hebrew doubles the letter where
 * the name already starts with one ("בבית ספר"), which is correct.
 */
export function composeSubject({ scope, siteName }: Pick<WordingInput, 'scope' | 'siteName'>): string {
  return `סקר בטיחות קרינה אלקטרומגנטית (אל מ"ג) ${frequencyPhrase(scope)} ב${siteName.trim()}`;
}

/** The sentence stating when the measurements were taken and of what. */
export function composeOpeningSentence({ scope, siteName, measurementDate }: WordingInput): string {
  return `בתאריך ${measurementDate.trim()} בוצעו מדידות לקביעת רמת השדה האלקטרומגנטי ${frequencyPhrase(scope)} ב${siteName.trim()}`;
}

/** The sentence naming the instrument classes used. */
export function composeInstrumentSentence(scope: SurveyScope): string {
  return `המדידות בוצעו במכשיר מדידה תקני למדידות ${instrumentPhrase(scope)}, ראה פרטים בהמשך.`;
}
