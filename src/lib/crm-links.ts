import type { Report } from './report-schema';

/**
 * Links back into the CRM, where a finished report is sent to the customer.
 *
 * Sending is not rebuilt here. The CRM already has the form — recipients, cc,
 * an AI-drafted body, the sender's signature — and, more to the point, it has
 * the thing this app has not got: an identity. Mail goes out through the
 * Outlook account of whoever is logged in there. This app is open to anyone
 * with the address, so a send button on this side would be a send button for
 * anyone at all, over Galit's own mailbox.
 *
 * So the report is filed onto the customer's card as it is produced, and this
 * hands the surveyor straight to the CRM's own form, opened on that report.
 */

/** Where the CRM's web app lives. */
export function crmWebUrl(): string {
  return String(process.env.CRM_WEB_URL || '').replace(/\/$/, '');
}

export function crmWebConfigured(): boolean {
  return crmWebUrl() !== '';
}

/**
 * Why a report cannot be sent yet, or null when it can.
 *
 * Worth saying out loud rather than hiding the button: "אין לקוח" and "עוד לא
 * הופק" are two different problems with two different fixes, and a button that
 * simply is not there teaches neither.
 */
export function sendBlockedReason(report: Report): string | null {
  if (!crmWebConfigured()) return 'הקישור ל-CRM לא הוגדר בשרת (CRM_WEB_URL).';
  if (!report.customerId) return 'הדוח לא משויך ללקוח מהספרייה — בחרו לקוח כדי לשלוח.';
  if (!report.crmDocumentId) return 'הדוח עוד לא הופק. הורידו Word פעם אחת, וההפקה תתייק אותו בכרטיס הלקוח.';
  return null;
}

/**
 * The CRM address that opens the customer's card with this report's send form.
 *
 * `view=customer&id=` is the CRM's own deep link to a card; `sendReport=` is
 * read by the "דוחות שהופקו" section, which opens its mail form on that
 * document.
 */
export function crmSendReportUrl(report: Report): string | null {
  if (sendBlockedReason(report)) return null;
  const params = new URLSearchParams({
    view: 'customer',
    id: report.customerId,
    sendReport: report.crmDocumentId,
  });
  return `${crmWebUrl()}/dashboard?${params.toString()}`;
}
