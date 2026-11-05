import { NextResponse } from 'next/server';
import { ensureJobNumber } from '@/lib/job-numbers';

/**
 * A Job Number for a system outside this app, from the company-wide register.
 *
 * Galit ELF Projection runs on its own, but its projects take their numbers from the
 * same sequence as every report here. It calls this with a bearer token
 * (`JOB_NUMBERS_TOKEN`) when it issues a report. Only the prediction kind is accepted:
 * the other departments live in this app and number their own reports.
 */
export async function POST(request: Request) {
  const token = process.env.JOB_NUMBERS_TOKEN;
  const header = request.headers.get('authorization') ?? '';
  if (!token || header !== `Bearer ${token}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { kind?: string; reportId?: string; customerName?: string; inspectorName?: string; preferred?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (body.kind !== 'prediction' || !body.reportId?.trim()) {
    return NextResponse.json({ error: 'kind must be prediction, with a reportId' }, { status: 400 });
  }

  const jobNumber = ensureJobNumber(
    'prediction',
    body.reportId.trim(),
    { customerName: body.customerName ?? '', inspectorName: body.inspectorName ?? '' },
    body.preferred,
  );
  return NextResponse.json({ jobNumber });
}
