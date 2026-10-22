import { NextResponse } from 'next/server';
import {
  generateAsbestosReport,
  loadAsbestosReport,
  saveAsbestosReport,
} from '@/lib/asbestos-service';
import { crmApiConfigured, fileReportOnCustomerCard } from '@/lib/crm-filing';
import { NoTemplateError } from '@/lib/docx/template-store';
import { TemplateRenderError } from '@/lib/docx/merge-docx';

/**
 * Generates and downloads an asbestos report.
 *
 * The same shape as the other two downloads, filing included: a finished report
 * that lives only in somebody's browser is a report nobody else can find.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = loadAsbestosReport(id);
  if (!report) {
    return NextResponse.json({ error: 'הדוח לא נמצא' }, { status: 404 });
  }

  try {
    // The id is passed so the photo appendix can be loaded — the photographs
    // live in their own table, keyed by report.
    const { bytes, fileName } = await generateAsbestosReport(report, id);

    // Filing is never allowed to fail the download — the surveyor asked for a
    // document and the document is ready.
    if (report.customerId && crmApiConfigured()) {
      try {
        const { documentId } = await fileReportOnCustomerCard(
          { ...report, crmDocumentId: report.crmDocumentId, customerId: report.customerId } as never,
          bytes,
          fileName,
        );
        if (documentId !== report.crmDocumentId) {
          saveAsbestosReport(id, { ...report, crmDocumentId: documentId });
        }
      } catch (err) {
        console.error('תיוק דוח האסבסט בכרטיס הלקוח נכשל', err);
      }
    }

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="asbestos-report.docx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    if (err instanceof NoTemplateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof TemplateRenderError) {
      return NextResponse.json({ error: err.message, issues: err.issues }, { status: 422 });
    }
    console.error('הפקת דוח האסבסט נכשלה', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'הפקת הדוח נכשלה' },
      { status: 500 },
    );
  }
}
