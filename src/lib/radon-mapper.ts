import type { RadonReport } from './radon-schema';
import { radonVerdict } from './radon-rules';
import { reportTitle } from './report-title';

/**
 * Turns a radon report into the flat object docxtemplater renders.
 *
 * Same boundary as the radiation mapper: everything the template prints is
 * decided here, because docxtemplater pastes strings and does no work of its
 * own. The template stays free of logic so it can be edited in Word.
 */
export function buildRadonMergeData(report: RadonReport): Record<string, unknown> {
  let point = 0;
  const isCompany = report.customerType === 'company';

  return {
    ...report,

    /**
     * Gates the company line and its label, both of which a private customer
     * has no use for.
     *
     * Blanking the value rather than only relying on the template's condition:
     * the label "שם החברה" sits in a table cell beside it, and an empty cell
     * next to a label is worse than no row at all — so the two travel together
     * through `{#isCompany}`.
     */
    isCompany,
    companyName: isCompany ? report.companyName : '',

    detectors: report.detectors.map((row) => ({
      ...row,
      // Numbered across the survey, which for radon is one table — but the rule
      // is the same one the radiation protocols follow, and it is the number a
      // client quotes back when they ask about a room.
      pointNumber: String(++point),
      /**
       * The verdict follows from the reading, its uncertainty and the action
       * level. A surveyor's own wording wins where they gave one; where they
       * did not, a blank cell in a delivered report is not an option.
       */
      recommendation: radonVerdict(row),
    })),
  };
}

/** The title the report is listed under — see `reportTitle`. */
export function radonSubject(report: RadonReport): string {
  return reportTitle('radon', report);
}

/** The file name of the produced document. */
export function radonFileName(report: RadonReport): string {
  const where = (report.companyName.trim() || report.recipientName.trim() || 'דוח ראדון')
    // Windows rejects these outright, and a download named with one silently fails.
    .replace(/[\\/:*?"<>|]/g, '-');
  const reference = report.referenceNumber.trim();
  return `${where} - דוח ראדון${reference ? ` - סימוכין ${reference}` : ''}.docx`;
}
