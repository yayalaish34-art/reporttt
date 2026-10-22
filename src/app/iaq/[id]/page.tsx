import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadIaqReport } from '@/lib/iaq-service';
import { reportTitle } from '@/lib/report-title';
import { activeTemplate } from '@/lib/docx/template-store';
import { IaqEditor } from './editor';
import { FocusMode } from '../../focus-mode';

export const dynamic = 'force-dynamic';

export default async function IaqReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = loadIaqReport(id);
  if (!report) notFound();

  const template = activeTemplate('iaq');

  return (
    <>
      <FocusMode />

      <div className="focus-bar">
        <Link href="/iaq" className="focus-back">
          → לכל הדוחות
        </Link>
        <span className="focus-ref">{reportTitle('iaq', report)}</span>
      </div>

      {!template && (
        <div className="notice error">
          לא הוגדרה תבנית איכות אוויר פעילה — ההפקה תיכשל. עברו ל<Link href="/templates">מסך התבניות</Link>{' '}
          והעלו את תבנית איכות האוויר.
        </div>
      )}

      <IaqEditor id={id} initial={report} />
    </>
  );
}
