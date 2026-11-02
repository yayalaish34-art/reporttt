import Link from 'next/link';
import { notFound } from 'next/navigation';
import { joinAddress } from '@/lib/address';
import { customerLabel, loadCustomer } from '@/lib/customer-service';
import { listCustomerDetectors } from '@/lib/radon-detectors';
import { installationEnd, placementDate, testProgress } from '@/lib/radon-installation';
import { listInstallations } from '@/lib/radon-installation-service';
import { findReadings } from '@/lib/radon-readings-store';
import { loadRadonReport } from '@/lib/radon-service';
import { RadonDetectorsSection } from './radon-detectors-section';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = loadCustomer(id);
  if (!customer) notFound();

  const assigned = listCustomerDetectors(id);
  const installations = listInstallations().filter((installation) => installation.customerId === id);
  const readings = await findReadings(assigned.map((d) => d.detectorNumber));

  const reportIds = [...new Set(assigned.map((d) => d.reportId).filter(Boolean))];
  const reports = reportIds.map((reportId) => ({
    id: reportId,
    reference: loadRadonReport(reportId)?.referenceNumber ?? '',
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{customerLabel(customer)}</h1>
          <p className="subtitle">
            {[joinAddress(customer.addressLine, customer.city), customer.phone, customer.email]
              .filter(Boolean)
              .join(' · ') || 'אין פרטי קשר'}
          </p>
        </div>
        <div className="actions">
          {/* A plain anchor: this route creates an installation, so it must not be prefetched. */}
          <a className="btn btn-primary" href={`/radon/installations/new?customer=${id}`}>
            התקנת גלאים
          </a>
          <Link className="btn" href="/customers">
            → לכל הלקוחות
          </Link>
        </div>
      </div>

      {installations.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>התקנות</h2>
          </div>
          {installations.map((installation) => (
            <div className="list-row" key={installation.id}>
              <div className="grow">
                <div className="title">
                  <Link href={`/radon/installations/${installation.id}`} prefetch={false}>
                    {installation.testLength === 'קצרה' ? 'קצר טווח' : 'ארוך טווח'}
                  </Link>
                </div>
                <div className="meta">
                  {placementDate(installation.installedOn)} עד{' '}
                  {placementDate(installationEnd(installation.testLength, installation.installedOn))} ·{' '}
                  {installation.scanned} מתוך {installation.spots} מקומות עם גלאי
                  {installation.wattStart && ` · ואט בתחילה: ${installation.wattStart}`}
                  {installation.wattEnd && ` · ואט בסיום: ${installation.wattEnd}`}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      <RadonDetectorsSection
        customerId={id}
        initial={assigned.map((detector) => {
          const reading = readings?.get(detector.detectorNumber);
          return {
            detectorNumber: detector.detectorNumber,
            reportId: detector.reportId,
            roomName: detector.roomName,
            floor: detector.floor,
            installationId: detector.installationId,
            testLength: detector.testLength,
            placedAt: detector.placedAt,
            collectedAt: detector.collectedAt,
            progress: testProgress(detector.placedAt, detector.collectedAt),
            concentration: reading?.concentration ?? '',
            uncertainty: reading?.uncertainty ?? '',
          };
        })}
        reports={reports}
        readingsAvailable={readings !== null}
      />
    </>
  );
}
