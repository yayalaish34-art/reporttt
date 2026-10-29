import { NextResponse } from 'next/server';
import { loadMoldReport } from '@/lib/mold-service';
import { chainOfCustodyFileName, renderChainOfCustodyPdf } from '@/lib/mold-coc-pdf';

/**
 * Downloads Hayes' Chain of Custody for a mould survey, filled in from the report.
 *
 * Rendered from the stored report, so the editor saves before it asks — see
 * `ChainOfCustodySection`.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = loadMoldReport(id);
  if (!report) {
    return NextResponse.json({ error: 'הדוח לא נמצא' }, { status: 404 });
  }

  try {
    const bytes = await renderChainOfCustodyPdf(report);
    if (!bytes) {
      return NextResponse.json({ error: 'לא נמצא דפדפן בשרת להפקת ה-PDF' }, { status: 503 });
    }
    const fileName = chainOfCustodyFileName(report);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="chain-of-custody.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('הפקת טופס Chain of Custody נכשלה', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'הפקת הטופס נכשלה' },
      { status: 500 },
    );
  }
}
