import Link from 'next/link';
import { listReports } from '@/lib/report-service';
import { activeTemplate } from '@/lib/docx/template-store';
import { createBlankReport } from '../actions';
import { DeleteReportButton } from '../delete-report-button';

export const dynamic = 'force-dynamic';

export default function ReportsPage() {
  const reports = listReports();
  const template = activeTemplate();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>דוח קרינה</h1>
          <p className="subtitle">
            {reports.length === 0 ? 'אין עדיין דוחות' : `${reports.length} דוחות`}
          </p>
        </div>
        <div className="actions">
          <form action={createBlankReport}>
            <button type="submit" className="btn-primary">
              דוח חדש
            </button>
          </form>
        </div>
      </div>

      {!template && (
        <div className="notice error">
          לא הוגדרה תבנית פעילה — לא ניתן להפיק מסמכים. עברו ל<Link href="/templates">מסך התבנית</Link> והעלו
          קובץ, או הריצו <span className="mono">npm run seed</span>.
        </div>
      )}

      <div className="card">
        {reports.length === 0 ? (
          <div className="empty">אין דוחות. לחצו ״דוח חדש״ כדי להתחיל.</div>
        ) : (
          reports.map((report) => (
            <div className="list-row" key={report.id}>
              <div className="grow">
                <div className="title">
                  {/* prefetch off throughout this list: it is one <Link> per report,
                      and the router fetched every one of them the moment the page
                      rendered. With a dozen reports that flood left it unable to
                      commit any navigation at all — every button on the page went
                      dead. The pages open fast enough on click. */}
                  <Link href={`/reports/${report.id}`} prefetch={false}>
                    {report.title || 'ללא נושא'}
                  </Link>
                </div>
                {/* When the survey was taken, not which serial it was filed under. The
                    reference is on every page of the document itself and is how the
                    office finds a report afterwards; on this screen it is a number that
                    means nothing while looking for the job done this morning. */}
                <div className="meta">
                  נוצר {formatDate(report.createdAt)}
                  {report.photoCount > 0 ? ` · ${report.photoCount} תמונות` : ''}
                </div>
              </div>
              {/* A plain anchor, not a <Link>: this is a file download, not a
                  route. As a <Link> the router prefetched the DOCX endpoint as
                  if it were a page and got a Word document back. */}
              <a className="btn btn-sm" href={`/api/reports/${report.id}/docx`}>
                הורדת Word
              </a>
              <Link className="btn btn-sm" href={`/reports/${report.id}`} prefetch={false}>
                עריכה
              </Link>
              <DeleteReportButton id={report.id} title={report.title || 'ללא נושא'} />
            </div>
          ))
        )}
      </div>
    </>
  );
}

/** Dates are shown in the local Israeli format the reports themselves use. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('he-IL', {
    // Pinned: the server runs in UTC, so an unpinned zone would show the
    // surveyor a time three hours off their own.
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
