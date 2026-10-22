import type { LabResult, MoldReport, MoldSample } from './mold-schema';
import { LAB_ORGANISMS, MOISTURE_INSTRUMENT } from './mold-schema';
import { reportTitle } from './report-title';
import {
  compareWithOutdoor,
  labResultFor,
  hasElevatedMoisture,
  hasSignificantFinding,
  hasWaterDamageMarkers,
  indoorAirSamples,
  isOutdoorLocation,
  isOutdoorSample,
  outdoorAirSample,
  realMoistureReadings,
  realSamples,
  surfaceSamples,
  waterDamageMarkersIn,
} from './mold-rules';

/**
 * Turns a mould report into the flat object docxtemplater renders.
 *
 * The same boundary as the other three mappers: everything the template prints is
 * decided here, because docxtemplater pastes strings and does no work of its own.
 *
 * Two things in this report need shaping rather than passing through. The address
 * is printed in five places in three grammatical forms — bare, after "ברחוב", and
 * as the object of "בדירת מגורים של X ב…" — and the surveyor answers it once. And
 * the cover's subject line is built from three separate answers, because "בדירת
 * מגורים של ערן פינגר" is a preposition, a place-kind and a person, and a survey
 * of a school needs to change the middle one without retyping the rest.
 */

/**
 * What the template says about a protocol detail nobody recorded.
 *
 * The source's own wording, kept verbatim: it is a standing note to whoever delivers
 * the report that the sampling protocol is incomplete, and an empty cell in its place
 * would read as though nothing were missing.
 */
const UNRECORDED = 'לא מופיע בקובץ המקור – יש להשלים מטופס השטח';
const UNRECORDED_PLURAL = 'לא מופיעים בקובץ המקור – יש להשלים מטופס השטח';

/** The Hebrew for a small count, as §4 writes it. */
const NUMBER_WORDS = [
  '',
  'אחת',
  'שתיים',
  'שלוש',
  'ארבע',
  'חמש',
  'שש',
  'שבע',
  'שמונה',
  'תשע',
  'עשר',
];

/**
 * "9 – שמונה פנימיות ודגימת חוץ אחת", counted from the samples themselves.
 *
 * Retyping this is how a report comes to claim nine samples above eight tables. The
 * shape follows the source; a survey with no outdoor control says so plainly rather
 * than printing a sentence about a comparison it did not make.
 */
function sampleCountLine(report: MoldReport): string {
  const samples = realSamples(report);
  if (samples.length === 0) return '';
  const outdoor = samples.filter(isOutdoorSample).length;
  const indoor = samples.length - outdoor;
  const word = (n: number) => NUMBER_WORDS[n] ?? String(n);

  /*
   * Hebrew counts one and two differently from the rest.
   *
   * "אחת פנימיות" and "שתיים פנימיות" are both wrong: one takes the singular
   * and follows the noun, and two has its own construct form. Only three and up read
   * correctly as a bare numeral before the plural, which is why the nine-sample case
   * this was written against looked fine.
   */
  const indoorPhrase =
    indoor === 0
      ? ''
      : indoor === 1
        ? 'דגימה פנימית אחת'
        : indoor === 2
          ? 'שתי דגימות פנימיות'
          : `${word(indoor)} פנימיות`;

  if (outdoor === 0) return `${samples.length} – ${indoorPhrase}`;
  if (outdoor === 1) return `${samples.length} – ${indoorPhrase} ודגימת חוץ אחת`;
  return `${samples.length} – ${indoorPhrase} ו-${word(outdoor)} דגימות חוץ`;
}

/**
 * One genus's concentration in a sample, for the summary table.
 *
 * Matched on a prefix because the laboratory writes the pair as
 * "Aspergillus/Penicillium" and sometimes "Aspergillus |Penicillium" — the summary
 * column is headed with the first name either way.
 *
 * A genus the laboratory did not find prints "לא זוהה" rather than an empty cell or a
 * nought: the outdoor sample's whole significance in this report is that
 * Aspergillus/Penicillium was *looked for and not found* there, and a blank would let
 * that read as a figure nobody filled in.
 */
function genusCount(result: LabResult, prefix: string): string {
  const row = result.organisms.find((o) =>
    o.organism.trim().toLowerCase().startsWith(prefix.toLowerCase()),
  );
  const value = row?.perCubicMetre.trim() ?? '';
  return value || 'לא זוהה';
}

/** A passage's non-empty lines, trimmed. */
function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** A drafted passage as the template's loops print it — one bullet per line. */
function linesOf(text: string): Array<{ text: string }> {
  return splitLines(text).map((line) => ({ text: line }));
}

/**
 * A sample's location as the document prints it — "Outdoors" for the control point,
 * regardless of what the surveyor typed or what the laboratory's own sheet called it.
 *
 * Hayes prints "Outside" on its own sheets, and that word used to flow straight
 * through into this report wherever a location fell back to the laboratory's name
 * for it. "Outdoors" is Galit's own choice of word for the control point — this is
 * the one place that choice is applied, so every printed location goes through it.
 */
function displayLocation(name: string): string {
  return isOutdoorLocation(name) ? 'Outdoors' : name;
}

/**
 * Reads one of the AI-drafted per-sample records back for a sample — tried by the
 * laboratory's own number first and by the typed location second, the same order
 * `alignInterpretationKeys` (mold-draft.ts) normalises its output to. Shared by
 * `interpretations`, `moistureNotes` and `moistureAssessments`, which are all keyed the
 * same way.
 */
function draftedFor(
  record: Record<string, string>,
  sample: Pick<MoldSample, 'location'>,
  result: LabResult,
): string {
  return record[result.labNumber]?.trim() || record[sample.location.trim()]?.trim() || '';
}

export function buildMoldMergeData(report: MoldReport): Record<string, unknown> {
  const isCompany = report.customerType === 'company';
  const address = report.siteAddress.trim();

  /**
   * The address with the word the sentences expect in front of it.
   *
   * The surveyor types "פעמונית 2, הוד השרון". The opening sentence says "ברחוב
   * הפעמונית 2, הוד השרון", so it needs that prefix — but a surveyor who typed
   * "רחוב" or "שדרות" themselves must not get "ברחוב רחוב". Hence the check rather
   * than a blind concatenation, the same as in the asbestos mapper.
   */
  const startsWithStreetWord = /^(רחוב|רח'|שדרות|שד'|דרך|סמטת|כיכר)\s/.test(address);
  const siteStreet = address ? (startsWithStreetWord ? `ב${address}` : `ברחוב ${address}`) : '';

  /**
   * The cover's subject — "בדירת מגורים של ערן פינגר".
   *
   * Assembled rather than stored whole so that a survey of an office or a school
   * changes one answer instead of being retyped. When no occupant is named the
   * place-kind is printed on its own, which is what a survey of a common area or a
   * building with no single resident actually reads like.
   */
  const siteKind = report.siteKind.trim();
  const occupant = report.occupantName.trim();
  const siteSubject = [siteKind, occupant].filter(Boolean).join(' ');

  const outdoor = outdoorAirSample(report);
  const indoor = indoorAirSamples(report);

  /**
   * §6.5's rows — one per indoor sample that actually got a moisture reading.
   *
   * Samples with no reading are left out rather than printed with a blank cell: a
   * summary table exists to be read at a glance, and a row with nothing in two of its
   * three columns reads as data lost rather than data never taken.
   *
   * Gated on `moistureSurveyed` too, not only on the readings themselves: a report
   * switched back to "לא בוצעה" after readings were typed in still has them sitting on
   * the sample rows — the toggle is what the surveyor is asserting, and section 6.5
   * printing anyway would contradict the report's own "לא בוצעה בדיקת לחות".
   */
  const moistureSummaryRows = (report.moistureSurveyed !== 'כן' ? [] : indoor)
    .filter((sample) => sample.moistureReading.trim() !== '')
    .map((sample) => {
      const result = labResultFor(report, sample);
      return {
        location: sample.location.trim() || result?.sampleName || '',
        reading: sample.moistureReading.trim(),
        assessment: result ? draftedFor(report.moistureAssessments, sample, result) : '',
      };
    });

  return {
    ...report,

    /** Gates the company line and its label — see the radon mapper. */
    isCompany,
    companyName: isCompany ? report.companyName : '',

    /** "בדירת מגורים של ערן פינגר" — the cover and the opening sentence. */
    siteSubject,
    /** "ברחוב פעמונית 2, הוד השרון" — for the sentences that need the preposition. */
    siteStreet,
    /** The address on its own, for the sentences that supply their own. */
    siteAddress: address,

    /**
     * The samples, as the result tables print them.
     *
     * Only rows the surveyor actually entered: a blank line left in the editor would
     * otherwise print as an empty row in a laboratory results table, which reads as a
     * sample that came back with nothing rather than as a row nobody filled in.
     *
     * Each carries its own comparison with the outdoor control, because the template
     * prints that word beside the count and the comparison is not something a Word
     * template can work out.
     */
    samples: realSamples(report).map((sample) => {
      const isOutdoor = isOutdoorSample(sample);
      const comparison = sample.kind === 'אוויר' && !isOutdoor
        ? compareWithOutdoor(sample, outdoor)
        : null;
      return {
        location: displayLocation(sample.location.trim()),
        kind: sample.kind,
        scope: isOutdoor ? 'חוץ' : sample.scope,
        labNumber: sample.labNumber.trim(),
        totalCount: sample.totalCount.trim(),
        organisms: sample.organisms.trim(),
        note: sample.note.trim(),
        /** '' rather than a reassuring word when the comparison could not be made. */
        comparison: comparison ?? '',
        markers: waterDamageMarkersIn(sample).join(', '),
      };
    }),

    /** The indoor air samples alone, for the section that discusses them. */
    indoorSamples: indoor.map((sample) => ({
      location: sample.location.trim(),
      totalCount: sample.totalCount.trim(),
      organisms: sample.organisms.trim(),
      comparison: compareWithOutdoor(sample, outdoor) ?? '',
    })),

    /** The surface samples, printed in their own summary section. */
    surfaceSamples: surfaceSamples(report).map((sample) => ({
      location: sample.location.trim(),
      organisms: sample.organisms.trim(),
      note: sample.note.trim(),
    })),

    /** The outdoor control's own figures, which the conclusion compares against. */
    hasOutdoor: Boolean(outdoor),
    outdoorLocation: displayLocation(outdoor?.location.trim() ?? ''),
    outdoorCount: outdoor?.totalCount.trim() ?? '',
    outdoorOrganisms: outdoor?.organisms.trim() ?? '',

    /**
     * The moisture chapter, printed only when the survey was carried out.
     *
     * The chapter is four paragraphs of purpose, method and caveat before it reaches
     * a single reading, so a report that did no moisture survey must drop the whole
     * section rather than print it with an empty results table underneath.
     */
    hasMoisture: report.moistureSurveyed === 'כן',
    moistureReadings: realMoistureReadings(report).map((reading) => ({
      location: reading.location.trim(),
      reading: reading.reading.trim(),
      level: reading.level,
    })),
    hasElevatedMoisture: hasElevatedMoisture(report),

    /**
     * The closing sections, as lines the template loops over.
     *
     * Stored as arrays of sentences the surveyor signs rather than one block of text,
     * so each prints as its own bullet — the same shape the asbestos summary uses, and
     * for the same reason: a paragraph pasted into one bullet reads as one finding.
     */
    conclusionLines: report.conclusions
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((text) => ({ text })),
    recommendationLines: report.recommendations
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((text) => ({ text })),

    /** The laboratory's own report number, printed in §1. */
    labReportNumber: report.labReportNumber.trim(),

    /*
     * The cover no longer names the rooms sampled (2026-09-16, Galit).
     *
     * That line came from `siteDescription`'s first sentence — the surveyor's own
     * rundown of which rooms were tested, e.g. "בדיקות בחדר שינה הורים, בסלון
     * ובמקלחת המסדרון" — printed in large type right under the title. Galit asked
     * for the cover to stop listing sample locations; §3 ("מטרת הבדיקה ותיאור
     * המקום") is where that detail belongs, and still gets it from the same field.
     */
    /** "שירי מסיקה | חנה רובינא 4, הרצליה" — who asked, then the site itself. */
    siteSubtitle: [report.clientName.trim(), address || report.city.trim()].filter(Boolean).join(' | '),
    /** §1's building line — one short fact about the structure, not the request date. */
    buildingDescription: report.buildingDescription.trim(),

    /**
     * The dates, as §1 and the identity block print them.
     *
     * `surveyDate` is the day of the sampling — taken from `surveyDateTime`, which the
     * surveyor may have written with a time after it ("12.08.2026, 08:00-09:30"), and
     * the table wants the day alone.
     */
    surveyDate: report.surveyDateTime.split(',')[0]?.trim() ?? '',
    /*
     * When this revision was produced.
     *
     * Today, not a stored value: it is the date the file was made, and a date typed
     * by hand is the one that still says last month when the report is reissued after
     * a correction. Written the way the document writes dates.
     */
    revisionDate:
      report.revisionDate.trim() ||
      new Date().toLocaleDateString('he-IL', {
        timeZone: 'Asia/Jerusalem',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).replace(/\//g, '.'),

    samplerName: report.samplerName.trim(),
    authorName: report.authorName.trim(),
    /*
     * Who signs "בכבוד רב" — the report's author.
     *
     * The template carries both signatures and prints one: Yoram's own line when he
     * wrote the report, Dr. Avichai's otherwise — which is also what every report
     * printed before the author could be chosen.
     */
    signedByYoram: report.authorName.trim() === 'יורם גבאי',
    labReceivedDate: report.labReceivedDate.trim(),
    labReportedDate: report.labReportedDate.trim(),

    /*
     * The four protocol details the source file never carried.
     *
     * They keep the template's own "יש להשלים מטופס השטח" until somebody
     * fills them in — that sentence is a standing note that the protocol is
     * incomplete, and an empty cell in its place would read as though nothing were
     * missing.
     */
    samplingHeight: report.samplingHeight.trim() || UNRECORDED,
    hvacState: report.hvacState.trim() || UNRECORDED,
    openingsState: report.openingsState.trim() || UNRECORDED,
    flowVerification: report.flowVerification.trim() || UNRECORDED_PLURAL,

    /**
     * "9 – שמונה פנימיות ודגימת חוץ אחת" — counted, not typed.
     *
     * Retyping this is how a report comes to claim nine samples above eight tables.
     */
    sampleCountLine: sampleCountLine(report),

    /**
     * §2.1 — one row per sample, the whole survey at a glance.
     *
     * The two genera named in its columns are the ones this report turns on:
     * Aspergillus/Penicillium is the group that indicates indoor amplification, and
     * Cladosporium is the commonest outdoor genus and so the one whose indoor excess
     * means something. Both are read out of the laboratory's own rows.
     */
    summaryRows: realSamples(report)
      .map((sample) => ({ sample, result: labResultFor(report, sample) }))
      .filter((entry) => entry.result !== null)
      .map(({ sample, result }) => ({
        location: displayLocation(sample.location.trim() || result!.sampleName),
        totalCount: result!.totalPerCubicMetre,
        aspergillus: genusCount(result!, 'Aspergillus'),
        cladosporium: genusCount(result!, 'Cladosporium'),
        note: sample.note.trim(),
        /*
         * The column always prints; a survey that skipped the moisture test says so in
         * every row rather than the table growing and shrinking a column between
         * reports, which would shift every column beside it.
         */
        moistureReading:
          report.moistureSurveyed !== 'כן'
            ? '—'
            : isOutdoorSample(sample)
              ? 'לא נמדדה'
              : sample.moistureReading.trim() || '—',
      })),

    /** §2 and §3 — drafted from the results, printed a bullet each. */
    executiveSummary: linesOf(report.executiveSummary),
    purposeLines: linesOf(report.purposeDescription),

    /**
     * One result block per sample, as the laboratory's sheet prints them.
     *
     * Driven by `samples` rather than by `labResults`, so the blocks appear in the
     * order the survey took them and carry the surveyor's own room names — the
     * laboratory's `sampleName` is often an abbreviation, and the reader has just
     * read the findings under the surveyor's wording.
     *
     * A sample with no matching sheet prints no block: an empty eighteen-row table
     * under a room heading reads as "the laboratory found nothing", which is a very
     * different statement from "these results have not arrived yet".
     */
    labBlocks: realSamples(report)
      .map((sample, i) => ({ sample, index: i + 1, result: labResultFor(report, sample) }))
      .filter((entry) => entry.result !== null)
      .map(({ sample, index, result }) => ({
        index: String(index),
        /*
         * The room, as the block's heading names it.
         *
         * The surveyor's own wording leads and the laboratory's is the fallback: the
         * sheet abbreviates ("124-4"), and by the time a reader reaches §6 they have
         * met the room under the surveyor's name for it in §2.1 and §3.
         *
         * Called `location` because that is the tag the template carries — the same
         * name §2.1 uses for the same thing.
         */
        location: displayLocation(sample.location.trim() || result!.sampleName),
        labNumber: result!.labNumber,
        volume: result!.volume,
        reportingLimit: result!.reportingLimit,
        background: result!.background,
        fragments: result!.fragments,
        /*
         * Only the genera the laboratory actually found.
         *
         * The template this replaced printed the full roster of eighteen with blanks
         * against the ones not found, on the reasoning that a blank is itself a
         * finding. The revised report drops them, and that is the better call for a
         * document somebody reads: three lines they can take in beat eighteen of
         * which fifteen say nothing. What was looked for is stated once, in §4.
         */
        organisms: result!.organisms.filter(
          (row) => row.raw.trim() !== '' || row.perCubicMetre.trim() !== '',
        ),
        totalRaw: result!.totalRaw,
        totalPerCubicMetre: result!.totalPerCubicMetre,
        totalPercent: result!.totalPercent,
        /*
         * The shaded moisture box, when there is anything to print in it.
         *
         * Present for the outdoor sample whenever moisture was surveyed at all (its box
         * explains that there is no wall to read outdoors), and for an indoor sample
         * only when it actually got a reading and the drafter wrote a note for it — a
         * report must never print a box about a reading nobody took.
         */
        moistureNote: report.moistureSurveyed === 'כן' ? draftedFor(report.moistureNotes, sample, result!) : '',
      })),

    /**
     * §7 — the professional interpretation, gathered into one chapter after every
     * result table rather than repeated under each one (2026-09-16, Galit).
     *
     * One line per sample that has results, in the same order §6 lists them, so a
     * reader who has just finished reading the tables meets the same rooms in the
     * same order here. A sample the drafter did not reach — or gave nothing worth
     * saying — is left out rather than printed with an empty sentence.
     */
    interpretationSummary: realSamples(report)
      .map((sample) => ({ sample, result: labResultFor(report, sample) }))
      .filter((entry): entry is { sample: typeof entry.sample; result: LabResult } => entry.result !== null)
      .map(({ sample, result }) => ({
        location: displayLocation(sample.location.trim() || result.sampleName),
        text: draftedFor(report.interpretations, sample, result),
      }))
      .filter((entry) => entry.text !== ''),

    /** Gates the sections that only make sense when something was found. */
    hasFindings: realSamples(report).length > 0,
    hasSignificantFinding: hasSignificantFinding(report),
    hasWaterDamageMarkers: hasWaterDamageMarkers(report),
    hasSurfaceSamples: surfaceSamples(report).length > 0,

    /**
     * §4's warning that the sampling protocol could not be read off the source file.
     *
     * The sentence is a standing note that four particulars are missing, and it used
     * to print unconditionally — which meant a report where the surveyor had answered
     * every one of the four pickers still told the customer the protocol was
     * incomplete. Gated on the same four fields the pickers themselves fall back to.
     */
    hasUnrecordedProtocol: [
      report.samplingHeight,
      report.hvacState,
      report.openingsState,
      report.flowVerification,
    ].some((v) => v.trim() === ''),

    /** §4.1 and §10 — the instrument every moisture reading in this report came off. */
    moistureInstrument: MOISTURE_INSTRUMENT,

    /** §6.5 — one row per indoor sample that actually got a moisture reading. */
    moistureSummaryRows: moistureSummaryRows,
    /** §6.5's closing paragraph, comparing the readings against one another. */
    moistureNarrativeLines: linesOf(report.moistureNarrative),
    /**
     * Gates §6.5 as a whole.
     *
     * `hasMoisture` covers the rest of the moisture chapter, but §6.5 is a summary of
     * *readings* specifically — the survey toggle can be on with every reading box
     * still blank (a scan interrupted mid-survey), and a summary table with nothing to
     * summarise is worse than no table at all.
     */
    hasMoistureSummary: moistureSummaryRows.length > 0,
  };
}

/** The title the report is listed under — see `reportTitle`. */
export function moldSubject(report: MoldReport): string {
  return reportTitle('mold', report);
}

/** The file name of the produced document. */
export function moldFileName(report: MoldReport): string {
  const where = (report.siteAddress.trim() || report.clientName.trim() || 'דוח עובשים')
    // Windows rejects these outright, and a download named with one silently fails.
    .replace(/[\\/:*?"<>|]/g, '-');
  const reference = report.referenceNumber.trim();
  return `${where} - דוח בדיקת עובשים${reference ? ` - סימוכין ${reference}` : ''}.docx`;
}
