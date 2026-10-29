import { NextResponse, type NextRequest } from 'next/server';

/**
 * Password protection for the whole app.
 *
 * The report system holds customer contact details, licensed inspectors'
 * signatures, and a template that anyone could replace. None of that belongs on
 * an address that is merely hard to guess, so a deployment with `APP_PASSWORD`
 * set requires the password before anything is served.
 *
 * With no password configured the app is open — that is local development,
 * where the alternative is typing a password into every dev session. The deploy
 * sets one, and `/api/health` reports whether it took.
 */
export function middleware(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  // Lets a load balancer check the app is alive without holding the password.
  if (request.nextUrl.pathname === '/api/health') return NextResponse.next();

  // The CRM delivering a Hayes e-mail is a machine with a bearer token, not a person
  // with the password — the route checks that token itself (`CRM_API_TOKEN`).
  if (request.nextUrl.pathname === '/api/mold/intake') return NextResponse.next();

  const header = request.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    // `atob` rather than Buffer: middleware runs on the Edge runtime.
    const decoded = atob(header.slice('Basic '.length));
    const supplied = decoded.slice(decoded.indexOf(':') + 1);
    if (timingSafeEqual(supplied, password)) return NextResponse.next();
  }

  // The realm is ASCII on purpose: header values are limited to Latin-1, and a
  // Hebrew realm makes the response fail to serialise — the browser then gets a
  // 500 and never shows the password prompt at all.
  return new NextResponse('נדרשת הזדהות', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Radiation Reports", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

/**
 * Compares in time that does not depend on where the strings first differ.
 *
 * A naive `===` returns faster the sooner it finds a mismatch, which over many
 * attempts leaks the password one character at a time.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  // Everything except Next's own static output, which carries no data.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
