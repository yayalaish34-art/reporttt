import Link from 'next/link';
import { listInstallations } from '@/lib/radon-installation-service';
import { placementDate } from '@/lib/radon-installation';
import { RadonTabs } from '../tabs';
import { DeleteInstallationButton } from './delete-installation-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'התקנת גלאי ראדון' };

export default function InstallationsPage() {
  const installations = listInstallations();

  return (
    <>
      <RadonTabs active="installations" />

      <div className="page-head">
        <div>
          <h1>התקנת גלאים</h1>
          <p className="subtitle">
            {installations.length === 0 ? 'אין עדיין התקנות' : `${installations.length} התקנות`}
          </p>
        </div>
        <div className="actions">
          {/* A plain anchor: this route creates an installation, so it must not be prefetched. */}
          <a className="btn btn-primary" href="/radon/installations/new">
            התקנה חדשה
          </a>
        </div>
      </div>

      <div className="card">
        {installations.length === 0 ? (
          <div className="empty">אין התקנות. לחצו ״התקנה חדשה״ כדי להתחיל.</div>
        ) : (
          installations.map((installation) => (
            <div className="list-row" key={installation.id}>
              <div className="grow">
                <div className="title">
                  <Link href={`/radon/installations/${installation.id}`} prefetch={false}>
                    {installation.title || 'ללא לקוח'}
                  </Link>
                </div>
                <div className="meta">
                  {[
                    placementDate(installation.installedOn),
                    `${installation.scanned} מתוך ${installation.spots} מקומות עם גלאי`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <Link className="btn btn-sm" href={`/radon/installations/${installation.id}`} prefetch={false}>
                עריכה
              </Link>
              <DeleteInstallationButton id={installation.id} title={installation.title || 'ללא לקוח'} />
            </div>
          ))
        )}
      </div>
    </>
  );
}
