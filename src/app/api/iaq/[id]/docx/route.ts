import { NextResponse } from 'next/server';
import { generateIaqReport, loadIaqReport } from '@/lib/iaq-service';
import { NoTemplateError } from '@/lib/docx/template-store';
import { TemplateRenderError } from '@/lib/docx/merge-docx';

/**
 * מפיק DOCX לדוח איכות אוויר ומחזיר אותו כהורדה. אין תיוק אוטומטי ל-CRM
 * (אין לנו `customerId` בסכמת IAQ) — זה קורה דרך `finishIaqReport` אם צריך.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = loadIaqReport(id);
  if (!report) {
    return NextResponse.json({ error: 'הדוח לא נמצא' }, { status: 404 });
  }

  try {
    const { bytes, fileName } = await generateIaqReport(report, id);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="iaq-report.docx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
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
    console.error('הפקת דוח איכות אוויר נכשלה', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'הפקת הדוח נכשלה' },
      { status: 500 },
    );
  }
}
