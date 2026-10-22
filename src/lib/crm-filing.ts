import type { Report } from './report-schema';

/**
 * Files a finished report onto the customer's card in the CRM.
 *
 * A report that exists only as a download in somebody's browser is a report
 * nobody else can find. The CRM already holds a document list per customer and
 * is where the office looks, so the finished DOCX goes there the moment it is
 * produced.
 *
 * The link is free: the customer directory here was imported from the CRM and
 * kept the CRM's own ids, so `report.customerId` addresses the right card with
 * no matching or guesswork.
 */

const TIMEOUT_MS = 30_000;

export interface FilingResult {
  /** The CRM document id, so the next filing can replace this one. */
  documentId: string;
}

export function crmApiConfigured(): boolean {
  return Boolean(process.env.CRM_API_URL && process.env.CRM_API_TOKEN);
}

async function crmFetch(path: string, init: RequestInit): Promise<Response> {
  const base = String(process.env.CRM_API_URL || '').replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.CRM_API_TOKEN}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Puts the DOCX on the customer's card, replacing this report's previous
 * filing if it had one.
 *
 * Throws on failure — the caller decides whether that should stop a download.
 * Returns the new document id, which the caller is expected to store on the
 * report.
 */
export async function fileReportOnCustomerCard(
  report: Report,
  bytes: Buffer,
  fileName: string,
): Promise<FilingResult> {
  if (!crmApiConfigured()) throw new Error('חיבור ל-CRM לא הוגדר (CRM_API_URL / CRM_API_TOKEN).');
  if (!report.customerId) throw new Error('לדוח לא משויך לקוח מהספרייה.');

  // Replace rather than accumulate: pressing "הורדת Word" three times should
  // leave one report on the card, not three.
  if (report.crmDocumentId) {
    await crmFetch(
      `/customers/${encodeURIComponent(report.customerId)}/documents/${encodeURIComponent(report.crmDocumentId)}`,
      { method: 'DELETE' },
    ).catch(() => undefined); // an already-deleted document must not block the new one
  }

  const res = await crmFetch(`/customers/${encodeURIComponent(report.customerId)}/documents`, {
    method: 'POST',
    body: JSON.stringify({
      name: fileName,
      documentType: 'REPORT',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: bytes.length,
      dataBase64: bytes.toString('base64'),
      documentDate: report.reportDate || undefined,
      // Who the report is addressed to. Without these the CRM's send window opened on
      // the customer record's own address, which at a company is the switchboard or
      // whoever was imported first — not the person this survey was written for.
      recipientName: report.recipientName || undefined,
      recipientEmail: report.email || undefined,
      description: [report.referenceNumber && `סימוכין ${report.referenceNumber}`, report.siteName]
        .filter(Boolean)
        .join(' · ') || undefined,
      // `filePath` is required by the CRM and normally points at a stored file.
      // These live in the database as base64, so it carries the origin instead —
      // which also makes a filing from here identifiable later.
      filePath: `radiation-report:${report.referenceNumber || 'ללא סימוכין'}`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`התיוק ל-CRM נכשל (${res.status}) ${body.slice(0, 200)}`);
  }

  const created = (await res.json()) as { id?: string };
  if (!created?.id) throw new Error('ה-CRM לא החזיר מזהה מסמך.');
  return { documentId: created.id };
}

/**
 * הסימוכין הבא בפורמט האישי (SS+DDMMYY) עבור משתמש ה-CRM שכתובת המייל שלו
 * ניתנת כאן — כרגע נקרא רק עבור דוחות עובש שיורם ה"עורך" שלהם, כדי שהמונה
 * היומי יהיה משותף עם הצעות המחיר ב-CRM ולא יתנגש. ר' mold-service.ts.
 *
 * מאומת באותו CRM_API_TOKEN ששאר הקריאות כאן משתמשות בו — הנתיב ב-CRM בודק
 * אותו כסוד משותף (לא כ-JWT), ר' ReferenceNumbersInternalController.
 */
export async function nextPersonalReference(email: string): Promise<string> {
  if (!crmApiConfigured()) throw new Error('חיבור ל-CRM לא הוגדר (CRM_API_URL / CRM_API_TOKEN).');
  const res = await crmFetch('/reference-numbers/internal/next', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`הקצאת סימוכין נכשלה (${res.status}) ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { reference?: string };
  if (!data?.reference) throw new Error('ה-CRM לא החזיר סימוכין.');
  return data.reference;
}
