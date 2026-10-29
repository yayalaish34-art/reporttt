import { randomUUID } from 'node:crypto';
import PizZip from 'pizzip';
import { db, now } from './db';
import { mergeDocx } from './docx/merge-docx';
import { activeTemplateBytes } from './docx/template-store';
import { findMarkedRegions } from './docx/marked-runs';
import { applyConclusionSlots, type ConclusionSlot } from './docx/conclusion-slots';
import { buildPhotosXml, photoBlock, PHOTO_PAGE_BREAK, type PhotoInput } from './docx/photos';
import { textOf } from './docx/ooxml';
import { aiDraftingAvailable, draftConclusionSlot } from './ai-text';
import { draftAsbestosFindings } from './asbestos-draft';
import { buildAsbestosMergeData, asbestosFileName, asbestosSubject } from './asbestos-mapper';
import { storedReportTitle } from './report-title';
import {
  computeAsbestosFindings,
  describeAsbestosFindings,
  realBuildings,
  realFindings,
} from './asbestos-rules';
import {
  DraftAsbestosReportSchema,
  type DraftAsbestosReport,
  type AsbestosReport,
} from './asbestos-schema';
import { customerOf, recordJob } from './job-numbers';

/**
 * Asbestos opinion persistence and generation.
 *
 * A third table and a third template, sharing the machinery underneath: the same
 * merge, the same photo appendix, the same customer directory. Three surveys,
 * one set of moving parts.
 */

export interface AsbestosSummaryRow {
  id: string;
  reference: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  findingCount: number;
  photoCount: number;
}

export function listAsbestosReports(): AsbestosSummaryRow[] {
  const rows = db()
    .prepare(
      `SELECT id, reference, title, data, created_at, updated_at
         FROM asbestos_reports ORDER BY updated_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => {
    let findingCount = 0;
    let photoCount = 0;
    try {
      const parsed = DraftAsbestosReportSchema.parse(JSON.parse(String(row.data)));
      findingCount = realFindings(parsed).length;
      photoCount = parsed.photos.length;
    } catch {
      /* a row that will not parse still belongs in the list, just without counts */
    }
    return {
      id: String(row.id),
      reference: String(row.reference),
      title: storedReportTitle('asbestos', row.data, row.title),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      findingCount,
      photoCount,
    };
  });
}

export function loadAsbestosReport(id: string): AsbestosReport | null {
  const row = db().prepare('SELECT data FROM asbestos_reports WHERE id = ?').get(id) as
    | { data: string }
    | undefined;
  if (!row) return null;
  return DraftAsbestosReportSchema.parse(JSON.parse(row.data));
}

/**
 * The next reference number, in the other reports' format.
 *
 * `YYMMDD` then a serial within the day, counted over the asbestos table alone
 * — see `nextRadonReference` for why the three kinds do not share a counter.
 */
export function nextAsbestosReference(today = new Date()): string {
  const prefix =
    String(today.getFullYear()).slice(2) +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');

  const rows = db()
    .prepare('SELECT reference FROM asbestos_reports WHERE reference LIKE ?')
    .all(`${prefix}%`) as Array<{ reference: string }>;

  let highest = 0;
  for (const row of rows) {
    const serial = Number(String(row.reference).slice(prefix.length));
    if (Number.isFinite(serial)) highest = Math.max(highest, serial);
  }
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

export function createAsbestosReport(report: AsbestosReport): string {
  const id = randomUUID();
  const timestamp = now();
  db()
    .prepare(
      `INSERT INTO asbestos_reports (id, reference, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      report.referenceNumber,
      asbestosSubject(report),
      JSON.stringify(report),
      timestamp,
      timestamp,
    );
  return id;
}

/**
 * Overwrites an asbestos opinion. Takes a draft: the autosave stores what is on
 * screen between steps, which is legitimately incomplete while the survey is
 * being written — the findings are typed while walking the building.
 */
export function saveAsbestosReport(id: string, report: DraftAsbestosReport): void {
  const result = db()
    .prepare(
      'UPDATE asbestos_reports SET reference = ?, title = ?, data = ?, updated_at = ? WHERE id = ?',
    )
    .run(
      report.referenceNumber,
      asbestosSubject(report as AsbestosReport),
      JSON.stringify(report),
      now(),
      id,
    );
  if (result.changes === 0) throw new Error(`דוח אסבסט ${id} לא נמצא`);
}

export function deleteAsbestosReport(id: string): void {
  db().prepare('DELETE FROM asbestos_reports WHERE id = ?').run(id);
}

// ── Photos ──────────────────────────────────────────────────────────

/** Stores an uploaded photograph and returns its id. */
export function addAsbestosPhoto(
  reportId: string,
  bytes: Buffer,
  contentType: string,
  width: number,
  height: number,
): string {
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO asbestos_photos (id, report_id, bytes, content_type, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, reportId, bytes, contentType, width, height, now());
  return id;
}

export function deleteAsbestosPhoto(id: string): void {
  db().prepare('DELETE FROM asbestos_photos WHERE id = ?').run(id);
}

/** A stored photograph's bytes, for previewing it in the browser. */
export function asbestosPhotoBytes(id: string): { bytes: Buffer; contentType: string } | null {
  const row = db()
    .prepare('SELECT bytes, content_type FROM asbestos_photos WHERE id = ?')
    .get(id) as { bytes: Uint8Array; content_type: string } | undefined;
  return row ? { bytes: Buffer.from(row.bytes), contentType: row.content_type } : null;
}

/**
 * Pairs each caption in the report with its stored image.
 *
 * A caption whose image is missing is skipped rather than failing the whole
 * generation — a half-uploaded photo should not block a deadline.
 */
function storedPhotoRows(reportId: string) {
  return db()
    .prepare(
      'SELECT id, bytes, content_type, width, height FROM asbestos_photos WHERE report_id = ?',
    )
    .all(reportId) as Array<{
    id: string;
    bytes: Uint8Array;
    content_type: string;
    width: number;
    height: number;
  }>;
}

function loadPhotoInputs(
  reportId: string,
  report: AsbestosReport,
  /** Extra entries printed in the appendix after the report's own — see the caller. */
  extra: Array<{ imageId: string; caption: string }> = [],
): PhotoInput[] {
  const rows = db()
    .prepare(
      'SELECT id, bytes, content_type, width, height FROM asbestos_photos WHERE report_id = ?',
    )
    .all(reportId) as Array<{
    id: string;
    bytes: Uint8Array;
    content_type: string;
    width: number;
    height: number;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));

  const inputs: PhotoInput[] = [];
  for (const photo of [...report.photos, ...extra]) {
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

export interface GeneratedAsbestos {
  bytes: Buffer;
  fileName: string;
  durationMs: number;
}

export async function generateAsbestosReport(
  report: AsbestosReport,
  reportId?: string,
): Promise<GeneratedAsbestos> {
  const started = process.hrtime.bigint();
  // Which of the two opinions this is — see `layout` in the schema. The tabled form is
  // a different document, not the same one with a section hidden.
  const kind = report.layout === 'tables' ? 'asbestos-tables' : 'asbestos';
  const template = await rewordSummary(activeTemplateBytes(kind), report);

  /**
   * The photo appendix is written into the archive before the merge.
   *
   * `buildPhotosXml` adds the image parts and their relationships to the zip and
   * returns the OOXML that displays them, which the merge then injects through
   * the template's `{@photosXml}` tag — one photograph per page, numbered as it
   * goes. So the zip must be opened here rather than handing bytes straight to
   * `mergeDocx`.
   */
  const zip = new PizZip(template);

  /**
   * Photographs are numbered once, across the whole document.
   *
   * The tabled opinion puts each building's picture straight after that building's
   * table, and the appendix carries whatever is left. Both draw from the same running
   * count, because "תמונה מס' 3" has to mean one page — a per-section count would
   * produce two number 1s in a document a client reads front to back.
   */
  let photoNumber = 0;
  const stored = reportId ? new Map(storedPhotoRows(reportId).map((r) => [r.id, r])) : new Map();

  const toInput = (photo: { imageId: string; caption: string }): PhotoInput | null => {
    const row = stored.get(photo.imageId);
    if (!row) return null;
    return {
      bytes: Buffer.from(row.bytes),
      contentType: row.content_type,
      width: row.width,
      height: row.height,
      caption: photo.caption,
    };
  };

  /**
   * One building's pictures, rendered where its table ends.
   *
   * The caption falls back to the building's name: the surveyor typed it once at the
   * top of the table, and making them type it again under the photograph is the kind
   * of duplication that ends with the two disagreeing.
   */
  const buildingPhotos = (building: AsbestosReport['buildings'][number]): string => {
    const blocks = building.photos
      .map((photo) => {
        const input = toInput(photo);
        if (!input) return null;
        photoNumber++;
        return photoBlock(
          zip,
          { ...input, caption: input.caption.trim() || building.name.trim() },
          photoNumber,
          `building-photo-${photoNumber}`,
        );
      })
      .filter((block): block is string => block !== null);

    // No picture means no page break either — a building without one should not
    // leave a blank page behind its table.
    return blocks.length === 0 ? '<w:p/>' : PHOTO_PAGE_BREAK + blocks.join(PHOTO_PAGE_BREAK);
  };

  /**
   * Rendered now, not when the merge asks for it.
   *
   * Two things depend on the order. The numbering runs building-first because that
   * is the order the pages appear in, and the pictures have to be written into the
   * archive before `generate` seals it below — a renderer called lazily during the
   * merge would add its images to a zip that had already been serialised, and the
   * document would reference pictures that are not in the file.
   */
  const buildingsXml = new Map<number, string>();
  // `realBuildings`, so the two agree on which buildings exist — a photo rendered
  // against an index the mapper skipped would land under the wrong table.
  realBuildings(report).forEach((building, index) =>
    buildingsXml.set(index, buildingPhotos(building)),
  );

  /*
   * The appendix takes the report-level photographs and the prose form's finding
   * photographs, continuing the same numbering.
   *
   * A finding's pictures go here rather than beside its own line because the prose
   * form prints its findings as a bulleted list, and a full-page photograph cannot sit
   * inside a bullet. The caption carries the element's name, so the reader can still
   * tell which finding each picture belongs to — which is the part that matters.
   *
   * The tabled form is different and handled above: there each building has a table of
   * its own with a page after it, so its photographs print in place.
   */
  const findingPhotos =
    report.layout === 'tables'
      ? []
      : realFindings(report).flatMap((finding) =>
          finding.photos.map((photo) => ({
            ...photo,
            caption: photo.caption.trim() || finding.element.trim() || finding.text.trim(),
          })),
        );

  const appendix = (reportId ? loadPhotoInputs(reportId, report, findingPhotos) : []).map((input) => {
    photoNumber++;
    return { input, number: photoNumber };
  });
  const photosXml =
    appendix.length === 0
      ? '<w:p/>'
      : PHOTO_PAGE_BREAK +
        appendix
          .map(({ input, number }) => photoBlock(zip, input, number, `report-photo-${number}`))
          .join(PHOTO_PAGE_BREAK);

  const withPhotos = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });

  /*
   * The findings section is worded from the surveyor's structured facts.
   *
   * A finding is recorded as what it is, how many, where and what size; the sentence a
   * reader sees is composed from those. Drafting here rather than in the editor means the
   * document always reflects the facts as they stand at production, and a survey edited
   * after a first draft does not print the earlier wording.
   *
   * Falls back to whatever the surveyor typed — see `draftAsbestosFindings`, which never
   * throws.
   */
  const draft = await draftAsbestosFindings(report);
  const worded: AsbestosReport = {
    ...report,
    findings: report.findings.map((finding, i) => ({ ...finding, text: draft.bullets[i] ?? finding.text })),
    buriedSentence: draft.buriedSentence || report.buriedSentence,
    /*
     * The prose form's summary is drafted too; the tabled form's was written by the
     * surveyor in its own step and is left alone.
     *
     * Both end up in the same `summaryLines` loop — see the mapper — so the template
     * has one closing section whichever shape produced it.
     */
    summaryBullets:
      report.layout === 'tables' ? report.summaryBullets : draft.summaryBullets,
  };

  const bytes = mergeDocx(withPhotos, {
    ...buildAsbestosMergeData(worded, (_building, index) => buildingsXml.get(index) ?? '<w:p/>'),
    photosXml,
  });

  // The job-number register: this report's number, issued on first production.
  recordJob('asbestos', reportId, { customerName: customerOf(report), inspectorName: '' });

  return {
    bytes,
    fileName: asbestosFileName(report),
    durationMs: Number(process.hrtime.bigint() - started) / 1e6,
  };
}

/**
 * Rewords any highlighted passage of the conclusions from this survey's findings.
 *
 * The template built from Galit's own opinion carries no highlights — its closing
 * sentences are fields the surveyor edits directly, which is the right shape for a
 * document given in place of testimony. This stays because the template is editable
 * in Word: the moment someone highlights a passage there, it behaves like the other
 * two reports rather than silently ignoring the mark.
 *
 * Never fatal, and the highlight comes off either way.
 */
async function rewordSummary(template: Buffer, report: AsbestosReport): Promise<Buffer> {
  const zip = new PizZip(template);
  const file = zip.file('word/document.xml');
  if (!file) return template;

  const xml = file.asText();
  const regions = findMarkedRegions(xml);
  if (regions.length === 0) return template;

  const slots: ConclusionSlot[] = regions.map((region) => ({
    kind: 'asbestos' as const,
    regions: [region],
    example: [region.text.trim()],
    wholeParagraphs: region.text.trim() === region.paragraphText.trim(),
    surrounding: region.paragraphText.trim(),
  }));

  const findings = describeAsbestosFindings(computeAsbestosFindings(report));

  const drafted = aiDraftingAvailable()
    ? await Promise.all(
        slots.map(async (slot) => {
          try {
            return await draftConclusionSlot({
              kind: 'asbestos',
              example: slot.example,
              wholeParagraphs: slot.wholeParagraphs,
              surrounding: slot.surrounding,
              findings,
              siteName: report.siteAddress || report.clientName,
              siteCharacter: report.siteDescription,
            });
          } catch (err) {
            console.error('ניסוח סיכום האסבסט נכשל — נשאר נוסח הדוגמה', err);
            return slot.example;
          }
        }),
      )
    : slots.map((slot) => slot.example);

  zip.file('word/document.xml', applyConclusionSlots(xml, slots, drafted));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Exposed for the tests: the document's text, for asserting what was rendered. */
export function asbestosDocumentText(bytes: Buffer): string {
  return textOf(new PizZip(bytes).file('word/document.xml')?.asText() ?? '');
}
