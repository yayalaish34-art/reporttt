import { NextResponse } from 'next/server';
import { moldPhotoBytes } from '@/lib/mold-service';

/**
 * Serves a stored photograph, for the thumbnail strip in the editor.
 *
 * Immutable: a photograph is written once and never edited in place, so the browser
 * may keep it for as long as it likes. Without this the editor refetched every
 * thumbnail on each render, which on a phone over cellular was the slowest thing on
 * the screen.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const photo = moldPhotoBytes(id);
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
