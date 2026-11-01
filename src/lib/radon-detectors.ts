import { db, now } from './db';
import { customerLabel, loadCustomer, type Customer } from './customer-service';
import { createRadonReport, nextRadonReference } from './radon-service';
import { detectorKey, implausibleUncertainty, isDetectorKey, newDetectorRow } from './radon-rules';
import { RadonReportSchema, type DetectorRow, type RadonReport } from './radon-schema';
import type { StoredReading } from './radon-readings-store';

/**
 * Which detectors went out to which customer.
 *
 * The detectors are scanned when they go out and the laboratory answers months later,
 * so this list is what connects the two: the numbers on it are looked up in the
 * laboratory's readings, and together they draft the customer's report.
 */

export interface AssignedDetector {
  detectorNumber: string;
  customerId: string;
  /** The report this detector was drafted into, empty until then. */
  reportId: string;
  assignedAt: string;
}

export interface AssignOutcome {
  added: string[];
  /** Already on this customer's list, which is what a double scan looks like. */
  alreadyHere: string[];
  /** On another customer's list, and left there: the person scanning has to look. */
  elsewhere: Array<{ detectorNumber: string; customerName: string }>;
  /** Scans that do not look like a detector number. */
  invalid: string[];
}

export function listCustomerDetectors(customerId: string): AssignedDetector[] {
  const rows = db()
    .prepare(
      `SELECT detector_number, customer_id, report_id, assigned_at
         FROM radon_detectors WHERE customer_id = ?
        ORDER BY CAST(detector_number AS INTEGER)`,
    )
    .all(customerId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    detectorNumber: String(row.detector_number),
    customerId: String(row.customer_id),
    reportId: String(row.report_id ?? ''),
    assignedAt: String(row.assigned_at),
  }));
}

/**
 * Adds detectors to a customer's list.
 *
 * A number that cannot be added does not stop the others: most of a series is still
 * right when one detector in it is taken, and the outcome names the exceptions.
 */
export function assignDetectors(customerId: string, numbers: string[]): AssignOutcome {
  const outcome: AssignOutcome = { added: [], alreadyHere: [], elsewhere: [], invalid: [] };
  if (!loadCustomer(customerId)) throw new Error(`לקוח ${customerId} לא נמצא`);

  const handle = db();
  const owner = handle.prepare('SELECT customer_id FROM radon_detectors WHERE detector_number = ?');
  const insert = handle.prepare(
    'INSERT INTO radon_detectors (detector_number, customer_id, assigned_at) VALUES (?, ?, ?)',
  );
  const timestamp = now();

  handle.exec('BEGIN');
  try {
    for (const raw of numbers) {
      const key = detectorKey(raw);
      if (!isDetectorKey(key)) {
        outcome.invalid.push(raw);
        continue;
      }
      const existing = owner.get(key) as { customer_id: string } | undefined;
      if (!existing) {
        insert.run(key, customerId, timestamp);
        outcome.added.push(key);
      } else if (existing.customer_id === customerId) {
        outcome.alreadyHere.push(key);
      } else {
        const other = loadCustomer(existing.customer_id);
        outcome.elsewhere.push({
          detectorNumber: key,
          customerName: other ? customerLabel(other) : existing.customer_id,
        });
      }
    }
    handle.exec('COMMIT');
  } catch (err) {
    handle.exec('ROLLBACK');
    throw err;
  }
  return outcome;
}

/** Takes detectors off a customer's list. One already in a report stays where it is. */
export function releaseDetectors(customerId: string, numbers: string[]): void {
  const remove = db().prepare(
    `DELETE FROM radon_detectors WHERE customer_id = ? AND detector_number = ? AND report_id = ''`,
  );
  for (const number of numbers) remove.run(customerId, detectorKey(number));
}

/**
 * The radon report these detectors produce, as a draft.
 *
 * The site kind follows the customer because it sets the action level: a private home
 * is held to 200, and the blank report's default of "workplace" would judge it against
 * 500 without anyone having chosen that.
 *
 * A reading whose uncertainty is too wide stays out of the row. The editor looks these
 * rows up as it opens and asks the surveyor for a figure, as it does for a typed number.
 */
export function draftReportFromDetectors(
  customer: Customer,
  numbers: string[],
  readings: Map<string, StoredReading>,
  reference: string,
): RadonReport {
  const isCompany = customer.kind === 'company';
  const base = RadonReportSchema.parse({
    referenceNumber: reference,
    reportDate: new Date().toISOString().slice(0, 10),
    customerId: customer.id,
    customerType: customer.kind,
    recipientName: customer.contactName || '—',
    companyName: isCompany ? customer.companyName : '',
    addressLine: customer.addressLine,
    city: customer.city,
    phone: customer.phone,
    email: customer.email,
    siteKind: isCompany ? 'מקום עבודה' : 'מגורים',
    detectors: [],
  });

  const detectors = numbers.map((detectorNumber): DetectorRow => {
    const row = { ...newDetectorRow(base), detectorNumber };
    const reading = readings.get(detectorNumber);
    if (!reading || reading.concentration.trim() === '' || implausibleUncertainty(reading.uncertainty)) {
      return row;
    }
    return { ...row, concentration: reading.concentration, uncertainty: reading.uncertainty };
  });

  return { ...base, detectors };
}

/**
 * Drafts a report from the customer's detectors that are not in one yet.
 *
 * Marking them is what makes a second press safe: it finds nothing left to draft rather
 * than producing a second report for the same detectors.
 */
export function createReportFromDetectors(
  customerId: string,
  readings: Map<string, StoredReading>,
): string {
  const customer = loadCustomer(customerId);
  if (!customer) throw new Error(`לקוח ${customerId} לא נמצא`);

  const numbers = listCustomerDetectors(customerId)
    .filter((detector) => detector.reportId === '')
    .map((detector) => detector.detectorNumber);
  if (numbers.length === 0) throw new Error('אין גלאים שעדיין לא נכללו בדוח.');

  const id = createRadonReport(draftReportFromDetectors(customer, numbers, readings, nextRadonReference()));

  const link = db().prepare('UPDATE radon_detectors SET report_id = ? WHERE detector_number = ?');
  for (const number of numbers) link.run(id, number);
  return id;
}
