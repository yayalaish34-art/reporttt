import type { AsbestosReport } from './asbestos-schema';
import { hasBuried, hasFindings, realBuildings, realFindings, totalArea } from './asbestos-rules';
import { reportTitle } from './report-title';

/**
 * Turns an asbestos opinion into the flat object docxtemplater renders.
 *
 * Same boundary as the other mappers: everything the template prints is decided
 * here, because docxtemplater pastes strings and does no work of its own.
 *
 * The address is the reason this file is worth reading. It appears six times in
 * the document in three different grammatical forms — bare, after "מרחוב", and
 * as the subject of "בבניין…" — and the surveyor highlighted all six. Asking six
 * times would be absurd, and injecting one string into all six would produce
 * "בביקור במבנה מרחוב וייסבורג 11, תל אביב" in one place and
 * "בוייסבורג 11, תל אביב" in another. So one answer is shaped into the forms the
 * sentences need, here, once.
 */
export function buildAsbestosMergeData(
  report: AsbestosReport,
  /**
   * Renders one building's photographs, when the caller can write to the archive.
   *
   * Optional so the mapper stays callable on its own — the tests merge without a
   * zip, and the prose form has no per-building pictures at all.
   */
  buildingPhotos?: (building: AsbestosReport['buildings'][number], index: number) => string,
): Record<string, unknown> {
  const isCompany = report.customerType === 'company';
  const address = report.siteAddress.trim();

  /**
   * The address with the word the sentences expect in front of it.
   *
   * The surveyor types "וייסבורג 11, תל אביב". The cover and the summary say
   * "מבנה מרחוב …", so they need that prefix; a surveyor who typed "רחוב" or
   * "שדרות" themselves must not get "מרחוב רחוב". Hence the check rather than a
   * blind concatenation.
   */
  const startsWithStreetWord = /^(רחוב|רח'|שדרות|שד'|דרך|סמטת|כיכר)\s/.test(address);
  const siteLabel = address
    ? startsWithStreetWord
      ? `מבנה ב${address}`
      : `מבנה מרחוב ${address}`
    : 'המבנה';

  const findings = realFindings(report);

  return {
    ...report,

    /** Gates the company line and its label — see the radon mapper. */
    isCompany,
    companyName: isCompany ? report.companyName : '',

    /** "מבנה מרחוב וייסבורג 11, תל אביב" — the cover and the summary. */
    siteLabel,
    /** The address on its own, for the sentences that supply their own preposition. */
    siteAddress: address,
    siteAddressBare: address,

    /**
     * The findings, as the repeating block prints them.
     *
     * Only rows the surveyor actually wrote. A blank line left behind in the
     * editor would otherwise print as an empty bullet in a signed opinion.
     */
    findings: findings.map((finding) => ({ ...finding, text: finding.text.trim() })),

    /**
     * The tabled form's buildings, one table each.
     *
     * A building with no name is one the surveyor started and did not fill in; printing
     * an empty fifteen-row table for it would be worse than printing nothing. The same
     * rule the prose form applies to findings.
     */
    buildings: realBuildings(report)
      .map((building, index) => ({
        /**
         * This building's photographs, already rendered as OOXML.
         *
         * Raw XML rather than a nested loop, for the same reason the appendix is:
         * the picture has to be written into the archive and referenced by id,
         * which docxtemplater cannot do from a template tag. The caller supplies
         * the renderer because only it holds the zip — see `buildingPhotosXml` in
         * the service. Absent one, the field is an empty paragraph and the table
         * simply prints without a picture after it.
         */
        photosXml: buildingPhotos ? buildingPhotos(building, index) : '<w:p/>',
        name: building.name.trim(),
        use: building.use.trim(),
        appearance: building.appearance.trim(),
        barrier: building.barrier.trim(),
        area: building.area.trim(),
        moisture: building.moisture.trim(),
        sheetCondition: building.sheetCondition.trim(),
        edgeCondition: building.edgeCondition.trim(),
        debris: building.debris.trim(),
        painted: building.painted.trim(),
        roofCover: building.roofCover.trim(),
        friable: building.friable.trim(),
        instructions: building.instructions.trim(),
      })),

    /**
     * The tabled form's closing "סיכום והנחיות לביצוע" lines.
     *
     * Drafted from the building tables — see `draftAsbestosSummary`. The prose form's
     * findings still feed this in its own layout, so the template has one loop to print
     * whichever the report carries: both are "a line that closes the document", and the
     * shape it was written in is not the template's business.
     */
    summaryLines: (report.layout === 'tables'
      ? report.summaryBullets.map((text) => text.trim())
      : /*
         * The prose form's closing section: three drafted bullets — what was found,
         * what it means, what to do. It used to reuse the findings' own sentences,
         * which made the summary a second copy of the section above it rather than a
         * summary of it. `summaryBullets` is filled by the drafter at production.
         */
        report.summaryBullets.map((text) => text.trim())
    )
      .filter((text) => text !== '')
      .map((text) => ({ text })),

    /** Summed rather than retyped — see `totalArea`. */
    totalArea: totalArea(report),

    /**
     * The two conditional closing sentences.
     *
     * Buried piping is what the soil warning follows from, and the demolition
     * sentence only makes sense if something was found. A survey that found
     * nothing prints neither, which is the case the source document — written
     * for a building that had three findings — never had to consider.
     */
    hasFindings: hasFindings(report),
    hasBuried: hasBuried(report),
  };
}

/** The title the report is listed under — see `reportTitle`. */
export function asbestosSubject(report: AsbestosReport): string {
  return reportTitle('asbestos', report);
}

/** The file name of the produced document. */
export function asbestosFileName(report: AsbestosReport): string {
  const where = (report.siteAddress.trim() || report.clientName.trim() || 'סקר אסבסט')
    // Windows rejects these outright, and a download named with one silently fails.
    .replace(/[\\/:*?"<>|]/g, '-');
  const reference = report.referenceNumber.trim();
  return `${where} - סקר אסבסט${reference ? ` - סימוכין ${reference}` : ''}.docx`;
}
