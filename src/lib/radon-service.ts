import { randomUUID } from 'node:crypto';
import PizZip from 'pizzip';
import { db, now } from './db';
import { mergeDocx } from './docx/merge-docx';
import { activeTemplateBytes } from './docx/template-store';
import { findMarkedRegions } from './docx/marked-runs';
import { applyConclusionSlots, type ConclusionSlot } from './docx/conclusion-slots';
import { textOf } from './docx/ooxml';
import { aiDraftingAvailable, draftConclusionSlot } from './ai-text';
import { buildRadonMergeData, radonFileName, radonSubject } from './radon-mapper';
import { computeRadonFindings, describeRadonFindings } from './radon-rules';
import { DraftRadonReportSchema, type DraftRadonReport, type RadonReport } from './radon-schema';
import { storedReportTitle } from './report-title';

/**
 * Radon report persistence and generation.
 *
 * A separate table and a separate template from the radiation reports, sharing
 * the machinery underneath: the same merge, the same marked-passage rewording,
 * the same customer directory. Two surveys, one set of moving parts.
 */

export interface RadonSummary {
  id: string;
  reference: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  detectorCount: number;
}

export function listRadonReports(): RadonSummary[] {
  const rows = db()
    .prepare(
      `SELECT id, reference, title, data, created_at, updated_at
         FROM radon_reports ORDER BY updated_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => {
    let detectorCount = 0;
    try {
      detectorCount = (JSON.parse(String(row.data)).detectors ?? []).length;
    } catch {
      /* a row that will not parse still belongs in the list, just without a count */
    }
    return {
      id: String(row.id),
      reference: String(row.reference),
      title: storedReportTitle('radon', row.data, row.title),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      detectorCount,
    };
  });
}

export function loadRadonReport(id: string): RadonReport | null {
  const row = db().prepare('SELECT data FROM radon_reports WHERE id = ?').get(id) as
    | { data: string }
    | undefined;
  if (!row) return null;
  return DraftRadonReportSchema.parse(JSON.parse(row.data));
}

/**
 * The next reference number, in the radiation reports' format.
 *
 * `YYMMDD` then a serial within the day. Counted over the radon table alone, so
 * the two report kinds do not interleave — a radon report and a radiation
 * report issued the same day can share a number without ambiguity, because the
 * document says which it is on every page.
 */
export function nextRadonReference(today = new Date()): string {
  const prefix =
    String(today.getFullYear()).slice(2) +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');

  const rows = db()
    .prepare('SELECT reference FROM radon_reports WHERE reference LIKE ?')
    .all(`${prefix}%`) as Array<{ reference: string }>;

  let highest = 0;
  for (const row of rows) {
    const serial = Number(String(row.reference).slice(prefix.length));
    if (Number.isFinite(serial)) highest = Math.max(highest, serial);
  }
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

export function createRadonReport(report: RadonReport): string {
  const id = randomUUID();
  const timestamp = now();
  db()
    .prepare(
      `INSERT INTO radon_reports (id, reference, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, report.referenceNumber, radonSubject(report), JSON.stringify(report), timestamp, timestamp);
  return id;
}

/**
 * Overwrites a radon report. Takes a draft: the autosave stores what is on screen
 * between steps, which is legitimately incomplete while the survey is being written.
 */
export function saveRadonReport(id: string, report: DraftRadonReport): void {
  const result = db()
    .prepare('UPDATE radon_reports SET reference = ?, title = ?, data = ?, updated_at = ? WHERE id = ?')
    .run(report.referenceNumber, radonSubject(report), JSON.stringify(report), now(), id);
  if (result.changes === 0) throw new Error(`דוח ראדון ${id} לא נמצא`);
}

export function deleteRadonReport(id: string): void {
  db().prepare('DELETE FROM radon_reports WHERE id = ?').run(id);
}

// ── Generation ──────────────────────────────────────────────────────

export interface GeneratedRadon {
  bytes: Buffer;
  fileName: string;
  durationMs: number;
}

export async function generateRadonReport(report: RadonReport): Promise<GeneratedRadon> {
  const started = process.hrtime.bigint();
  const template = await rewordSummary(activeTemplateBytes('radon'), report);
  const bytes = mergeDocx(template, buildRadonMergeData(report));

  return {
    bytes,
    fileName: radonFileName(report),
    durationMs: Number(process.hrtime.bigint() - started) / 1e6,
  };
}

/**
 * Rewords the marked sentence of section ז from this survey's findings.
 *
 * One passage rather than the radiation report's several, so the slot is built
 * here instead of by `collectConclusionSlots` — that function splits its
 * regions between ELF and RF by looking for two "מסקנות" headings, which is a
 * question that has no meaning in a radon report.
 *
 * Never fatal, and the highlight comes off either way: it is an instruction to
 * this code, and no client should ever see it.
 */
async function rewordSummary(template: Buffer, report: RadonReport): Promise<Buffer> {
  const zip = new PizZip(template);
  const file = zip.file('word/document.xml');
  if (!file) return template;

  const xml = file.asText();
  const regions = findMarkedRegions(xml);
  if (regions.length === 0) return template;

  const slots: ConclusionSlot[] = regions.map((region) => ({
    kind: 'radon' as const,
    regions: [region],
    example: [region.text.trim()],
    wholeParagraphs: region.text.trim() === region.paragraphText.trim(),
    surrounding: region.paragraphText.trim(),
  }));

  const findings = describeRadonFindings(computeRadonFindings(report));

  const drafted = aiDraftingAvailable()
    ? await Promise.all(
        slots.map(async (slot) => {
          try {
            return await draftConclusionSlot({
              kind: 'radon',
              example: slot.example,
              wholeParagraphs: slot.wholeParagraphs,
              surrounding: slot.surrounding,
              findings,
              siteName: report.companyName || report.recipientName,
              siteCharacter: report.siteKind,
            });
          } catch (err) {
            console.error('ניסוח סיכום הראדון נכשל — נשאר נוסח הדוגמה', err);
            return slot.example;
          }
        }),
      )
    : slots.map((slot) => slot.example);

  zip.file('word/document.xml', applyConclusionSlots(xml, slots, drafted));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Exposed for the tests: what the template offers as rewritable. */
export function radonSummaryPassages(template: Buffer): string[] {
  const xml = new PizZip(template).file('word/document.xml')?.asText() ?? '';
  return findMarkedRegions(xml).map((r) => r.text.trim());
}

/** Exposed for the tests: the document's text, for asserting what was rendered. */
export function radonDocumentText(bytes: Buffer): string {
  return textOf(new PizZip(bytes).file('word/document.xml')?.asText() ?? '');
}
