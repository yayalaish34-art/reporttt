import Link from 'next/link';
import { listAsbestosReports } from '@/lib/asbestos-service';
import { activeTemplate } from '@/lib/docx/template-store';
import { createBlankAsbestosReport } from './actions';
import { DeleteAsbestosButton } from './delete-asbestos-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'דוח אסבסט' };

export default function AsbestosPage() {
  const reports = listAsbestosReports();
  const template = activeTemplate('asbestos');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>דוח אסבסט</h1>
          <p className="subtitle">
            {reports.length === 0 ? 'אין עדיין דוחות' : `${reports.length} דוחות`}
          </p>
        </div>
        {/* Two shapes of opinion, chosen before the survey is opened: the prose form
            states findings as sentences, the tabled form assesses each building on the
            same thirteen questions. They render from different templates, so the choice
            decides which fields the editor asks for. */}
        <div className="actions">
          <form action={createBlankAsbestosReport}>
            <input type="hidden" name="layout" value="prose" />
            <button type="submit" className="btn-primary" title="ממצאים כמשפטים — סקר של מבנה אחד">
              דוח חדש
            </button>
          </form>
          <form action={createBlankAsbestosReport}>
            <input type="hidden" name="layout" value="tables" />
            <button type="submit" className="btn" title="טבלה של 13 שדות לכל מבנה — סקר של כמה מבנים">
              דוח חדש עם טבלאות
            </button>
          </form>
        </div>
      </div>

      {!template && (
        <div className="notice error">
          לא הוגדרה תבנית אסבסט פעילה — לא ניתן להפיק מסמכים. עברו ל
          <Link href="/templates">מסך התבניות</Link> והעלו קובץ.
        </div>
      )}

      <div className="card">
        {reports.length === 0 ? (
          <div className="empty">אין דוחות אסבסט. לחצו ״דוח חדש״ כדי להתחיל.</div>
        ) : (
          reports.map((report) => (
            <div className="list-row" key={report.id}>
              <div className="grow">
                <div className="title">
                  <Link href={`/asbestos/${report.id}`} prefetch={false}>
                    {report.title || 'ללא נושא'}
                  </Link>
                </div>
                {/* When the survey was taken, not which serial it was filed under —
                    see the note on the radiation list. */}
                <div className="meta">
                  נוצר {formatDate(report.createdAt)}
                  {report.findingCount > 0 ? ` · ${report.findingCount} ממצאים` : ''}
                  {report.photoCount > 0 ? ` · ${report.photoCount} תמונות` : ''}
                </div>
              </div>
              {/* A plain anchor: a file download, not a route. */}
              <a className="btn btn-sm" href={`/api/asbestos/${report.id}/docx`}>
                הורדת Word
              </a>
              <Link className="btn btn-sm" href={`/asbestos/${report.id}`} prefetch={false}>
                עריכה
              </Link>
              <DeleteAsbestosButton id={report.id} title={report.title || 'ללא נושא'} />
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
