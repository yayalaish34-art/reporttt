'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CustomerPicker } from '../../reports/[id]/customer-picker';

/** Where scanning starts: choose the customer, and their card opens ready to scan. */
export default function AssignDetectorsPage() {
  const router = useRouter();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>שיוך גלאים ללקוח</h1>
          <p className="subtitle">בחרו לקוח, ובכרטיס שלו סורקים את הגלאים.</p>
        </div>
        <div className="actions">
          <Link className="btn" href="/radon">
            → לדוחות הראדון
          </Link>
        </div>
      </div>

      <section className="card">
        <div className="card-body">
          <div className="grid">
            <CustomerPicker onPick={(fields) => router.push(`/customers/${fields.customerId}`)} />
          </div>
        </div>
      </section>
    </>
  );
}
