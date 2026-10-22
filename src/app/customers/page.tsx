import { searchCustomers } from '@/lib/customer-service';
import { CustomerDirectory } from './customer-directory';

export const dynamic = 'force-dynamic';

export default function CustomersPage() {
  // The first screenful only. The directory came from the CRM and runs to tens
  // of thousands of records, so it is no longer something to hand over whole —
  // typing in the filter box queries the server for the rest.
  const customers = searchCustomers('', 200);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>לקוחות</h1>
          <p className="subtitle">
            הפרטים כאן ממלאים את בלוק הנמען בדוח. לקוח מסוג <strong>חברה</strong> מדפיס שורת איש קשר
            ושורת שם חברה; <strong>לקוח פרטי</strong> מדפיס את שמו בלבד, בלי שורת חברה.
          </p>
        </div>
      </div>

      <CustomerDirectory customers={customers} />
    </>
  );
}
