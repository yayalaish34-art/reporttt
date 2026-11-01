import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadInstallation } from '@/lib/radon-installation-service';
import { customerNameOf } from '@/lib/report-title';
import { FocusMode } from '../../../focus-mode';
import { InstallationEditor } from './editor';

export const dynamic = 'force-dynamic';

export default async function InstallationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const installation = loadInstallation(id);
  if (!installation) notFound();

  const name = customerNameOf(installation);

  return (
    <>
      <FocusMode />

      <div className="focus-bar">
        <Link href="/radon/installations" className="focus-back">
          → לכל ההתקנות
        </Link>
        <span className="focus-ref">{name ? `התקנת גלאים — ${name}` : 'התקנת גלאים'}</span>
      </div>

      <InstallationEditor id={id} initial={installation} />
    </>
  );
}
