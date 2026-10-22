import type { Report } from './report-schema';
import { measuredProtocols, ELF_INSTANTANEOUS_THRESHOLD, elfCompliance, elfThreshold, rfCompliance } from './measurement-rules';

/**
 * What the measurements actually say.
 *
 * Computed in code, never by the model. The conclusions of a radiation survey
 * are the part a regulator reads and a client acts on; a sentence that misstates
 * whether a threshold was exceeded is the worst thing this system could
 * produce. So the findings are derived here, deterministically, and the model
 * is given them as fixed facts to word — it decides how the sentence reads, not
 * what it says.
 */

/**
 * Exposure thresholds, as the reports state them.
 *
 * From the Ministry of Environmental Protection guidance quoted in the report's
 * own appendices, which is what the conclusions are written against.
 */
export const THRESHOLDS = {
  /**
   * Instantaneous maximum for the public, in mG.
   *
   * Taken from `measurement-rules` rather than restated, so the number the conclusions
   * are drafted against is by construction the number the tables were judged against —
   * two copies of it drifted apart once already.
   */
  elfInstantaneous: ELF_INSTANTANEOUS_THRESHOLD,
  /** Recommended ceiling for a workplace at 8 hours a day, in mG. */
  elfWorkplace: 10,
  /** IARC long-term reference for continuous occupancy, 24-hour average, in mG. */
  elfContinuous: 4,
  /** Environmental threshold for continuously occupied areas, in µW/cm². */
  rfContinuous: 20,
} as const;

export interface MeasurementPoint {
  protocol: string;
  description: string;
  /** Normalized value for ELF, measured value for RF. */
  value: number;
  occupancy: string;
  compliance: string;
}

export interface Findings {
  elf: {
    protocolCount: number;
    pointCount: number;
    /** Highest normalized reading anywhere, or null when nothing is numeric. */
    highest: MeasurementPoint | null;
    /** Highest reading at a point people occupy continuously. */
    highestContinuous: MeasurementPoint | null;
    /** Points whose verdict text says they exceed the guidance. */
    exceeding: MeasurementPoint[];
    /** Points nobody has judged yet — neither exceeding nor compliant. */
    unjudged: MeasurementPoint[];
    /** Continuously occupied points above the long-term IARC reference. */
    aboveContinuousReference: MeasurementPoint[];
    /** Points above this survey's own ceiling, whatever their occupancy. */
    aboveWorkplace: MeasurementPoint[];
    /**
     * The ceiling this survey is held to, in mG.
     *
     * Decided by the site characterization — 4 for a school or a home, 10 for a
     * workplace, 2 for government housing — and carried here so the brief handed
     * to the model states the number the table was actually judged against.
     */
    limit: number;
  };
  rf: {
    protocolCount: number;
    pointCount: number;
    highest: MeasurementPoint | null;
    /** The reference threshold the protocols were judged against. */
    threshold: number | null;
    exceeding: MeasurementPoint[];
  };
}

/** Parses a measurement cell, which is free text and may be blank or "<0.1". */
function toNumber(value: string): number | null {
  const cleaned = value.replace(/[^\d.,-]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** True when the verdict text says the point exceeds the guidance. */
function isExceeding(compliance: string): boolean {
  const t = compliance.trim();
  // "לא חורג" and "לא חורג, חשיפה רגעית" both mean compliant; only a bare
  // "חורג" — or "לא עומד" on the RF side — is an exceedance.
  if (/^לא\s+חורג/.test(t)) return false;
  if (/^עומד/.test(t)) return false;
  return /חורג|לא\s+עומד/.test(t);
}

/** True when the occupancy text means people are there continuously. */
function isContinuous(occupancy: string): boolean {
  const t = occupancy.trim();
  if (/^לא\s/.test(t)) return false;
  return /קבועה|רציף/.test(t);
}

const highestOf = (points: MeasurementPoint[]): MeasurementPoint | null =>
  points.reduce<MeasurementPoint | null>((best, p) => (!best || p.value > best.value ? p : best), null);

/** Reads the measurement tables and reports what they establish. */
export function computeFindings(report: Report): Findings {
  const elfProtocols = measuredProtocols(report.elfProtocols);
  const rfProtocols = measuredProtocols(report.rfProtocols);
  const elfPoints: MeasurementPoint[] = [];
  for (const protocol of elfProtocols) {
    for (const row of protocol.rows) {
      // The normalized value is what the conclusions are judged on; the raw
      // reading is a step on the way to it.
      const value = toNumber(row.normalized) ?? toNumber(row.measured);
      if (value === null) continue;
      elfPoints.push({
        protocol: protocol.title,
        description: row.description,
        value,
        occupancy: row.occupancy,
        /**
         * The same fallback the printed table uses.
         *
         * The surveyor's verdict wins; where they have not given one, the
         * reading and the occupancy decide. Reading it raw meant the conclusions
         * were drafted from "טרם סומנו" for a row whose own table printed
         * "חורג" — the document contradicting itself on the one column a
         * regulator reads.
         */
        compliance: row.compliance || elfCompliance(row.normalized || row.measured, row.occupancy, report.siteCharacter),
      });
    }
  }

  const rfPoints: MeasurementPoint[] = [];
  const thresholds: number[] = [];
  for (const protocol of rfProtocols) {
    for (const row of protocol.rows) {
      const value = toNumber(row.measured);
      const threshold = toNumber(row.threshold);
      if (threshold !== null) thresholds.push(threshold);
      if (value === null) continue;
      rfPoints.push({
        protocol: protocol.title,
        description: row.description,
        value,
        occupancy: row.occupancy,
        /**
         * Derived from the reading, not read off the row.
         *
         * The RF verdict column is computed for display and again when the
         * document is merged, but it is never written back into the row — so
         * the stored value is usually blank. Trusting it here meant a point
         * reading 95 against a threshold of 40 counted as compliant, and the
         * conclusions were drafted from "כל הנקודות עומדות" while the printed
         * table said otherwise.
         */
        compliance: rfCompliance(row.measured, row.threshold) || row.compliance,
      });
    }
  }

  const continuous = elfPoints.filter((p) => isContinuous(p.occupancy));

  return {
    elf: {
      protocolCount: elfProtocols.length,
      pointCount: elfPoints.length,
      highest: highestOf(elfPoints),
      highestContinuous: highestOf(continuous),
      exceeding: elfPoints.filter((p) => isExceeding(p.compliance)),
      /** Points whose verdict column nobody has filled in yet. */
      unjudged: elfPoints.filter((p) => p.compliance.trim() === ''),
      aboveContinuousReference: continuous.filter((p) => p.value > THRESHOLDS.elfContinuous),
      // This survey's own ceiling, not a fixed 10: a reading of 5 mG is over
      // the limit in a school and under it in an office.
      aboveWorkplace: elfPoints.filter((p) => p.value > elfThreshold(report.siteCharacter)),
      limit: elfThreshold(report.siteCharacter),
    },
    rf: {
      protocolCount: rfProtocols.length,
      pointCount: rfPoints.length,
      highest: highestOf(rfPoints),
      threshold: thresholds.length > 0 ? Math.min(...thresholds) : null,
      exceeding: rfPoints.filter((p) => isExceeding(p.compliance)),
    },
  };
}

/**
 * How much of the survey the finding covers: all of it, part of it, or none.
 *
 * The quantifier is the one word in a conclusion that cannot be left to
 * judgement. Handed only counts, a draft of two exceedances out of two points
 * came back as "בחלק מהאזורים נמדדו רמות העולות על הסף" — an understatement of
 * a total exceedance, and precisely the sentence a client would act on. So the
 * split is decided here and stated as an instruction, in the same spirit as the
 * rest of this file: the model chooses the wording, not the claim.
 */
function quantifier(
  matching: number,
  total: number,
  words: { subject: string; condition: string; none: string },
): string {
  if (total === 0) return '';
  if (matching === 0) return `${words.none} — מותר לנסח "בכל" לגבי ההפך.`;
  if (matching >= total) {
    return `כל ${total} ${words.subject} ${words.condition} — יש לנסח "בכל", אסור לנסח "בחלק".`;
  }
  return `${matching} מתוך ${total} ${words.subject} ${words.condition} — יש לנסח "בחלק מ…", אסור לנסח "בכל".`;
}

/**
 * The findings as a brief for the model.
 *
 * Plain statements of fact with the numbers already decided, so the model has
 * nothing to compute and no room to guess. It reads as a list because that is
 * what it is: the things the conclusions are allowed to say.
 */
export function describeFindings(findings: Findings, kind: 'elf' | 'rf'): string {
  const lines: string[] = [];

  if (kind === 'elf') {
    const { elf } = findings;
    lines.push(`נמדדו ${elf.pointCount} נקודות ב-${elf.protocolCount} פרוטוקולי ELF.`);

    if (elf.highest) {
      lines.push(`הערך הגבוה ביותר: ${elf.highest.value} מיליגאוס ב"${elf.highest.description}" (${elf.highest.protocol}), אכלוס: ${elf.highest.occupancy}.`);
    }
    if (elf.highestContinuous) {
      lines.push(`הגבוה ביותר בנקודה עם שהייה קבועה: ${elf.highestContinuous.value} מיליגאוס ב"${elf.highestContinuous.description}".`);
    } else {
      lines.push('אין נקודות מדידה עם שהייה קבועה.');
    }

    // "אף נקודה אינה חורגת" is only true once every point has actually been
    // judged. Said while rows are still blank it is a claim nobody made, and it
    // is the sentence the drafted clause leans on hardest.
    const unjudged = elf.unjudged.length;
    lines.push(
      elf.exceeding.length > 0
        ? `${elf.exceeding.length} נקודות סומנו כחורגות: ${elf.exceeding.map((p) => `"${p.description}" (${p.value} מ"ג)`).join(', ')}.`
        : unjudged > 0
          ? `${unjudged} נקודות טרם סומנו כחורגות או לא חורגות — אין לקבוע לגביהן עמידה בהמלצות.`
          : 'אף נקודה אינה חורגת מהמלצות המשרד להגנת הסביבה.',
    );

    lines.push(
      elf.aboveContinuousReference.length === 0
        ? `אין נקודות עם שהייה קבועה מעל ${THRESHOLDS.elfContinuous} מיליגאוס (סף IARC לחשיפה ממושכת).`
        : `${elf.aboveContinuousReference.length} נקודות עם שהייה קבועה מעל ${THRESHOLDS.elfContinuous} מיליגאוס: ${elf.aboveContinuousReference.map((p) => `"${p.description}" (${p.value})`).join(', ')}.`,
    );

    if (elf.aboveWorkplace.length > 0) {
      lines.push(`${elf.aboveWorkplace.length} נקודות מעל ${elf.limit} מיליגאוס (הסף שחל על סוג המקום): ${elf.aboveWorkplace.map((p) => `"${p.description}" (${p.value})`).join(', ')}.`);
    }
    lines.push(
      quantifier(elf.exceeding.length, elf.pointCount, {
        subject: 'נקודות המדידה',
        condition: 'חורגות',
        none: 'אף אחת מנקודות המדידה אינה חורגת',
      }),
    );
    return lines.filter(Boolean).join('\n');
  }

  const { rf } = findings;
  lines.push(`נמדדו ${rf.pointCount} נקודות ב-${rf.protocolCount} פרוטוקולי RF.`);
  if (rf.highest) {
    lines.push(`הערך הגבוה ביותר: ${rf.highest.value} מיקרוואט לסמ"ר ב"${rf.highest.description}" (${rf.highest.protocol}).`);
  }
  if (rf.threshold !== null) {
    lines.push(`סף הייחוס שלפיו נבחנו התוצאות: ${rf.threshold} מיקרוואט לסמ"ר.`);
  }
  lines.push(
    rf.exceeding.length === 0
      ? 'כל הנקודות עומדות בדרישות.'
      : `${rf.exceeding.length} נקודות אינן עומדות בדרישות: ${rf.exceeding.map((p) => `"${p.description}" (${p.value})`).join(', ')}.`,
  );
  lines.push(
    quantifier(rf.exceeding.length, rf.pointCount, {
      subject: 'האזורים שנמדדו',
      condition: 'חורגים מהסף',
      none: 'אף אחד מהאזורים שנמדדו אינו חורג מהסף',
    }),
  );
  return lines.filter(Boolean).join('\n');
}

