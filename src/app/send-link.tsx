'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * The link that hands a finished report to the CRM's mail form.
 *
 * On a desktop it opens a second tab, so the report stays where it was. On a
 * phone that is the wrong behaviour and was the reported one: a new tab is a
 * separate window with no visible way back, mobile browsers block it outright
 * when it is not recognised as a direct response to a tap, and the surveyor
 * ends up looking at a stranded page. On a touch device the link simply
 * navigates, and the back button returns them to the report.
 *
 * Rendered without `target` on the server and upgraded after mount, so the
 * server and the first client render agree — deciding this during render from
 * `window` would be a hydration mismatch, which is what broke the templates
 * screen once already.
 */
export function SendLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const [newTab, setNewTab] = useState(false);

  useEffect(() => {
    // A coarse pointer is the honest question — it catches phones and tablets
    // without guessing from a width that a small desktop window would also hit.
    const coarse = window.matchMedia('(pointer: coarse)');
    const apply = () => setNewTab(!coarse.matches);
    apply();
    coarse.addEventListener('change', apply);
    return () => coarse.removeEventListener('change', apply);
  }, []);

  return (
    <a
      href={href}
      className={className}
      {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
    >
      {children}
    </a>
  );
}
