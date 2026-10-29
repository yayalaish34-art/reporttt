import { z } from 'zod';

/**
 * The data model of a mould survey — דו"ח בדיקת עובשים באוויר.
 *
 * A fourth department, and the first whose findings come back from someone else.
 * Radiation and radon are measured on site; asbestos is what the surveyor saw.
 * Mould is neither: air and surface samples are collected, couriered to a
 * microbiology laboratory in the United States, and the report is written around
 * what that laboratory returns.
 *
 * That is why this schema is thinner than it looks next to the printed document.
 * The template runs to fourteen pages, but most of them are the laboratory's own
 * result tables, the standing explanation of how spore counts are read, and the
 * organism descriptions — text that is the same in every report and belongs to
 * the template, not here. What varies from job to job is exactly what the
 * surveyor highlighted in yellow: who ordered it, where and when it was sampled,
 * what the place is like, what the customer complained of, what was found, and
 * what follows from it.
 *
 * Every field is a string, as in the other three: docxtemplater pastes values
 * verbatim, so formatting happens once, here.
 */

const text = z.string().trim();
const required = (label: string) => text.min(1, `${label} — שדה חובה`);

/** Air or surface. The laboratory analyses the two differently and reports them apart. */
export const SAMPLE_KINDS = ['אוויר', 'משטח'] as const;

/**
 * Whether a sample is from inside the building or is the outdoor control.
 *
 * This is the single most consequential property of a sample, and it is why the
 * field exists rather than being inferred from the location's name. The whole
 * reading of a mould report is the comparison between the indoor samples and the
 * outdoor one: there are no national standards for indoor spore counts, so the
 * outdoor sample taken the same morning *is* the reference. A report that cannot
 * tell which sample is the control cannot state its own conclusion.
 */
export const SAMPLE_SCOPES = ['פנים', 'חוץ'] as const;

/**
 * The six surfaces of a room a wall-moisture reading can be taken on.
 *
 * Compass walls rather than "right"/"left": a reader of the report was not standing
 * where the surveyor stood, and "קיר ימני" names nothing once the page is printed.
 */
export const MOISTURE_SURFACES = [
  'קיר צפוני',
  'קיר דרומי',
  'קיר מזרחי',
  'קיר מערבי',
  'רצפה',
  'תקרה',
] as const;

/** One wall-moisture reading in a room: which surface, and the meter's percentage. */
export const WallReadingSchema = z.object({
  /** One of `MOISTURE_SURFACES`. */
  surface: text.default(''),
  /** As the meter shows it — "0.8" or "0.8%"; the "%" is added when printed. */
  reading: text.default(''),
});

/**
 * Where a sample was taken and what the laboratory found in it.
 *
 * One row per sample, air and surface alike, because the laboratory reports each
 * separately and the summary compares them — so a sample has to be something the
 * report can count, name and place, not a sentence.
 *
 * The concentrations stay strings rather than numbers. The laboratory reports
 * "<37,000" as readily as a plain figure, and the "<" carries the meaning that
 * the count ran past the countable range. A numeric field would either refuse
 * that or silently drop the sign that makes it readable.
 */
export const MoldSampleSchema = z.object({
  /** Where it was taken, in the surveyor's words — "חדר בן", "סלון", "חוץ". */
  location: required('מיקום הדגימה'),
  kind: z.enum(SAMPLE_KINDS).default('אוויר'),
  /** 'פנים' or 'חוץ' — see `SAMPLE_SCOPES`. */
  scope: z.enum(SAMPLE_SCOPES).default('פנים'),
  /** The laboratory's own sample number, as printed — "807-1". */
  labNumber: text.default(''),
  /**
   * Total spores per cubic metre, as the laboratory wrote it: "38,009" or "<38,009".
   *
   * A surface sample has no volume and therefore no concentration; the field stays
   * empty there and the summary says what was present instead.
   */
  totalCount: text.default(''),
  /**
   * The genera found, as the laboratory names them — "Aspergillus/Penicillium,
   * Stachybotrys".
   *
   * Latin and comma-separated, because that is how the laboratory reports them and
   * how the summary has to print them. One string rather than a list: the surveyor
   * is copying a line off a laboratory sheet, and splitting it into rows would make
   * that transcription slower without making it more accurate.
   */
  organisms: text.default(''),
  /** Anything specific to this sample that the summary should carry. */
  note: text.default(''),
  /**
   * A capacitive wall-moisture reading taken beside this sample, as the meter shows it
   * — "0.1%", "1.3%".
   *
   * Lives on the sample rather than in a separate list, unlike the meter's own reading
   * log elsewhere: each mould sampling point gets exactly one wall reading beside it,
   * and matching a free-standing list back to a sample by typed-out location name is
   * exactly the kind of silent mismatch a signed report cannot afford. The outdoor
   * sample never carries one — there is no wall to read at an outdoor control point.
   */
  moistureReading: text.default(''),
  /**
   * The media (cassette) number written on the sampling head in the field.
   *
   * It is what the surveyor writes on the chain-of-custody form, so Hayes often prints
   * it back as the sample's name — which is how a room typed on site is matched to its
   * laboratory block a week later. See `labResultFor`.
   */
  mediaNumber: text.default(''),
  /**
   * The wall-moisture readings taken in this room, one per surface.
   *
   * Supersedes `moistureReading` once any is filled in; that single string stays for
   * reports written before rooms carried their own readings. See `moistureText`.
   */
  wallReadings: z.array(WallReadingSchema).default([]),
  /**
   * The photographs taken in this room — ids into the report's `photos`.
   *
   * The photographs themselves stay in one list, so the appendix and its numbering are
   * unchanged; this only says which room each belongs to, which orders the appendix by
   * room and captions an uncaptioned photo with the room's name.
   */
  photoIds: z.array(text).default([]),

  // ── The row this sample gets on Hayes' Chain of Custody ───────────
  /** "Sample" — the name the laboratory will print back, in English. */
  sampleNameEn: text.default(''),
  /** "Analysis" — one of `COC_ANALYSIS_CODES`; spore trap is what every job sends. */
  analysis: text.default('S'),
  /** "Volume" — as written on the form, "150 Lit.". */
  volume: text.default('150 Lit.'),
  /** "Notes" — the row's own note to the laboratory. */
  cocNote: text.default(''),
});

/** The analysis codes Hayes' Chain of Custody lists, in its own order. */
export const COC_ANALYSIS_CODES = ['S', 'S+', 'D', 'D+', 'C1', 'C2', 'C3', 'C5', 'TPA'] as const;

/**
 * The header of Hayes' Chain of Custody form (Form #20).
 *
 * Every field may stay empty: the form is produced from what the report already knows
 * — the sampler, the date, the rooms — and these only override it. See
 * `chainOfCustody` in `mold-coc.ts` for what each one falls back to.
 */
export const ChainOfCustodySchema = z.object({
  jobNumber: text.default(''),
  jobName: text.default(''),
  collector: text.default(''),
  mobile: text.default(''),
  email: text.default(''),
  /** ISO date, "2023-02-13" — printed "February 13, 2023". Empty means today. */
  dateCollected: text.default(''),
  note: text.default(''),
});

/**
 * The organisms the laboratory's table lists, in the order it prints them.
 *
 * Hayes reports the same fixed roster on every sheet, with blanks where a genus was
 * not found — which is why this is a constant and not something read per report: the
 * table's shape is the laboratory's, and a report that printed only the genera it
 * found would no longer match the sheet a customer can hold up beside it.
 *
 * The two pairs joined by a bar are the laboratory's own convention for genera it
 * does not separate under the microscope, and are kept exactly as printed.
 */
export const LAB_ORGANISMS = [
  'Alternaria',
  'Ascospores',
  'Aspergillus |Penicillium',
  'Basidiospores',
  'Bipolaris|Drechslera',
  'Chaetomium',
  'Cladosporium',
  'Curvularia',
  'Epicoccum',
  'Fusarium',
  'Memnoniella',
  'Myxomycetes',
  'Pithomyces',
  'Stachybotrys',
  'Stemphylium',
  'Torula',
  'Ulocladium',
  'Unspecified Spore',
] as const;

/**
 * One organism's row in a sample's laboratory table.
 *
 * Every figure stays a string, as everywhere else here: the laboratory writes
 * "<37000" and ">1%" and "5600<", and the qualifier carries meaning that a number
 * would drop. The report prints what the sheet says.
 */
export const LabOrganismRowSchema = z.object({
  /** The genus as the laboratory names it — one of `LAB_ORGANISMS`. */
  organism: text.default(''),
  /** "ספירה גולמית" — the raw count on the slide. */
  raw: text.default(''),
  /** "ספירה / מטר³" — the concentration. */
  perCubicMetre: text.default(''),
  /** "% מסה״כ". */
  percent: text.default(''),
});

/**
 * The laboratory's result block for one sample.
 *
 * This mirrors the two tables the Hayes sheet prints per sample: a header of the
 * sample's own particulars, and the organism table beneath it. Both are transcribed
 * from the photograph rather than typed.
 */
export const LabResultSchema = z.object({
  /** "מספר דגימה מעבדה דוגמת" — e.g. "807-1". Also what ties this to a sample row. */
  labNumber: text.default(''),
  /** "שם הדגימה" — the room, as the laboratory recorded it. */
  sampleName: text.default(''),
  /** "נפח הדגימה" — e.g. "150 ליטר". */
  volume: text.default(''),
  /** "מגבלת דיווח" — e.g. "7 נבגים \\מטר³". */
  reportingLimit: text.default(''),
  /** "רקע כללי" — the 1–5 background scale, or "ND". */
  background: text.default(''),
  /** "מקטעים" — hyphal fragments, e.g. "73/מטר3". */
  fragments: text.default(''),
  /** One row per organism, in the laboratory's own order. */
  organisms: z.array(LabOrganismRowSchema).default([]),
  /** The "סה״כ" row, which the laboratory prints as a total rather than a genus. */
  totalRaw: text.default(''),
  totalPerCubicMetre: text.default(''),
  totalPercent: text.default(''),
});

/**
 * The answers offered for the four sampling details of §4.
 *
 * A list rather than free text because these are the same handful of answers on every
 * job, and typing them out per report is where the wording drifts — the same protocol
 * described four ways across four reports, so a reader cannot tell whether the
 * differences mean anything. These are the answers Galit's own sampling actually gives.
 *
 * Every one of them keeps a free-text escape in the editor: a sampling that genuinely
 * happened otherwise has to be able to say so, and a picker that flattens it to the
 * nearest listed answer would be recording something that did not happen.
 */

/** Height of the sampling head above the floor — the breathing zone is the default. */
export const SAMPLING_HEIGHT_OPTIONS = [
  '1.0 מ׳ (גובה נשימה בישיבה)',
  '1.5 מ׳ (גובה נשימה בעמידה)',
  '0.5 מ׳',
  '2.0 מ׳',
  'על הרצפה',
] as const;

/**
 * What the air-conditioning was doing during the sampling.
 *
 * It matters to the reading and therefore to the conclusion: a unit running stirs
 * settled spores into the air and can raise a count several-fold, and one that has been
 * off for days gives a picture of the room rather than of the system.
 */
export const HVAC_STATE_OPTIONS = [
  'פעלה במהלך הדיגום',
  'לא פעלה במהלך הדיגום',
  'פעלה במחזור אוויר פנימי בלבד',
  'פעלה עם אוויר צח',
  'אין מערכת מיזוג בחלל',
] as const;

/**
 * What kind of building was surveyed — printed in §1 as "תיאור המבנה".
 *
 * A list rather than a sentence typed per report: it is one of a handful of answers on
 * every job, and the "אחר…" box stays for the building that is none of them.
 */
export const BUILDING_TYPE_OPTIONS = [
  'מבנה מגורים',
  'מקום עבודה',
  'משרדים',
  'מוסד חינוכי',
  'מבנה ציבור',
  'מסחר',
  'תעשייה / מחסן',
] as const;

/** Whether the space was closed while it was sampled. */
export const OPENINGS_STATE_OPTIONS = [
  'חלונות ודלתות סגורים',
  'חלונות סגורים, דלתות פתוחות',
  'חלונות פתוחים',
  'החלל ללא חלונות',
] as const;

/** How the pump's flow was confirmed — the reading is meaningless without it. */
export const FLOW_VERIFICATION_OPTIONS = [
  'בוצעה בדיקת ספיקה לפני הדיגום ואחריו',
  'בוצעה בדיקת ספיקה לפני הדיגום',
  'המשאבה כוילה במעבדה בתוקף',
] as const;

/**
 * The people who may be named in §1 as "מבצע הדיגום" and "עורך הדוח".
 *
 * A fixed pair rather than free text: these two sign Galit's mould reports, and a name
 * typed per report is how the same person comes to be spelled two ways in two copies.
 */
export const MOLD_STAFF = ['יורם גבאי', 'אביחי מוכתר'] as const;

/**
 * What `authorName` defaulted to before it could be chosen.
 *
 * No screen ever set it, and §1 printed "אביחי מוכתר" regardless — the template carried
 * the name as fixed text. Now that the template prints the field, a report stored with
 * this default has to keep printing what it always printed, not a line of credentials.
 */
const LEGACY_AUTHOR_DEFAULT = 'ד״ר אביחי מוכתר (Ph.D.), מדעי החיים ואיכות הסביבה';

/** How a moisture reading is characterised in the report. */
export const MOISTURE_LEVELS = ['תקין', 'לחות מוגברת', 'לחות גבוהה'] as const;

/**
 * The wall-moisture meter Galit's surveyors carry, printed in §4.1 and cited in §10.
 *
 * A constant rather than a field: every moisture reading in this report comes off the
 * same instrument, and a per-report free-text name would be one more empty box on a
 * survey where it is always the same answer. If that ever stops being true, this is
 * the one place to change it.
 */
export const MOISTURE_INSTRUMENT = 'Laserliner MoistureFinder Compact';

/**
 * One reading taken with the wall-moisture meter.
 *
 * Kept apart from the samples because it answers a different question. A spore
 * count says mould is in the air; a damp wall says why. The two together are what
 * turn "there is mould" into "there is mould and here is where the water is
 * getting in", which is the finding a customer can actually act on.
 */
export const MoistureReadingSchema = z.object({
  /** Where the meter was placed — "חדר בן, קיר מערבי מתחת לחלון". */
  location: required('מיקום המדידה'),
  /** What the meter said, as read. Free text: meters are scaled differently. */
  reading: text.default(''),
  level: z.enum(MOISTURE_LEVELS).default('לחות מוגברת'),
});

export const MoldReportSchema = z.object({
  // ── Identification ────────────────────────────────────────────────
  referenceNumber: required('מספר סימוכין'),
  /** Printed on the cover as written — "30 ביולי 2026". */
  reportDate: required('תאריך הדוח'),

  // ── Recipient ─────────────────────────────────────────────────────
  /** A private recipient prints no company line — as in the other reports. */
  customerType: z.enum(['company', 'private']).default('company'),
  customerId: text.default(''),
  /** The document this report was last filed as, on the customer's CRM card. */
  crmDocumentId: text.default(''),
  recipientName: text.default(''),
  companyName: text.default(''),
  addressLine: text.default(''),
  city: text.default(''),
  phone: text.default(''),
  email: text.default(''),

  /**
   * Who asked for the survey, printed on the cover and in the opening line.
   *
   * Separate from the recipient for the reason the asbestos opinion keeps the two
   * apart: the מזמין is frequently a contractor, a managing agent or an insurer,
   * and the report is addressed to them while being *about* somebody's flat. The
   * source document shows exactly that — the cover names the resident whose home
   * was sampled, and the letter is addressed to a company in Nazareth.
   */
  clientName: text.default(''),
  /** The מבקש's own phone, printed in "פרטי ההזמנה". */
  clientPhone: text.default(''),
  /** The מבקש's own e-mail, printed in "פרטי ההזמנה". */
  clientEmail: text.default(''),
  /** When the survey was asked for — printed above the survey's own date. */
  requestDate: text.default(''),

  /*
   * Neither the client nor the address is demanded any more.
   *
   * They were, and the editor asked for both before anything else. It no longer asks
   * for either: the one thing this report is written around is the laboratory's PDF,
   * which arrives about a week after the visit, and demanding the particulars first
   * put five screens between the surveyor and the only step that does any work.
   *
   * Requiring a field the form never shows is the worst of both — the surveyor scans
   * the sheet, presses "סיום", and is told "שם המבקש — שדה חובה" about a box
   * that is not on the screen. Both still print, and both are still worth filling in;
   * they are simply not a gate in front of the scan.
   */

  // ── The site ──────────────────────────────────────────────────────
  /**
   * Whose premises were sampled, as the cover names them.
   *
   * The cover reads "בדירת מגורים של ערן פינגר" — a phrase in two halves, and they
   * are two fields here: `siteKind` is "בדירת מגורים של" and this is the name.
   * Splitting them lets a survey of a school or an office say so without the
   * surveyor retyping the preposition around it.
   */
  occupantName: text.default(''),
  /** "בדירת מגורים של", "במשרדי", "בבית הספר" — see `occupantName`. */
  siteKind: text.default('בדירת מגורים של'),
  /**
   * The address, asked once and printed in five places.
   *
   * Written as the source writes it — "פעמונית 2, הוד השרון" — with no leading
   * "רחוב": the template supplies that word where its own sentence needs it, and
   * the mapper shapes the rest. The same arrangement as the asbestos address, and
   * for the same reason.
   */
  siteAddress: text.default(''),

  // ── The survey ────────────────────────────────────────────────────
  /** Date and time as printed — "30/07/2026, 08:00-09:30". */
  surveyDateTime: text.default(''),
  /** "קיצי, בהיר". */
  weather: text.default(''),
  /** Who was present — the report states this because it is a site visit. */
  attendedBy: text.default(''),
  /** The surveyor, printed under "מבצע הבדיקה" and above the signature. */
  inspectorName: text.default('חיים כהן'),
  inspectorTitle: text.default('בודק מקצועי לאיכות האוויר'),
  inspectorPhone: text.default('054-3692295'),

  /**
   * How many samples reached the laboratory in good condition.
   *
   * Stated in its own sentence near the top of the report — "שבע הדגימות התקבלו
   * במעבדה האנליטית כשהן במצב טוב" — and it is a statement about the chain of
   * custody, not a count of the rows below it. Its own field rather than derived,
   * because a sample that was taken and arrived damaged is a thing the report has
   * to be able to say.
   */
  samplesReceived: text.default(''),
  /** The laboratory's own report number — "#26042301". */
  labReportNumber: text.default(''),

  // ── The new template's own fields ─────────────────────────────────
  //
  // The report is issued as a numbered document with its own revision history, and
  // §1 names everyone who touched it. These are the parts of that block the report
  // carries rather than the template.

  /**
   * When this revision was produced — "מועד הפקת גרסה מתוקנת".
   *
   * Filled with today's date at production rather than asked for: it is the date the
   * file was made, and a date typed by hand is the one that still says last month when
   * the report is reissued after a correction.
   */
  revisionDate: text.default(''),
  /**
   * Who carried out the sampling on site — one of `MOLD_STAFF`, printed in §1.
   *
   * No default: it is a statement of fact in a signed report, and a guessed name is a
   * false one. Reports stored before the choice existed keep the name they carry.
   */
  samplerName: text.default(''),
  /** Who wrote the report — one of `MOLD_STAFF`, printed in §1. */
  authorName: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === LEGACY_AUTHOR_DEFAULT ? 'אביחי מוכתר' : value),
    text.default('אביחי מוכתר'),
  ),
  /** When the laboratory received the samples, and when it reported. */
  labReceivedDate: text.default(''),
  labReportedDate: text.default(''),

  /**
   * The four sampling details the source file did not carry.
   *
   * They print the template's own "לא מופיע בקובץ המקור – יש להשלים מטופס השטח" until
   * somebody fills them in, which is deliberate: that sentence is a standing note to
   * whoever delivers the report that the protocol is incomplete, and blanking it would
   * quietly turn a known gap into an unremarkable empty cell.
   */
  samplingHeight: text.default(''),
  hvacState: text.default(''),
  openingsState: text.default(''),
  flowVerification: text.default(''),

  // ── Description ───────────────────────────────────────────────────
  /** What the place is, in the surveyor's words. Printed under "תיאור מקום הבדיקה". */
  siteDescription: text.default(''),
  /**
   * The building itself, in one short line — "דירה בקומה הראשונה מעל קומת עמודים".
   *
   * Printed in §1's identity table, where the source document that mould templates
   * were built from carried a physical description of the structure rather than the
   * date the survey was requested. Kept apart from `siteDescription`, which is about
   * the rooms sampled and what they open onto: this is one line about the building
   * a reader glances at once, that is about the whole floor.
   */
  buildingDescription: text.default(''),
  /** What the customer says prompted the survey — printed under "טענת המזמין". */
  customerClaim: text.default(''),
  /** What was sampled and why — printed under "אופן ביצוע הבדיקה". */
  methodDescription: text.default(''),

  // ── Moisture ──────────────────────────────────────────────────────
  /**
   * Whether the wall-moisture survey was carried out at all.
   *
   * It is a separate instrument and a separate walk-through, and plenty of jobs are
   * air sampling alone. The whole "בדיקת לחות בקירות" chapter — its purpose, its
   * method, its caveats and its results — prints only when this is on, so a report
   * that did not measure moisture does not carry four paragraphs explaining a test
   * nobody ran.
   */
  moistureSurveyed: z.enum(['כן', 'לא']).default('כן'),
  moistureReadings: z.array(MoistureReadingSchema).default([]),
  /** The moisture chapter's own closing paragraph, drafted and editable. */
  moistureFindings: text.default(''),

  // ── Samples and results ───────────────────────────────────────────
  samples: z.array(MoldSampleSchema).default([]),

  /**
   * The laboratory's own result tables, one per sample, read off its sheet.
   *
   * Kept apart from `samples` although the two describe the same samples, because
   * they come from different places and are trusted differently. A `samples` row is
   * what the surveyor recorded on site and may edit freely; a `labResults` entry is a
   * transcription of a document issued by someone else, and the report prints it as
   * the laboratory wrote it. Merging them would invite an edit on one side to look
   * like a laboratory finding on the other.
   *
   * Matched to a sample by `labNumber` — see `labResultFor`.
   */
  labResults: z.array(LabResultSchema).default([]),

  /** The Chain of Custody sent to Hayes with the samples — see `ChainOfCustodySchema`. */
  coc: ChainOfCustodySchema.default({}),

  /**
   * The photographed laboratory sheets, printed as an appendix.
   *
   * The source document ends with "נספח א' : תוצאות דיגומי אוויר", which in the
   * signed original is the laboratory's own pages. Storing them means the report
   * carries its evidence: a reader who doubts a transcribed figure can look at the
   * sheet it was read from, in the same file.
   *
   * Their own list rather than the general `photos`, because they are not survey
   * photographs — they belong at the end, after the findings, and are captioned by
   * the laboratory report they came from rather than by what they show.
   */
  labSheets: z
    .array(z.object({ imageId: text, caption: text.default('') }))
    .default([]),

  /**
   * The four closing sections, kept editable.
   *
   * They are what a reader treats as the report itself, so they are stored as text
   * the surveyor signs rather than composed at production time from the rows above.
   * The editor drafts them from the samples — every fact they state is already in
   * the tables — and the surveyor edits what the draft says.
   *
   * Stored rather than regenerated, for the reason the asbestos summary is:
   * producing the document twice must not quietly reword the conclusions between
   * two copies of a signed report.
   */
  /**
   * §2 — the executive summary, one bullet per line.
   *
   * Drafted from the laboratory's figures: which rooms came back elevated, what the
   * dominant group was, and how the indoor profile compares with the outdoor sample.
   * It is the section most readers stop at, so it is the one the model is given the
   * most to work from.
   */
  executiveSummary: text.default(''),
  /** §3 — the purpose of the survey and a description of the rooms sampled. */
  purposeDescription: text.default(''),
  /**
   * §7 — professional interpretation, keyed by the laboratory's sample number.
   *
   * Kept per-sample here, but the mapper (see `mold-mapper.ts`'s `interpretationSummary`)
   * gathers every non-empty entry into one chapter printed *after* all the result
   * tables, not under each one individually — Galit asked for the interpretation
   * consolidated rather than repeated per sample (2026-09-16). One short sentence per
   * sample, two at most, and only when the finding is significant enough to say
   * anything — most samples print nothing here.
   */
  interpretations: z.record(text).default({}),
  /**
   * §6 — the moisture box under a sample's table, keyed the same way as
   * `interpretations`. One short paragraph: the reading and what it does or does not
   * indicate for the outdoor control, "לא נמדדה" — there is no wall to read outdoors.
   * A sample with no key here prints no box, rather than one about a reading nobody
   * took.
   *
   * Comparative wording only — see `moistureAssessments` for why "תקין"/"חריג" is
   * banned here too.
   */
  moistureNotes: z.record(text).default({}),
  /**
   * §6.5 — one short assessment per indoor sample that got a moisture reading, for the
   * summary table's "הערכה" column — e.g. "קריאה נמוכה יחסית לשאר המדידות באתר".
   * Keyed the same way as `interpretations`.
   *
   * Comparative language only: the meter has no standard threshold matching the
   * measurement method, so a reading may never be called "תקין"/"רגיל"/"חריג" or
   * described as showing "אין אינדיקציה לחריגה" — both phrasings imply a pass/fail
   * threshold that does not exist (Galit, 2026-09-16). Compare readings only to each
   * other, never to an implied standard.
   */
  moistureAssessments: z.record(text).default({}),
  /** §6.5 — "פרשנות משולבת", comparing the readings against each other. Lines, as above. */
  moistureNarrative: text.default(''),

  airSummary: text.default(''),
  surfaceSummary: text.default(''),
  conclusions: z.array(text).default([]),
  recommendations: z.array(text).default([]),

  // ── Photographs ───────────────────────────────────────────────────
  /**
   * The appendix. One per page, numbered in code — see `buildPhotosXml`.
   *
   * The caption is what goes after "תמונה מס' N :", so it describes the picture and
   * never carries a number of its own.
   */
  photos: z
    .array(z.object({ imageId: text, caption: text.default('') }))
    .default([]),
});

/**
 * A mould report that is still being written.
 *
 * The same relaxation as the other three, and this one stays incomplete for longer
 * than any of them: the laboratory results arrive days after the site visit.
 * Refusing to load a report that is waiting on a courier would make the app useless
 * for exactly the week it is most needed.
 */
export const DraftMoldReportSchema = MoldReportSchema.extend({
  referenceNumber: text.default(''),
  reportDate: text.default(''),
  clientName: text.default(''),
  siteAddress: text.default(''),
  samples: z.array(MoldSampleSchema.extend({ location: text.default('') })).default([]),
  moistureReadings: z
    .array(MoistureReadingSchema.extend({ location: text.default('') }))
    .default([]),
});

/**
 * A report ready to be issued, checked against the shape it is actually in.
 *
 * Rows belonging to a chapter this report is not printing are dropped before
 * validation rather than being asked to justify themselves — the same rule the
 * asbestos schema applies to the layout it is not in. A blank moisture row in a
 * report whose moisture survey is switched off is not a gap in the document; it is
 * a row the editor is not showing, and demanding "מיקום המדידה — שדה חובה" about it
 * would leave the surveyor hunting for a field that is not on screen.
 */
export function parseIssuableMoldReport(data: unknown) {
  const draft = DraftMoldReportSchema.safeParse(data);
  if (!draft.success) return draft;

  const report = draft.data;
  return MoldReportSchema.safeParse({
    ...report,
    moistureReadings: report.moistureSurveyed === 'כן' ? report.moistureReadings : [],
  });
}

export type LabOrganismRow = z.infer<typeof LabOrganismRowSchema>;
export type LabResult = z.infer<typeof LabResultSchema>;
export type MoldSample = z.infer<typeof MoldSampleSchema>;
export type WallReading = z.infer<typeof WallReadingSchema>;
export type ChainOfCustody = z.infer<typeof ChainOfCustodySchema>;
export type MoistureReading = z.infer<typeof MoistureReadingSchema>;
export type MoldReport = z.infer<typeof MoldReportSchema>;
/** A mould report as it exists mid-writing — what the autosave stores between steps. */
export type DraftMoldReport = z.infer<typeof DraftMoldReportSchema>;
