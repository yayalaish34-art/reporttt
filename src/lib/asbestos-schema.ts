import { z } from 'zod';

/**
 * The data model of an asbestos survey — a חוות דעת.
 *
 * This report is not a laboratory result. It is an expert opinion, given in
 * place of testimony in court, by a licensed surveyor who walked the building
 * and identified asbestos-cement elements on sight. So there are no sample
 * numbers, no fibre types and no laboratory: the finding is what the surveyor
 * saw, described in their own words, with a quantity attached.
 *
 * The template it fills is Galit's own signed opinion, and the fields here are
 * exactly the passages the surveyor highlighted in it as varying between jobs —
 * nothing more. The address was highlighted six times; it is one field, asked
 * once.
 *
 * Every field is a string, for the same reason as in the other reports:
 * docxtemplater pastes values verbatim, so formatting happens once, here.
 */

const text = z.string().trim();
const required = (label: string) => text.min(1, `${label} — שדה חובה`);

/**
 * The families the law treats differently.
 *
 * Cement-bound asbestos is the sheeting, piping and cladding this survey is
 * usually about. Friable asbestos crumbles under hand pressure and may only be
 * handled by a separately licensed contractor, so which one a survey concerns
 * is printed on the cover — it is the first thing a reader needs to know.
 */
export const ASBESTOS_KINDS = ['צמנט', 'פריך'] as const;

/**
 * One finding: an element the surveyor identified, and how much of it there is.
 *
 * The description is free text on purpose. The source report says "3 צינורות
 * ביוב עשויים אסבסט בתוך קירות הבניין כל אחד 9 מטרים סה"כ 27 מטרים" — a count,
 * a material, a place and an arithmetic, written the way a person writes it.
 * Breaking that into columns would produce a table that reads worse and still
 * could not hold the next building's phrasing.
 */
/**
 * The elements a survey actually finds, as the opinions name them.
 *
 * A list rather than free text because these are the same handful of things every time —
 * the source opinions say "צינורות ביוב", "ארובה", "עדניות" — and the wording of the
 * finished sentence is composed from the element, not typed around it.
 */
export const ELEMENT_OPTIONS = [
  'צינורות ביוב',
  'ארובה',
  'עדניות',
  'לוחות גג',
  'קירות חיצוניים',
  'סככה',
  'מיכל מים',
  'צנרת',
] as const;

/** Where an element sits, which decides how the sentence places it. */
export const PLACEMENT_OPTIONS = [
  'בתוך קירות הבניין',
  'על גג הבניין',
  'על חזית המבנה',
  'בחצר',
  'במרתף',
  'בחדר המדרגות',
] as const;

/** The condition a visual survey can actually report. */
export const CONDITION_OPTIONS = ['תקין', 'סדוק', 'שבור', 'מתפורר', 'לא ניתן לראות'] as const;

/**
 * A finding's fields, before the rule that a finding must say what it is.
 *
 * Split from `FindingRowSchema` below purely so the draft schema can still relax a
 * field: the refinement makes the result a ZodEffects, which cannot be extended.
 */
const FindingFieldsSchema = z.object({
  /**
   * The finding as it is printed.
   *
   * Left in place even though the structured fields below now compose it: a finding
   * written before those fields existed carries its whole sentence here, and the merge
   * still prints this field. What changed is where the sentence comes from — the drafter
   * writes into it from the structured facts, and the surveyor can still overwrite it.
   *
   * Not required, and that is the point. The editor has no box for it — the findings
   * step records what, how many, where and what size, and the sentence is composed
   * from those when the document is produced. Demanding it here refused to save an
   * otherwise complete survey with "תיאור הממצא — שדה חובה", naming a field the
   * surveyor could not go and fill in because it is not on the screen. What makes a
   * finding real is checked on the row as a whole instead — see the refinement below.
   */
  text: text.default(''),
  /** What the element is — "צינורות ביוב". Free text accepted for anything unlisted. */
  element: text.default(''),
  /** How many of them, as written: "3". */
  quantity: text.default(''),
  /** Where it sits — "בתוך קירות הבניין". */
  placement: text.default(''),
  /** Size per unit or overall, as the surveyor measured it: "כל אחד 9 מטרים". */
  dimensions: text.default(''),
  /** What the surveyor could see of its state. */
  condition: text.default(''),
  /**
   * The area in square metres, as a number in a string.
   *
   * Kept apart from the description even though the description usually repeats
   * it, because the summary states a total and a total has to be added up. A
   * surveyor who writes "סה"כ 27 מטרים" in the text still owes the report a
   * figure it can sum.
   */
  area: text.default(''),
  /**
   * True when the element is buried or inside a wall — piping, mostly.
   *
   * This is the one property of a finding that changes what the summary says:
   * buried asbestos piping is why the closing section warns that the soil may
   * be contaminated. Without it that sentence would either print on every
   * report or on none.
   */
  buried: z.enum(['כן', 'לא']).default('לא'),
  /**
   * The photographs of this finding, printed straight after it.
   *
   * The same arrangement as a building's own pictures, and for the same reason: the
   * photograph is taken at the moment the element is examined, and it means something
   * beside the finding it documents rather than at the end of the report among others
   * the reader has to match up by caption.
   *
   * Only the id and the caption live here; the picture itself is a row in
   * `asbestos_photos`. The caption falls back to the element's name.
   */
  photos: z.array(z.object({ imageId: text, caption: text.default('') })).default([]),
});

export const FindingRowSchema = FindingFieldsSchema
  /**
   * A finding has to say what it is — by either route.
   *
   * The requirement sits on the row rather than on a field because there are two
   * legitimate ways to answer it, and which one applies depends on when the survey was
   * written. A finding recorded today carries `element` and the sentence is composed at
   * production; one written before those fields existed carries the whole sentence in
   * `text` and nothing else. Both are complete findings, and an opinion already issued
   * from the second kind has to stay reissuable — the stored reports are the archive.
   *
   * Requiring either field on its own broke one of those two cases, which is how the
   * original "תיאור הממצא — שדה חובה" arose: a demand aimed at the old shape, met by a
   * surveyor filling in the new one.
   *
   * The message names the element, because that is the field the editor shows and the
   * only one a surveyor reading this can act on.
   */
  .refine((finding) => finding.element.trim() !== '' || finding.text.trim() !== '', {
    message: 'סוג האלמנט — שדה חובה',
    path: ['element'],
  });

/**
 * One surveyed building, as the tabled report describes it.
 *
 * The tabled variant of the opinion carries a fifteen-row table per building. Three of
 * those rows are section headings printed by the template; the thirteen below are what
 * the surveyor fills in, and they are the fields here.
 *
 * The labels are the source document's own, kept verbatim including their parenthetical
 * examples — "מופע אסבסט (גגות, סככה פתוחה, קיר חיצוני/פנימי וכו')". They are the
 * question the surveyor is answering, and rewording them would change what the answer
 * means.
 *
 * Every answer is free text rather than a fixed list, even where the label says
 * "(כן/לא)". The real answers in Galit's own reports are "לא ניתן לראות- בוצע עליהם
 * שיפוץ חיפוי גבס" and "יש- לא רלוונטי גג רעפים" — a yes/no picker would force those
 * into "לא" and lose the reason, which is the part a reader needs.
 */
export const BuildingRowSchema = z.object({
  /** "שם/ תיאור המבנה" — e.g. "ביתן 3", "בית ספר שלוותה". */
  name: required('שם המבנה'),
  /** "שימוש" — e.g. "משרד משק", "בית ספר- חינוכי". */
  use: text.default(''),
  /** "מופע אסבסט" — where the asbestos appears, e.g. "קירות חיצוניים". */
  appearance: text.default(''),
  /** "תקרת ביניים/ חומר מבנה חוצץ בין האסבסט לחלל המבנה". */
  barrier: text.default(''),
  /** "שטח אסבסט מקורב (מ״ר)". Printed as written — "50 מ״ר" or just "200". */
  area: text.default(''),
  /** "רטיבות בתוך המבנה/ על הלוחות". */
  moisture: text.default(''),
  /** "מצב לוחות/ חומר מכיל אסבסט". */
  sheetCondition: text.default(''),
  /** "מצב שולי/קצוות הלוחות". */
  edgeCondition: text.default(''),
  /** "שברי לוחות על הקרקע (כן/לא)". */
  debris: text.default(''),
  /** "לוחות צבועים (פרט)". */
  painted: text.default(''),
  /** "האם הגגות מכוסות בחזזיות/יריעות ביטומן וכו'". */
  roofCover: text.default(''),
  /** "האם נצפה אסבסט פריך במבנה". */
  friable: text.default(''),
  /** "הנחיות לביצוע" — printed in the table's closing row. */
  instructions: text.default(''),
  /**
   * The photographs of this building, printed straight after its own table.
   *
   * Held on the building rather than in the report's appendix because that is
   * where they belong in the document: a reader who has just read the fifteen
   * rows describing a roof wants the picture of that roof on the next page, not
   * at the end among nine others they have to match up by name. It is the same
   * rule the radiation report follows, where the photograph is taken from inside
   * the table it documents.
   *
   * Only the id and the caption live here; the picture itself is a row in
   * `asbestos_photos`. The caption defaults to the building's name — the surveyor
   * has already typed it once at the top of the table — and stays editable.
   */
  photos: z.array(z.object({ imageId: text, caption: text.default('') })).default([]),
});

export const AsbestosReportSchema = z.object({
  // ── Identification ────────────────────────────────────────────────
  referenceNumber: required('מספר סימוכין'),
  /** Printed on the cover as written — the source says "אוגוסט 2026". */
  reportDate: required('תאריך הדוח'),

  // ── Recipient ─────────────────────────────────────────────────────
  /** A private recipient prints no company line — as in the other reports. */
  customerType: z.enum(['company', 'private']).default('company'),
  customerId: text.default(''),
  /** The document this report was last filed as, on the customer's CRM card. */
  crmDocumentId: text.default(''),
  recipientName: text.default(''),
  companyName: text.default(''),
  phone: text.default(''),
  email: text.default(''),

  /**
   * Who commissioned the survey, as printed on the cover and in the opening.
   *
   * Separate from the recipient: the contact who receives the report and the
   * company that ordered it are often not the same, and it is the ordering
   * company that the opinion names.
   */
  clientName: required('מזמין הסקר'),

  // ── The building ──────────────────────────────────────────────────
  /**
   * The address, asked once and printed six times.
   *
   * Written as the source writes it — "וייסבורג 11, תל אביב" — with no leading
   * "רחוב", because the template already supplies that word where it needs it.
   */
  siteAddress: required('כתובת המבנה'),
  /** "צמנט" / "פריך" — printed on the cover. */
  asbestosKind: text.default('צמנט'),
  /** The building and its use, in the surveyor's words. */
  siteDescription: text.default(''),
  /** How the building sits relative to its neighbours. */
  surroundings: text.default(''),

  /**
   * Which shape of opinion this is.
   *
   * Galit issues the asbestos opinion in two forms, and they are genuinely different
   * documents rather than one document with a section switched off:
   *
   *   'prose'  — findings written as sentences, the way a demolition survey reads:
   *              "3 צינורות ביוב עשויים אסבסט בתוך קירות הבניין... סה״כ 27 מטרים".
   *   'tables' — a fifteen-row table per building, the way a maintenance survey of a
   *              campus reads, where each building is assessed on the same thirteen
   *              questions so that the buildings can be compared.
   *
   * Chosen when the report is created, because it decides which template renders and
   * therefore which fields the editor asks for. It stays editable afterwards — a survey
   * started on the wrong form should not have to be retyped — and each form keeps its
   * own data, so switching back and forth loses nothing.
   */
  layout: z.enum(['prose', 'tables']).default('prose'),

  // ── Findings ──────────────────────────────────────────────────────
  /** Used by the prose form: findings as sentences. */
  findings: z.array(FindingRowSchema).default([]),
  /** Used by the tabled form: one table per building. */
  buildings: z.array(BuildingRowSchema).default([]),

  /**
   * The closing "סיכום והנחיות לביצוע" bullets of the tabled opinion.
   *
   * Drafted from the building tables rather than typed. The surveyor used to
   * write these lines by hand in a step of their own, which asked for facts the
   * tables already held — which buildings carry asbestos cement, in what
   * condition, and which remedial actions were ticked — and so invited the
   * summary and the tables to disagree with each other in a signed document.
   *
   * Stored rather than regenerated at production time, and editable: a drafted
   * sentence in an expert opinion is a starting point, and the surveyor signs
   * the result. Once written they stay put, so producing the document twice
   * cannot quietly reword the section between the two copies.
   */
  summaryBullets: z.array(text).default([]),

  /**
   * The closing sentences, kept editable.
   *
   * They are pre-filled with the source's own wording and are what a reader
   * treats as the opinion itself, so the surveyor has to be able to say
   * something else — a building that is not being demolished does not need the
   * demolition sentence, whatever the defaults say.
   */
  buriedSentence: text.default(
    'בעקבות הימצאות צינורות ביוב עשויים אסבסט קיים פוטנציאל להימצאות נוכחות אסבסט בקרקע.',
  ),
  removalSentence: text.default(
    'לפני הריסת המבנה יש לפנות את כל האלמנטים העשויים אסבסט על פי נוהל לפינוי אסבסט ואבק מזיק.',
  ),

  // ── Photographs ───────────────────────────────────────────────────
  /**
   * The appendix. One per page, numbered in code — see `buildPhotosXml`.
   *
   * The caption is what goes after "תמונה מס' N :", so it describes the picture
   * and never carries a number of its own.
   */
  photos: z
    .array(z.object({ imageId: text, caption: text.default('') }))
    .default([]),
});

/**
 * A report ready to be issued, checked against the shape it is actually in.
 *
 * The two layouts keep their data side by side, so a tabled opinion still carries
 * whatever `findings` existed before it was switched — including the blank starter
 * row every new report is created with. Holding those rows to the strict schema
 * demanded a description for a finding the tabled editor has no screen for, and the
 * surveyor was told "תיאור הממצא — שדה חובה" about a row they could not see, let
 * alone fix.
 *
 * So the rows belonging to the *other* shape are dropped before validation rather
 * than being asked to justify themselves. They stay in storage untouched, which is
 * what lets a report be switched back without losing what was written.
 *
 * Untouched rows are dropped for the same reason, and it is the same complaint one
 * step further in: every report is created with one blank starter finding, and a
 * survey that had two findings typed into three cards was refused over the third —
 * a row the surveyor had never opened. An empty row is not an incomplete finding,
 * it is the absence of one, so it is removed here rather than reported. What counts
 * as empty is `realFindings`' own test, so the row the editor treats as blank and
 * the row this drops are the same row by construction.
 *
 * A *partly* filled row still fails, which is the check doing its job: a card with
 * an element and no area is a finding the surveyor started and left, and naming it
 * is the only way they will know.
 */
export function parseIssuableReport(data: unknown) {
  const draft = DraftAsbestosReportSchema.safeParse(data);
  if (!draft.success) return draft;

  const report = draft.data;
  // Empty means *every* field empty, not just the two that identify a finding. A card
  // carrying a count and an area but no element is one the surveyor opened and left
  // half-answered, and dropping it silently would issue an opinion missing a finding
  // they believed they had recorded. Only a wholly untouched row goes quietly.
  const started = report.findings.filter((finding) =>
    [
      finding.text,
      finding.element,
      finding.quantity,
      finding.placement,
      finding.dimensions,
      finding.condition,
      finding.area,
    ].some((value) => value.trim() !== ''),
  );
  return AsbestosReportSchema.safeParse({
    ...report,
    findings: report.layout === 'tables' ? [] : started,
    buildings: report.layout === 'tables' ? report.buildings : [],
  });
}

/**
 * An asbestos report that is still being written.
 *
 * Same relaxation as the other two: a report created a second ago has no
 * reference number, no client and no findings by definition, and refusing to
 * load it is worse than showing it incomplete. Issuing still goes through the
 * strict schema.
 */
export const DraftAsbestosReportSchema = AsbestosReportSchema.extend({
  referenceNumber: text.default(''),
  reportDate: text.default(''),
  clientName: text.default(''),
  siteAddress: text.default(''),
  // The unrefined fields, so a blank row still autosaves: every report is created with
  // one starter finding, and an autosave that refused it would fail from the moment the
  // survey was opened. The rule that a finding must say what it is belongs to issuing.
  findings: z.array(FindingFieldsSchema).default([]),
  buildings: z.array(BuildingRowSchema.extend({ name: text.default('') })).default([]),
});

export type FindingRow = z.infer<typeof FindingRowSchema>;
export type BuildingRow = z.infer<typeof BuildingRowSchema>;
/** Which shape of opinion a report is — see `layout`. */
export type AsbestosLayout = z.infer<typeof AsbestosReportSchema>['layout'];
export type AsbestosReport = z.infer<typeof AsbestosReportSchema>;
/** An asbestos report as it exists mid-writing — what the autosave stores between steps. */
export type DraftAsbestosReport = z.infer<typeof DraftAsbestosReportSchema>;
