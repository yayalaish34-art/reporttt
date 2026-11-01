import Link from 'next/link';

/** The two halves of the radon work: putting detectors up, and reporting on them. */
export function RadonTabs({ active }: { active: 'installations' | 'reports' }) {
  return (
    <nav className="actions" aria-label="ראדון" style={{ marginBottom: 16 }}>
      <Link className={active === 'installations' ? 'btn-primary btn' : 'btn'} href="/radon/installations" prefetch={false}>
        התקנת גלאים
      </Link>
      <Link className={active === 'reports' ? 'btn-primary btn' : 'btn'} href="/radon" prefetch={false}>
        הפקת דוחות
      </Link>
    </nav>
  );
}
