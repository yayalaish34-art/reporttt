import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadRadonReport } from '@/lib/radon-service';
import { reportTitle } from '@/lib/report-title';
import { activeTemplate } from '@/lib/docx/template-store';
import { RadonEditor } from './editor';
import { FocusMode } from '../../focus-mode';

export const dynamic = 'force-dynamic';

export default async function RadonReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = loadRadonReport(id);
  if (!report) notFound();

  const template = activeTemplate('radon');

  return (
    <>
      <FocusMode />

      <div className="focus-bar">
        <Link href="/radon" className="focus-back">
          → לכל הדוחות
        </Link>
        {/* אותה כותרת כמו ברשימה — ראו reportTitle. */}
        <span className="focus-ref">{reportTitle('radon', report)}</span>
      </div>

      {!template && (
        <div className="notice error">
          לא הוגדרה תבנית ראדון פעילה — ההפקה תיכשל. עברו ל<Link href="/templates">מסך התבניות</Link>.
        </div>
      )}

      <RadonEditor id={id} initial={report} />
    </>
  );
}
