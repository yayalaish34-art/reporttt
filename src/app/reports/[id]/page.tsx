import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadReport } from '@/lib/report-service';
import { reportListTitle } from '@/lib/report-mapper';
import { activeTemplate } from '@/lib/docx/template-store';
import { aiDraftingAvailable } from '@/lib/ai-text';
import { ReportEditor } from './editor';
import { FocusMode } from '../../focus-mode';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = loadReport(id);
  if (!report) notFound();

  const template = activeTemplate();

  return (
    <>
      {/* בזמן מילוי דוח המסך שייך לדוח: הכותרת, הלוגו והניווט מוסתרים. */}
      <FocusMode />

      {/* מה שנשאר מהכותרת — הדרך החוצה ושם הדוח, בשורה אחת דקה.
          שם הלקוח ולא הסימוכין: כשנכנסים לדוח מסימנייה או מההיסטוריה, השאלה
          הראשונה היא "לאיזה דוח נכנסתי", ומספר סידורי אינו עונה עליה. */}
      <div className="focus-bar">
        <Link href="/reports" className="focus-back">
          → לכל הדוחות
        </Link>
        <span className="focus-ref">{reportListTitle(report)}</span>
      </div>

      {!template && (
        <div className="notice error">
          לא הוגדרה תבנית פעילה — ההפקה תיכשל. עברו ל<Link href="/templates">מסך התבנית</Link>.
        </div>
      )}

      <ReportEditor
        id={id}
        initial={report}
        aiAvailable={aiDraftingAvailable()}
      />
    </>
  );
}
