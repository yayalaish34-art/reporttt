'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The masthead: the logo, and which of the two report kinds is open.
 *
 * It used to read "דוחות קרינה — גלית — איכות הסביבה", which is a company name rather
 * than a place. The company is already the logo beside it, so the words repeated the
 * picture and pushed the part that says *where you are* off a phone screen. What replaces
 * it is the one fact the header can usefully carry: which kind of report this is.
 *
 * Derived from the path rather than passed down, so the two lists and the editor under
 * each of them all say the right thing without every page having to declare it.
 */
export function Brand() {
  const pathname = usePathname() ?? '/';
  const radon = pathname === '/radon' || pathname.startsWith('/radon/');

  return (
    <Link href={radon ? '/radon' : '/'} className="brand">
      <Image src="/logo.png" alt="גלית" width={34} height={34} priority />
      <span className="brand-text">{radon ? 'דוח ראדון' : 'דוח קרינה'}</span>
    </Link>
  );
}
