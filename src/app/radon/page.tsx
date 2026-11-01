import Link from 'next/link';
import { listRadonReports } from '@/lib/radon-service';
import { activeTemplate } from '@/lib/docx/template-store';
import { createBlankRadonReport } from './actions';
import { DeleteRadonButton } from './delete-radon-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'דוח ראדון' };

export default function RadonPage() {
  const reports = listRadonReports();
  const template = activeTemplate('radon');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>דוח ראדון</h1>
          <p className="subtitle">
            {reports.length === 0 ? 'אין עדיין דוחות' : `${reports.length} דוחות`}
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href="/radon/detectors">
            שיוך גלאים ללקוח
          </Link>
          <form action={createBlankRadonReport}>
            <button type="submit" className="btn-primary">
              דוח חדש
            </button>
          </form>
        </div>
      </div>

      {!template && (
        <div className="notice error">
          לא הוגדרה תבנית ראדון פעילה — לא ניתן להפיק מסמכים. עברו ל
          <Link href="/templates">מסך התבניות</Link> והעלו קובץ.
        </div>
      )}

      <div className="card">
        {reports.length === 0 ? (
          <div className="empty">אין דוחות ראדון. לחצו ״דוח חדש״ כדי להתחיל.</div>
        ) : (
          reports.map((report) => (
            <div className="list-row" key={report.id}>
              <div className="grow">
                <div className="title">
                  <Link href={`/radon/${report.id}`} prefetch={false}>
                    {report.title || 'ללא נושא'}
                  </Link>
                </div>
                {/* When the survey was taken, not which serial it was filed under —
                    see the note on the radiation list. */}
                <div className="meta">
                  נוצר {formatDate(report.createdAt)}
                  {report.detectorCount > 0 ? ` · ${report.detectorCount} גלאים` : ''}
                </div>
              </div>
              {/* A plain anchor: a file download, not a route. */}
              <a className="btn btn-sm" href={`/api/radon/${report.id}/docx`}>
                הורדת Word
              </a>
              <Link className="btn btn-sm" href={`/radon/${report.id}`} prefetch={false}>
                עריכה
              </Link>
              <DeleteRadonButton id={report.id} title={report.title || 'ללא נושא'} />
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
