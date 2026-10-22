import { randomUUID } from 'node:crypto';
import { db, now } from './db';

/**
 * The signature library.
 *
 * A signature belongs to a person, not to a report, and the same few people
 * sign every survey the company issues. Keeping them here means a report picks
 * a signature rather than carrying one, which is what stops the template from
 * stamping one person's mark on everybody's row.
 */

export interface SignatureRecord {
  id: string;
  /** Whose signature it is. */
  label: string;
  contentType: string;
  width: number;
  height: number;
  createdAt: string;
}

export interface SignatureImage extends SignatureRecord {
  bytes: Buffer;
}

const COLUMNS = 'id, label, content_type, width, height, created_at';

/** Every signature on file, oldest first so the order stays stable in menus. */
export function listSignatures(): SignatureRecord[] {
  const rows = db()
    .prepare(`SELECT ${COLUMNS} FROM signatures ORDER BY created_at, label`)
    .all() as Array<Record<string, unknown>>;
  return rows.map(toRecord);
}

/** One signature with its bytes, for injecting into a document or previewing. */
export function loadSignature(id: string): SignatureImage | null {
  const row = db().prepare(`SELECT ${COLUMNS}, bytes FROM signatures WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return { ...toRecord(row), bytes: Buffer.from(row.bytes as Uint8Array) };
}

export function createSignature(
  label: string,
  bytes: Buffer,
  contentType: string,
  width: number,
  height: number,
): SignatureRecord {
  const id = randomUUID();
  db()
    .prepare(
      'INSERT INTO signatures (id, label, bytes, content_type, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, label, bytes, contentType, width, height, now());
  return listSignatures().find((s) => s.id === id)!;
}

export function renameSignature(id: string, label: string): void {
  const result = db().prepare('UPDATE signatures SET label = ? WHERE id = ?').run(label, id);
  if (result.changes === 0) throw new Error(`חתימה ${id} לא נמצאה`);
}

export function deleteSignature(id: string): void {
  db().prepare('DELETE FROM signatures WHERE id = ?').run(id);
}

/** Finds a signature by the name on it, used when seeding. */
export function findSignatureByLabel(label: string): SignatureRecord | null {
  const row = db().prepare(`SELECT ${COLUMNS} FROM signatures WHERE label = ? LIMIT 1`).get(label) as
    | Record<string, unknown>
    | undefined;
  return row ? toRecord(row) : null;
}

function toRecord(row: Record<string, unknown>): SignatureRecord {
  return {
    id: String(row.id),
    label: String(row.label),
    contentType: String(row.content_type),
    width: Number(row.width),
    height: Number(row.height),
    createdAt: String(row.created_at),
  };
}

/**
 * Best signature for a person, used when pre-filling a new report.
 *
 * The library labels signatures by name and role — "יורם גבאי — מאשר" — because
 * the source document held two separate scans of the same person's signature,
 * one per table. A `prefer` hint picks between them; failing that, any
 * signature bearing the person's name is used.
 *
 * This is a convenience for seeding only. Whoever writes the report picks the
 * signature explicitly in the editor, and that choice is what is stored.
 */
export function matchSignature(personName: string, prefer?: string): string {
  const name = personName.trim();
  if (name === '') return '';

  const byName = listSignatures().filter((s) => s.label.startsWith(name));
  if (byName.length === 0) return '';

  if (prefer) {
    const preferred = byName.find((s) => s.label.includes(prefer));
    if (preferred) return preferred.id;
  }
  return byName[0].id;
}
