import { NextResponse } from 'next/server';
import {
  IaqLabScanError,
  MAX_IMAGE_BYTES,
  iaqLabScanAvailable,
  scanIaqLabImages,
} from '@/lib/iaq-lab-scan';

/**
 * קורא טבלת תוצאות מדידה של דוח איכות אוויר מתוך תמונה.
 *
 * ראוט ולא server action כי ה-body הוא תמונה — ראה את ההערה של mold/lab-scan.
 * הקובץ עצמו לא נשמר כאן; אם הבודק רוצה אותו בנספח, הוא מעלה אותו דרך מסלול
 * התמונות הרגיל של דוח ה-iaq.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!iaqLabScanAvailable()) {
    return NextResponse.json(
      { error: 'קריאת תמונות לא הוגדרה בשרת (OPENAI_API_KEY).' },
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
    const { rows, pages, emptyPages } = await scanIaqLabImages(images);

    return NextResponse.json({
      rows,
      pages,
      emptyPages,
      warning:
        emptyPages > 0
          ? `${emptyPages} מתוך ${pages} עמודים לא נקראו. ודאו שהם חדים ומכילים את טבלת התוצאות.`
          : undefined,
    });
  } catch (err) {
    if (err instanceof IaqLabScanError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error('קריאת תוצאות IAQ נכשלה', err);
    return NextResponse.json({ error: 'קריאת התמונה נכשלה' }, { status: 500 });
  }
}
