import type { Report } from './report-schema';
import { gregorianDateHebrew, hebrewCalendarDate, hebrewWeekday, parseIsoDate } from './hebrew-date';
import { composeInstrumentSentence, composeOpeningSentence, composeSubject } from './report-text';
import type { SurveyScope } from './report-text';
import { reportTitle } from './report-title';
import { measuredProtocols, composeProtocolTitle, elfCompliance, elfNormalized, rfCompliance } from './measurement-rules';

/**
 * Turns a validated report into the flat object docxtemplater renders.
 *
 * Everything the template will print is decided here. docxtemplater performs no
 * formatting of its own — it pastes strings — so any numbering, defaulting or
 * derived wording has to happen on this side of the boundary. The template stays
 * free of logic, which matters because it is edited in Word by people who are
 * not reading this code.
 */
/**
 * The height as the document has to carry it.
 *
 * The column carries a sign now — a point above the board reads "+1", one below it "-1"
 * — and it prints into a right-to-left table cell. Under the bidi algorithm a leading
 * "-" is a neutral character, so it takes the paragraph's direction and lands on the
 * wrong end: a height stored as "-1" prints as "1-", which reads as a different number.
 * A left-to-right mark in front pins the value down.
 *
 * Only a signed value is marked. A plain "1" already prints correctly, so every height
 * written before the column had a sign reaches the document exactly as it always did.
 */
function printableHeight(height: string): string {
  const value = height.trim();
  return /^[+-]/.test(value) ? `‎${value}` : height;
}

/**
 * The inspectors whose licence covers what this survey actually measured.
 *
 * The licence table carries one row per permit class — an ELF permit and an RF permit,
 * each with its own number and expiry. Printing both on a survey that only took one of
 * them states a qualification the report never drew on, which in a compliance document
 * is a claim rather than a formatting detail: it is the same reason the unused survey
 * section is cut out (see stripUnusedSurvey).
 *
 * A row whose permit class was left blank is always kept. That is a person the surveyor
 * entered, and dropping their signature over a field nobody filled in would remove a
 * name from the document rather than a redundant one.
 */
export function inspectorsForScope<T extends { permitType: string }>(
  inspectors: readonly T[],
  scope: SurveyScope,
): T[] {
  if (scope === 'both') return [...inspectors];
  const wanted = scope === 'elf' ? 'ELF' : 'RF';
  return inspectors.filter((i) => {
    const type = i.permitType.trim().toUpperCase();
    return type === '' || type === wanted;
  });
}

export function buildMergeData(report: Report, photosXml = EMPTY_PARAGRAPH): Record<string, unknown> {
  /**
   * Measurement points are numbered across the whole survey, not per table.
   *
   * A protocol is one table per source per floor, and a survey routinely runs
   * to a dozen of them. Numbering that restarts at 1 in every table gives four
   * different points called "3", which is no use to anyone reading the
   * conclusions or answering a question about a specific reading. ELF and RF
   * are two separate surveys bound into one report, so each keeps its own
   * sequence.
   *
   * This replaced Word's automatic list numbering, which had no way of knowing
   * that the tables belonged to one series.
   */
  let elfPoint = 0;
  let rfPoint = 0;

  return {
    ...report,

    // Only the licence that covers what was measured — see inspectorsForScope.
    inspectors: inspectorsForScope(report.inspectors, report.surveyScope),

    // ── Header ──────────────────────────────────────────────────────
    // One stored date drives all three renderings of it in the header.
    ...headerDates(report.reportDate),

    // ── Recipient ───────────────────────────────────────────────────
    /** Gates the company line, which a private customer does not have. */
    isCompany: report.customerType === 'company',
    recipientLine: recipientLine(report),

    // ── Cover wording ───────────────────────────────────────────────
    ...coverWording(report),

    // ── Instrument spec blocks ──────────────────────────────────────
    // The template addresses these as {elfInstrument.modelLine}, but
    // docxtemplater's default parser does not walk a dotted path — it looks the
    // whole tag up as one key. Left as nested objects the entire spec table
    // printed blank, with only its labels showing, and nothing in the app said
    // so. Supplying the flattened keys as well is what makes those tags resolve;
    // the nested objects stay for anything that reads them as objects.
    ...dotted('elfInstrument', report.elfInstrument),
    ...dotted('rfInstrument', report.rfInstrument),

    // ── Conclusions ─────────────────────────────────────────────────
    // Each is one numbered item whose body runs over several paragraphs. The
    // first carries the list number; the rest must not, or the fixed items
    // after it are renumbered.

    // ── Measurement characterization ────────────────────────────────
    // These lines end in a full stop that the template supplies, so a value
    // typed with one of its own would otherwise print "משרדים..".
    measurementDateTime: sentenceValue(report.measurementDateTime),
    /*
     * The site name stands in when "מקום" is empty.
     *
     * The two were separate fields asking the same question, and the editor now fills
     * this one from the site name. A report written before that carries whatever was
     * typed then and prints it unchanged; one written since carries both. The fallback
     * is for the case in between — a draft that had a site name and no place.
     */
    location: sentenceValue(report.location.trim() || report.siteName),
    siteCharacter: sentenceValue(report.siteCharacter),
    weather: sentenceValue(report.weather),
    fieldSource: sentenceValue(report.fieldSource),
    measurementType: sentenceValue(report.measurementType),

    // ── Loops ───────────────────────────────────────────────────────
    // Each loop body gets its own view model so the template can stay literal.
    elfProtocols: measuredProtocols(report.elfProtocols).map((p) => {
      const factor = p.normalizationFactor || '1';
      return {
        ...p,
        // The field holds the radiating source; the fixed opening of the
        // heading is added here, so it is typed once in the code rather than
        // once per table by the surveyor.
        title: composeProtocolTitle('elf', p.title),
        normalizationFactor: factor,
        // Worded from the coefficient rather than stored beside it. The note
        // states the coefficient in words, so a stored one went stale the
        // moment the coefficient changed — and since the note is no longer
        // shown in the editor, nobody would have seen it contradict the table.
        normalizationNote: normalizationNote(factor),
        // Only rows that were actually read go into the document. The editor lays out
        // five distances per description so the surveyor has somewhere to type, but a
        // source measured at three of them leaves two blanks — and a printed table with
        // empty cells reads as a measurement that failed rather than one not taken.
        // Filtered before numbering, so the points stay 1,2,3… with no gaps.
        rows: p.rows.map((r) => {
          // Recomputed from the reading and this protocol's coefficient, so the
          // two columns cannot disagree — and changing the coefficient updates
          // every row that depends on it.
          const normalized = elfNormalized(r.measured, factor) || r.normalized;
          return {
            ...r,
            pointNumber: String(++elfPoint),
            height: printableHeight(r.height),
            normalized,
            // The surveyor's word wins; the reading fills the column when they
            // have not given one, so it cannot print blank in a report that has
            // already been sent.
            compliance: r.compliance || elfCompliance(normalized, r.occupancy, report.siteCharacter),
          };
        }),
      };
    }),

    rfProtocols: measuredProtocols(report.rfProtocols).map((p) => ({
      ...p,
      title: composeProtocolTitle('rf', p.title),
      rows: p.rows.map((r) => ({
        ...r,
        pointNumber: String(++rfPoint),
        height: printableHeight(r.height),
        // Recomputed rather than taken from the row. The verdict follows from
        // the reading against the threshold, so a stored value could only ever
        // disagree with them — and it is the column a reader trusts most.
        compliance: rfCompliance(r.measured, r.threshold) || r.compliance,
      })),
    })),

    // The photo appendix is raw OOXML rather than text — an image cannot be
    // substituted through an ordinary placeholder.
    photosXml,
  };
}

/**
 * The three date strings the page header prints.
 *
 * An unparseable date yields empty strings rather than throwing: a draft with a
 * half-typed date should still generate, with a blank header, instead of failing
 * the whole document.
 */
function headerDates(reportDate: string): Record<string, string> {
  const date = parseIsoDate(reportDate);
  if (!date) return { headerWeekday: '', headerHebrewDate: '', headerDate: '' };

  return {
    headerWeekday: hebrewWeekday(date),
    headerHebrewDate: hebrewCalendarDate(date),
    headerDate: gregorianDateHebrew(date),
  };
}

/**
 * The line naming the person the report is addressed to.
 *
 * A company contact is printed as "name - role"; a private customer is printed
 * bare. Assembling it here rather than in the template keeps the separator from
 * being left stranded when there is no role to follow it.
 */
/**
 * Exposes an object's fields under dotted keys: `{a: 1}` → `{"p.a": 1}`.
 *
 * Only one level deep, which is all the template asks for.
 */
function dotted(prefix: string, value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value ?? {})) out[`${prefix}.${key}`] = v;
  return out;
}

function recipientLine(report: Report): string {
  const name = report.recipientName.trim();
  if (report.customerType === 'private') return name;

  const title = report.recipientTitle.trim();
  return title ? `${name} - ${title}` : name;
}

/**
 * The three cover sentences that name the surveyed frequency ranges.
 *
 * The subject and the opening sentence are recomposed here whenever they are
 * left on automatic, so changing the survey scope cannot leave a stale sentence
 * behind claiming the wrong ranges were measured. The instrument sentence has
 * no manual mode at all — it states a fact about the survey, not a description
 * of the site, so there is nothing to word differently.
 */
export function coverWording(report: Report): Record<string, string> {
  const input = {
    scope: report.surveyScope,
    siteName: report.siteName,
    measurementDate: report.measurementDate,
  };

  return {
    subject: report.subjectAuto || !report.subject ? composeSubject(input) : report.subject,
    openingSentence:
      report.openingAuto || !report.openingSentence ? composeOpeningSentence(input) : report.openingSentence,
    instrumentSentence: composeInstrumentSentence(report.surveyScope),
  };
}

/**
 * The sentence explaining the normalization coefficient of one protocol.
 *
 * The coefficient says what the readings had to be multiplied by to stand for a typical
 * load, so it also says what the load was when they were taken — and the sentence has to
 * agree with it:
 *
 *   • above 1 — the readings were scaled up, so the site was drawing *less* than usual
 *     ("עומס מופחת"): a survey taken at night, or with the plant idle.
 *   • exactly 1 — nothing was scaled, so the load was already typical ("עומס אופייני").
 *   • below 1 — the readings were scaled down, so the site was drawing *more* than usual
 *     ("עומס מוגבר").
 *
 * Until now the sentence said "עומס אופייני" whatever the coefficient was, so a protocol
 * normalized by 2 printed a sentence stating the load was typical and then set a
 * coefficient that only makes sense if it was not. In a compliance document the two
 * halves of one sentence contradicting each other is the sort of thing a reader
 * challenges.
 *
 * A coefficient that is not a number falls back to the neutral wording rather than
 * guessing — the field is typed by hand, and a half-typed value should not assert
 * something about the site.
 */
function normalizationNote(factor: string): string {
  const value = factor.trim() || '1';
  const n = Number(value);
  const load = !Number.isFinite(n) || n === 1 ? 'אופייני' : n > 1 ? 'מופחת' : 'מוגבר';
  return `מכיוון שהמדידות בוצעו בעומס ${load} נקבע נרמול לבדיקה על ${value}.`;
}

/**
 * The subject line as it will print — composed or manual.
 *
 * Used outside the merge too: it names the report in the drafts list and in the
 * downloaded file, and those must agree with the document's own cover.
 */
export function reportSubject(report: Report): string {
  return coverWording(report).subject;
}

/**
 * How a report is named in the drafts list — "דוח קרינה — כ.א.ל".
 *
 * Not the cover subject: every subject opens with the same forty characters — "סקר
 * בטיחות קרינה אלקטרומגנטית (אל מ״ג) בתדירויות…" — and a list of them is a column of
 * identical text. The rule itself is shared with the other three departments; see
 * `reportTitle`.
 */
export function reportListTitle(
  report: Pick<Report, 'recipientName' | 'customerType' | 'companyName'>,
): string {
  return reportTitle('radiation', report);
}

/**
 * Strips a trailing full stop so the template can own the punctuation.
 *
 * The characterization lines read as sentences — "אפיון המקום: משרדים." — and
 * the stop is part of the template's wording, not of the data. Removing it here
 * means a surveyor who types one anyway gets the same output as one who does
 * not, instead of a stray double stop nobody proofreads for.
 */
function sentenceValue(value: string): string {
  return value.trim().replace(/\.+$/, '');
}

/**
 * A single empty paragraph.
 *
 * A raw-XML placeholder replaces the paragraph that contains it, so it must be
 * given a block-level element even when there is nothing to inject; an empty
 * string would leave the document body malformed.
 */
export const EMPTY_PARAGRAPH = '<w:p/>';
