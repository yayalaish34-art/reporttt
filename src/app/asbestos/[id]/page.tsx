import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadAsbestosReport } from '@/lib/asbestos-service';
import { reportTitle } from '@/lib/report-title';
import { activeTemplate } from '@/lib/docx/template-store';
import { AsbestosEditor } from './editor';
import { FocusMode } from '../../focus-mode';

export const dynamic = 'force-dynamic';

export default async function AsbestosReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = loadAsbestosReport(id);
  if (!report) notFound();

  const template = activeTemplate('asbestos');

  return (
    <>
      <FocusMode />

      <div className="focus-bar">
        <Link href="/asbestos" className="focus-back">
          → לכל הדוחות
        </Link>
        {/* אותה כותרת כמו ברשימה — ראו reportTitle. */}
        <span className="focus-ref">{reportTitle('asbestos', report)}</span>
      </div>

      {!template && (
        <div className="notice error">
          לא הוגדרה תבנית אסבסט פעילה — ההפקה תיכשל. עברו ל<Link href="/templates">מסך התבניות</Link>{' '}
          והעלו את תבנית האסבסט.
        </div>
      )}

      <AsbestosEditor id={id} initial={report} />
    </>
  );
}
