import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { LabScanError, MAX_IMAGE_BYTES, labScanAvailable, readDetectorLabel } from '@/lib/radon-lab-scan';

/**
 * Reads a detector's number off a photograph of its label.
 *
 * The image is not stored: it exists only to become a number the surveyor then checks.
 */
export const maxDuration = 60;

/** What the vision model accepts; a phone may send anything else, HEIC above all. */
const READABLE = /^image\/(jpeg|png|webp)$/;

export async function POST(request: Request) {
  if (!labScanAvailable()) {
    return NextResponse.json({ error: 'קריאת תמונות לא הוגדרה בשרת (OPENAI_API_KEY).' }, { status: 409 });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('image');
  } catch {
    return NextResponse.json({ error: 'לא התקבלה תמונה' }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'לא נבחרה תמונה' }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'התמונה גדולה מדי (מעל 20MB)' }, { status: 413 });
  }

  try {
    let bytes: Buffer = Buffer.from(await file.arrayBuffer());
    let contentType = file.type;
    if (!READABLE.test(contentType)) {
      bytes = await sharp(bytes).rotate().jpeg({ quality: 90 }).toBuffer();
      contentType = 'image/jpeg';
    }
    return NextResponse.json({ number: await readDetectorLabel(bytes, contentType) });
  } catch (err) {
    if (err instanceof LabScanError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error('קריאת תווית הגלאי נכשלה', err);
    return NextResponse.json({ error: 'קריאת התמונה נכשלה' }, { status: 500 });
  }
}
