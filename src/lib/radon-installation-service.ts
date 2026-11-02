import { randomUUID } from 'node:crypto';
import { db, now } from './db';
import { customerLabel, loadCustomer } from './customer-service';
import {
  createDraftReport,
  listInstallationDetectors,
  recipientOf,
  toDetector,
  type AssignedDetector,
} from './radon-detectors';
import {
  InstallationSchema,
  installationEnd,
  installationSpots,
  israelNow,
  placementDate,
  type Installation,
} from './radon-installation';
import { printedAnswers } from './radon-questions';
import { detectorKey, isDetectorKey } from './radon-rules';
import type { StoredReading } from './radon-readings-store';
import { customerNameOf } from './report-title';

/** Detector installations, and keeping the detector list in step with them. */

export interface InstallationSummary {
  id: string;
  customerId: string;
  title: string;
  testLength: string;
  installedOn: string;
  wattStart: string;
  wattEnd: string;
  updatedAt: string;
  /** Spots with a detector scanned, out of all the spots added. */
  scanned: number;
  spots: number;
  /** Scanned detectors not yet in a report. */
  unreported: string[];
}

function parse(data: string): Installation {
  return InstallationSchema.parse(JSON.parse(data));
}

export function loadInstallation(id: string): Installation | null {
  const row = db().prepare('SELECT data FROM radon_installations WHERE id = ?').get(id) as
    | { data: string }
    | undefined;
  return row ? parse(row.data) : null;
}

export function listInstallations(): InstallationSummary[] {
  const rows = db()
    .prepare('SELECT id, data, updated_at FROM radon_installations ORDER BY updated_at DESC')
    .all() as Array<{ id: string; data: string; updated_at: string }>;

  return rows.map((row) => {
    const installation = parse(row.data);
    const spots = installationSpots(installation);
    return {
      id: row.id,
      customerId: installation.customerId,
      title: customerNameOf(installation),
      testLength: installation.testLength,
      installedOn: installation.installedOn,
      wattStart: installation.wattStart,
      wattEnd: installation.wattEnd,
      updatedAt: row.updated_at,
      scanned: spots.filter((spot) => spot.detectorNumber !== '').length,
      spots: spots.length,
      unreported: listInstallationDetectors(row.id)
        .filter((detector) => detector.reportId === '')
        .map((detector) => detector.detectorNumber),
    };
  });
}

/** A new installation, already filled in when started from a customer's card. */
export function createInstallation(customerId?: string): string {
  const id = randomUUID();
  const timestamp = now();
  const customer = customerId ? loadCustomer(customerId) : null;
  const blank = InstallationSchema.parse({
    ...(customer ? recipientOf(customer) : {}),
    installedOn: israelNow().slice(0, 10),
  });
  db()
    .prepare('INSERT INTO radon_installations (id, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, '', JSON.stringify(blank), timestamp, timestamp);
  return id;
}

export function saveInstallation(id: string, installation: Installation): void {
  const result = db()
    .prepare('UPDATE radon_installations SET title = ?, data = ?, updated_at = ? WHERE id = ?')
    .run(customerNameOf(installation), JSON.stringify(installation), now(), id);
  if (result.changes === 0) throw new Error(`התקנה ${id} לא נמצאה`);
  syncDetectors(id, installation);
}

export function deleteInstallation(id: string): void {
  const handle = db();
  handle.prepare('DELETE FROM radon_installations WHERE id = ?').run(id);
  // A detector already in a report keeps its record; the rest go back to being unused.
  handle.prepare(`DELETE FROM radon_detectors WHERE installation_id = ? AND report_id = ''`).run(id);
  handle.prepare(`UPDATE radon_detectors SET installation_id = '' WHERE installation_id = ?`).run(id);
}

/**
 * Makes the detector list say what the installation says.
 *
 * The whole installation arrives with every autosave, so this is what removes a detector
 * whose room was deleted and what carries a corrected room name or a changed customer.
 * It also re-adds a number an older save removed, since saves can overtake a scan.
 *
 * A number held by another customer or installation is left alone. The scan refuses those,
 * so one here can only be a stale copy of the installation.
 */
function syncDetectors(id: string, installation: Installation): void {
  const handle = db();
  const spots = installationSpots(installation).filter((spot) => spot.detectorNumber !== '');
  const wanted = new Set(spots.map((spot) => spot.detectorNumber));
  const placedAt = placementDate(installation.installedOn);
  const collectedAt = placementDate(installationEnd(installation.testLength, installation.installedOn));
  const { testLength } = installation;

  const find = handle.prepare('SELECT * FROM radon_detectors WHERE detector_number = ?');
  const insert = handle.prepare(
    `INSERT INTO radon_detectors
       (detector_number, customer_id, assigned_at, installation_id, room_name, floor, placed_at, collected_at, test_length)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = handle.prepare(
    `UPDATE radon_detectors
        SET customer_id = ?, installation_id = ?, room_name = ?, floor = ?, placed_at = ?, collected_at = ?, test_length = ?
      WHERE detector_number = ?`,
  );
  const remove = handle.prepare(`DELETE FROM radon_detectors WHERE detector_number = ? AND report_id = ''`);

  handle.exec('BEGIN');
  try {
    for (const detector of listInstallationDetectors(id)) {
      if (!wanted.has(detector.detectorNumber)) remove.run(detector.detectorNumber);
    }
    if (installation.customerId) {
      for (const spot of spots) {
        const row = find.get(spot.detectorNumber) as Record<string, unknown> | undefined;
        const existing = row ? toDetector(row) : null;
        if (!existing) {
          insert.run(
            spot.detectorNumber,
            installation.customerId,
            now(),
            id,
            spot.roomName,
            spot.floor,
            placedAt,
            collectedAt,
            testLength,
          );
        } else if (mayPlace(existing, id, installation.customerId) && existing.reportId === '') {
          update.run(
            installation.customerId,
            id,
            spot.roomName,
            spot.floor,
            placedAt,
            collectedAt,
            testLength,
            spot.detectorNumber,
          );
        }
      }
    }
    handle.exec('COMMIT');
  } catch (err) {
    handle.exec('ROLLBACK');
    throw err;
  }
}

/** Already this installation's, or scanned onto this customer and not yet placed anywhere. */
function mayPlace(detector: AssignedDetector, installationId: string, customerId: string): boolean {
  if (detector.installationId === installationId) return true;
  return detector.installationId === '' && detector.customerId === customerId;
}

export type ClaimResult = { ok: true; detectorNumber: string } | { ok: false; message: string };

/**
 * Reserves a scanned number for this installation, or says who already holds it.
 *
 * A CR-39 detector is developed once, so a number that is already out is a wrong scan or
 * a wrong record. Either way the person holding the detector is the one who can tell.
 */
export function claimDetector(id: string, customerId: string, raw: string): ClaimResult {
  if (!customerId) return { ok: false, message: 'יש לבחור לקוח בשלב הראשון לפני הסריקה.' };
  const key = detectorKey(raw);
  if (!isDetectorKey(key)) return { ok: false, message: `"${raw}" אינו מספר גלאי.` };

  const handle = db();
  const row = handle.prepare('SELECT * FROM radon_detectors WHERE detector_number = ?').get(key) as
    | Record<string, unknown>
    | undefined;

  if (!row) {
    handle
      .prepare(
        'INSERT INTO radon_detectors (detector_number, customer_id, assigned_at, installation_id) VALUES (?, ?, ?, ?)',
      )
      .run(key, customerId, now(), id);
    return { ok: true, detectorNumber: key };
  }

  const existing = toDetector(row);
  if (mayPlace(existing, id, customerId)) return { ok: true, detectorNumber: key };

  if (existing.customerId === customerId) {
    return { ok: false, message: `גלאי ${key} כבר רשום בהתקנה אחרת של הלקוח.` };
  }
  const other = loadCustomer(existing.customerId);
  return {
    ok: false,
    message: `גלאי ${key} כבר משויך ללקוח אחר: ${other ? customerLabel(other) : existing.customerId}.`,
  };
}

/** Drafts a report from this installation's detectors that are not in one yet. */
export function createReportFromInstallation(id: string, readings: Map<string, StoredReading>): string {
  const installation = loadInstallation(id);
  if (!installation) throw new Error(`התקנה ${id} לא נמצאה`);

  // In the order they were installed, which is how the surveyor walked the building.
  const order = installationSpots(installation).map((spot) => spot.detectorNumber);
  const detectors = listInstallationDetectors(id)
    .filter((detector) => detector.reportId === '')
    .sort((a, b) => order.indexOf(a.detectorNumber) - order.indexOf(b.detectorNumber));

  return createDraftReport(installation, detectors, readings, printedAnswers(installation.answers));
}
