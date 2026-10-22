import { Client } from 'pg';
import type { IaqReport } from './iaq-schema';

/** SKU 72 in Galit's price list is the indoor-air-quality inspection. */
const IAQ_SKU = '72';
const COMPANY_TYPES = new Set(['COMPANY', 'SUPPLIER', 'PUBLIC']);

const clean = (value: unknown) => String(value ?? '').trim();
const usefulContact = (value: unknown) => {
  const name = clean(value);
  return /^(איש קשר|מייל כללי)$/i.test(name) ? '' : name;
};

export interface IaqQuoteOption {
  id: string;
  quoteNumber: string;
  customerName: string;
  address: string;
  city: string;
  quoteDate: string;
  appointment: string;
}

export interface IaqQuoteListResult {
  quotes: IaqQuoteOption[];
  error?: string;
}

interface QuoteRow extends Record<string, unknown> {
  id: string;
  quoteNumber: string | null;
  customerId: string;
  customerName: string | null;
  customer_type: string;
  customer_name: string;
  customer_contact_name: string;
  customer_phone: string;
  customer_email: string;
  customer_address: string | null;
  customer_city: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_address: string | null;
  contact_city: string | null;
  addressSummary: string | null;
  citySummary: string | null;
  phoneSummary: string | null;
  task_address: string | null;
  task_city: string | null;
  field_contact_name: string | null;
  field_contact_phone: string | null;
  special_instructions: string | null;
  field_notes: string | null;
  quote_date_text: string | null;
  scheduled_date_text: string | null;
  scheduled_start_text: string | null;
  scheduled_end_text: string | null;
}

const SELECT = `
  SELECT
    q.id,
    q."quoteNumber",
    q."customerId",
    q."customerName",
    q."addressSummary",
    q."citySummary",
    q."phoneSummary",
    c.type AS customer_type,
    c.name AS customer_name,
    c."contactName" AS customer_contact_name,
    c.phone AS customer_phone,
    c.email AS customer_email,
    c.address AS customer_address,
    c.city AS customer_city,
    cc."fullName" AS contact_name,
    COALESCE(NULLIF(cc.mobile, ''), cc.phone) AS contact_phone,
    cc.email AS contact_email,
    cc.address AS contact_address,
    cc.city AS contact_city,
    tf."siteAddress" AS task_address,
    tf."siteCity" AS task_city,
    tf."fieldContactName" AS field_contact_name,
    tf."fieldContactPhone" AS field_contact_phone,
    tf."specialInstructions" AS special_instructions,
    tf."fieldNotes" AS field_notes,
    TO_CHAR((q."quoteDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem', 'DD.MM.YYYY') AS quote_date_text,
    TO_CHAR((tf."scheduledStartAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem', 'DD.MM.YYYY') AS scheduled_date_text,
    TO_CHAR((tf."scheduledStartAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI') AS scheduled_start_text,
    TO_CHAR((tf."scheduledEndAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jerusalem', 'HH24:MI') AS scheduled_end_text
  FROM "Quote" q
  JOIN "Customer" c ON c.id = q."customerId"
  LEFT JOIN "CustomerContact" cc ON cc.id = q."customerContactId"
  LEFT JOIN "TaskField" tf ON tf."taskId" = q."linkedEntityId"
`;

const IS_IAQ = `
  EXISTS (
    SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(q."lineItemsJson") = 'array' THEN q."lineItemsJson" ELSE '[]'::jsonb END
      ) item
     WHERE item->>'sku' = $1
        OR item->>'description' ILIKE '%בדיקת איכות אוויר תוך מבני%'
  )
`;

function crmConfigured(): boolean {
  return Boolean(process.env.CRM_DATABASE_URL);
}

async function withCrm<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.CRM_DATABASE_URL;
  if (!connectionString) throw new Error('CRM_DATABASE_URL לא הוגדר');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    query_timeout: 8000,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Recent offers that actually contain the IAQ service, not merely the word "air". */
export async function listIaqQuotes(): Promise<IaqQuoteListResult> {
  if (!crmConfigured()) return { quotes: [], error: 'חיבור ה-CRM לא הוגדר בשרת.' };
  try {
    const rows = await withCrm(async (client) => {
      const result = await client.query<QuoteRow>(
        `${SELECT} WHERE ${IS_IAQ} ORDER BY q."updatedAt" DESC LIMIT 100`,
        [IAQ_SKU],
      );
      return result.rows;
    });
    return { quotes: rows.map(toOption) };
  } catch (error) {
    console.error('קריאת הצעות מחיר לאיכות אוויר מה-CRM נכשלה', error);
    return { quotes: [], error: 'לא ניתן לקרוא כרגע את הצעות המחיר מה-CRM.' };
  }
}

/** Reads one chosen offer and maps every useful fact into a new report. */
export async function iaqPrefillFromQuote(quoteId: string): Promise<Partial<IaqReport>> {
  if (!quoteId.trim()) throw new Error('לא נבחרה הצעת מחיר');
  const row = await withCrm(async (client) => {
    const result = await client.query<QuoteRow>(
      `${SELECT} WHERE q.id = $2 AND ${IS_IAQ} LIMIT 1`,
      [IAQ_SKU, quoteId],
    );
    return result.rows[0];
  });
  if (!row) throw new Error('הצעת המחיר לא נמצאה או שאינה כוללת בדיקת איכות אוויר תוך־מבנית');

  const isCompany = COMPANY_TYPES.has(clean(row.customer_type).toUpperCase());
  const company = clean(row.customerName) || clean(row.customer_name);
  const recipient =
    usefulContact(row.contact_name) ||
    usefulContact(row.field_contact_name) ||
    usefulContact(row.customer_contact_name) ||
    company;
  const address =
    clean(row.task_address) ||
    clean(row.addressSummary) ||
    clean(row.contact_address) ||
    clean(row.customer_address);
  const city =
    clean(row.task_city) ||
    clean(row.citySummary) ||
    clean(row.contact_city) ||
    clean(row.customer_city);
  const phone =
    clean(row.field_contact_phone) ||
    clean(row.phoneSummary) ||
    clean(row.contact_phone) ||
    clean(row.customer_phone);
  const email = clean(row.contact_email) || clean(row.customer_email);
  const presence = usefulContact(row.field_contact_name) || recipient;
  const reason = [clean(row.special_instructions), clean(row.field_notes)]
    .filter((value, index, all) => value && all.indexOf(value) === index)
    .join('\n');
  const start = clean(row.scheduled_start_text);
  const end = clean(row.scheduled_end_text);

  return {
    sourceQuoteId: clean(row.id),
    sourceQuoteNumber: clean(row.quoteNumber),
    customerId: clean(row.customerId),
    customerType: isCompany ? 'company' : 'private',
    companyName: isCompany ? company : '',
    recipientName: recipient,
    clientName: isCompany ? company : recipient,
    contactPhone: phone,
    contactEmail: email,
    address,
    city,
    requestDate: clean(row.quote_date_text),
    surveyDate: clean(row.scheduled_date_text) || clean(row.quote_date_text),
    surveyTime: start && end ? `${start}–${end}` : start,
    presentAt: presence ? `הבדיקה בוצעה בנוכחות ${presence}` : '',
    reason,
  };
}

function toOption(row: QuoteRow): IaqQuoteOption {
  return {
    id: clean(row.id),
    quoteNumber: clean(row.quoteNumber),
    customerName: clean(row.customerName) || clean(row.customer_name),
    address: clean(row.task_address) || clean(row.addressSummary) || clean(row.customer_address),
    city: clean(row.task_city) || clean(row.citySummary) || clean(row.customer_city),
    quoteDate: clean(row.quote_date_text),
    appointment: [clean(row.scheduled_date_text), clean(row.scheduled_start_text)]
      .filter(Boolean)
      .join(' '),
  };
}
