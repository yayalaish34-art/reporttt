import { NextResponse } from 'next/server';
import { LabScanError, MAX_IMAGE_BYTES, labScanAvailable, scanLabImages } from '@/lib/radon-lab-scan';
import { saveReadings } from '@/lib/radon-readings-store';

/**
 * Reads a photograph of the laboratory's results table.
 *
 * The image is not stored. It is a working document on its way to becoming a
 * table of numbers, and keeping a copy of every screen photo somebody uploaded
 * would be a filing cabinet nobody asked for.
 */
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!labScanAvailable()) {
    return NextResponse.json({ error: 'קריאת תמונות לא הוגדרה בשרת (OPENAI_API_KEY).' }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'לא התקבלה תמונה' }, { status: 400 });
  }

  // The browser sends the photograph already cut into overlapping bands: the
  // whole screen is rendered too small for the digits to survive, a band is not.
  const reportId = String(form.get('reportId') ?? '');
  const files = form.getAll('image').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: 'לא נבחרה תמונה' }, { status: 400 });
  }
  if (files.some((f) => f.size > MAX_IMAGE_BYTES)) {
    return NextResponse.json({ error: 'התמונה גדולה מדי (מעל 20MB)' }, { status: 413 });
  }
  if (files.some((f) => !/^image\//.test(f.type))) {
    return NextResponse.json({ error: 'הקובץ אינו תמונה' }, { status: 400 });
  }

  try {
    const images = await Promise.all(
      files.map(async (f) => ({ bytes: Buffer.from(await f.arrayBuffer()), contentType: f.type })),
    );
    const { rows, bands, emptyBands } = await scanLabImages(images);

    /**
     * Every row goes to Supabase, not only the ones this report will use.
     *
     * A screen holds a whole batch from the laboratory, and the detectors on it
     * belong to several customers. The reading is the part that cannot be
     * recovered once the photograph is gone, so it is kept whether or not
     * anybody has typed that detector into a report yet.
     */
    const stored = await saveReadings(
      rows.map((row) => ({
        detectorNumber: row.detectorNumber,
        concentration: row.concentration,
        uncertainty: row.uncertainty,
        status: row.status,
        reportId: reportId || undefined,
      })),
    );

    return NextResponse.json({ rows, bands, emptyBands, saved: stored.saved, saveError: stored.error });
  } catch (err) {
    if (err instanceof LabScanError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error('קריאת תמונת המעבדה נכשלה', err);
    return NextResponse.json({ error: 'קריאת התמונה נכשלה' }, { status: 500 });
  }
}
