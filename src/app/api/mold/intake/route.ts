import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createBlankMoldReportId } from '@/app/mold/actions';
import { intakeHayesReport } from '@/lib/mold-intake';
import { moldLabScanAvailable } from '@/lib/mold-lab-scan';

/**
 * Where the CRM delivers a laboratory report e-mailed by Hayes.
 *
 * Authenticated with the same `CRM_API_TOKEN` this app already uses to call the CRM:
 * one shared secret between the two systems, in both directions. No secret configured
 * means the route is closed, not open.
 *
 * multipart/form-data: `file` (the PDF), `messageId` (the e-mail's internet message
 * id, for de-duplication — the same e-mail reaches several mailboxes).
 */
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const expected = (process.env.CRM_API_TOKEN ?? '').trim();
  if (!expected) return false;
  const provided = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!moldLabScanAvailable()) {
    return NextResponse.json({ error: 'קריאת תוצאות מעבדה לא הוגדרה בשרת (OPENAI_API_KEY).' }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'לא התקבל קובץ' }, { status: 400 });
  }
  const file = form.get('file');
  const messageId = String(form.get('messageId') ?? '').trim();
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'לא התקבל קובץ' }, { status: 400 });
  }
  if (!messageId) {
    return NextResponse.json({ error: 'חסר messageId' }, { status: 400 });
  }

  try {
    const result = await intakeHayesReport({
      pdf: Buffer.from(await file.arrayBuffer()),
      messageId: `${messageId}|${file.name}`,
      createReport: createBlankMoldReportId,
    });
    const origin = new URL(request.url).origin;
    return NextResponse.json({ ...result, url: `${origin}/mold/${result.reportId}` });
  } catch (err) {
    console.error('קליטת דוח Hayes מהמייל נכשלה', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'קליטת הדוח נכשלה' },
      { status: 422 },
    );
  }
}
