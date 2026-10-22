/**
 * How a report is named — "דוח קרינה — כ.א.ל", "דוח עובשים — ערן פינגר".
 *
 * One rule for all four departments: the department, then whom the report was written
 * for. Each kind used to compose its own — the radiation list led with the site, radon
 * with a thirty-character cover phrase, asbestos and mould with the street address — so
 * the same office looking at the four lists saw four different ideas of what identifies
 * a report. The office finds a report by its customer, and that is what follows the dash.
 *
 * The customer is the company for a company and the person for a private customer —
 * the same split the cover makes with `isCompany`. Each falls back to the other, and
 * then to the commissioning party, because a report opened a minute ago may have only
 * one of them typed in.
 */

export const REPORT_KIND_LABELS = {
  radiation: 'דוח קרינה',
  radon: 'דוח ראדון',
  asbestos: 'דוח אסבסט',
  mold: 'דוח עובשים',
  iaq: 'דוח איכות אוויר',
} as const;

export type ReportKindKey = keyof typeof REPORT_KIND_LABELS;

/** The fields a title is read from. Loose, so a stored row can be named without a full parse. */
export interface TitleSource {
  customerType?: unknown;
  companyName?: unknown;
  recipientName?: unknown;
  /** "מזמין הבדיקה" — asbestos and mould only, and only as a last resort. */
  clientName?: unknown;
}

/**
 * A stored name, or '' for one that says nothing.
 *
 * The asbestos editor used to seed its fields with "—", and those reports still carry it.
 */
function nameOf(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '—' ? '' : text;
}

/** The customer's name as the title prints it — see the note at the top of the file. */
export function customerNameOf(source: TitleSource): string {
  const company = nameOf(source.companyName);
  const person = nameOf(source.recipientName);
  const ordered = source.customerType === 'private' ? [person, company] : [company, person];
  return [...ordered, nameOf(source.clientName)].find((name) => name !== '') ?? '';
}

/** "דוח קרינה — כ.א.ל", or the department alone while no customer is named. */
export function reportTitle(kind: ReportKindKey, source: TitleSource): string {
  const name = customerNameOf(source);
  return name ? `${REPORT_KIND_LABELS[kind]} — ${name}` : REPORT_KIND_LABELS[kind];
}

/**
 * A stored row's title, read from its data rather than from its title column.
 *
 * The column holds whatever rule was in force when the row was last saved, so a report
 * nobody has opened since would keep the old name forever. Reading the data names every
 * row by the current rule; the column is only the fallback for a row that will not parse.
 */
export function storedReportTitle(kind: ReportKindKey, data: unknown, storedTitle: unknown): string {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (parsed && typeof parsed === 'object') return reportTitle(kind, parsed as TitleSource);
  } catch {
    /* falls through to the stored title */
  }
  return String(storedTitle ?? '');
}
