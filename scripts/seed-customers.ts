/**
 * Adds a starting set of customers so the picker is not empty on first run.
 *
 * Idempotent: a customer whose contact and company already match is left alone,
 * so re-running after a schema change does not duplicate the directory.
 *
 *   npx tsx scripts/seed-customers.ts
 */
import { createCustomer, searchCustomers, type CustomerInput } from '../src/lib/customer-service';

const SEED: CustomerInput[] = [
  {
    kind: 'company',
    contactName: 'ירון חכם',
    contactTitle: 'רמ"ד אחזקה ובינוי',
    companyName: 'כרטיסי אשראי לישראל בע"מ',
    addressLine: 'תפוצות ישראל 13',
    city: 'גבעתיים',
    phone: '052-2857557',
    email: 'yaron.haham@icc.co.il',
  },
];

let added = 0;
for (const customer of SEED) {
  const existing = searchCustomers(customer.contactName, 50).some(
    (c) => c.contactName === customer.contactName && c.companyName === customer.companyName,
  );
  if (existing) {
    console.log(`קיים כבר: ${customer.contactName}`);
    continue;
  }
  createCustomer(customer);
  added++;
  console.log(`נוסף: ${customer.companyName || customer.contactName}`);
}

console.log(`\n${added} לקוחות נוספו.`);
