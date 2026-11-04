import type { NextRequest } from 'next/server';

/**
 * The prediction engine's API, served from this app's own address.
 *
 * The engine is Python and runs on Vercel; the screens live here. The browser only ever
 * talks to this origin, so the engine's login cookie is first-party and no CORS is needed.
 *
 * Only what the engine needs is passed on. In particular this app's own Basic-auth header,
 * once `APP_PASSWORD` is set, must never leave for another service, and of this app's
 * cookies only the engine's own is sent.
 */
const API_BASE = process.env.PREDICTION_API_URL ?? 'https://galit-elf.vercel.app';
const REQUEST_HEADERS = ['content-type', 'accept', 'if-none-match'];
const RESPONSE_HEADERS = [
  'content-type',
  'content-disposition',
  'cache-control',
  'etag',
  'last-modified',
  'x-content-type-options',
];

export const dynamic = 'force-dynamic';

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  // The upload signer is the engine's one route outside /api.
  const target =
    path.length === 1 && path[0] === 'upload-url'
      ? `${API_BASE}/upload-url`
      : `${API_BASE}/api/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const token = request.cookies.get('elf_token')?.value;
  if (token) headers.set('cookie', `elf_token=${token}`);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return Response.json({ detail: 'מנוע החיזוי אינו זמין כרגע' }, { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
  // Streamed through: a plan or a report can be far larger than one buffer should hold.
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
