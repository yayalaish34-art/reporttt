import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadMoldReport } from '@/lib/mold-service';
import { reportTitle } from '@/lib/report-title';
import { activeTemplate } from '@/lib/docx/template-store';
import { MoldEditor } from './editor';
import { FocusMode } from '../../focus-mode';

export const dynamic = 'force-dynamic';

export default async function MoldReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = loadMoldReport(id);
  if (!report) notFound();

  const template = activeTemplate('mold');

  return (
    <>
      <FocusMode />

      <div className="focus-bar">
        <Link href="/mold" className="focus-back">
          → לכל הדוחות
        </Link>
        {/* אותה כותרת כמו ברשימה — ראו reportTitle. */}
        <span className="focus-ref">{reportTitle('mold', report)}</span>
      </div>

      {!template && (
        <div className="notice error">
          לא הוגדרה תבנית עובשים פעילה — ההפקה תיכשל. עברו ל<Link href="/templates">מסך התבניות</Link>{' '}
          והעלו את תבנית העובשים.
        </div>
      )}

      <MoldEditor id={id} initial={report} />
    </>
  );
}
