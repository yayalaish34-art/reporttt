import { Client } from 'pg';

/**
 * The laboratory's readings, kept where the rest of the business keeps things.
 *
 * A detector is developed once. Its number, its concentration and its
 * uncertainty are the one piece of this whole system that cannot be
 * reconstructed later — the photograph gets deleted, the software's own folder
 * gets overwritten, and the report only ever carries the handful of detectors
 * that belonged to that customer. So every row read off a laboratory screen is
 * written to Supabase, whether or not it ended up in a report.
 *
 * Keyed by detector number, because that is what a detector is. Re-reading the
 * same screen updates the row rather than adding a second one, so an accidental
 * second upload is harmless.
 */

/** The table is created on first use — this app is a guest in the CRM's schema. */
const TABLE = 'RadonLabReading';

export interface StoredReading {
  detectorNumber: string;
  /** As printed in the laboratory's KBq_m3_h column, before the ± sign. */
  concentration: string;
  /** The figure after the ± sign, a percentage of the reading. */
  uncertainty: string;
  status: string;
  /** The report this reading was scanned for, when it was scanned from one. */
  reportId?: string;
  customerId?: string;
}

export function readingsStoreConfigured(): boolean {
  return Boolean(process.env.CRM_DATABASE_URL);
}

export async function connectReadingsStore(): Promise<Client> {
  const connectionString = process.env.CRM_DATABASE_URL;
  if (!connectionString) throw new Error('חיבור ל-Supabase לא הוגדר בשרת (CRM_DATABASE_URL).');
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

/**
 * Creates the table if it is not there.
 *
 * Run on every save rather than as a migration: this app does not own the CRM's
 * schema and has no place in its migration history, and the statement costs
 * nothing once the table exists.
 */
async function ensureTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${TABLE}" (
      "detectorNumber" TEXT PRIMARY KEY,
      "concentration"  TEXT NOT NULL DEFAULT '',
      "uncertainty"    TEXT NOT NULL DEFAULT '',
      "status"         TEXT NOT NULL DEFAULT '',
      "reportId"       TEXT,
      "customerId"     TEXT,
      "scannedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(
    `CREATE INDEX IF NOT EXISTS "idx_radon_reading_report" ON "${TABLE}" ("reportId")`,
  );
}

/**
 * Writes a batch of readings, replacing any it has seen before.
 *
 * Never throws to the caller: the readings are already on screen and already on
 * their way into the report, and a Supabase that is unreachable must not cost
 * the surveyor the scan they just waited two minutes for. Returns how many rows
 * were written so the interface can say plainly whether the copy was made.
 */
export async function saveReadings(readings: StoredReading[]): Promise<{ saved: number; error?: string }> {
  if (readings.length === 0) return { saved: 0 };
  if (!readingsStoreConfigured()) return { saved: 0, error: 'חיבור ל-Supabase לא הוגדר בשרת.' };

  let client: Client | null = null;
  try {
    client = await connectReadingsStore();
    await ensureTable(client);

    for (const reading of readings) {
      await client.query(
        `INSERT INTO "${TABLE}"
           ("detectorNumber", "concentration", "uncertainty", "status", "reportId", "customerId")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("detectorNumber") DO UPDATE SET
           "concentration" = EXCLUDED."concentration",
           "uncertainty"   = EXCLUDED."uncertainty",
           "status"        = EXCLUDED."status",
           "reportId"      = COALESCE(EXCLUDED."reportId", "${TABLE}"."reportId"),
           "customerId"    = COALESCE(EXCLUDED."customerId", "${TABLE}"."customerId"),
           "updatedAt"     = NOW()`,
        [
          reading.detectorNumber,
          reading.concentration,
          reading.uncertainty,
          reading.status,
          reading.reportId ?? null,
          reading.customerId ?? null,
        ],
      );
    }

    return { saved: readings.length };
  } catch (err) {
    console.error('שמירת קריאות המעבדה ב-Supabase נכשלה', err);
    return { saved: 0, error: err instanceof Error ? err.message : 'שמירה ב-Supabase נכשלה' };
  } finally {
    await client?.end().catch(() => undefined);
  }
}

/**
 * Looks up a customer's whole batch of detectors in one query.
 *
 * Returns null when the store cannot answer, which is not the same as "no results
 * yet" — the customer's card says which of the two it is.
 */
export async function findReadings(detectorNumbers: string[]): Promise<Map<string, StoredReading> | null> {
  if (!readingsStoreConfigured()) return null;
  if (detectorNumbers.length === 0) return new Map();

  let client: Client | null = null;
  try {
    client = await connectReadingsStore();
    await ensureTable(client);
    const { rows } = await client.query(
      `SELECT "detectorNumber", "concentration", "uncertainty", "status", "reportId", "customerId"
         FROM "${TABLE}" WHERE "detectorNumber" = ANY($1)`,
      [detectorNumbers],
    );
    return new Map((rows as StoredReading[]).map((row) => [row.detectorNumber, row]));
  } catch (err) {
    console.error('קריאת גלאים מ-Supabase נכשלה', err);
    return null;
  } finally {
    await client?.end().catch(() => undefined);
  }
}

/** Looks a detector up, for a report written months after the scan. */
export async function findReading(detectorNumber: string): Promise<StoredReading | null> {
  if (!readingsStoreConfigured()) return null;
  const key = detectorNumber.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
  if (!key) return null;

  let client: Client | null = null;
  try {
    client = await connectReadingsStore();
    await ensureTable(client);
    const { rows } = await client.query(
      `SELECT "detectorNumber", "concentration", "uncertainty", "status", "reportId", "customerId"
         FROM "${TABLE}" WHERE "detectorNumber" = $1`,
      [key],
    );
    return (rows[0] as StoredReading) ?? null;
  } catch (err) {
    console.error('קריאת גלאי מ-Supabase נכשלה', err);
    return null;
  } finally {
    await client?.end().catch(() => undefined);
  }
}
