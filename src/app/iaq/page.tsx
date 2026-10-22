import Link from 'next/link';
import { listIaqReports } from '@/lib/iaq-service';
import { listIaqQuotes } from '@/lib/iaq-quote-import';
import { activeTemplate } from '@/lib/docx/template-store';
import { createBlankIaqReport, createIaqReportFromQuote } from './actions';
import { DeleteIaqButton } from './delete-iaq-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'דוח איכות אוויר' };

export default async function IaqPage({
  searchParams,
}: {
  searchParams: Promise<{ quoteError?: string }>;
}) {
  const reports = listIaqReports();
  const template = activeTemplate('iaq');
  const quoteResult = await listIaqQuotes();
  const { quoteError } = await searchParams;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>דוח איכות אוויר תוך-מבנית</h1>
          <p className="subtitle">
            {reports.length === 0 ? 'אין עדיין דוחות' : `${reports.length} דוחות`}
          </p>
        </div>
        <div className="actions">
          <form action={createBlankIaqReport}>
            <button type="submit" className="btn-primary">
              דוח חדש
            </button>
          </form>
        </div>
      </div>

      {!template && (
        <div className="notice error">
          לא הוגדרה תבנית איכות אוויר פעילה — לא ניתן להפיק מסמכים. עברו ל
          <Link href="/templates">מסך התבניות</Link> והעלו קובץ.
        </div>
      )}

      {quoteError && <div className="notice error">{quoteError}</div>}

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <div>
            <h2>פתיחת דוח מהצעת מחיר</h2>
            <div className="hint">מייבא לקוח, איש קשר, כתובת ומועד מהפגישה המקושרת</div>
          </div>
        </div>
        <div className="card-body">
          {quoteResult.error ? (
            <div className="notice error">{quoteResult.error}</div>
          ) : quoteResult.quotes.length === 0 ? (
            <div className="empty">לא נמצאו הצעות מחיר עם שירות בדיקת איכות אוויר תוך־מבנית.</div>
          ) : (
            <form action={createIaqReportFromQuote} className="row" style={{ alignItems: 'end' }}>
              <label className="field" style={{ flex: 1, minWidth: 280 }}>
                <span>הצעת מחיר</span>
                <select name="quoteId" required defaultValue="">
                  <option value="" disabled>
                    בחרו הצעה…
                  </option>
                  {quoteResult.quotes.map((quote) => (
                    <option value={quote.id} key={quote.id}>
                      {[
                        quote.quoteNumber ? `מס׳ ${quote.quoteNumber}` : 'ללא מספר',
                        quote.customerName,
                        [quote.address, quote.city].filter(Boolean).join(', '),
                        quote.appointment ? `פגישה ${quote.appointment}` : quote.quoteDate,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn-primary">
                פתח ומלא מההצעה
              </button>
            </form>
          )}
        </div>
      </section>

      <div className="card">
        {reports.length === 0 ? (
          <div className="empty">אין דוחות איכות אוויר. לחצו ״דוח חדש״ כדי להתחיל.</div>
        ) : (
          reports.map((report) => (
            <div className="list-row" key={report.id}>
              <div className="grow">
                <div className="title">
                  <Link href={`/iaq/${report.id}`} prefetch={false}>
                    {report.title || 'ללא נושא'}
                  </Link>
                </div>
                <div className="meta">
                  נוצר {formatDate(report.createdAt)}
                  {report.locationCount > 0 ? ` · ${report.locationCount} נקודות` : ''}
                  {report.photoCount > 0 ? ` · ${report.photoCount} תמונות` : ''}
                </div>
              </div>
              <a className="btn btn-sm" href={`/api/iaq/${report.id}/docx`}>
                הורדת Word
              </a>
              <Link className="btn btn-sm" href={`/iaq/${report.id}`} prefetch={false}>
                עריכה
              </Link>
              <DeleteIaqButton id={report.id} title={report.title || 'ללא נושא'} />
            </div>
          ))
        )}
      </div>
    </>
  );
}

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
