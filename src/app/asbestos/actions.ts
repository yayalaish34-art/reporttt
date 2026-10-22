'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  addAsbestosPhoto,
  createAsbestosReport,
  deleteAsbestosPhoto,
  deleteAsbestosReport,
  generateAsbestosReport,
  loadAsbestosReport,
  nextAsbestosReference,
  saveAsbestosReport,
} from '@/lib/asbestos-service';
import { crmApiConfigured, fileReportOnCustomerCard } from '@/lib/crm-filing';
import {
  DraftAsbestosReportSchema,
  parseIssuableReport,
  type AsbestosReport,
} from '@/lib/asbestos-schema';
import { buildingsForSummary, newFindingRow } from '@/lib/asbestos-rules';
import { aiDraftingAvailable, draftAsbestosSummary } from '@/lib/ai-text';
import { acceptPhoto } from '@/lib/photo-intake';
import { keepStoredPhotos } from '@/lib/keep-photos';

export interface AsbestosActionResult {
  ok: boolean;
  error?: string;
  issues?: string[];
}

/** The month and year, as the cover prints it — "אוגוסט 2026". */
function hebrewMonthYear(date = new Date()): string {
  const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * An opinion with everything that can be decided before the surveyor arrives.
 *
 * Parsed as a draft, so the client and the address start genuinely empty. They used
 * to be seeded with "—" to satisfy the strict schema at creation, and that dash was
 * a real stored value: it sat in the box looking like an answer, it had to be
 * deleted before anything could be typed, and every check for "has an address" had
 * to know to treat one particular character as meaning no. A placeholder says the
 * same thing without being data — see the `placeholder` on the two fields.
 */
function blankAsbestosReport(): AsbestosReport {
  const base = DraftAsbestosReportSchema.parse({
    referenceNumber: nextAsbestosReference(),
    reportDate: hebrewMonthYear(),
    findings: [],
  });
  // One row to start: an empty table gives the surveyor nothing to type into.
  return { ...base, findings: [newFindingRow()] } as AsbestosReport;
}

/**
 * Opens a new opinion in one of its two shapes.
 *
 * The shape is chosen here rather than inside the editor because it decides which
 * template renders and therefore which fields the editor asks for — a survey started on
 * the wrong one would be answering the wrong questions. It stays editable afterwards all
 * the same: each form keeps its own data, so switching loses nothing.
 *
 * Takes a FormData so the two buttons on the list can be plain submit buttons rather than
 * client-side handlers.
 */
export async function createBlankAsbestosReport(form?: FormData): Promise<never> {
  const requested = String(form?.get('layout') ?? 'prose');
  const layout = requested === 'tables' ? 'tables' : 'prose';
  const id = createAsbestosReport({ ...blankAsbestosReport(), layout });
  revalidatePath('/asbestos');
  redirect(`/asbestos/${id}`);
}

/**
 * Creates a blank asbestos opinion and returns its id, without touching the cache.
 *
 * For the `/asbestos/new` route — see `createBlankReportId` for why a page cannot
 * call the action that revalidates. Prose by default: the tabled shape is chosen
 * deliberately from the list, where the two are offered side by side.
 */
export async function createBlankAsbestosReportId(): Promise<string> {
  return createAsbestosReport({ ...blankAsbestosReport(), layout: 'prose' });
}

export async function removeAsbestosReport(id: string): Promise<void> {
  deleteAsbestosReport(id);
  revalidatePath('/asbestos');
}

/**
 * Stores the opinion as it stands, without insisting it is finished.
 *
 * The autosave behind every step. A survey is written while walking the building,
 * so what is on screen between steps is legitimately incomplete — findings named
 * but not yet measured, photographs taken but not yet captioned.
 *
 * `revalidatePath` is deliberately not called: this runs every few seconds.
 */
export async function persistAsbestosReportDraft(
  id: string,
  data: unknown,
): Promise<AsbestosActionResult> {
  const parsed = DraftAsbestosReportSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'הטיוטה לא נשמרה', issues: parsed.error.issues.map((i) => i.message) };
  }

  try {
    // A save may caption or delete photographs; it may not drop one by leaving it
    // out — see `keepStoredPhotos`.
    saveAsbestosReport(id, {
      ...parsed.data,
      photos: keepStoredPhotos(
        'asbestos_photos',
        id,
        parsed.data.photos,
        parsed.data.buildings.flatMap((b) => b.photos),
      ),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }
}

/**
 * Persists a finished opinion.
 *
 * Validated against the strict schema, so an opinion missing its client or its
 * address cannot be issued — the same bar the other two are held to.
 */
export async function persistAsbestosReport(
  id: string,
  data: unknown,
): Promise<AsbestosActionResult> {
  const parsed = parseIssuableReport(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'הדוח לא נשמר — יש שדות חסרים',
      issues: parsed.error.issues.map((i) => i.message),
    };
  }

  try {
    // A save may caption or delete photographs; it may not drop one by leaving it
    // out — see `keepStoredPhotos`.
    saveAsbestosReport(id, {
      ...parsed.data,
      photos: keepStoredPhotos(
        'asbestos_photos',
        id,
        parsed.data.photos,
        parsed.data.buildings.flatMap((b) => b.photos),
      ),
    });
    revalidatePath('/asbestos');
    revalidatePath(`/asbestos/${id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }
}

/**
 * Ends the survey: saves it, builds the document, and files it on the customer's card.
 *
 * The last step used to carry two buttons — one that produced a download and filed it on
 * the way past, and one that only left the screen. Filing therefore depended on somebody
 * choosing to download a file they often did not want: the office reads opinions off the
 * CRM card, not out of a phone's downloads folder. Same reasoning as the radiation
 * report's `finishReport`, and the same single button.
 *
 * The strict schema, not the draft one: this is the moment the opinion is issued, and one
 * missing its address or its findings must be refused here rather than filed incomplete.
 */
export interface AsbestosFinishResult extends AsbestosActionResult {
  /** True when the document reached the customer's card. */
  filed?: boolean;
}

export async function finishAsbestosReport(
  id: string,
  data: unknown,
): Promise<AsbestosFinishResult> {
  const parsed = parseIssuableReport(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'הדוח לא הושלם — יש שדות חסרים',
      issues: parsed.error.issues.map((i) => i.message),
    };
  }

  // The document is built from what is saved here, so a stale photo list would
  // produce an opinion missing an appendix page — see `keepStoredPhotos`.
  const report = {
    ...parsed.data,
    photos: keepStoredPhotos(
        'asbestos_photos',
        id,
        parsed.data.photos,
        parsed.data.buildings.flatMap((b) => b.photos),
      ),
  };
  try {
    saveAsbestosReport(id, report);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }

  // An opinion with no customer from the directory has no card to be filed on. That is a
  // normal way to write one, so it finishes without filing rather than failing.
  if (!report.customerId || !crmApiConfigured()) {
    revalidatePath('/asbestos');
    return {
      ok: true,
      error: report.customerId
        ? 'הדוח נשמר. חיבור ל-CRM לא הוגדר, ולכן לא תויק בכרטיס.'
        : 'הדוח נשמר. לא משויך לקוח מהספרייה, ולכן לא תויק בכרטיס.',
    };
  }

  try {
    const { bytes, fileName } = await generateAsbestosReport(report, id);
    const { documentId } = await fileReportOnCustomerCard(report as never, bytes, fileName);
    if (documentId !== report.crmDocumentId) {
      saveAsbestosReport(id, { ...report, crmDocumentId: documentId });
    }
    revalidatePath('/asbestos');
    return { ok: true, filed: true };
  } catch (err) {
    // The survey itself is saved, which is the part that cannot be redone.
    console.error('תיוק דוח האסבסט בכרטיס הלקוח נכשל', err);
    return {
      ok: false,
      error: `הדוח נשמר, אך התיוק בכרטיס הלקוח נכשל: ${err instanceof Error ? err.message : 'שגיאה'}`,
    };
  }
}

/** The stored opinion, for a client that needs to re-read after a server change. */
export async function readAsbestosReport(id: string): Promise<AsbestosReport | null> {
  return loadAsbestosReport(id);
}

// ── Photographs ─────────────────────────────────────────────────────

export interface AsbestosPhotoResult extends AsbestosActionResult {
  /** The stored photograph, for the editor to append to what it already holds. */
  photo?: { imageId: string; caption: string };
}

/**
 * Stores an uploaded photograph against an opinion.
 *
 * Takes the report as it stands in the editor, unsaved edits and all — loading
 * the stored copy here instead would throw away everything typed since the last
 * save, which is what made adding a photograph mid-report silently revert it in
 * the radiation editor.
 */
export async function uploadAsbestosPhoto(
  reportId: string,
  form: FormData,
): Promise<AsbestosPhotoResult> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'לא נבחר קובץ' };
  }

  const uploaded = Buffer.from(await file.arrayBuffer());
  // The declared type is not trusted — the format is read from the bytes. A HEIC
  // from an iPhone is converted to JPEG here rather than refused; see `acceptPhoto`.
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
    typeof draft === 'string' ? DraftAsbestosReportSchema.safeParse(JSON.parse(draft)) : null;
  const report = parsed?.success ? parsed.data : loadAsbestosReport(reportId);
  if (!report) return { ok: false, error: 'הדוח לא נמצא' };

  const imageId = addAsbestosPhoto(reportId, bytes, size.contentType, size.width, size.height);
  // The caption is what follows "תמונה מס' N :", so it never carries a number
  // of its own — the numbering is done when the document is built.
  const photo = { imageId, caption: '' };

  /**
   * Which list the photograph joins.
   *
   * A picture taken from inside a building's card belongs to that building and prints
   * on the page after its table; one added from the report's own step goes to the
   * appendix at the end. The index is sent by the editor, and a value that no longer
   * addresses a building falls back to the appendix rather than being dropped — a
   * photograph in the wrong place is recoverable, a lost one is not.
   */
  const rawIndex = form.get('buildingIndex');
  const buildingIndex = typeof rawIndex === 'string' ? Number(rawIndex) : NaN;
  const building =
    Number.isInteger(buildingIndex) &&
    buildingIndex >= 0 &&
    buildingIndex < report.buildings.length
      ? report.buildings[buildingIndex]
      : null;

  // The prose form attaches to a finding by the same route — see `findingIndex`.
  const rawFinding = form.get('findingIndex');
  const findingIndex = typeof rawFinding === 'string' ? Number(rawFinding) : NaN;
  const finding =
    Number.isInteger(findingIndex) && findingIndex >= 0 && findingIndex < report.findings.length
      ? report.findings[findingIndex]
      : null;

  if (building) building.photos.push(photo);
  else if (finding) finding.photos.push(photo);
  else report.photos.push(photo);

  saveAsbestosReport(reportId, report);

  revalidatePath(`/asbestos/${reportId}`);
  return { ok: true, photo };
}

/** Removes a photograph and the caption that pointed at it. */
export async function removeAsbestosPhoto(
  reportId: string,
  imageId: string,
): Promise<AsbestosActionResult> {
  const report = loadAsbestosReport(reportId);
  if (!report) return { ok: false, error: 'הדוח לא נמצא' };

  // Removed from wherever it is held. A picture taken inside a building's card lives
  // on that building, not in the appendix, and clearing only the appendix left the
  // row deleted from disk while the building still pointed at it — a photograph that
  // renders as nothing and cannot be removed from the screen.
  report.photos = report.photos.filter((p) => p.imageId !== imageId);
  report.findings = report.findings.map((finding) => ({
    ...finding,
    photos: finding.photos.filter((p) => p.imageId !== imageId),
  }));
  report.buildings = report.buildings.map((building) => ({
    ...building,
    photos: building.photos.filter((p) => p.imageId !== imageId),
  }));

  saveAsbestosReport(reportId, report);
  deleteAsbestosPhoto(imageId);

  revalidatePath(`/asbestos/${reportId}`);
  return { ok: true };
}

// ── Summary drafting ────────────────────────────────────────────────

export interface AsbestosSummaryResult extends AsbestosActionResult {
  /** The drafted lines, for the editor to put on screen. */
  bullets?: string[];
}

/**
 * Drafts the closing "סיכום והנחיות לביצוע" lines from the building tables.
 *
 * Everything these lines say is already in the tables, so this replaces a step
 * where the surveyor typed them out a second time — which is both slow and the
 * kind of duplication that lets a signed document contradict itself.
 *
 * Takes the report as it stands in the editor rather than the stored copy: the
 * tables are usually still being edited when the summary is asked for, and
 * drafting from a version three keystrokes old would quietly describe a
 * building that has since been renamed.
 *
 * Deliberately does not save. The surveyor sees the draft, edits it, and the
 * autosave stores it like anything else they typed — a model's suggestion should
 * not enter a signed opinion without passing under their eyes first.
 */
export async function draftAsbestosSummaryLines(data: unknown): Promise<AsbestosSummaryResult> {
  const parsed = DraftAsbestosReportSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'לא ניתן לנסח — הדוח אינו תקין' };
  }

  const buildings = buildingsForSummary(parsed.data);
  if (buildings.length === 0) {
    return { ok: false, error: 'אין מבנים לנסח מהם. הוסיפו מבנה בשלב "מבנים".' };
  }

  if (!aiDraftingAvailable()) {
    return { ok: false, error: 'ניסוח אוטומטי אינו זמין — לא הוגדר מפתח OpenAI בשרת.' };
  }

  try {
    const bullets = await draftAsbestosSummary({
      buildings,
      siteAddress: parsed.data.siteAddress.trim(),
    });
    return { ok: true, bullets };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'הניסוח נכשל. נסו שוב.',
    };
  }
}
