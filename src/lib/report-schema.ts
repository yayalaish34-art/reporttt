import { z } from 'zod';
import { stripProtocolPrefix } from './measurement-rules';

/**
 * The data model of a radiation survey report.
 *
 * Every field is a string. docxtemplater does no formatting of its own — it
 * pastes values verbatim — so numbers and dates are formatted once, here at the
 * edge, and travel through the system already presentable.
 */

const text = z.string().trim();

/** One measured point in an ELF (power-frequency magnetic field) protocol. */
export const ElfRowSchema = z.object({
  /** Free-text description of where the probe was held. */
  description: text.default(''),
  /** Distance from the source, in metres. */
  distance: text.default(''),
  /** Height above floor, in metres. */
  height: text.default(''),
  /** Measured flux density, in mG. */
  measured: text.default(''),
  /** Flux density after applying the normalization factor, in mG. */
  normalized: text.default(''),
  /** "קבועה" / "לא קבועה" — whether people occupy the point continuously. */
  occupancy: text.default(''),
  /** "לא חורג" / "חורג" + optional qualifier. */
  compliance: text.default(''),
});

/** One measured point in an RF (radio frequency) protocol. */
export const RfRowSchema = z.object({
  description: text.default(''),
  /** "רציף" / "לא רציף" — occupancy of the area. */
  occupancy: text.default(''),
  /** Measured power density, in µW/cm². */
  measured: text.default(''),
  /** Reference threshold applied, in µW/cm². */
  threshold: text.default(''),
  /** "עומד" / "לא עומד". */
  compliance: text.default(''),
  distance: text.default(''),
  height: text.default(''),
});

/** A single official protocol: one table of points for one source at one floor. */
export const ElfProtocolSchema = z.object({
  /**
   * The radiating source, e.g. "לוח חשמל ראשי".
   *
   * Only the source — the fixed opening of the heading ("פרוטוקול רשמי - מדידת
   * שדה מגנטי ELF ב…") is added when the document is built, so it is written
   * once in code rather than retyped for every table.
   */
  title: text.default(''),
  /** Column header describing the source, e.g. "בדיקה ביחס ללוח חשמל דרומי". */
  referenceLabel: text.default(''),
  rows: z.array(ElfRowSchema).default([]),
  /** The normalization coefficient applied to this protocol. */
  normalizationFactor: text.default('1'),
  /** The sentence explaining why that coefficient was chosen. */
  normalizationNote: text.default(''),
});

export const RfProtocolSchema = z.object({
  /** The radiating source. Same rule as ELF — see `ElfProtocolSchema.title`. */
  title: text.default(''),
  referenceLabel: text.default(''),
  rows: z.array(RfRowSchema).default([]),
});

/**
 * A measuring instrument and its calibration status.
 *
 * The spec block in the report prints one fact per line, so each line is its
 * own field rather than being assembled from parts. That keeps the wording of
 * a line — which is copied verbatim off the device's calibration certificate —
 * under the surveyor's control instead of the template's.
 */
export const InstrumentSchema = z.object({
  /** Make and model line, e.g. "Electromagnetic field strength meter: AARONIA AG …". */
  modelLine: text.default(''),
  /** Secondary description line, used by the RF spec block. */
  descriptionLine: text.default(''),
  /** Serial line as printed, e.g. "S.N: 37401". */
  serialLine: text.default(''),
  /** Frequency range, English line. */
  frequencyRangeEn: text.default(''),
  /** Frequency range, Hebrew line. Only the ELF block prints one. */
  frequencyRangeHe: text.default(''),
  /** Sensitivity line. Only the ELF block prints one. */
  sensitivity: text.default(''),
  /** Date the calibration certificate expires. */
  calibrationValidity: text.default(''),
});

/** A licensed inspector who performed the site visit and measurements. */
export const InspectorSchema = z.object({
  name: text.default(''),
  /** e.g. "בודק קרינה". */
  title: text.default(''),
  /** "ELF" or "RF" — the permit class. */
  permitType: text.default(''),
  permitNumber: text.default(''),
  permitValidity: text.default(''),
  /** Signature to stamp on this row. Empty leaves the cell blank. */
  signatureId: text.default(''),
});

/** Whoever wrote the report and whoever signed it off. */
export const AuthorSchema = z.object({
  name: text.default(''),
  /** "עורך הדו\"ח" / "מאשר הדו\"ח". */
  role: text.default(''),
  /** Signature to stamp on this row. Empty leaves the cell blank. */
  signatureId: text.default(''),
});

/** A site photograph appended after the conclusions. */
export const PhotoSchema = z.object({
  /** Caption, without the "תמונה מס' N :" prefix — that is generated. */
  caption: text.default(''),
  /** Stored image id, resolved to bytes at merge time. */
  imageId: text.default(''),
});

export const ReportSchema = z.object({
  // ── Identification ────────────────────────────────────────────────
  /** Reference number ("סימוכין"), printed in the header of every page. */
  referenceNumber: text.default(''),
  /**
   * The date the report is issued, as `YYYY-MM-DD`.
   *
   * Drives the whole header: the weekday, the Hebrew calendar date and the
   * Gregorian date are all derived from it at merge time. Stored rather than
   * taken from the clock so that regenerating an issued report reproduces it
   * instead of silently re-dating it to today.
   */
  reportDate: text.default(''),

  // ── Recipient (לכבוד) ─────────────────────────────────────────────
  /**
   * A company recipient prints a contact line and a company line; a private
   * one prints just their name, and the company line is dropped entirely.
   */
  customerType: z.enum(['company', 'private']).default('company'),
  /**
   * The customer this report belongs to, as the CRM knows them.
   *
   * The recipient fields below are a copy taken when the customer was picked —
   * deliberately, so that correcting a name here cannot rewrite the directory.
   * This id is what survives that copy, and it is what lets a finished report
   * be filed back onto the right customer card. Empty for a report whose
   * recipient was typed in by hand rather than chosen.
   */
  customerId: text.default(''),
  /**
   * The document this report was last filed as, on the customer's card.
   *
   * Kept so that regenerating replaces that filing instead of leaving the card
   * with a pile of near-identical copies, one per time somebody pressed
   * "הורדת Word".
   */
  crmDocumentId: text.default(''),
  /** The person addressed. For a private customer this is the customer. */
  recipientName: text.default(''),
  /** Role, printed after the name. Companies only. */
  recipientTitle: text.default(''),
  /** Printed bold and underlined. Companies only. */
  companyName: text.default(''),
  addressLine: text.default(''),
  /** Printed bold and underlined. */
  city: text.default(''),
  phone: text.default(''),
  email: text.default(''),

  // ── Subject and cover wording ─────────────────────────────────────
  /**
   * Which frequency ranges the survey covered.
   *
   * Three sentences on the cover name the ranges, and all three are derived
   * from this one value — an ELF-only survey must not claim on its cover to
   * have measured radio frequencies.
   */
  surveyScope: z.enum(['elf', 'rf', 'both']).default('both'),
  /** The site as it is named in running text, e.g. "משרדי חברת כ.א.ל, מוקד בני ברק". */
  siteName: text.default(''),
  /**
   * The subject line. Recomposed from the survey data on every merge while
   * `subjectAuto` holds; the stored value is used once the surveyor takes it
   * over, either by editing it or by accepting an AI draft.
   */
  subject: text.default(''),
  subjectAuto: z.boolean().default(true),
  /** The sentence stating when the measurements were taken, same rule. */
  openingSentence: text.default(''),
  openingAuto: z.boolean().default(true),

  // ── Order details (פרטי ההזמנה) ───────────────────────────────────
  requesterName: text.default(''),

  // ── Measurement characterization (אפיון מדידות הקרינה) ────────────
  /** Date only, used in the cover sentence. */
  measurementDate: text.default(''),
  /** Date and time as printed in the characterization table. */
  measurementDateTime: text.default(''),
  /** Street address of the measured site. */
  location: text.default(''),
  /** e.g. "משרדים". */
  siteCharacter: text.default(''),
  weather: text.default(''),
  /** e.g. "לוח חשמל". */
  fieldSource: text.default(''),
  /** e.g. "מדידות שדה מגנטי". */
  measurementType: text.default(''),

  // ── People ────────────────────────────────────────────────────────
  inspectors: z.array(InspectorSchema).default([]),
  authors: z.array(AuthorSchema).default([]),

  // ── Instruments ───────────────────────────────────────────────────
  elfInstrument: InstrumentSchema.default({}),
  rfInstrument: InstrumentSchema.default({}),

  // ── Results ───────────────────────────────────────────────────────
  elfProtocols: z.array(ElfProtocolSchema).default([]),
  rfProtocols: z.array(RfProtocolSchema).default([]),

  // ── Narrative ─────────────────────────────────────────────────────
  /** Bullet lines of the ELF conclusions section. */
  /** Bullet lines of the RF conclusions section. */

  // ── Appendix ──────────────────────────────────────────────────────
  photos: z.array(PhotoSchema).default([]),

  // ── Antenna map (נספח מפת אנטנות) ────────────────────────────────
  /** Manual request for a map; selecting antennas in the survey forces it regardless. */
  antennaMapEnabled: z.boolean().default(false),
  /** Exact street/address of the surveyed property, never the customer's postal address. */
  antennaMapAddress: text.default(''),
  /** City of the surveyed property, kept separate from the recipient's city. */
  antennaMapCity: text.default(''),
  /** Override: ITM X coordinate (from govmap click or manual entry). */
  antennaMapX: z.number().optional(),
  /** Override: ITM Y coordinate. */
  antennaMapY: z.number().optional(),
  /** Initial radius; export automatically expands to 1 km if the 500 m search is empty. */
  antennaMapRadius: z.number().default(500).transform(() => 500),
  /** Label for the survey point on the map, e.g. "בית ספר אליאנס". */
  antennaMapLabel: text.default(''),
  /** Site classification, e.g. "מוסד חינוך" / "בית מגורים". */
  antennaMapClassification: text.default(''),
});

/** Drafts and issued reports accept partial input; empty measurements are omitted at export. */
export const DraftReportSchema = ReportSchema;

/**
 * Reads a stored report, defaulting the wording modes for older records.
 *
 * Reports written before the subject became composable carry a `subject` but no
 * `subjectAuto`. Letting that default to automatic would silently discard
 * wording a surveyor had chosen, so a stored sentence with no mode beside it is
 * taken as manual — the reading that cannot lose anything.
 *
 * Built on the draft schema: what is on disk includes reports that are still
 * half-written, and refusing to load one is worse than showing it incomplete.
 */
export const StoredReportSchema = z.preprocess((value) => {
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;

  const withDefaults = { ...record };
  if (record.subjectAuto === undefined && typeof record.subject === 'string' && record.subject.trim() !== '') {
    withDefaults.subjectAuto = false;
  }
  if (
    record.openingAuto === undefined &&
    typeof record.openingSentence === 'string' &&
    record.openingSentence.trim() !== ''
  ) {
    withDefaults.openingAuto = false;
  }

  /**
   * Protocol headings written before the split held the whole sentence.
   *
   * Left alone, an old report would show a field labelled "שם המקור המקרין"
   * with a full heading in it, and would then print that heading with the fixed
   * opening in front of it twice. Stripped here, an old report simply behaves
   * like a new one from the moment it is opened.
   */
  for (const [key, kind] of [
    ['elfProtocols', 'elf'],
    ['rfProtocols', 'rf'],
  ] as const) {
    const protocols = record[key];
    if (!Array.isArray(protocols)) continue;
    withDefaults[key] = protocols.map((protocol) =>
      protocol && typeof protocol === 'object' && typeof (protocol as { title?: unknown }).title === 'string'
        ? { ...protocol, title: stripProtocolPrefix(kind, (protocol as { title: string }).title) }
        : protocol,
    );
  }

  return withDefaults;
}, DraftReportSchema);

export type ElfRow = z.infer<typeof ElfRowSchema>;
export type RfRow = z.infer<typeof RfRowSchema>;
export type ElfProtocol = z.infer<typeof ElfProtocolSchema>;
export type RfProtocol = z.infer<typeof RfProtocolSchema>;
export type Instrument = z.infer<typeof InstrumentSchema>;
export type Inspector = z.infer<typeof InspectorSchema>;
export type Author = z.infer<typeof AuthorSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type Report = z.infer<typeof ReportSchema>;
/** A saved report, including work still in progress. */
export type DraftReport = z.infer<typeof DraftReportSchema>;
