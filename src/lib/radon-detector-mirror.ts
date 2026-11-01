import type { Client } from 'pg';
import { db } from './db';
import { listCustomerDetectors, type AssignedDetector } from './radon-detectors';
import { printedDateToMoment } from './radon-installation';
import { connectReadingsStore, readingsStoreConfigured } from './radon-readings-store';

/**
 * A copy of the detector list, kept where the CRM can read it.
 *
 * The list itself lives in this app's own database, which the CRM cannot reach, and the
 * office looks at a customer's card in the CRM. The customer directory here keeps the
 * CRM's own ids, so a row found by `customerId` is the right card with no matching.
 *
 * Never fatal, and never waited on: the installation is already stored here, and a
 * Supabase that is unreachable must not hold up someone scanning detectors on site. A
 * missed write is made good by the next change to that customer, or by the next restart.
 */

/** The table is created on first use — this app is a guest in the CRM's schema. */
const TABLE = 'RadonInstalledDetector';

async function ensureTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${TABLE}" (
      "detectorNumber" TEXT PRIMARY KEY,
      "customerId"     TEXT NOT NULL,
      "installationId" TEXT NOT NULL DEFAULT '',
      "reportId"       TEXT NOT NULL DEFAULT '',
      "roomName"       TEXT NOT NULL DEFAULT '',
      "floor"          TEXT NOT NULL DEFAULT '',
      "testLength"     TEXT NOT NULL DEFAULT '',
      "placedAt"       TEXT NOT NULL DEFAULT '',
      "collectedAt"    TEXT NOT NULL DEFAULT '',
      "startsAt"       TIMESTAMPTZ,
      "endsAt"         TIMESTAMPTZ,
      "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS "idx_radon_installed_customer" ON "${TABLE}" ("customerId")`);
}

/** Replaces what the store holds for a customer. A detector moved here from another customer moves with it. */
async function write(client: Client, customerId: string, detectors: AssignedDetector[]): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(`DELETE FROM "${TABLE}" WHERE "customerId" = $1 AND NOT ("detectorNumber" = ANY($2))`, [
      customerId,
      detectors.map((detector) => detector.detectorNumber),
    ]);
    for (const detector of detectors) {
      await client.query(
        `INSERT INTO "${TABLE}"
           ("detectorNumber", "customerId", "installationId", "reportId", "roomName", "floor",
            "testLength", "placedAt", "collectedAt", "startsAt", "endsAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         ON CONFLICT ("detectorNumber") DO UPDATE SET
           "customerId"     = EXCLUDED."customerId",
           "installationId" = EXCLUDED."installationId",
           "reportId"       = EXCLUDED."reportId",
           "roomName"       = EXCLUDED."roomName",
           "floor"          = EXCLUDED."floor",
           "testLength"     = EXCLUDED."testLength",
           "placedAt"       = EXCLUDED."placedAt",
           "collectedAt"    = EXCLUDED."collectedAt",
           "startsAt"       = EXCLUDED."startsAt",
           "endsAt"         = EXCLUDED."endsAt",
           "updatedAt"      = NOW()`,
        [
          detector.detectorNumber,
          customerId,
          detector.installationId,
          detector.reportId,
          detector.roomName,
          detector.floor,
          detector.testLength,
          detector.placedAt,
          detector.collectedAt,
          printedDateToMoment(detector.placedAt),
          printedDateToMoment(detector.collectedAt),
        ],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function copyCustomer(customerId: string): Promise<void> {
  let client: Client | null = null;
  try {
    client = await connectReadingsStore();
    await ensureTable(client);
    await write(client, customerId, listCustomerDetectors(customerId));
  } catch (err) {
    console.error('העתקת גלאי הלקוח ל-Supabase נכשלה', err);
  } finally {
    await client?.end().catch(() => undefined);
  }
}

/** Customers being copied now, marked when another change arrived during the copy. */
const copying = new Map<string, { again: boolean }>();

/**
 * Copies a customer's detectors, one copy at a time per customer.
 *
 * The autosave calls this every few seconds while someone is scanning. A change arriving
 * mid-copy asks for one more when it finishes, which reads the list as it then stands.
 */
export async function mirrorCustomerDetectors(customerId: string): Promise<void> {
  if (!customerId || !readingsStoreConfigured()) return;

  const running = copying.get(customerId);
  if (running) {
    running.again = true;
    return;
  }

  const state = { again: false };
  copying.set(customerId, state);
  try {
    do {
      state.again = false;
      await copyCustomer(customerId);
    } while (state.again);
  } finally {
    copying.delete(customerId);
  }
}

/** Copies everyone, at startup: it fills the table once, and makes good any write that was missed. */
export async function mirrorAllDetectors(): Promise<number> {
  if (!readingsStoreConfigured()) return 0;
  const rows = db().prepare('SELECT DISTINCT customer_id FROM radon_detectors').all() as Array<{ customer_id: string }>;
  for (const row of rows) await mirrorCustomerDetectors(row.customer_id);
  return rows.length;
}
