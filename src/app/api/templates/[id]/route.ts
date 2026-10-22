import { NextResponse } from 'next/server';
import { templateBytes } from '@/lib/docx/template-store';

/**
 * Downloads a stored template so it can be edited in Word.
 *
 * Serves the stored bytes rather than the file under `templates/`, because the
 * database is what actually renders — the two differ as soon as someone uploads
 * a revision without rebuilding from source.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric)) {
    return NextResponse.json({ error: 'מזהה תבנית לא תקין' }, { status: 400 });
  }

  const template = templateBytes(numeric);
  if (!template) return NextResponse.json({ error: 'התבנית לא נמצאה' }, { status: 404 });

  return new NextResponse(new Uint8Array(template.bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="template.docx"; filename*=UTF-8''${encodeURIComponent(template.name)}`,
      'Content-Length': String(template.bytes.length),
      'Cache-Control': 'no-store',
    },
  });
}
