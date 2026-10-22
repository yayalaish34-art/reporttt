import { Client } from 'pg';
import { db, now } from './db';
import { streetOf } from './address';

/**
 * Pulls the customer directory from the Galit CRM.
 *
 * The report addresses a named person at a named company, and the CRM is where
 * that directory is already maintained. Keeping a second one here would mean
 * two lists drifting apart, so this copies the CRM's.
 *
 * Idempotent by construction: the local row keeps the CRM's own id as its
 * primary key, so a re-run updates every record in place instead of appending a
 * second copy of the directory. Anyone typed into this app directly has a
 * generated id and is never touched.
 */

/**
 * The CRM types that mean "an organisation", and so get a company line in the
 * recipient block. Everything else is addressed as a person.
 *
 * POTENTIAL sits on the private side: it is the CRM's bucket for leads nobody
 * has classified yet, and the sample is overwhelmingly individual homeowners.
 * A wrong company line is visible on the page; a missing one is not, so the
 * ambiguous case goes to the quieter failure.
 */
const COMPANY_TYPES = new Set(['COMPANY', 'SUPPLIER', 'PUBLIC']);

/**
 * The CRM's legacy import invented an address for every record that had none.
 * They do not deliver, and a report printing one looks more wrong than a blank.
 */
const isPlaceholderEmail = (email: string) => /@legacy\.import\.local$/i.test(email);

const clean = (v: unknown) => String(v ?? '').trim();

export interface CrmImportResult {
  read: number;
  before: number;
  after: number;
  companies: number;
  people: number;
  /** Companies filed under a person's own name, imported as private. */
  flattened: number;
  droppedEmails: number;
}

/** Whether the CRM connection string is configured on this deployment. */
export function crmConfigured(): boolean {
  return Boolean(process.env.CRM_DATABASE_URL);
}

export class CrmNotConfiguredError extends Error {
  constructor() {
    super('חיבור ל-CRM לא הוגדר בשרת (CRM_DATABASE_URL).');
    this.name = 'CrmNotConfiguredError';
  }
}

export async function importCrmCustomers(): Promise<CrmImportResult> {
  const connectionString = process.env.CRM_DATABASE_URL;
  if (!connectionString) throw new CrmNotConfiguredError();

  const crm = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await crm.connect();
  let rows: Array<Record<string, unknown>>;
  try {
    ({ rows } = await crm.query(
      `SELECT id, name, "contactName", type, address, city, phone, email
         FROM "Customer"
        WHERE COALESCE(TRIM(name), '') <> ''
        ORDER BY "updatedAt" DESC NULLS LAST`,
    ));
  } finally {
    await crm.end();
  }

  const handle = db();
  const before = (handle.prepare('SELECT COUNT(*) AS c FROM customers').get() as { c: number }).c;

  const upsert = handle.prepare(UPSERT);

  const timestamp = now();
  let companies = 0;
  let people = 0;
  let flattened = 0;
  let droppedEmails = 0;

  const prepared = rows.map((r) => {
    const mapped = toDirectoryRow(r, timestamp);
    if (mapped.flattened) flattened++;
    if (mapped.droppedEmail) droppedEmails++;
    mapped.isCompany ? companies++ : people++;
    return mapped.values;
  });

  // One transaction: tens of thousands of separate commits would take minutes,
  // and a dropped connection midway would leave half a directory behind.
  handle.exec('BEGIN');
  try {
    for (const row of prepared) upsert.run(...row);
    handle.exec('COMMIT');
  } catch (e) {
    handle.exec('ROLLBACK');
    throw e;
  }

  const after = (handle.prepare('SELECT COUNT(*) AS c FROM customers').get() as { c: number }).c;
  return { read: rows.length, before, after, companies, people, flattened, droppedEmails };
}

/**
 * Re-reads one customer from the CRM into the directory, as they are picked.
 *
 * The directory is a copy taken whenever someone last pressed "import", and a
 * customer's address is typically completed in the CRM *after* the lead was opened —
 * the call comes in with a town, the street arrives with the order. Picking from the
 * copy filled a report with the address as it stood at import: "הרצליה" where the CRM
 * had long since said "חנה רובינא 4".
 *
 * Returns false where there is nothing to refresh from — no connection, a customer
 * typed into this app directly, or a CRM that did not answer in time. The picker then
 * uses the copy it already has, which is what it did before.
 */
export async function refreshCrmCustomer(customerId: string): Promise<boolean> {
  const connectionString = process.env.CRM_DATABASE_URL;
  if (!connectionString || !customerId) return false;

  const crm = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    // The surveyor is waiting on this with a customer half-picked; a slow CRM costs
    // the fresh address, never the pick.
    connectionTimeoutMillis: 4000,
    query_timeout: 4000,
  });
  try {
    await crm.connect();
    const { rows } = await crm.query(
      `SELECT id, name, "contactName", type, address, city, phone, email
         FROM "Customer"
        WHERE id = $1 AND COALESCE(TRIM(name), '') <> ''`,
      [customerId],
    );
    if (rows.length === 0) return false;
    db().prepare(UPSERT).run(...toDirectoryRow(rows[0], now()).values);
    return true;
  } catch (err) {
    console.error('רענון הלקוח מה-CRM נכשל', err);
    return false;
  } finally {
    await crm.end().catch(() => undefined);
  }
}

const UPSERT = `INSERT INTO customers
       (id, kind, contact_name, contact_title, company_name, address_line, city, phone, email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind         = excluded.kind,
       contact_name = excluded.contact_name,
       company_name = excluded.company_name,
       address_line = excluded.address_line,
       city         = excluded.city,
       phone        = excluded.phone,
       email        = excluded.email,
       updated_at   = excluded.updated_at`;

/** One CRM customer as a directory row, with what the import counts about it. */
function toDirectoryRow(r: Record<string, unknown>, timestamp: string) {
  const name = clean(r.name);
  const contact = clean(r.contactName) || name;
  /**
   * A CRM "company" whose contact is spelled exactly like the company is a
   * sole trader filed under their own name. As a company it would print the
   * same name on both recipient lines and list in the picker as
   * "גיל שמש — גיל שמש", and the directory form rejects a company with an
   * empty company line, so dropping one of the two is not an option either.
   * Addressed as a person it comes out right, and anyone who is genuinely a
   * company can be switched back in the directory.
   */
  const typedCompany = COMPANY_TYPES.has(clean(r.type).toUpperCase());
  const isCompany = typedCompany && contact !== name;

  const email = clean(r.email);
  const placeholder = Boolean(email) && isPlaceholderEmail(email);

  const values = [
    String(r.id),
    isCompany ? 'company' : 'private',
    // For a company the two names differ (the person, then the organisation);
    // for a person they are the same value and only the contact line prints.
    isCompany ? contact : name,
    '', // contact_title — not held in the CRM; filled per report in the app
    isCompany ? name : '',
    streetOf(clean(r.address), clean(r.city)),
    clean(r.city),
    clean(r.phone),
    placeholder ? '' : email,
    timestamp,
    timestamp,
  ] as const;

  return { values, isCompany, flattened: typedCompany && !isCompany, droppedEmail: placeholder };
}
