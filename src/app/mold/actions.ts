'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addMoldPhoto,
  createMoldReport,
  deleteMoldPhoto,
  deleteMoldReport,
  generateMoldReport,
  loadMoldReport,
  nextMoldReference,
  saveMoldReport,
  upgradeToPersonalMoldReference,
} from '@/lib/mold-service';
import { crmApiConfigured, fileReportOnCustomerCard } from '@/lib/crm-filing';
import {
  DraftMoldReportSchema,
  parseIssuableMoldReport,
  type MoldReport,
} from '@/lib/mold-schema';
import { aiDraftingAvailable } from '@/lib/ai-text';
import { draftMoldReport } from '@/lib/mold-draft';
import { realSamples } from '@/lib/mold-rules';
import { acceptPhoto } from '@/lib/photo-intake';
import { keepStoredPhotos } from '@/lib/keep-photos';

export interface MoldActionResult {
  ok: boolean;
  error?: string;
  issues?: string[];
}

/** The date as the cover prints it — "30 ביולי 2026". */
function hebrewDate(date = new Date()): string {
  const months = ['בינואר', 'בפברואר', 'במרץ', 'באפריל', 'במאי', 'ביוני',
    'ביולי', 'באוגוסט', 'בספטמבר', 'באוקטובר', 'בנובמבר', 'בדצמבר'];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * The date as §1 and the identity block print it — "12.08.2026".
 *
 * Numeric, not the cover's Hebrew month: those tables are read as a record of when
 * things happened, and a column of "12 באוגוסט 2026" beside "18.08.2026" reads as two
 * different kinds of fact.
 *
 * Pinned to Israel: the server runs in UTC, and a report opened late in the evening
 * would otherwise be dated the day before.
 */
function numericDate(date = new Date()): string {
  return date
    .toLocaleDateString('he-IL', {
      timeZone: 'Asia/Jerusalem',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    .replace(/\//g, '.');
}

/**
 * A report with everything that can be decided before the surveyor arrives.
 *
 * Parsed as a draft so the client and the address start genuinely empty — see the
 * asbestos equivalent for why a "—" placeholder is worse than an empty box.
 */
function blankMoldReport(): MoldReport {
  /*
   * `requestDate` — when the report was opened — genuinely is today, so it is taken
   * rather than asked for.
   *
   * `surveyDateTime` — the sampling date — used to default to today as well, on the
   * reasoning that the surveyor opens the report on the day of the visit. For mould
   * that reasoning does not hold: the findings arrive from the laboratory in the
   * United States about a week after the visit, and by the time anyone opens this
   * screen the sampling date is already in the past. A report written up on the 15th
   * for a survey taken on the 3rd printed "15.09.2026" as the sampling date, silently
   * wrong in both §1 and the cover.
   *
   * So it starts empty and is filled from the laboratory sheet instead — the "Collected"
   * date printed on every Hayes report — the same "only into an empty field" rule every
   * other scanned particular follows. It is also its own field in the editor, for the
   * survey the sheet does not carry that date on, or carries it wrong.
   */
  const today = numericDate();
  const base = DraftMoldReportSchema.parse({
    referenceNumber: nextMoldReference(),
    reportDate: hebrewDate(),
    requestDate: today,
  });
  /*
   * No sample rows are seeded.
   *
   * Two were, one indoor and one outdoor, so the surveyor would find the control row
   * waiting and remember to take that sample. That reasoning belonged to a form filled
   * in on site; this one is filled in from the laboratory's PDF a week later, and the
   * rows are created by reading it — one per block on the sheet, with the numbers
   * already in them.
   *
   * Seeding them now would only leave two blank rows that the strict schema refuses at
   * "סיום", naming a location for a sample nobody took.
   */
  return base as MoldReport;
}

export async function createBlankMoldReport(): Promise<never> {
  const id = createMoldReport(blankMoldReport());
  revalidatePath('/mold');
  redirect(`/mold/${id}`);
}

/**
 * Creates a blank mould report and returns its id, without touching the cache.
 *
 * For the `/mold/new` route — see `createBlankReportId` for why a page cannot call
 * the action that revalidates.
 */
export async function createBlankMoldReportId(): Promise<string> {
  return createMoldReport(blankMoldReport());
}

export async function removeMoldReport(id: string): Promise<void> {
  deleteMoldReport(id);
  revalidatePath('/mold');
}

/**
 * Stores the report as it stands, without insisting it is finished.
 *
 * The autosave behind every step. This report is incomplete for longer than the
 * others by design: the site visit happens days before the laboratory answers, and
 * the sample rows sit empty in between.
 *
 * `revalidatePath` is deliberately not called: this runs every few seconds.
 */
export async function persistMoldReportDraft(
  id: string,
  data: unknown,
): Promise<MoldActionResult> {
  const parsed = DraftMoldReportSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'הטיוטה לא נשמרה', issues: parsed.error.issues.map((i) => i.message) };
  }

  try {
    // A save may caption or delete photographs; it may not drop one by leaving it
    // out — see `keepStoredPhotos`.
    saveMoldReport(id, {
      ...parsed.data,
      referenceNumber: await upgradeToPersonalMoldReference(parsed.data.referenceNumber, parsed.data.authorName),
      // The laboratory sheets live in the same table but in their own list, so they
      // are declared as held elsewhere — otherwise every save would find them
      // "missing" from the photo appendix and append them into it, printing each
      // sheet twice. See `alsoHeld`.
      photos: keepStoredPhotos('mold_photos', id, parsed.data.photos, parsed.data.labSheets),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }
}

/** Persists a finished report, held to the strict schema. */
export async function persistMoldReport(id: string, data: unknown): Promise<MoldActionResult> {
  const parsed = parseIssuableMoldReport(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'הדוח לא נשמר — יש שדות חסרים',
      issues: parsed.error.issues.map((i) => i.message),
    };
  }

  try {
    saveMoldReport(id, {
      ...parsed.data,
      referenceNumber: await upgradeToPersonalMoldReference(parsed.data.referenceNumber, parsed.data.authorName),
      // The laboratory sheets live in the same table but in their own list, so they
      // are declared as held elsewhere — otherwise every save would find them
      // "missing" from the photo appendix and append them into it, printing each
      // sheet twice. See `alsoHeld`.
      photos: keepStoredPhotos('mold_photos', id, parsed.data.photos, parsed.data.labSheets),
    });
    revalidatePath('/mold');
    revalidatePath(`/mold/${id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }
}

export interface MoldFinishResult extends MoldActionResult {
  /** True when the document reached the customer's card. */
  filed?: boolean;
}

/**
 * Ends the survey: saves it, builds the document, and files it on the customer's card.
 *
 * One button rather than two — see `finishAsbestosReport` for why filing does not
 * depend on somebody choosing to download a file they often do not want.
 */
export async function finishMoldReport(id: string, data: unknown): Promise<MoldFinishResult> {
  const parsed = parseIssuableMoldReport(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'הדוח לא הושלם — יש שדות חסרים',
      issues: parsed.error.issues.map((i) => i.message),
    };
  }

  // The document is built from what is saved here, so a stale photo list would
  // produce a report missing an appendix page — see `keepStoredPhotos`. The
  // reference is upgraded before generation too, so the printed cover matches
  // what ends up stored — see `upgradeToPersonalMoldReference`.
  const report = {
    ...parsed.data,
    referenceNumber: await upgradeToPersonalMoldReference(parsed.data.referenceNumber, parsed.data.authorName),
    photos: keepStoredPhotos('mold_photos', id, parsed.data.photos, parsed.data.labSheets),
  };
  try {
    saveMoldReport(id, report);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }

  // A report with no customer from the directory has no card to be filed on. That is a
  // normal way to write one, so it finishes without filing rather than failing.
  if (!report.customerId || !crmApiConfigured()) {
    revalidatePath('/mold');
    return {
      ok: true,
      error: report.customerId
        ? 'הדוח נשמר. חיבור ל-CRM לא הוגדר, ולכן לא תויק בכרטיס.'
        : 'הדוח נשמר. לא משויך לקוח מהספרייה, ולכן לא תויק בכרטיס.',
    };
  }

  try {
    const { bytes, fileName } = await generateMoldReport(report, id);
    const { documentId } = await fileReportOnCustomerCard(report as never, bytes, fileName);
    if (documentId !== report.crmDocumentId) {
      saveMoldReport(id, { ...report, crmDocumentId: documentId });
    }
    revalidatePath('/mold');
    return { ok: true, filed: true };
  } catch (err) {
    // The survey itself is saved, which is the part that cannot be redone.
    console.error('תיוק דוח העובשים בכרטיס הלקוח נכשל', err);
    return {
      ok: false,
      error: `הדוח נשמר, אך התיוק בכרטיס הלקוח נכשל: ${err instanceof Error ? err.message : 'שגיאה'}`,
    };
  }
}

/** The stored report, for a client that needs to re-read after a server change. */
export async function readMoldReport(id: string): Promise<MoldReport | null> {
  return loadMoldReport(id);
}

// ── Photographs ─────────────────────────────────────────────────────

export interface MoldPhotoResult extends MoldActionResult {
  /** The stored photograph, for the editor to append to what it already holds. */
  photo?: { imageId: string; caption: string };
}

/**
 * Stores an uploaded photograph against a report.
 *
 * Takes the report as it stands in the editor, unsaved edits and all — loading the
 * stored copy here instead would throw away everything typed since the last save.
 */
export async function uploadMoldPhoto(
  reportId: string,
  form: FormData,
): Promise<MoldPhotoResult> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'לא נבחר קובץ' };
  }

  const uploaded = Buffer.from(await file.arrayBuffer());
  // The declared type is not trusted — the format is read from the bytes. A HEIC from
  // an iPhone is converted to JPEG here rather than refused; see `acceptPhoto`.
  const accepted = await acceptPhoto(uploaded);
  if (!accepted) {
    return {
      ok: false,
      error: `לא ניתן לקרוא את הקובץ: ${file.name}. נתמכים JPEG, PNG, HEIC, GIF, BMP ו-WebP.`,
    };
  }
  const { bytes, size } = accepted;

  const draft = form.get('report');
  const parsed =
    typeof draft === 'string' ? DraftMoldReportSchema.safeParse(JSON.parse(draft)) : null;
  const report = parsed?.success ? parsed.data : loadMoldReport(reportId);
  if (!report) return { ok: false, error: 'הדוח לא נמצא' };

  const imageId = addMoldPhoto(reportId, bytes, size.contentType, size.width, size.height);
  // The caption is what follows "תמונה מס' N :", so it never carries a number of its
  // own — the appendix numbers the pages itself.
  const photo = { imageId, caption: '' };
  report.photos.push(photo);
  saveMoldReport(reportId, report);

  revalidatePath(`/mold/${reportId}`);
  return { ok: true, photo };
}

/** Removes a photograph and the caption that pointed at it. */
export async function removeMoldPhoto(
  reportId: string,
  imageId: string,
): Promise<MoldActionResult> {
  const report = loadMoldReport(reportId);
  if (!report) return { ok: false, error: 'הדוח לא נמצא' };

  report.photos = report.photos.filter((p) => p.imageId !== imageId);
  saveMoldReport(reportId, report);
  deleteMoldPhoto(imageId);

  revalidatePath(`/mold/${reportId}`);
  return { ok: true };
}

// ── The laboratory's sheets ─────────────────────────────────────────

export interface MoldLabSheetResult extends MoldActionResult {
  /** The stored sheet, for the editor to append to what it already holds. */
  sheet?: { imageId: string; caption: string };
}

/**
 * Stores a photographed laboratory sheet against a report.
 *
 * The same store as the survey photographs — one table, one upload path — but listed
 * separately on the report, because the two print as different appendices and are
 * captioned differently: a survey photograph shows a wall, a sheet shows the evidence
 * a figure was transcribed from.
 */
export async function uploadMoldLabSheet(
  reportId: string,
  form: FormData,
): Promise<MoldLabSheetResult> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'לא נבחר קובץ' };
  }

  const uploaded = Buffer.from(await file.arrayBuffer());
  const accepted = await acceptPhoto(uploaded);
  if (!accepted) {
    return {
      ok: false,
      error: `לא ניתן לקרוא את הקובץ: ${file.name}. נתמכים JPEG, PNG, HEIC, GIF, BMP ו-WebP.`,
    };
  }
  const { bytes, size } = accepted;

  const draft = form.get('report');
  const parsed =
    typeof draft === 'string' ? DraftMoldReportSchema.safeParse(JSON.parse(draft)) : null;
  const report = parsed?.success ? parsed.data : loadMoldReport(reportId);
  if (!report) return { ok: false, error: 'הדוח לא נמצא' };

  const imageId = addMoldPhoto(reportId, bytes, size.contentType, size.width, size.height);
  const sheet = { imageId, caption: '' };
  report.labSheets.push(sheet);
  saveMoldReport(reportId, report);

  revalidatePath(`/mold/${reportId}`);
  return { ok: true, sheet };
}

/** Removes a laboratory sheet from the appendix. */
export async function removeMoldLabSheet(
  reportId: string,
  imageId: string,
): Promise<MoldActionResult> {
  const report = loadMoldReport(reportId);
  if (!report) return { ok: false, error: 'הדוח לא נמצא' };

  report.labSheets = report.labSheets.filter((s) => s.imageId !== imageId);
  saveMoldReport(reportId, report);
  deleteMoldPhoto(imageId);

  revalidatePath(`/mold/${reportId}`);
  return { ok: true };
}

// ── Drafting the closing sections ───────────────────────────────────

export interface MoldDraftResult extends MoldActionResult {
  /** The drafted sections, for the editor to put on screen. */
  draft?: {
    executiveSummary: string;
    purposeDescription: string;
    interpretations: Record<string, string>;
    conclusions: string[];
    recommendations: string[];
  };
}

/**
 * Words the closing sections from the laboratory's figures, on demand.
 *
 * The drafting already ran at production time, inside `generateMoldReport` — which
 * meant the surveyor never saw a word of it until the document was built and
 * downloaded. The boxes sat empty through the whole of writing the report, and the
 * only way to find out what it would say was to finish it.
 *
 * That is the wrong order for a document somebody signs. The wording is drafted here,
 * on a button, so it lands in editable boxes and the surveyor reads it before it is
 * printed. Producing the document still drafts too, so a report finished without
 * pressing the button is not left blank.
 *
 * Takes the report as it stands in the editor rather than the stored copy: the sheet
 * is often scanned seconds earlier, and drafting from a version three keystrokes old
 * would describe a survey that has since changed.
 *
 * Deliberately does not save. The surveyor sees the draft, edits it, and the autosave
 * stores it like anything else they typed — a model's suggestion should not enter a
 * signed report without passing under their eyes first.
 */
export async function draftMoldSections(data: unknown): Promise<MoldDraftResult> {
  const parsed = DraftMoldReportSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'לא ניתן לנסח — הדוח אינו תקין' };
  }

  const report = parsed.data as MoldReport;
  if (realSamples(report).length === 0) {
    return { ok: false, error: 'אין תוצאות לנסח מהן. סרקו קודם את דוח המעבדה.' };
  }
  if (!aiDraftingAvailable()) {
    return { ok: false, error: 'ניסוח אוטומטי אינו זמין — לא הוגדר מפתח OpenAI בשרת.' };
  }

  // `draftMoldReport` never throws: an unreachable model returns what the report
  // already carried. That is right at production time and useless here, where the
  // surveyor pressed a button and is owed an answer — so an unchanged result is
  // reported as a failure rather than shown as a draft.
  const draft = await draftMoldReport(report);
  const unchanged =
    draft.executiveSummary === report.executiveSummary &&
    draft.conclusions.length === report.conclusions.length &&
    draft.recommendations.length === report.recommendations.length;
  if (unchanged && draft.executiveSummary === '') {
    return { ok: false, error: 'הניסוח נכשל. נסו שוב.' };
  }

  return { ok: true, draft };
}
