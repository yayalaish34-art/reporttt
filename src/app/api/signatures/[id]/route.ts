import { NextResponse } from 'next/server';
import { loadSignature } from '@/lib/signature-service';

/** Serves a stored signature for the pickers and the signature library. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const signature = loadSignature(id);
  if (!signature) return NextResponse.json({ error: 'החתימה לא נמצאה' }, { status: 404 });

  return new NextResponse(new Uint8Array(signature.bytes), {
    headers: {
      'Content-Type': signature.contentType,
      'Content-Length': String(signature.bytes.length),
      // Immutable once stored — a replacement gets a new id.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
