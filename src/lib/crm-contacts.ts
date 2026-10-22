import { Client } from 'pg';

/**
 * The people at a company, read from the CRM.
 *
 * The customer directory here keeps one contact per customer — the primary one,
 * copied at import. That is right for a private customer, who is the contact,
 * and wrong for a company, where the report is addressed to whichever person
 * ordered this particular survey. A company with six contacts was reduced to
 * one, and every report to that company went out addressed to that one.
 *
 * So the list is fetched live rather than imported. Contacts change more often
 * than companies do, and a stale copy would put the wrong name on a document
 * that leaves the building.
 */

export interface CrmContact {
  id: string;
  fullName: string;
  roleTitle: string;
  phone: string;
  email: string;
  isPrimary: boolean;
}

export function crmContactsConfigured(): boolean {
  return Boolean(process.env.CRM_DATABASE_URL);
}

export async function listCustomerContacts(customerId: string): Promise<CrmContact[]> {
  const connectionString = process.env.CRM_DATABASE_URL;
  if (!connectionString || !customerId) return [];

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT id, "fullName", COALESCE("roleTitle", '') AS "roleTitle",
              COALESCE(NULLIF(mobile, ''), phone) AS phone,
              email, "isPrimary"
         FROM "CustomerContact"
        WHERE "customerId" = $1
          AND "isActive" = true
          AND COALESCE(TRIM("fullName"), '') <> ''
        -- The primary first, then alphabetically: the common choice is at the
        -- top and the rest are where a name can be found by eye.
        ORDER BY "isPrimary" DESC, "fullName" ASC`,
      [customerId],
    );

    return rows.map((row) => ({
      id: String(row.id),
      fullName: String(row.fullName ?? '').trim(),
      roleTitle: String(row.roleTitle ?? '').trim(),
      phone: String(row.phone ?? '').trim(),
      email: String(row.email ?? '').trim(),
      isPrimary: row.isPrimary === true,
    }));
  } catch (err) {
    // Never fatal: the recipient fields are typed-in text, and a CRM that is
    // unreachable costs the surveyor a convenience, not the report.
    console.error('קריאת אנשי הקשר מה-CRM נכשלה', err);
    return [];
  } finally {
    await client.end().catch(() => undefined);
  }
}
