import { randomUUID } from 'node:crypto';
import PizZip from 'pizzip';
import { db, now } from './db';
import { mergeDocx } from './docx/merge-docx';
import { activeTemplateBytes } from './docx/template-store';
import { buildPhotosXml, type PhotoInput } from './docx/photos';
import { textOf } from './docx/ooxml';
import { buildMoldMergeData, moldFileName, moldSubject } from './mold-mapper';
import { draftMoldReport } from './mold-draft';
import { photosInRoomOrder, realSamples } from './mold-rules';
import { storedReportTitle } from './report-title';
import { nextPersonalReference } from './crm-filing';
import {
  DraftMoldReportSchema,
  type DraftMoldReport,
  type MoldReport,
} from './mold-schema';

/**
 * Mould report persistence and generation.
 *
 * A fourth table and a fourth template, sharing the machinery underneath: the same
 * merge, the same photo appendix, the same customer directory. Four surveys, one
 * set of moving parts.
 */

export interface MoldSummaryRow {
  id: string;
  reference: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sampleCount: number;
  photoCount: number;
}

export function listMoldReports(): MoldSummaryRow[] {
  const rows = db()
    .prepare(
      `SELECT id, reference, title, data, created_at, updated_at
         FROM mold_reports ORDER BY updated_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => {
    let sampleCount = 0;
    let photoCount = 0;
    try {
      const parsed = DraftMoldReportSchema.parse(JSON.parse(String(row.data)));
      sampleCount = realSamples(parsed).length;
      photoCount = parsed.photos.length;
    } catch {
      /* a row that will not parse still belongs in the list, just without counts */
    }
    return {
      id: String(row.id),
      reference: String(row.reference),
      title: storedReportTitle('mold', row.data, row.title),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      sampleCount,
      photoCount,
    };
  });
}

export function loadMoldReport(id: string): MoldReport | null {
  const row = db().prepare('SELECT data FROM mold_reports WHERE id = ?').get(id) as
    | { data: string }
    | undefined;
  if (!row) return null;
  return DraftMoldReportSchema.parse(JSON.parse(row.data));
}

/**
 * The next reference number, in the other reports' format.
 *
 * `YYMMDD` then a serial within the day, counted over the mould table alone — see
 * `nextRadonReference` for why the kinds do not share a counter.
 */
export function nextMoldReference(today = new Date()): string {
  const prefix =
    String(today.getFullYear()).slice(2) +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');

  const rows = db()
    .prepare('SELECT reference FROM mold_reports WHERE reference LIKE ?')
    .all(`${prefix}%`) as Array<{ reference: string }>;

  let highest = 0;
  for (const row of rows) {
    const serial = Number(String(row.reference).slice(prefix.length));
    if (Number.isFinite(serial)) highest = Math.max(highest, serial);
  }
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

/**
 * Who §1 names as "עורך הדוח" — one of `MOLD_STAFF` — printed as free text
 * (`authorName`). The CRM does not know this table, so this is the one place
 * that recognises Yoram by name rather than by an account.
 */
const PERSONAL_REFERENCE_AUTHOR = 'יורם גבאי';
const PERSONAL_REFERENCE_EMAIL = 'yoram@galit.co.il';

/** True once a reference is already in the personal SS+DDMMYY shape (8 digits). */
function isPersonalReference(reference: string): boolean {
  return /^\d{8}$/.test(reference.trim());
}

/**
 * Swaps the reference for Yoram's personal daily one (`01160926` — serial 01,
 * 16/09/26) the first time a report is saved with him as the author.
 *
 * The reference is normally handed out once, at `blankMoldReport()`, before
 * the author is ever chosen — so a report only becomes his after the fact,
 * on whichever save first names him. Once swapped it stays swapped: the
 * check is on the reference's own shape, not on who's named now, so a later
 * change of author does not recycle or reissue the number. The counter lives
 * in the CRM, shared with quotes there, so the two never collide on the same
 * day — see `nextPersonalReference`.
 *
 * Falls back to the reference already on the report if the CRM call fails;
 * the next save tries again.
 */
export async function upgradeToPersonalMoldReference(
  reference: string,
  authorName: string,
): Promise<string> {
  if (authorName.trim() !== PERSONAL_REFERENCE_AUTHOR) return reference;
  if (isPersonalReference(reference)) return reference;
  try {
    return await nextPersonalReference(PERSONAL_REFERENCE_EMAIL);
  } catch {
    return reference;
  }
}

export function createMoldReport(report: MoldReport): string {
  const id = randomUUID();
  const timestamp = now();
  db()
    .prepare(
      `INSERT INTO mold_reports (id, reference, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      report.referenceNumber,
      moldSubject(report),
      JSON.stringify(report),
      timestamp,
      timestamp,
    );
  return id;
}

/**
 * Overwrites a mould report. Takes a draft: the autosave stores what is on screen
 * between steps, and this report is legitimately incomplete for longer than any of
 * the others — the site visit happens days before the laboratory answers.
 */
export function saveMoldReport(id: string, report: DraftMoldReport): void {
  const result = db()
    .prepare(
      'UPDATE mold_reports SET reference = ?, title = ?, data = ?, updated_at = ? WHERE id = ?',
    )
    .run(
      report.referenceNumber,
      moldSubject(report as MoldReport),
      JSON.stringify(report),
      now(),
      id,
    );
  if (result.changes === 0) throw new Error(`דוח עובשים ${id} לא נמצא`);
}

export function deleteMoldReport(id: string): void {
  db().prepare('DELETE FROM mold_reports WHERE id = ?').run(id);
}

// ── Photos ──────────────────────────────────────────────────────────

/** Stores an uploaded photograph and returns its id. */
export function addMoldPhoto(
  reportId: string,
  bytes: Buffer,
  contentType: string,
  width: number,
  height: number,
): string {
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO mold_photos (id, report_id, bytes, content_type, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, reportId, bytes, contentType, width, height, now());
  return id;
}

export function deleteMoldPhoto(id: string): void {
  db().prepare('DELETE FROM mold_photos WHERE id = ?').run(id);
}

/** A stored photograph's bytes, for previewing it in the browser. */
export function moldPhotoBytes(id: string): { bytes: Buffer; contentType: string } | null {
  const row = db()
    .prepare('SELECT bytes, content_type FROM mold_photos WHERE id = ?')
    .get(id) as { bytes: Uint8Array; content_type: string } | undefined;
  return row ? { bytes: Buffer.from(row.bytes), contentType: row.content_type } : null;
}

/**
 * Pairs each caption in the report with its stored image.
 *
 * A caption whose image is missing is skipped rather than failing the whole
 * generation — a half-uploaded photo should not block a deadline.
 */
function loadPhotoInputs(
  reportId: string,
  entries: Array<{ imageId: string; caption: string }>,
): PhotoInput[] {
  const rows = db()
    .prepare('SELECT id, bytes, content_type, width, height FROM mold_photos WHERE report_id = ?')
    .all(reportId) as Array<{
    id: string;
    bytes: Uint8Array;
    content_type: string;
    width: number;
    height: number;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));

  const inputs: PhotoInput[] = [];
  for (const photo of entries) {
    const stored = byId.get(photo.imageId);
    if (!stored) continue;
    inputs.push({
      bytes: Buffer.from(stored.bytes),
      contentType: stored.content_type,
      width: stored.width,
      height: stored.height,
      caption: photo.caption,
    });
  }
  return inputs;
}

// ── Generation ──────────────────────────────────────────────────────

export interface GeneratedMold {
  bytes: Buffer;
  fileName: string;
  durationMs: number;
}

export async function generateMoldReport(
  report: MoldReport,
  reportId?: string,
): Promise<GeneratedMold> {
  const started = process.hrtime.bigint();
  const template = activeTemplateBytes('mold');

  /**
   * The photo appendix is written into the archive before the merge.
   *
   * `buildPhotosXml` adds the image parts and their relationships to the zip and
   * returns the OOXML that displays them, which the merge then injects through the
   * template's `{@photosXml}` tag. So the zip must be opened here rather than
   * handing bytes straight to `mergeDocx`.
   */
  const zip = new PizZip(template);
  const photos = reportId ? loadPhotoInputs(reportId, photosInRoomOrder(report)) : [];
  const photosXml = buildPhotosXml(zip, photos);
  /*
   * The laboratory's sheets are a second appendix, built the same way.
   *
   * Kept apart from the survey photographs so they print after them and keep their
   * own captions — they are the evidence the figures were transcribed from, not
   * pictures of the building.
   */
  /*
   * The laboratory's sheets are captioned plainly — they are documents, not pictures
   * of the building, and "תמונה מס' 1" over a page of results is the wrong word.
   */
  const sheets = (reportId ? loadPhotoInputs(reportId, report.labSheets) : []).map((input) => ({
    ...input,
    plainCaption: true,
  }));
  const labSheetsXml = buildPhotosXml(zip, sheets);
  const withPhotos = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });

  /*
   * The closing sections are worded from the laboratory's findings at production.
   *
   * Every fact they state is already in the sample rows, so drafting here means the
   * document always reflects the results as they stand — a report produced again
   * after a corrected figure does not keep the earlier conclusion. Never throws: see
   * `draftMoldReport`, which falls back to whatever the report already carried.
   */
  const drafted = await draftMoldReport(report);
  const worded: MoldReport = { ...report, ...drafted };

  const bytes = mergeDocx(withPhotos, {
    ...buildMoldMergeData(worded),
    photosXml,
    labSheetsXml,
  });

  return {
    bytes,
    fileName: moldFileName(report),
    durationMs: Number(process.hrtime.bigint() - started) / 1e6,
  };
}

/** Exposed for the tests: the document's text, for asserting what was rendered. */
export function moldDocumentText(bytes: Buffer): string {
  return textOf(new PizZip(bytes).file('word/document.xml')?.asText() ?? '');
}
