import { z } from 'zod';

/**
 * The data model of a radon survey report.
 *
 * Radon is measured, not read: a CR-39 detector sits in a room for months and is
 * then developed in a laboratory, which returns a concentration and an
 * uncertainty. So where the radiation report records what a meter showed at a
 * moment, this one records a detector, two dates, and what came back.
 *
 * Every field is a string, for the same reason as in the radiation report:
 * docxtemplater pastes values verbatim, so formatting happens once, here.
 */

const text = z.string().trim();
const required = (label: string) => text.min(1, `${label} — שדה חובה`);

/**
 * Action levels, in Bq/m³.
 *
 * The two are not a stricter and a looser version of one rule: a workplace is
 * held to the Ministry of Economy's 500, everywhere else to the Ministry of
 * Environmental Protection's 200. Which applies is decided by the site kind,
 * which is why that field is an enum and not free text.
 */
export const RADON_THRESHOLDS = {
  workplace: 500,
  general: 200,
} as const;

/** The site kinds the guidance distinguishes, as the report names them. */
export const SITE_KINDS = [
  'מקום עבודה',
  'מגורים',
  'מוסד חינוך',
  'מוסד ציבורי',
  'צה"ל',
  'אתר אחר',
] as const;

/** Long-term is the standard survey; short-term is the screening test. */
export const TEST_LENGTHS = ['ארוכה', 'קצרה'] as const;

/**
 * The verdicts the report prints, taken word for word from the guidance table
 * that the template itself carries.
 */
export const RADON_VERDICTS = {
  ok: 'תקין, אין צורך לבצע פעולות שיפור',
  exceeds: 'לא תקין, יש לבצע פעולות שיפור',
  shortOk: 'יש לבצע בדיקה ארוכת טווח',
} as const;

/** One detector: where it sat, for how long, and what the laboratory returned. */
export const DetectorRowSchema = z.object({
  /** Laboratory serial of the detector. */
  detectorNumber: text.default(''),
  /** Room the detector sat in. */
  roomName: required('שם החדר'),
  /** Floor, as written — "1-" for a basement level. */
  floor: text.default(''),
  /** "ארוכה" / "קצרה". */
  testLength: text.default('ארוכה'),
  /** Ventilation regime during the test. "ת.מ.ר" = normal living conditions. */
  ventilation: text.default('ת.מ.ר'),
  /** When the detector was placed and collected, as printed. */
  placedAt: text.default(''),
  collectedAt: text.default(''),
  /** Concentration returned by the laboratory, in Bq/m³. */
  concentration: text.default(''),
  /** Measurement uncertainty, as a percentage of the reading. */
  uncertainty: text.default(''),
  /**
   * The action level this row was judged against, in Bq/m³.
   *
   * Stored per row rather than derived at print time: a survey can cover rooms
   * held to different levels, and the printed table has to say which was used.
   */
  threshold: text.default(String(RADON_THRESHOLDS.workplace)),
  /**
   * The verdict. Left blank it is computed from the reading, the uncertainty
   * and the threshold — see `radonVerdict`.
   */
  recommendation: text.default(''),
});

export const RadonReportSchema = z.object({
  // ── Identification ────────────────────────────────────────────────
  referenceNumber: required('מספר סימוכין'),
  reportDate: required('תאריך הדוח'),

  // ── Recipient ─────────────────────────────────────────────────────
  /**
   * A company recipient prints a company line; a private one prints just their
   * name, and the line — with its "שם החברה" label — is dropped entirely.
   *
   * The radon report was built without this distinction, so every report
   * carried a company line whether or not there was a company, and the editor
   * asked for a company name from a private customer.
   */
  customerType: z.enum(['company', 'private']).default('company'),
  customerId: text.default(''),
  /** The document this report was last filed as, on the customer's CRM card. */
  crmDocumentId: text.default(''),
  recipientName: required('שם איש הקשר'),
  companyName: text.default(''),
  addressLine: text.default(''),
  city: text.default(''),
  phone: text.default(''),
  email: text.default(''),

  // ── The survey ────────────────────────────────────────────────────
  /** Decides which action level applies. */
  siteKind: text.default('מקום עבודה'),
  /** Detector type and laboratory, printed in the "פרטי הגלאים" table. */
  detectorType: text.default('CR39'),
  detectorBrand: text.default('RV'),
  laboratory: text.default('גלית החברה לאיכות הסביבה'),

  // ── Results ───────────────────────────────────────────────────────
  detectors: z.array(DetectorRowSchema).default([]),

  // ── Notes block (הערות לגבי הבדיקה) ───────────────────────────────
  /** Which rooms the notes block describes, e.g. "חדרים בקומת 1-". */
  notesRooms: text.default(''),
});

/**
 * A radon report that is still being written.
 *
 * Same relaxation as the radiation report: a report created a second ago has no
 * reference number and no recipient by definition, and refusing to load it is
 * worse than showing it incomplete.
 */
export const DraftRadonReportSchema = RadonReportSchema.extend({
  referenceNumber: text.default(''),
  recipientName: text.default(''),
  /**
   * The rows are relaxed too, and this is not a detail.
   *
   * A new report opens with one empty detector row, so a schema that insists on
   * a room name cannot read back the report it has just created — every fresh
   * radon report failed to open. Saving still goes through the strict schema,
   * so an empty room name can be typed but not issued.
   */
  detectors: z.array(DetectorRowSchema.extend({ roomName: text.default('') })).default([]),
});

export type DetectorRow = z.infer<typeof DetectorRowSchema>;
export type RadonReport = z.infer<typeof RadonReportSchema>;
/** A radon report as it exists mid-writing — what the autosave stores between steps. */
export type DraftRadonReport = z.infer<typeof DraftRadonReportSchema>;
