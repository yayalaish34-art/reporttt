import { db } from './db';

/**
 * Stops a save from deleting photographs the report already has.
 *
 * Every save sends the whole report from the browser, captions and photo list
 * included, and the server stored it verbatim. That is fine while the browser's
 * copy is current and silently destructive when it is not — and it stops being
 * current more often than it looks:
 *
 *  - A photograph uploads and the editor re-renders, but a save already in flight
 *    is carrying the list from before it.
 *  - A component was handed `report` as a prop and holds the value from the render
 *    it was created in.
 *  - The upload succeeded on the server and its result never reached the state,
 *    because the connection dropped on the way back.
 *
 * In each case the next save writes a photo list that is missing a picture the
 * database is still holding, and the picture disappears from the report. The
 * surveyor sees photographs they took vanish from a table they had already filled
 * in — which is exactly how it was reported.
 *
 * So the rows are the truth about *which photographs exist*, and the browser is
 * the truth about *what they are called*. A save may caption, reorder and delete
 * deliberately; it may not drop a photograph by omission. Anything stored but not
 * mentioned is appended back.
 */

export interface PhotoRef {
  imageId: string;
  caption: string;
}

/**
 * The incoming list, with any stored photograph it forgot added back.
 *
 * `table` is the photo table for this kind of report — `photos` keyed by
 * `report_id`, `asbestos_photos`, `mold_photos` or `iaq_photos`.
 */
export function keepStoredPhotos(
  table: 'photos' | 'asbestos_photos' | 'mold_photos' | 'iaq_photos',
  reportId: string,
  incoming: PhotoRef[],
  /**
   * Photographs held somewhere other than this list, and so not missing at all.
   *
   * The tabled asbestos opinion keeps each building's pictures on the building and
   * only the appendix's own in `report.photos`. Without this the building's pictures
   * look forgotten on every save and are appended back into the appendix — which
   * prints each of them twice, once after its own table and once at the end.
   */
  alsoHeld: readonly PhotoRef[] = [],
): PhotoRef[] {
  let stored: Array<{ id: string }>;
  try {
    stored = db()
      .prepare(`SELECT id FROM ${table} WHERE report_id = ? ORDER BY created_at`)
      .all(reportId) as Array<{ id: string }>;
  } catch {
    // No table yet, or a database that will not answer: the save must still happen.
    return incoming;
  }

  if (stored.length === 0) return incoming;

  const mentioned = new Set([...incoming, ...alsoHeld].map((p) => p.imageId));
  const missing = stored.filter((row) => !mentioned.has(row.id));
  if (missing.length === 0) return incoming;

  console.warn(
    `דוח ${reportId}: ${missing.length} תמונות שמורות לא הופיעו בשמירה — הוחזרו`,
  );

  // Appended in the order they were uploaded, and uncaptioned: the caption belongs
  // to the browser, and inventing one here would put a wrong label in the document.
  // Better an empty caption the surveyor can see and fill than a lost photograph.
  return [...incoming, ...missing.map((row) => ({ imageId: row.id, caption: '' }))];
}

/**
 * Deletes a photograph's row.
 *
 * Deliberate removal has to be a real delete rather than an omission from a save,
 * precisely because omissions are no longer honoured. Both editors already call
 * their own remove action, which is what this backs.
 */
export function photoExists(
  table: 'photos' | 'asbestos_photos' | 'mold_photos',
  imageId: string,
): boolean {
  try {
    return Boolean(db().prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(imageId));
  } catch {
    return false;
  }
}
