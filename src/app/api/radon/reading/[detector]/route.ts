import { NextResponse } from 'next/server';
import { findReading } from '@/lib/radon-readings-store';

/**
 * Looks up one detector's laboratory reading.
 *
 * This is what makes a detector number worth typing. The readings are stored by
 * detector number when a laboratory screen is scanned, and a screen holds a
 * whole batch — so by the time a surveyor writes up one customer's report, the
 * numbers for their detectors are usually already known. Typing "19715" is then
 * a lookup, not an instruction to go and read a photograph again.
 *
 * It also survives time: a scan from three months ago answers a report written
 * today, which the in-session flow never could.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ detector: string }> }) {
  const { detector } = await params;
  const reading = await findReading(detector);
  return NextResponse.json({ reading }, { headers: { 'Cache-Control': 'no-store' } });
}
