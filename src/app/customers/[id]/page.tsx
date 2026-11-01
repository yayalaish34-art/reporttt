import Link from 'next/link';
import { notFound } from 'next/navigation';
import { joinAddress } from '@/lib/address';
import { customerLabel, loadCustomer } from '@/lib/customer-service';
import { listCustomerDetectors } from '@/lib/radon-detectors';
import { findReadings } from '@/lib/radon-readings-store';
import { loadRadonReport } from '@/lib/radon-service';
import { RadonDetectorsSection } from './radon-detectors-section';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = loadCustomer(id);
  if (!customer) notFound();

  const assigned = listCustomerDetectors(id);
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
          <Link className="btn" href="/customers">
            → לכל הלקוחות
          </Link>
        </div>
      </div>

      <RadonDetectorsSection
        customerId={id}
        initial={assigned.map((detector) => {
          const reading = readings?.get(detector.detectorNumber);
          return {
            detectorNumber: detector.detectorNumber,
            reportId: detector.reportId,
            roomName: detector.roomName,
            installationId: detector.installationId,
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
