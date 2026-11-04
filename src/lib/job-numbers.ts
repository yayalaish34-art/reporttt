import { db, now } from './db';

/**
 * The job-number register: one running sequence across every department.
 *
 * Every report gets a number the first time it is produced, and keeps it however many
 * times it is produced again — the number identifies the job, not the file. The mould
 * report also hands its number to Hayes on the Chain of Custody, before the report
 * itself is produced; that is the same number, taken earlier.
 *
 * Each row records the customer, who carried out the inspection and the service, so
 * the register on /jobs accounts for every number that was handed out.
 */

/** The first number this system issues; earlier jobs were numbered by hand. */
export const FIRST_JOB_NUMBER = 817;

export type JobKind = 'radiation' | 'radon' | 'asbestos' | 'mold' | 'iaq' | 'prediction';

/** The service each department's report is, as the register names it. */
export const JOB_SERVICES: Record<JobKind, string> = {
  radiation: 'בדיקת קרינה',
  radon: 'בדיקת ראדון',
  asbestos: 'סקר אסבסט',
  mold: 'בדיקת עובשים',
  iaq: 'איכות אוויר',
  prediction: 'חיזוי קרינה',
};

/** Where each department's report opens in the editor. */
export const JOB_PATHS: Record<JobKind, string> = {
  radiation: '/reports',
  radon: '/radon',
  asbestos: '/asbestos',
  mold: '/mold',
  iaq: '/iaq',
  prediction: '/prediction/projects',
};

export interface JobDetails {
  customerName: string;
  inspectorName: string;
  /** Defaults to the department's own service name. */
  service?: string;
}

export interface JobRow {
  jobNumber: number;
  kind: JobKind;
  reportId: string;
  customerName: string;
  inspectorName: string;
  service: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The number to issue next: one above the highest anywhere — in the register, or typed
 * onto a mould Chain of Custody before the register existed.
 */
function nextJobNumber(): number {
  const inRegister = db().prepare('SELECT MAX(job_number) AS n FROM job_numbers').get() as { n: number | null };
  let highest = Math.max(FIRST_JOB_NUMBER - 1, Number(inRegister.n ?? 0));
  const typed = db()
    .prepare(`SELECT json_extract(data, '$.coc.jobNumber') AS job FROM mold_reports`)
    .all() as Array<{ job: unknown }>;
  for (const row of typed) {
    const n = Number(String(row.job ?? '').trim());
    if (Number.isInteger(n)) highest = Math.max(highest, n);
  }
  return highest + 1;
}

/**
 * This report's job number — issued now if it has none, and its register row brought
 * up to date with who it is for and who did it.
 *
 * `preferred` is a number the report already carries (a mould Chain of Custody typed
 * by hand); it is kept when no other report holds it.
 */
export function ensureJobNumber(
  kind: JobKind,
  reportId: string,
  details: JobDetails,
  preferred?: string,
): number {
  const service = details.service?.trim() || JOB_SERVICES[kind];
  const customer = details.customerName.trim();
  const inspector = details.inspectorName.trim();
  const at = now();

  const existing = db()
    .prepare('SELECT job_number FROM job_numbers WHERE kind = ? AND report_id = ?')
    .get(kind, reportId) as { job_number: number } | undefined;
  if (existing) {
    // A blank never overwrites what was recorded earlier — a later production of a
    // report whose customer was cleared should not erase the register.
    db()
      .prepare(
        `UPDATE job_numbers
            SET customer_name = CASE WHEN ? <> '' THEN ? ELSE customer_name END,
                inspector_name = CASE WHEN ? <> '' THEN ? ELSE inspector_name END,
                service = ?, updated_at = ?
          WHERE job_number = ?`,
      )
      .run(customer, customer, inspector, inspector, service, at, existing.job_number);
    return Number(existing.job_number);
  }

  const wanted = Number(String(preferred ?? '').trim());
  const free =
    Number.isInteger(wanted) &&
    wanted > 0 &&
    !db().prepare('SELECT 1 FROM job_numbers WHERE job_number = ?').get(wanted);
  const jobNumber = free ? wanted : nextJobNumber();

  db()
    .prepare(
      `INSERT INTO job_numbers
         (job_number, kind, report_id, customer_name, inspector_name, service, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(jobNumber, kind, reportId, customer, inspector, service, at, at);
  return jobNumber;
}

/**
 * Records a produced report, never letting the register stop the document.
 *
 * The surveyor asked for a file; a register that cannot be written is logged and the
 * file still goes out.
 */
export function recordJob(
  kind: JobKind,
  reportId: string | undefined,
  details: JobDetails,
  preferred?: string,
): void {
  if (!reportId) return;
  try {
    ensureJobNumber(kind, reportId, details, preferred);
  } catch (err) {
    console.error(`רישום job number נכשל (${kind} ${reportId})`, err);
  }
}

/** The customer as the register names them — the company, else the person. */
export function customerOf(report: {
  companyName?: string;
  clientName?: string;
  recipientName?: string;
}): string {
  return (report.companyName || report.clientName || report.recipientName || '').trim();
}

export function listJobNumbers(): JobRow[] {
  const rows = db()
    .prepare(
      `SELECT job_number, kind, report_id, customer_name, inspector_name, service, created_at, updated_at
         FROM job_numbers ORDER BY job_number DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    jobNumber: Number(r.job_number),
    kind: String(r.kind) as JobKind,
    reportId: String(r.report_id),
    customerName: String(r.customer_name ?? ''),
    inspectorName: String(r.inspector_name ?? ''),
    service: String(r.service ?? ''),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}
