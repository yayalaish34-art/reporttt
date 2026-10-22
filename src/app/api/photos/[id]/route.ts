import { NextResponse } from 'next/server';
import { photoBytes } from '@/lib/report-service';

/** Serves a stored photograph for the editor's thumbnail grid. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = photoBytes(id);
  if (!photo) return NextResponse.json({ error: 'התמונה לא נמצאה' }, { status: 404 });

  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: {
      'Content-Type': photo.contentType,
      'Content-Length': String(photo.bytes.length),
      // Photos are immutable once stored — a new upload gets a new id.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
