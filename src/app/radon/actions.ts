'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createRadonReport,
  deleteRadonReport,
  generateRadonReport,
  loadRadonReport,
  nextRadonReference,
  saveRadonReport,
} from '@/lib/radon-service';
import { crmApiConfigured, fileReportOnCustomerCard } from '@/lib/crm-filing';
import { DraftRadonReportSchema, RadonReportSchema, type RadonReport } from '@/lib/radon-schema';
import { newDetectorRow } from '@/lib/radon-rules';
import {
  assignDetectors,
  createReportFromDetectors,
  listCustomerDetectors,
  releaseDetectors,
  type AssignOutcome,
} from '@/lib/radon-detectors';
import { findReadings, saveReadings } from '@/lib/radon-readings-store';
import { refreshCrmCustomer } from '@/lib/crm-import';

export interface RadonActionResult {
  ok: boolean;
  error?: string;
  issues?: string[];
}

/** A radon report with everything that can be decided before the surveyor arrives. */
function blankRadonReport(): RadonReport {
  const base = RadonReportSchema.parse({
    referenceNumber: nextRadonReference(),
    reportDate: new Date().toISOString().slice(0, 10),
    recipientName: '—',
    detectors: [],
  });
  // One row to start, for the same reason the radiation tables do: an empty
  // table gives the surveyor nothing to type into.
  return { ...base, detectors: [newDetectorRow(base)] };
}

export async function createBlankRadonReport(): Promise<never> {
  const id = createRadonReport(blankRadonReport());
  revalidatePath('/radon');
  redirect(`/radon/${id}`);
}

/**
 * Creates a blank radon report and returns its id, without touching the cache.
 *
 * For the `/radon/new` route — see `createBlankReportId` for why a page cannot
 * call the action that revalidates.
 */
export async function createBlankRadonReportId(): Promise<string> {
  return createRadonReport(blankRadonReport());
}

export async function removeRadonReport(id: string): Promise<void> {
  deleteRadonReport(id);
  revalidatePath('/radon');
}

/**
 * Persists an edited radon report.
 *
 * Validated against the strict schema, so a report missing its reference or its
 * recipient cannot be saved — the same bar the radiation reports are held to.
 */
/**
 * Stores the radon report as it stands, without insisting it is finished.
 *
 * The autosave behind every step — see `persistReportDraft` in the radiation actions for
 * why a report mid-writing must be storable even though it is not yet issuable. A radon
 * survey is filled in with the detectors in hand, so rooms are named as they are visited
 * and the report is legitimately incomplete for most of its life.
 *
 * `revalidatePath` is deliberately not called: this runs every few seconds.
 */
export async function persistRadonReportDraft(id: string, data: unknown): Promise<RadonActionResult> {
  const parsed = DraftRadonReportSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'הטיוטה לא נשמרה', issues: parsed.error.issues.map((i) => i.message) };
  }

  try {
    saveRadonReport(id, parsed.data);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }
}

export async function persistRadonReport(id: string, data: unknown): Promise<RadonActionResult> {
  const parsed = RadonReportSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'הדוח לא נשמר — יש שדות חסרים',
      issues: parsed.error.issues.map((i) => i.message),
    };
  }

  try {
    saveRadonReport(id, parsed.data);
    revalidatePath('/radon');
    revalidatePath(`/radon/${id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }
}

/**
 * Ends the survey: saves it, builds the document, and files it on the customer's card.
 *
 * One button rather than two — see `finishReport` in the radiation actions for why the
 * pair was wrong: filing depended on somebody choosing to download a file they often did
 * not want, and the office reads reports off the CRM card.
 *
 * The strict schema, not the draft one: this is the moment the report is issued.
 */
export interface RadonFinishResult extends RadonActionResult {
  /** True when the document reached the customer's card. */
  filed?: boolean;
}

export async function finishRadonReport(id: string, data: unknown): Promise<RadonFinishResult> {
  const parsed = RadonReportSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'הדוח לא הושלם — יש שדות חסרים',
      issues: parsed.error.issues.map((i) => i.message),
    };
  }

  const report = parsed.data;
  try {
    saveRadonReport(id, report);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'שמירה נכשלה' };
  }

  if (!report.customerId || !crmApiConfigured()) {
    revalidatePath('/radon');
    return {
      ok: true,
      error: report.customerId
        ? 'הדוח נשמר. חיבור ל-CRM לא הוגדר, ולכן לא תויק בכרטיס.'
        : 'הדוח נשמר. לא משויך לקוח מהספרייה, ולכן לא תויק בכרטיס.',
    };
  }

  try {
    const { bytes, fileName } = await generateRadonReport(report, id);
    const { documentId } = await fileReportOnCustomerCard(report as never, bytes, fileName);
    if (documentId !== report.crmDocumentId) {
      saveRadonReport(id, { ...report, crmDocumentId: documentId });
    }
    revalidatePath('/radon');
    return { ok: true, filed: true };
  } catch (err) {
    console.error('תיוק דוח הראדון בכרטיס הלקוח נכשל', err);
    return {
      ok: false,
      error: `הדוח נשמר, אך התיוק בכרטיס הלקוח נכשל: ${err instanceof Error ? err.message : 'שגיאה'}`,
    };
  }
}

/**
 * Adds scanned detectors to a customer.
 *
 * `revalidatePath` is deliberately not called: this runs once per scan, and the card
 * refreshes itself when the scanning pauses.
 */
export async function addCustomerDetectors(customerId: string, numbers: string[]): Promise<AssignOutcome> {
  return assignDetectors(customerId, numbers);
}

export async function removeCustomerDetectors(customerId: string, numbers: string[]): Promise<void> {
  releaseDetectors(customerId, numbers);
  revalidatePath(`/customers/${customerId}`);
}

/**
 * Stores readings confirmed on a customer's card, with any uncertainty the surveyor corrected.
 *
 * The scan itself already stored what it read. This is what replaces a figure printed too
 * wide to use, so the customer's report is drafted from the corrected one.
 */
export async function confirmDetectorReadings(
  customerId: string,
  rows: Array<{ detectorNumber: string; concentration: string; uncertainty: string; status: string }>,
): Promise<RadonActionResult> {
  const { error } = await saveReadings(rows.map((row) => ({ ...row, customerId })));
  revalidatePath(`/customers/${customerId}`);
  return error ? { ok: false, error } : { ok: true };
}

/**
 * Drafts the customer's report from their detectors and whatever readings have arrived.
 *
 * Stops at a draft, for the reason the laboratory scan does: readings need a look before
 * they reach a client, and the rooms are known only to whoever placed the detectors.
 */
export async function draftCustomerRadonReport(
  customerId: string,
): Promise<RadonActionResult & { reportId?: string }> {
  try {
    // The address is usually completed in the CRM after the copy here was taken.
    await refreshCrmCustomer(customerId);
    const numbers = listCustomerDetectors(customerId).map((detector) => detector.detectorNumber);
    const readings = (await findReadings(numbers)) ?? new Map();
    const reportId = createReportFromDetectors(customerId, readings);
    revalidatePath('/radon');
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, reportId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'הפקת הדוח נכשלה' };
  }
}

/** The stored report, for a client that needs to re-read after a server change. */
export async function readRadonReport(id: string): Promise<RadonReport | null> {
  return loadRadonReport(id);
}
