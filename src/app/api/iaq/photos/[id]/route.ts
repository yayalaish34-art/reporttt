import { NextResponse } from 'next/server';
import { iaqPhotoBytes } from '@/lib/iaq-service';

/**
 * מגיש תמונה שמורה (לתצוגה בעורך). immutable — תמונה נכתבת פעם אחת ולא נערכת
 * במקום, כך שהדפדפן יכול להחזיק אותה כמה שבא לו.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const photo = iaqPhotoBytes(id);
  if (!photo) {
    return NextResponse.json({ error: 'התמונה לא נמצאה' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: {
      'Content-Type': photo.contentType,
      'Content-Length': String(photo.bytes.length),
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
