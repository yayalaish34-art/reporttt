import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import './prediction.css';
import { Shell } from './shell';

export const metadata: Metadata = {
  title: 'Galit ELF Projection',
  description: 'חיזוי שדות מגנטיים (ELF, 50 Hz) מתוכניות חשמל',
  icons: { icon: '/logo.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="גלית" width={34} height={34} />
              <span className="brand-text">Galit ELF Projection</span>
            </Link>
          </div>
        </header>
        <main className="shell">
          <Shell>{children}</Shell>
        </main>
      </body>
    </html>
  );
}
