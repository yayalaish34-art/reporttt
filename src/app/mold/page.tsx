import Link from 'next/link';
import { listMoldReports } from '@/lib/mold-service';
import { activeTemplate } from '@/lib/docx/template-store';
import { createBlankMoldReport } from './actions';
import { DeleteMoldButton } from './delete-mold-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'דוח עובשים' };

export default function MoldPage() {
  const reports = listMoldReports();
  const template = activeTemplate('mold');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>דוח עובשים</h1>
          <p className="subtitle">
            {reports.length === 0 ? 'אין עדיין דוחות' : `${reports.length} דוחות`}
          </p>
        </div>
        <div className="actions">
          <form action={createBlankMoldReport}>
            <button type="submit" className="btn-primary">
              דוח חדש
            </button>
          </form>
        </div>
      </div>

      {!template && (
        <div className="notice error">
          לא הוגדרה תבנית עובשים פעילה — לא ניתן להפיק מסמכים. עברו ל
          <Link href="/templates">מסך התבניות</Link> והעלו קובץ.
        </div>
      )}

      <div className="card">
        {reports.length === 0 ? (
          <div className="empty">אין דוחות עובשים. לחצו ״דוח חדש״ כדי להתחיל.</div>
        ) : (
          reports.map((report) => (
            <div className="list-row" key={report.id}>
              <div className="grow">
                <div className="title">
                  <Link href={`/mold/${report.id}`} prefetch={false}>
                    {report.title || 'ללא נושא'}
                  </Link>
                </div>
                {/* When the survey was taken, not which serial it was filed under —
                    see the note on the radiation list. */}
                <div className="meta">
                  נוצר {formatDate(report.createdAt)}
                  {report.sampleCount > 0 ? ` · ${report.sampleCount} דגימות` : ''}
                  {report.photoCount > 0 ? ` · ${report.photoCount} תמונות` : ''}
                </div>
              </div>
              {/* A plain anchor: a file download, not a route. */}
              <a className="btn btn-sm" href={`/api/mold/${report.id}/docx`}>
                הורדת Word
              </a>
              <Link className="btn btn-sm" href={`/mold/${report.id}`} prefetch={false}>
                עריכה
              </Link>
              <DeleteMoldButton id={report.id} title={report.title || 'ללא נושא'} />
            </div>
          ))
        )}
      </div>
    </>
  );
}

/** Pinned to Israel: the server runs in UTC and would otherwise be three hours off. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
