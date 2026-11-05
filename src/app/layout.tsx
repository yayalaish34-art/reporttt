import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { Brand } from './brand';
import { FreshSession } from './fresh-session';
import { ELF_PROJECTION_URL } from '@/lib/elf-projection';

/**
 * The address the site is served from, used to make the icon and preview URLs
 * absolute. Search engines and link previews need a full URL; Railway supplies
 * the domain, and the fallback keeps local development working.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL
  : process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : 'http://localhost:3000';

/**
 * The reports are filled in on a phone, in a plant room, one-handed.
 *
 * `viewportFit: 'cover'` lets the page reach under a notch; the safe-area padding in
 * globals.css keeps content out from under it. `maximumScale` is deliberately left
 * alone — pinch-zoom is how someone reads a measurement they cannot quite see, and
 * blocking it to stop iOS's focus-zoom would be fixing the symptom by removing a
 * control people need. The focus-zoom itself is prevented by giving inputs a 16px
 * font, which is what actually triggers it.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'מערכת הפקת דוחות קרינה',
  description: 'הפקת דוחות בדיקת קרינה אלקטרומגנטית מתבנית Word',
  applicationName: 'גלית — דוחות קרינה',
  // One square PNG covers the browser tab, the phone home screen and the
  // preview card. It is the company mark, so the same file serves all three.
  icons: {
    icon: [{ url: '/logo.png', type: 'image/png', sizes: '512x512' }],
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
  openGraph: {
    title: 'גלית — מערכת הפקת דוחות קרינה',
    description: 'הפקת דוחות בדיקת קרינה אלקטרומגנטית',
    url: SITE_URL,
    siteName: 'גלית — החברה לאיכות הסביבה',
    images: [{ url: '/logo.png', width: 512, height: 512, alt: 'גלית — החברה לאיכות הסביבה' }],
    locale: 'he_IL',
    type: 'website',
  },
};

/**
 * Tells search engines which image is the organisation's logo.
 *
 * A favicon alone is a tab icon; the logo shown beside a result comes from
 * Organization structured data, and this is the shape Google reads it in.
 *
 * Rendered inside <body>, which is where structured data is read from just as
 * well. It was in a hand-written <head> at first, and that broke every button
 * in the app: the App Router owns the document head, and a <head> element of
 * our own left its client-side navigation dead — server actions ran and
 * returned their redirect, but the browser never followed it.
 */
const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'גלית — החברה לאיכות הסביבה',
  url: 'https://galit.co.il',
  logo: `${SITE_URL}/logo.png`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        {/* A browser opened afresh lands on the start screen rather than back inside
            whatever report its last session was in — see `FreshSession`. */}
        <FreshSession />
        <script
          type="application/ld+json"
          // Serialised rather than interpolated so a stray character in a name
          // cannot break out of the script tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <header className="topbar">
          <div className="topbar-inner">
            <Brand />
            {/* ספריית הלקוחות ומסך החתימות הוסרו מהתפריט אך נשארו זמינים
                ב-/customers וב-/signatures: בורר הלקוחות שבעורך ובחירת החתימה
                בטבלאות הבודקים עדיין נשענים עליהם, ובלי המסכים האלה אין דרך
                להוסיף חתימה או לתקן פרטי לקוח. */}
            <nav>
              {/* "/" is the start screen now, not the radiation list — the list moved
                  to /reports when opening the app stopped meaning "read the archive"
                  and started meaning "write a survey". */}
              <Link href="/reports">דוח קרינה</Link>
              <Link href="/radon">דוח ראדון</Link>
              <Link href="/asbestos">דוח אסבסט</Link>
              <Link href="/mold">דוח עובשים</Link>
              <Link href="/iaq">איכות אוויר</Link>
              {/* A separate system (Galit ELF Projection) with its own login. */}
              <a href={ELF_PROJECTION_URL}>חיזוי קרינה</a>
              <Link href="/jobs">Job Number</Link>
              <Link href="/inspectors">בודקים</Link>
              <Link href="/templates">תבניות</Link>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
