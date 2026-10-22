import { NextResponse } from 'next/server';
import { generateReport, loadReport, saveReport } from '@/lib/report-service';
import { crmApiConfigured, fileReportOnCustomerCard } from '@/lib/crm-filing';
import { NoTemplateError } from '@/lib/docx/template-store';
import { TemplateRenderError } from '@/lib/docx/merge-docx';

/**
 * Generates and downloads a report.
 *
 * A GET rather than a POST because the browser's own download handling is what
 * makes this pleasant — the surveyor clicks a link and gets a file, with no
 * intermediate blob to manage.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = loadReport(id);
  if (!report) {
    return NextResponse.json({ error: 'הדוח לא נמצא' }, { status: 404 });
  }

  try {
    const { bytes, fileName, missingPhotos } = await generateReport(report, id);

    /**
     * File it on the customer's card on the way out.
     *
     * Deliberately not allowed to fail the download: the surveyor asked for a
     * document and the document is ready, so a CRM that is unreachable costs
     * them the filing, not the file. The failure is logged and the report keeps
     * its previous filing id, so the next download tries again.
     */
    if (report.customerId && crmApiConfigured()) {
      try {
        const { documentId } = await fileReportOnCustomerCard(report, bytes, fileName);
        if (documentId !== report.crmDocumentId) {
          saveReport(id, { ...report, crmDocumentId: documentId });
        }
      } catch (err) {
        console.error('תיוק הדוח בכרטיס הלקוח נכשל', err);
      }
    }

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // The file name is Hebrew, so it goes in the RFC 5987 form; the ASCII
        // fallback keeps older clients from receiving a mangled name.
        'Content-Disposition': `attachment; filename="report.docx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store',
        /*
         * A download is a file, not a page, so there is nowhere to show a warning —
         * but the fact that the appendix came out short must not vanish entirely.
         * The header is what the editor reads to raise it on screen, and it is also
         * visible in the network tab when someone is working out why a report has no
         * pictures in it.
         */
        ...(missingPhotos > 0 ? { 'X-Missing-Photos': String(missingPhotos) } : {}),
      },
    });
  } catch (err) {
    if (err instanceof NoTemplateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof TemplateRenderError) {
      return NextResponse.json({ error: err.message, issues: err.issues }, { status: 422 });
    }
    console.error('הפקת הדוח נכשלה', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'הפקה נכשלה' }, { status: 500 });
  }
}
