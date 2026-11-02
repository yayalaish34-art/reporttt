import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PizZip from 'pizzip';
import { db, now } from '../db';

/**
 * Storage for the Word template.
 *
 * The database is the only source of truth. The file under `templates/` is a
 * build artefact used to seed it once — not a runtime fallback. Keeping two
 * live copies of the same template is a standing invitation to the bug where a
 * fix is applied to one and the other is what actually renders.
 *
 * The practical payoff: the wording of the report can be changed by uploading a
 * new template, with no deploy.
 */

/**
 * Which survey a template belongs to.
 *
 * Three reports, three templates, all active at once. Every function here takes
 * a kind and defaults to radiation, which is what every existing caller means.
 */
export type TemplateKind =
  | 'radiation'
  | 'radon'
  | 'asbestos'
  | 'asbestos-tables'
  | 'mold'
  | 'iaq';

export const TEMPLATE_KINDS: Record<TemplateKind, { label: string; bundled: string }> = {
  radiation: { label: 'דוח קרינה', bundled: 'templates/report-template.docx' },
  radon: { label: 'דוח ראדון', bundled: 'templates/radon-template.docx' },
  // No file ships for this one yet: the asbestos template is uploaded through
  // the templates screen. `ensureSeeded` simply finds nothing and leaves the
  // kind empty, which is what puts the "no active template" notice on screen —
  // the same state radon was in before its own template existed.
  asbestos: { label: 'דוח אסבסט', bundled: 'templates/asbestos-template.docx' },
  /**
   * The tabled asbestos opinion — a fifteen-row table per building.
   *
   * A separate kind rather than a variant of the one above, because they are separate
   * documents: different tables, different loops, different closing sections. Which one
   * renders is the report's own `layout`, chosen when it is created.
   */
  'asbestos-tables': {
    label: 'דוח אסבסט עם טבלאות',
    bundled: 'templates/asbestos-tables-template.docx',
  },
  /**
   * The mould report — דו"ח בדיקת עובשים באוויר.
   *
   * A fourth department. Its template is built from Galit's own signed report by
   * `scripts/build-mold-template.ts`, the same route the asbestos one took.
   */
  mold: { label: 'דוח עובשים', bundled: 'templates/mold-template.docx' },
  /**
   * The indoor-air-quality report — דו"ח בדיקת איכות אוויר תוך-מבנית.
   *
   * A fifth department. The template ships alongside the others; its docxtemplater
   * tags are defined in `src/lib/iaq-mapper.ts`.
   */
  iaq: { label: 'דוח איכות אוויר', bundled: 'templates/iaq-template.docx' },
};

export interface TemplateRecord {
  id: number;
  kind: TemplateKind;
  name: string;
  size: number;
  sha256: string;
  note: string;
  uploadedAt: string;
  isActive: boolean;
}

/** Thrown when a merge is attempted before any template has been stored. */
export class NoTemplateError extends Error {
  constructor(kind: TemplateKind = 'radiation') {
    super(`לא הוגדרה תבנית פעילה ל${TEMPLATE_KINDS[kind].label}. העלה תבנית דרך מסך התבניות.`);
    this.name = 'NoTemplateError';
  }
}

/** The bytes of the active template. */
export function activeTemplateBytes(kind: TemplateKind = 'radiation'): Buffer {
  ensureSeeded(kind);
  const row = db()
    .prepare('SELECT bytes FROM templates WHERE is_active = 1 AND kind = ? LIMIT 1')
    .get(kind) as { bytes: Uint8Array } | undefined;
  if (!row) throw new NoTemplateError(kind);
  return Buffer.from(row.bytes);
}

/**
 * Loads the built template on first use if the database has none.
 *
 * A deployment starts with an empty volume, and an app whose very first action
 * fails with "no template" is indistinguishable from a broken one. The file
 * ships in the image, so the first request can seed itself.
 *
 * This does not make the file a second source of truth: it is consulted only
 * when the database is empty, and an uploaded template takes over from then on.
 */
function ensureSeeded(kind: TemplateKind = 'radiation'): void {
  const existing = db()
    .prepare('SELECT COUNT(*) AS n FROM templates WHERE kind = ?')
    .get(kind) as { n: number };
  if (Number(existing.n) > 0) {
    upgradeLegacyIaqTemplate(kind);
    upgradeBundledMoldTemplate(kind);
    upgradeBundledRadonTemplate(kind);
    return;
  }

  const relative = TEMPLATE_KINDS[kind].bundled;
  const bundled = resolve(process.cwd(), relative);
  if (!existsSync(bundled)) return;

  try {
    storeTemplate(readFileSync(bundled), relative.split('/').pop()!, 'נטענה אוטומטית בהפעלה הראשונה', kind);
    console.log(`תבנית ${kind} נטענה אוטומטית מהתמונה`);
  } catch (err) {
    console.error(`טעינת תבנית ${kind} האוטומטית נכשלה`, err);
  }
}

/**
 * The first IAQ implementation shipped a 5KB document assembled from raw XML.
 * It is precisely the template that lost the customer's RTL design. Replace only
 * that known shape (under 20KB) with the bundled source-derived template; a real
 * template uploaded by a user is never overwritten.
 */
function upgradeLegacyIaqTemplate(kind: TemplateKind): void {
  if (kind !== 'iaq') return;
  const active = db()
    .prepare('SELECT size FROM templates WHERE kind = ? AND is_active = 1 LIMIT 1')
    .get(kind) as { size: number } | undefined;
  if (!active || Number(active.size) >= 20_000) return;

  const bundled = resolve(process.cwd(), TEMPLATE_KINDS.iaq.bundled);
  if (!existsSync(bundled)) return;
  const bytes = readFileSync(bundled);
  if (bytes.length < 100_000) return; // A failed build must not replace a working fallback.

  storeTemplate(
    bytes,
    'iaq-template.docx',
    'שדרוג אוטומטי: התבנית המקורית של גלית עם RTL ועיצוב מלא',
    'iaq',
  );
  console.log('תבנית איכות האוויר הישנה הוחלפה בתבנית המקורית של גלית');
}

/**
 * Mould templates that shipped in the image and were seeded as-is.
 *
 * The bundled template moved the photo appendix ahead of the Hayes sheets and renamed
 * §1's "מיקום" to "כתובת". A database still running an earlier bundled file is
 * upgraded to the current one; a template somebody uploaded has a different hash and
 * is never touched.
 */
const SUPERSEDED_MOLD_TEMPLATES = new Set([
  '7011ef6ef907e861e92ecee8d97bc1d56c448811f2ec7197c9516456d04b6675',
  // Before "שעת הדיגום" printed beside the sampling date.
  '2e2e3658c9313fcda6a7bbd52624adb952c1c920c084598ee4b270300b2098b0',
]);

function upgradeBundledMoldTemplate(kind: TemplateKind): void {
  if (kind !== 'mold') return;
  const active = db()
    .prepare('SELECT sha256 FROM templates WHERE kind = ? AND is_active = 1 LIMIT 1')
    .get(kind) as { sha256: string } | undefined;
  if (!active || !SUPERSEDED_MOLD_TEMPLATES.has(String(active.sha256))) return;

  const bundled = resolve(process.cwd(), TEMPLATE_KINDS.mold.bundled);
  if (!existsSync(bundled)) return;
  const bytes = readFileSync(bundled);
  if (SUPERSEDED_MOLD_TEMPLATES.has(createHash('sha256').update(bytes).digest('hex'))) return;

  storeTemplate(
    bytes,
    'mold-template.docx',
    'שדרוג אוטומטי לתבנית המצורפת (נספחים, ״כתובת״, שעת הדיגום)',
    'mold',
  );
  console.log('תבנית העובשים עודכנה לגרסה המצורפת');
}

/**
 * Radon templates that shipped in the image and were seeded as-is.
 *
 * Their notes table printed fixed answers. A database still running one is upgraded to
 * the bundled file, whose table prints what was asked at the installation; a template
 * somebody uploaded has a different hash and is never touched.
 */
const SUPERSEDED_RADON_TEMPLATES = new Set([
  'c5ffb3f3b87cf34328219da32ac04cd84e4f369a9e790c594d3e6fb119d95489',
  // Before the notes table asked whether the room is sealed.
  '671f723d5d9b3570750d78f06d0911520dc73a6194ea866c7dcff53f11d0942f',
]);

function upgradeBundledRadonTemplate(kind: TemplateKind): void {
  if (kind !== 'radon') return;
  const active = db()
    .prepare('SELECT sha256 FROM templates WHERE kind = ? AND is_active = 1 LIMIT 1')
    .get(kind) as { sha256: string } | undefined;
  if (!active || !SUPERSEDED_RADON_TEMPLATES.has(String(active.sha256))) return;

  const bundled = resolve(process.cwd(), TEMPLATE_KINDS.radon.bundled);
  if (!existsSync(bundled)) return;
  const bytes = readFileSync(bundled);
  if (SUPERSEDED_RADON_TEMPLATES.has(createHash('sha256').update(bytes).digest('hex'))) return;

  storeTemplate(bytes, 'radon-template.docx', 'שדרוג אוטומטי: תשובות טבלת ההערות מהשאלון', 'radon');
  console.log('תבנית הראדון עודכנה לגרסה המצורפת');
}

/**
 * The bytes of a specific stored template, for downloading it to edit.
 *
 * Editing starts from the stored template rather than from the file on disk:
 * the database is the source of truth, and the two can differ once someone has
 * uploaded a revision without rebuilding.
 */
export function templateBytes(id: number): { bytes: Buffer; name: string } | null {
  const row = db()
    .prepare('SELECT bytes, name FROM templates WHERE id = ?')
    .get(id) as { bytes: Uint8Array; name: string } | undefined;
  return row ? { bytes: Buffer.from(row.bytes), name: row.name } : null;
}

const COLUMNS = 'id, kind, name, size, sha256, note, uploaded_at, is_active';

/** Metadata for the active template, or null when none has been stored. */
export function activeTemplate(kind: TemplateKind = 'radiation'): TemplateRecord | null {
  ensureSeeded(kind);
  const row = db()
    .prepare(`SELECT ${COLUMNS} FROM templates WHERE is_active = 1 AND kind = ? LIMIT 1`)
    .get(kind) as Record<string, unknown> | undefined;
  return row ? toRecord(row) : null;
}

/** Every stored template of a kind, newest first — the upload history. */
export function listTemplates(kind: TemplateKind = 'radiation'): TemplateRecord[] {
  const rows = db()
    .prepare(`SELECT ${COLUMNS} FROM templates WHERE kind = ? ORDER BY id DESC`)
    .all(kind) as Array<Record<string, unknown>>;
  return rows.map(toRecord);
}

/**
 * Stores a template and makes it the active one.
 *
 * The previous template is kept, so a bad upload can be rolled back by
 * activating the one before it.
 */
export function storeTemplate(
  bytes: Buffer,
  name: string,
  note = '',
  kind: TemplateKind = 'radiation',
): TemplateRecord {
  validateTemplate(bytes);

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const handle = db();

  handle.exec('BEGIN');
  try {
    // Only this kind is deactivated — the other survey's template stays live.
    handle.prepare('UPDATE templates SET is_active = 0 WHERE is_active = 1 AND kind = ?').run(kind);
    handle
      .prepare(
        `INSERT INTO templates (kind, name, bytes, size, sha256, note, uploaded_at, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(kind, name, bytes, bytes.length, sha256, note, now());
    handle.exec('COMMIT');
  } catch (err) {
    handle.exec('ROLLBACK');
    throw err;
  }

  const stored = activeTemplate(kind);
  if (!stored) throw new Error('התבנית נשמרה אך לא סומנה כפעילה');
  return stored;
}

/** Makes a previously uploaded template active again, within its own kind. */
export function activateTemplate(id: number): TemplateRecord {
  const handle = db();
  const existing = handle.prepare('SELECT kind FROM templates WHERE id = ?').get(id) as
    | { kind: string }
    | undefined;
  if (!existing) throw new Error(`תבנית ${id} לא נמצאה`);
  const kind = (existing.kind || 'radiation') as TemplateKind;

  handle.exec('BEGIN');
  try {
    handle.prepare('UPDATE templates SET is_active = 0 WHERE is_active = 1 AND kind = ?').run(kind);
    handle.prepare('UPDATE templates SET is_active = 1 WHERE id = ?').run(id);
    handle.exec('COMMIT');
  } catch (err) {
    handle.exec('ROLLBACK');
    throw err;
  }

  return activeTemplate(kind)!;
}

/**
 * Rejects anything that is not a readable .docx before it reaches the database.
 *
 * Catching this at upload time turns a confusing render failure — hit once per
 * report, by whoever is generating it — into an immediate, specific message for
 * whoever uploaded the wrong file.
 */
function validateTemplate(bytes: Buffer): void {
  let zip: PizZip;
  try {
    zip = new PizZip(bytes);
  } catch {
    throw new Error('הקובץ אינו ארכיון תקין. ודא שזהו קובץ .docx ולא .doc');
  }

  if (!zip.file('word/document.xml')) {
    throw new Error('הארכיון אינו מסמך Word — word/document.xml חסר');
  }
  if (!zip.file('[Content_Types].xml')) {
    throw new Error('הארכיון פגום — [Content_Types].xml חסר');
  }
}

function toRecord(row: Record<string, unknown>): TemplateRecord {
  return {
    id: Number(row.id),
    kind: (String(row.kind || 'radiation') as TemplateKind),
    name: String(row.name),
    size: Number(row.size),
    sha256: String(row.sha256),
    note: String(row.note ?? ''),
    uploadedAt: String(row.uploaded_at),
    isActive: Number(row.is_active) === 1,
  };
}
