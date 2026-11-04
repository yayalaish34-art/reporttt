import Link from 'next/link';
import { FIRST_JOB_NUMBER, JOB_PATHS, listJobNumbers } from '@/lib/job-numbers';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'בקרת Job Number' };

/**
 * The job-number register — every number the system has issued, newest first.
 *
 * One sequence across all six departments, from 817. A report takes its number the
 * first time it is produced (a mould report already when its Hayes Chain of Custody
 * is printed) and keeps it after; see `job-numbers.ts`.
 */
export default function JobsPage() {
  const jobs = listJobNumbers();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>בקרת Job Number</h1>
          <p className="subtitle">
            {jobs.length === 0
              ? `טרם הונפקו מספרים — הראשון יהיה ${FIRST_JOB_NUMBER}`
              : `${jobs.length} מספרים · הבא בתור ${jobs[0].jobNumber + 1}`}
          </p>
        </div>
      </div>

      <div className="card">
        {jobs.length === 0 ? (
          <div className="empty">
            מספר נרשם כאן בכל הפקת דוח, בכל סוגי הדוחות, ובדוח עובשים — כבר בהפקת טופס Hayes.
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Job Number</th>
                  <th>תאריך</th>
                  <th>שם לקוח</th>
                  <th>מבצע הבדיקה</th>
                  <th>שירות</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.jobNumber}>
                    <td className="ltr">
                      <strong>{job.jobNumber}</strong>
                    </td>
                    <td>{formatDate(job.createdAt)}</td>
                    <td>{job.customerName || '—'}</td>
                    <td>{job.inspectorName || '—'}</td>
                    <td>{job.service}</td>
                    <td>
                      <Link href={`${JOB_PATHS[job.kind]}/${job.reportId}`} prefetch={false}>
                        לדוח
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
