'use server';

import { mirrorCustomerDetectors } from '@/lib/radon-detector-mirror';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { DraftReportSchema, ReportSchema, type Report } from '@/lib/report-schema';
import { sampleReport } from '@/lib/sample-report';
import {
  addPhoto,
  createReport,
  deletePhoto,
  deleteReport,
  generateReport,
  loadReport,
  nextReferenceNumber,
  saveReport,
} from '@/lib/report-service';
import { crmApiConfigured, fileReportOnCustomerCard } from '@/lib/crm-filing';
import {
  crmConfigured,
  importCrmCustomers,
  refreshCrmCustomer,
  syncCrmCustomersIfStale,
} from '@/lib/crm-import';
import { listCustomerContacts, type CrmContact } from '@/lib/crm-contacts';
import { acceptPhoto } from '@/lib/photo-intake';
import { keepStoredPhotos } from '@/lib/keep-photos';
import { todayIso } from '@/lib/hebrew-date';
import {
  AiDraftError,
  draftReportWording,
  type DraftInput,
  type DraftResult,
} from '@/lib/ai-text';
import {
  storeTemplate,
  activateTemplate,
  TEMPLATE_KINDS,
  type TemplateKind,
} from '@/lib/docx/template-store';
import {
  createSignature,
  deleteSignature,
  matchSignature,
  renameSignature,
} from '@/lib/signature-service';
import {
  CustomerSchema,
  createCustomer,
  deleteCustomer,
  loadCustomer,
  searchCustomers,
  updateCustomer,
  type Customer,
} from '@/lib/customer-service';
import {
  createInspector,
  deleteInspector,
  listInspectors,
  seedInspectorsFromReports,
  updateInspector,
  type InspectorRecord,
} from '@/lib/inspector-service';

/**
 * Mutations invoked from the UI.
 *
 * Everything crossing this boundary is re-validated with the schema. The client
 * form is a convenience, not a guarantee — a report is what the schema says it
 * is, wherever the values came from.
 */

export interface ActionResult {
  ok: boolean;
  message?: string;
  /** Field-level problems, in the order the schema reported them. */
  issues?: string[];
}

/** Creates a blank report and opens it. */
export async function createBlankReport(): Promise<never> {
  const id = createReport(blankReport());
  revalidatePath('/reports');
  redirect(`/reports/${id}`);
}

/**
 * Creates a blank report and returns its id, without touching the cache.
 *
 * For the `/reports/new` route, which is a page rather than an action.
 * `revalidatePath` may not run during a render — Next refuses it outright — so the
 * route cannot simply call `createBlankReport`, and the list it would have
 * refreshed is not on screen at that moment anyway: the browser is on its way into
 * the new report.
 */
export async function createBlankReportId(): Promise<string> {
  return createReport(blankReport());
}

/** Creates a report pre-filled with the example survey. */
export async function createSampleReport(): Promise<never> {
  const id = createReport(withSignatures(sampleReport()));
  revalidatePath('/reports');
  redirect(`/reports/${id}`);
}

/**
 * Attaches each person's signature from the library.
 *
 * Only a starting point — the editor shows a picker per row, and an unmatched
 * person simply gets an empty signature cell, which reads as unfinished rather
 * than as someone else's mark.
 */
function withSignatures(report: Report): Report {
  return {
    ...report,
    inspectors: report.inspectors.map((person) => ({
      ...person,
      signatureId: person.signatureId || matchSignature(person.name, 'בודק'),
    })),
    authors: report.authors.map((person) => ({
      ...person,
      signatureId: person.signatureId || matchSignature(person.name, 'מאשר'),
    })),
  };
}

export async function removeReport(id: string): Promise<void> {
  deleteReport(id);
  revalidatePath('/reports');
}

/**
 * Stores the report as it stands, without insisting it is finished.
 *
 * The autosave behind every step of the wizard. A survey is written in the order it was
 * measured, so what is on screen between steps is legitimately incomplete — no site name
 * yet, a table laid out but not described — and `persistReport` would refuse all of it.
 * Refusing to store the work is the one failure mode that actually loses it: the report
 * lived only in the browser until the last step, so a locked phone or a closed tab in a
 * plant room cost the surveyor everything typed since they arrived.
 *
 * Partial data is accepted for saving and generation alike. Empty readings are
 * omitted only from the generated document, never from the saved draft.
 *
 * `revalidatePath` is deliberately not called. This runs every few seconds, and
 * re-rendering the drafts list under the surveyor on each keystroke pause is both wasted
 * work and a visible flicker; the list is refreshed by the save on the final step.
 */
export async function persistReportDraft(id: string, data: unknown): Promise<ActionResult> {
  const parsed = DraftReportSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'הטיוטה לא נשמרה',
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'הדוח'}: ${i.message}`),
    };
  }

  try {
    // A save may caption or delete photographs; it may not drop one by leaving it
    // out. See `keepStoredPhotos` — this is what stopped uploads vanishing when a
    // save carried a photo list from before them.
    saveReport(id, { ...parsed.data, photos: keepStoredPhotos('photos', id, parsed.data.photos) });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }

  return { ok: true, message: 'נשמר' };
}

/**
 * Ends the survey: saves it, builds the document, and files it on the customer's card.
 *
 * The last step used to carry two buttons — "הפקת הדוח", which produced a download and
 * filed it on the way past, and "סיום", which only left the screen. Filing therefore
 * depended on somebody choosing to download a file they often did not want: the office
 * reads reports off the CRM card, not out of a phone's downloads folder. A survey
 * finished on the correct button ended up on nobody's card.
 *
 * So finishing is one button and it does the filing. The document is still downloadable
 * from the list whenever a copy is actually wanted.
 *
 * Missing fields do not block completion; only the entered readings are exported.
 */
export interface FinishResult extends ActionResult {
  /** True when the document reached the customer's card. */
  filed?: boolean;
}

export async function finishReport(id: string, data: unknown): Promise<FinishResult> {
  const parsed = ReportSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'הדוח לא הושלם — יש שדות שאינם תקינים.',
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'הדוח'}: ${i.message}`),
    };
  }

  // Photographs the database holds are kept even if this copy forgot them — see
  // `keepStoredPhotos`. The document is built from what is saved here, so a list
  // arriving stale would produce a report missing an appendix page.
  const report = { ...parsed.data, photos: keepStoredPhotos('photos', id, parsed.data.photos) };
  try {
    saveReport(id, report);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }

  // A report with no customer from the directory has no card to be filed on. That is a
  // normal way to write one — a recipient typed by hand — so it finishes without filing
  // rather than failing.
  if (!report.customerId) {
    revalidatePath('/reports');
    return { ok: true, message: 'הדוח נשמר. לא משויך לקוח מהספרייה, ולכן לא תויק בכרטיס.' };
  }

  if (!crmApiConfigured()) {
    revalidatePath('/reports');
    return { ok: true, message: 'הדוח נשמר. חיבור ל-CRM לא הוגדר, ולכן לא תויק בכרטיס.' };
  }

  try {
    const { bytes, fileName, missingPhotos } = await generateReport(report, id);
    const { documentId } = await fileReportOnCustomerCard(report, bytes, fileName);
    if (documentId !== report.crmDocumentId) {
      saveReport(id, { ...report, crmDocumentId: documentId });
    }
    revalidatePath('/reports');
    /*
     * A report filed without the photographs it lists is still filed, and this is the
     * moment the surveyor can still do something about it — the document has just gone
     * onto the customer's card. Saying nothing here is what let reports reach customers
     * with an empty appendix and nobody any the wiser; see `loadPhotoInputs`.
     */
    if (missingPhotos > 0) {
      return {
        ok: true,
        filed: true,
        message:
          `הדוח תויק בכרטיס הלקוח, אך ${missingPhotos} תמונות רשומות בדוח ולא נכללו בו — ` +
          'קבצי התמונות חסרים בשרת. יש להעלות אותן מחדש ולהפיק שוב.',
      };
    }
    return { ok: true, message: 'הדוח תויק בכרטיס הלקוח.', filed: true };
  } catch (err) {
    // The survey itself is saved, which is the part that cannot be redone. Saying so
    // matters: "נכשל" alone would read as though the morning's work had been lost.
    console.error('תיוק הדוח בכרטיס הלקוח נכשל', err);
    return {
      ok: false,
      message: `הדוח נשמר, אך התיוק בכרטיס הלקוח נכשל: ${err instanceof Error ? err.message : 'שגיאה'}`,
    };
  }
}

/** Persists an edited report. */
export async function persistReport(id: string, data: unknown): Promise<ActionResult> {
  const parsed = ReportSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      message: 'הדוח לא נשמר — יש שדות שאינם תקינים.',
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'הדוח'}: ${i.message}`),
    };
  }

  try {
    saveReport(id, { ...parsed.data, photos: keepStoredPhotos('photos', id, parsed.data.photos) });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }

  revalidatePath('/reports');
  revalidatePath(`/reports/${id}`);
  return { ok: true, message: 'נשמר' };
}

/** Stores an uploaded photograph against a report. */
export interface PhotoActionResult extends ActionResult {
  /** The stored photograph, for the editor to append to what it already holds. */
  photo?: { imageId: string; caption: string };
}

export async function uploadPhoto(reportId: string, form: FormData): Promise<PhotoActionResult> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'לא נבחר קובץ' };
  }

  const uploaded = Buffer.from(await file.arrayBuffer());
  // The declared type is not trusted — the format is read from the bytes. A HEIC
  // from an iPhone is converted to JPEG here rather than refused; see `acceptPhoto`.
  const accepted = await acceptPhoto(uploaded);
  if (!accepted) {
    return {
      ok: false,
      message: `לא ניתן לקרוא את הקובץ: ${file.name}. נתמכים JPEG, PNG, HEIC, GIF, BMP ו-WebP.`,
    };
  }
  const { bytes, size } = accepted;

  /**
   * The report as it stands in the editor, unsaved edits and all.
   *
   * Loading the stored copy here instead — which is what this did — threw away
   * everything typed since the last save: adding a photograph halfway through
   * writing a report silently reverted it. The editor sends what it is holding,
   * the photograph is appended to that, and the whole thing is saved together.
   */
  const draft = form.get('report');
  const parsed = typeof draft === 'string' ? DraftReportSchema.safeParse(JSON.parse(draft)) : null;
  const report = parsed?.success ? parsed.data : loadReport(reportId);
  if (!report) return { ok: false, message: 'הדוח לא נמצא' };

  const imageId = addPhoto(reportId, bytes, size.contentType, size.width, size.height);
  const photo = { imageId, caption: captionFromFileName(file.name) };
  report.photos.push(photo);
  saveReport(reportId, report);

  revalidatePath(`/reports/${reportId}`);
  return { ok: true, message: `${file.name} נוספה`, photo };
}

/** Removes a photograph and the caption that pointed at it. */
export async function removePhoto(reportId: string, imageId: string): Promise<ActionResult> {
  const report = loadReport(reportId);
  if (!report) return { ok: false, message: 'הדוח לא נמצא' };

  report.photos = report.photos.filter((p) => p.imageId !== imageId);
  saveReport(reportId, report);
  deletePhoto(imageId);

  revalidatePath(`/reports/${reportId}`);
  return { ok: true };
}

/** Replaces the active template. */
export async function uploadTemplate(form: FormData): Promise<ActionResult> {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'לא נבחר קובץ' };
  }

  const note = String(form.get('note') ?? '');

  /**
   * Which survey the template belongs to.
   *
   * Matched against the known kinds rather than tested for one of them: written
   * as `x === 'radon' ? 'radon' : 'radiation'`, a third kind arriving from the
   * form would fall through to radiation and quietly *replace the radiation
   * template* with an asbestos document. Anything unrecognised stays radiation,
   * which is what an older form that sends no field at all means.
   */
  const requested = String(form.get('kind') ?? 'radiation');
  const kind: TemplateKind = requested in TEMPLATE_KINDS ? (requested as TemplateKind) : 'radiation';

  /** Where the newly activated template changes what is on screen. */
  const LIST_PATH: Record<TemplateKind, string> = {
    radiation: '/',
    radon: '/radon',
    asbestos: '/asbestos',
    // Both asbestos templates back the same list; which one renders is the report's own
    // `layout`, not a separate screen.
    'asbestos-tables': '/asbestos',
    mold: '/mold',
    iaq: '/iaq',
  };

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = storeTemplate(bytes, file.name, note, kind);
    revalidatePath('/templates');
    revalidatePath(LIST_PATH[kind]);
    return { ok: true, message: `${stored.name} נטענה והופעלה` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'העלאה נכשלה' };
  }
}

/** Rolls back to a previously uploaded template. */
export async function makeTemplateActive(id: number): Promise<ActionResult> {
  try {
    const stored = activateTemplate(id);
    revalidatePath('/templates');
    return { ok: true, message: `${stored.name} הופעלה` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'הפעלה נכשלה' };
  }
}

// ── AI drafting ─────────────────────────────────────────────────────

export interface DraftActionResult extends ActionResult {
  draft?: DraftResult;
}

/**
 * Drafts the cover wording with OpenAI.
 *
 * Returns a suggestion; nothing is written to the report here. The caller
 * decides whether to accept it, which is the whole point — this is a compliance
 * document and the surveyor signs it.
 */
export async function draftWording(input: DraftInput): Promise<DraftActionResult> {
  if (!input.siteName?.trim()) {
    return { ok: false, message: 'יש למלא שם אתר לפני ניסוח.' };
  }

  try {
    return { ok: true, draft: await draftReportWording(input) };
  } catch (err) {
    if (err instanceof AiDraftError) return { ok: false, message: err.message };
    console.error('ניסוח AI נכשל', err);
    return { ok: false, message: 'הניסוח נכשל. השתמשו בנוסח האוטומטי.' };
  }
}

// ── Signatures ──────────────────────────────────────────────────────

export async function uploadSignature(form: FormData): Promise<ActionResult> {
  const file = form.get('file');
  const label = String(form.get('label') ?? '').trim();

  if (!label) return { ok: false, message: 'יש לתת שם לחתימה.' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: 'לא נבחר קובץ' };

  const uploaded = Buffer.from(await file.arrayBuffer());
  // The declared type is not trusted — the format is read from the bytes, and a
  // HEIC is converted rather than refused. See `acceptPhoto`.
  const accepted = await acceptPhoto(uploaded);
  if (!accepted) {
    return {
      ok: false,
      message: `לא ניתן לקרוא את הקובץ: ${file.name}. נתמכים JPEG, PNG, HEIC, GIF, BMP ו-WebP.`,
    };
  }
  const { bytes, size } = accepted;

  createSignature(label, bytes, size.contentType, size.width, size.height);
  revalidatePath('/signatures');
  return { ok: true, message: `${label} נוספה` };
}

export async function renameSignatureAction(id: string, label: string): Promise<ActionResult> {
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, message: 'שם החתימה אינו יכול להיות ריק.' };

  try {
    renameSignature(id, trimmed);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'שינוי השם נכשל' };
  }

  revalidatePath('/signatures');
  return { ok: true, message: 'השם עודכן' };
}


export async function removeSignature(id: string): Promise<ActionResult> {
  try {
    deleteSignature(id);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'המחיקה נכשלה' };
  }

  revalidatePath('/signatures');
  return { ok: true, message: 'החתימה נמחקה' };
}


// ── Inspectors ──────────────────────────────────────────────────────

/**
 * The inspector directory, for the picker in the report editor.
 *
 * Seeded from the people already named in stored reports the first time it is read
 * while empty, so an installation that has been issuing reports for months does not
 * open the new screen to an empty list. See `seedInspectorsFromReports`.
 */
export async function fetchInspectors(): Promise<InspectorRecord[]> {
  seedInspectorsFromReports();
  return listInspectors();
}

/** Validates an inspector as typed on the directory screen. */
function inspectorProblem(input: Omit<InspectorRecord, 'id'>): string | null {
  if (!input.name.trim()) return 'יש להזין שם בודק.';
  const permit = input.permitType.trim().toUpperCase();
  if (permit && permit !== 'ELF' && permit !== 'RF') return 'סוג ההיתר חייב להיות ELF או RF.';
  return null;
}

export async function saveInspector(
  id: string | null,
  input: Omit<InspectorRecord, 'id'>,
): Promise<ActionResult> {
  const problem = inspectorProblem(input);
  if (problem) return { ok: false, message: problem };

  try {
    if (id) updateInspector(id, input);
    else createInspector(input);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'השמירה נכשלה' };
  }

  revalidatePath('/inspectors');
  return { ok: true, message: id ? 'הבודק עודכן' : 'הבודק נוסף' };
}

export async function removeInspector(id: string): Promise<ActionResult> {
  try {
    deleteInspector(id);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'המחיקה נכשלה' };
  }

  revalidatePath('/inspectors');
  return { ok: true, message: 'הבודק נמחק' };
}


// ── Customers ───────────────────────────────────────────────────────

/**
 * Looks up customers for the picker in the report editor.
 *
 * An action rather than a route handler so the query never leaves the server
 * boundary as a URL — customer names and phone numbers should not end up in
 * proxy or browser history logs.
 */
/**
 * The contacts at a company, for the recipient picker.
 *
 * A company report is addressed to whoever ordered it, and the directory here
 * only ever kept one name per customer. Read live from the CRM so a contact
 * added there is available here the same day.
 */
export async function customerContacts(customerId: string): Promise<CrmContact[]> {
  if (!customerId) return [];
  return listCustomerContacts(customerId);
}

/**
 * The customer as the CRM holds them now, for the moment they are picked.
 *
 * The search runs over the local copy; this re-reads the one row chosen, so a street
 * added in the CRM since the last import reaches the report. Null only for an id the
 * directory does not hold — a CRM that cannot be reached returns the copy.
 */
export async function freshCustomer(customerId: string): Promise<Customer | null> {
  if (!customerId) return null;
  await refreshCrmCustomer(customerId);
  return loadCustomer(customerId);
}

export async function findCustomers(query: string, limit = 15): Promise<Customer[]> {
  // Picks up customers opened in the CRM since the last sync, at most once an hour.
  await syncCrmCustomersIfStale();
  return searchCustomers(query, limit);
}

/**
 * Pulls the customer directory from the CRM into this deployment.
 *
 * Exposed as a button rather than a script because the deployment has no shell:
 * the database lives on a mounted volume inside the container, and nothing
 * outside it can write there. Re-running is safe — records are matched on the
 * CRM's own id and updated in place.
 */
export async function refreshCustomersFromCrm(): Promise<ActionResult> {
  if (!crmConfigured()) {
    return { ok: false, message: 'חיבור ל-CRM לא הוגדר בשרת (CRM_DATABASE_URL).' };
  }
  try {
    const r = await importCrmCustomers();
    revalidatePath('/customers');
    return {
      ok: true,
      message: `הספרייה עודכנה מה-CRM: ${r.after} לקוחות (${r.companies} חברות, ${r.people} פרטיים).`,
    };
  } catch (err) {
    console.error('ייבוא לקוחות מה-CRM נכשל', err);
    return { ok: false, message: err instanceof Error ? err.message : 'הייבוא נכשל' };
  }
}

export async function saveCustomer(id: string | null, form: FormData): Promise<ActionResult> {
  const parsed = CustomerSchema.safeParse({
    kind: form.get('kind'),
    contactName: form.get('contactName') ?? '',
    contactTitle: form.get('contactTitle') ?? '',
    companyName: form.get('companyName') ?? '',
    addressLine: form.get('addressLine') ?? '',
    city: form.get('city') ?? '',
    phone: form.get('phone') ?? '',
    email: form.get('email') ?? '',
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: 'הלקוח לא נשמר — יש שדות שאינם תקינים.',
      issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'הלקוח'}: ${i.message}`),
    };
  }

  // A company with no company name would render an empty line in the recipient
  // block, which reads as a layout bug rather than as missing data.
  if (parsed.data.kind === 'company' && parsed.data.companyName === '') {
    return { ok: false, message: 'ללקוח מסוג חברה חייב להיות שם חברה.' };
  }

  try {
    if (id) updateCustomer(id, parsed.data);
    else createCustomer(parsed.data);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }

  revalidatePath('/customers');
  return { ok: true, message: id ? 'הלקוח עודכן' : 'הלקוח נוסף' };
}

export async function removeCustomer(id: string): Promise<void> {
  deleteCustomer(id);
  // Their detectors went with them, so the copy on the CRM's side goes too.
  void mirrorCustomerDetectors(id);
  revalidatePath('/customers');
}

/**
 * A new report, pre-filled with what stays the same between surveys.
 *
 * The inspectors, the instruments and the boilerplate sentences change once a
 * year at most; making the surveyor retype them every time would be the fastest
 * way to get a wrong permit number into a signed report.
 */
function blankReport(): Report {
  const example = withSignatures(sampleReport());
  // Draft rules: a report this new has no reference number, site or dates yet.
  return DraftReportSchema.parse({
    referenceNumber: nextReferenceNumber(),
    reportDate: todayIso(),
    customerType: 'company',
    recipientName: '',
    recipientTitle: '',
    companyName: '',
    addressLine: '',
    city: '',
    phone: '',
    email: '',
    surveyScope: 'both',
    siteName: '',
    requesterName: '',
    measurementDate: '',
    measurementDateTime: '',
    location: '',
    // Left blank so the three lists open on their lists. "משרדים" was a
    // reasonable guess while these were free text, but it is not one of the
    // four site kinds, so it opened the field in "other" mode with a word
    // nobody had chosen already typed into it.
    siteCharacter: '',
    weather: '',
    fieldSource: '',
    measurementType: 'מדידות שדה מגנטי',
    inspectors: example.inspectors,
    authors: example.authors,
    elfInstrument: example.elfInstrument,
    rfInstrument: example.rfInstrument,
    elfProtocols: [],
    rfProtocols: [],
    photos: [],
  });
}

/** Turns "לוח חשמל קומה 26.jpg" into a starting caption. */
function captionFromFileName(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
}

/**
 * Adds an inspector and their signature in one step, from inside a report.
 *
 * The directory screen already does both separately, and for setting the company up
 * that is the right shape. This exists for the moment it is actually needed: a report
 * is being written, the person who wrote it is not in the directory yet, and sending
 * the surveyor to another screen to add them means losing the report they are in.
 *
 * The two are done together because half of it is worse than neither — an inspector
 * with no signature prints an empty box where a mark belongs, and a signature with no
 * inspector is a file nobody can attach to anything. The signature is optional, though:
 * a name can be added now and the mark uploaded later from the directory.
 */
export interface AddInspectorResult extends ActionResult {
  /** The stored inspector, for the editor to select without refetching. */
  inspector?: InspectorRecord;
}

export async function addInspectorWithSignature(form: FormData): Promise<AddInspectorResult> {
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { ok: false, message: 'יש להזין שם מלא.' };

  const title = String(form.get('title') ?? '').trim() || 'בודק קרינה';
  const file = form.get('signature');

  let signatureId = '';
  if (file instanceof File && file.size > 0) {
    const uploaded = Buffer.from(await file.arrayBuffer());
    // The declared type is not trusted — the format is read from the bytes, and a
    // HEIC from a phone is converted rather than refused. See `acceptPhoto`.
    const accepted = await acceptPhoto(uploaded);
    if (!accepted) {
      return {
        ok: false,
        message: `לא ניתן לקרוא את קובץ החתימה: ${file.name}. נתמכים JPEG, PNG, HEIC, GIF, BMP ו-WebP.`,
      };
    }
    const { bytes, size } = accepted;
    // Labelled by name so the directory screen shows whose mark it is.
    const stored = createSignature(name, bytes, size.contentType, size.width, size.height);
    signatureId = stored.id;
  }

  try {
    const inspector = createInspector({
      name,
      title,
      // No permit: this person is being added to write or approve a report, not to
      // carry out measurements. A permit is what the directory screen is for, and
      // demanding one here would block the case this exists to serve.
      permitType: '',
      permitNumber: '',
      permitValidity: '',
      signatureId,
    });
    revalidatePath('/inspectors');
    return { ok: true, message: `${name} נוסף`, inspector };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'ההוספה נכשלה' };
  }
}
