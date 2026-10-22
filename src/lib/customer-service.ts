import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, now } from './db';
import { streetOf } from './address';

/**
 * The customer directory.
 *
 * A customer is looked up rather than retyped, because the recipient block is
 * where a wrong value is least likely to be noticed and most embarrassing — a
 * report addressed to the previous contact at the right company reads as
 * correct right up until someone senior sees it.
 */

const text = z.string().trim();

export const CustomerSchema = z.object({
  /**
   * A company has a contact person and a company name; a private customer is
   * one person, and the report addresses them directly with no company line.
   */
  kind: z.enum(['company', 'private']),
  /** The person the report is addressed to. */
  contactName: text.min(1, 'שם איש קשר — שדה חובה'),
  /** Their role, printed after the name. Companies only. */
  contactTitle: text.default(''),
  companyName: text.default(''),
  addressLine: text.default(''),
  city: text.default(''),
  phone: text.default(''),
  email: text.default(''),
});

export type CustomerInput = z.infer<typeof CustomerSchema>;

export interface Customer extends CustomerInput {
  id: string;
  updatedAt: string;
}

/**
 * Finds customers by any of the names, the city, or the contact details.
 *
 * One box rather than a form: whoever is writing up a survey remembers either
 * the company or the person they dealt with, and should not have to know which
 * field the directory filed it under.
 */
export function searchCustomers(query: string, limit = 20): Customer[] {
  const trimmed = query.trim();

  if (trimmed === '') {
    const rows = db()
      .prepare(`SELECT ${COLUMNS} FROM customers ORDER BY updated_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map(toCustomer);
  }

  const pattern = `%${trimmed.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const rows = db()
    .prepare(
      `SELECT ${COLUMNS} FROM customers
        WHERE company_name  LIKE ? ESCAPE '\\'
           OR contact_name  LIKE ? ESCAPE '\\'
           OR city          LIKE ? ESCAPE '\\'
           OR phone         LIKE ? ESCAPE '\\'
           OR email         LIKE ? ESCAPE '\\'
        ORDER BY
          -- A name that starts with the query outranks one that merely contains it.
          CASE WHEN company_name LIKE ? ESCAPE '\\' OR contact_name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
          updated_at DESC
        LIMIT ?`,
    )
    .all(pattern, pattern, pattern, pattern, pattern, `${trimmed}%`, `${trimmed}%`, limit) as Array<
    Record<string, unknown>
  >;
  return rows.map(toCustomer);
}

export function loadCustomer(id: string): Customer | null {
  const row = db().prepare(`SELECT ${COLUMNS} FROM customers WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? toCustomer(row) : null;
}

export function createCustomer(input: CustomerInput): Customer {
  const id = randomUUID();
  const timestamp = now();
  db()
    .prepare(
      `INSERT INTO customers
         (id, kind, contact_name, contact_title, company_name, address_line, city, phone, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.kind,
      input.contactName,
      input.contactTitle,
      input.companyName,
      input.addressLine,
      input.city,
      input.phone,
      input.email,
      timestamp,
      timestamp,
    );
  return loadCustomer(id)!;
}

export function updateCustomer(id: string, input: CustomerInput): Customer {
  const result = db()
    .prepare(
      `UPDATE customers SET
         kind = ?, contact_name = ?, contact_title = ?, company_name = ?,
         address_line = ?, city = ?, phone = ?, email = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.kind,
      input.contactName,
      input.contactTitle,
      input.companyName,
      input.addressLine,
      input.city,
      input.phone,
      input.email,
      now(),
      id,
    );
  if (result.changes === 0) throw new Error(`לקוח ${id} לא נמצא`);
  return loadCustomer(id)!;
}

export function deleteCustomer(id: string): void {
  db().prepare('DELETE FROM customers WHERE id = ?').run(id);
}

export function countCustomers(): number {
  const row = db().prepare('SELECT COUNT(*) AS n FROM customers').get() as { n: number };
  return Number(row.n);
}

const COLUMNS =
  'id, kind, contact_name, contact_title, company_name, address_line, city, phone, email, updated_at';

function toCustomer(row: Record<string, unknown>): Customer {
  const city = String(row.city ?? '');
  return {
    id: String(row.id),
    kind: row.kind === 'private' ? 'private' : 'company',
    contactName: String(row.contact_name ?? ''),
    contactTitle: String(row.contact_title ?? ''),
    companyName: String(row.company_name ?? ''),
    // Rows imported before `streetOf` still carry the city in the street line.
    addressLine: streetOf(String(row.address_line ?? ''), city),
    city,
    phone: String(row.phone ?? ''),
    email: String(row.email ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

/** How a customer is labelled in the search results. */
export function customerLabel(customer: Customer): string {
  return customer.kind === 'company' && customer.companyName
    ? `${customer.companyName} — ${customer.contactName}`
    : customer.contactName;
}
