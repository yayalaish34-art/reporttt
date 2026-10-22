import { NextResponse } from 'next/server';
import {
  MAX_IMAGE_BYTES,
  MoldLabScanError,
  moldLabScanAvailable,
  scanMoldLabImages,
} from '@/lib/mold-lab-scan';

/**
 * Reads the laboratory's results off a photograph of its report.
 *
 * A route rather than a server action because the body is an image: actions carry
 * their payload through the React stream, and several megabytes of scanned page does
 * not belong there.
 *
 * The image is not stored here. Whether it is kept as an appendix is the editor's
 * decision — it uploads the same file through the photo path when the surveyor wants
 * the sheet in the report, which is the common case but not the only one.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!moldLabScanAvailable()) {
    return NextResponse.json(
      { error: 'קריאת תוצאות מעבדה לא הוגדרה בשרת (OPENAI_API_KEY).' },
      { status: 409 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'לא התקבלה תמונה' }, { status: 400 });
  }

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
    const { results, details, pages, emptyPages } = await scanMoldLabImages(images);

    return NextResponse.json({
      results,
      // The sheet's own particulars — its number and its two dates — which print in §1
      // rather than in any result block.
      details,
      pages,
      emptyPages,
      // Said plainly rather than left for the surveyor to notice: a page that could
      // not be read is a sample missing from the report, and it looks identical to a
      // sample the laboratory did not analyse.
      warning:
        emptyPages > 0
          ? `${emptyPages} מתוך ${pages} עמודים לא נקראו. ודאו שהם חדים ומכילים את טבלת התוצאות.`
          : undefined,
    });
  } catch (err) {
    if (err instanceof MoldLabScanError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error('קריאת תוצאות המעבדה נכשלה', err);
    return NextResponse.json({ error: 'קריאת התמונה נכשלה' }, { status: 500 });
  }
}
