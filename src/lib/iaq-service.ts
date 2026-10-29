import { randomUUID } from 'node:crypto';
import PizZip from 'pizzip';
import { db, now } from './db';
import { mergeDocx } from './docx/merge-docx';
import { activeTemplateBytes } from './docx/template-store';
import type { PhotoInput } from './docx/photos';
import { buildIaqPhotosXml } from './docx/iaq-photos';
import { textOf } from './docx/ooxml';
import { buildIaqMergeData, iaqFileName, iaqSubject } from './iaq-mapper';
import {
  DraftIaqReportSchema,
  IaqReportSchema,
  type DraftIaqReport,
  type IaqReport,
} from './iaq-schema';
import { storedReportTitle } from './report-title';
import { iaqReportLocations } from './iaq-rules';
import { customerOf, recordJob } from './job-numbers';

/**
 * דוח איכות אוויר תוך-מבנית — שכבת ה-persistence וה-generation.
 *
 * אותו דפוס כמו עובש, מצומצם: אין lab-sheets, אין draft עם AI, אין החלפת
 * reference אישית — הכל ישיר.
 */

export interface IaqSummaryRow {
  id: string;
  reference: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  locationCount: number;
  photoCount: number;
}

export function listIaqReports(): IaqSummaryRow[] {
  const rows = db()
    .prepare(
      `SELECT id, reference, title, data, created_at, updated_at
         FROM iaq_reports ORDER BY updated_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => {
    let locationCount = 0;
    let photoCount = 0;
    try {
      const parsed = DraftIaqReportSchema.parse(JSON.parse(String(row.data)));
      locationCount = iaqReportLocations(parsed).length;
      photoCount = (parsed.photos ?? []).length;
    } catch {
      /* שורה שלא נפרסת עדיין נכנסת לרשימה, בלי ספירות */
    }
    return {
      id: String(row.id),
      reference: String(row.reference),
      title: storedReportTitle('iaq', row.data, row.title),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      locationCount,
      photoCount,
    };
  });
}

export function loadIaqReport(id: string): IaqReport | null {
  const row = db().prepare('SELECT data FROM iaq_reports WHERE id = ?').get(id) as
    | { data: string }
    | undefined;
  if (!row) return null;
  // רשומות ישנות שנשמרו לפני תוספת שדות (customerId / contactEmail / author*)
  // חסרות אותם ב-JSON. ה-DraftIaqReportSchema עשה `.partial()` ולכן לא החיל
  // את ה-.default() מה-sch הראשי — ומצד הלקוח `report.authorName.trim()`
  // נפל ב-TypeError. מעבירים עכשיו דרך הסכמה המחמירה שכן מחילה את כל
  // ברירות המחדל; `referenceNumber` לא נושא .default (יש לו min(1)), אז fallback.
  const raw = JSON.parse(row.data) as Record<string, unknown>;
  if (typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.referenceNumber !== 'string' || raw.referenceNumber.trim() === '') {
    raw.referenceNumber = id.slice(0, 10) || 'draft';
  }
  return IaqReportSchema.parse(raw);
}

/**
 * סימוכין הבא לדוח. YYMMDD + סדרה בת 4 ספרות שמונה רק מעל טבלת IAQ.
 */
export function nextIaqReference(today = new Date()): string {
  const prefix =
    String(today.getFullYear()).slice(2) +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');

  const rows = db()
    .prepare('SELECT reference FROM iaq_reports WHERE reference LIKE ?')
    .all(`${prefix}%`) as Array<{ reference: string }>;

  let highest = 0;
  for (const row of rows) {
    const serial = Number(String(row.reference).slice(prefix.length));
    if (Number.isFinite(serial)) highest = Math.max(highest, serial);
  }
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

export function createIaqReport(report: IaqReport): string {
  const id = randomUUID();
  const timestamp = now();
  db()
    .prepare(
      `INSERT INTO iaq_reports (id, reference, title, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      report.referenceNumber,
      iaqSubject(report),
      JSON.stringify(report),
      timestamp,
      timestamp,
    );
  return id;
}

/** דורס דוח IAQ. מקבל draft — autosave שומר מה שעל המסך בין צעדים. */
export function saveIaqReport(id: string, report: DraftIaqReport): void {
  const result = db()
    .prepare(
      'UPDATE iaq_reports SET reference = ?, title = ?, data = ?, updated_at = ? WHERE id = ?',
    )
    .run(
      report.referenceNumber ?? '',
      iaqSubject(report as IaqReport),
      JSON.stringify(report),
      now(),
      id,
    );
  if (result.changes === 0) throw new Error(`דוח איכות אוויר ${id} לא נמצא`);
}

export function deleteIaqReport(id: string): void {
  db().prepare('DELETE FROM iaq_reports WHERE id = ?').run(id);
}

// ── תמונות ──────────────────────────────────────────────────────────

export function addIaqPhoto(
  reportId: string,
  bytes: Buffer,
  contentType: string,
  width: number,
  height: number,
): string {
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO iaq_photos (id, report_id, bytes, content_type, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, reportId, bytes, contentType, width, height, now());
  return id;
}

export function deleteIaqPhoto(id: string): void {
  db().prepare('DELETE FROM iaq_photos WHERE id = ?').run(id);
}

export function iaqPhotoBytes(id: string): { bytes: Buffer; contentType: string } | null {
  const row = db()
    .prepare('SELECT bytes, content_type FROM iaq_photos WHERE id = ?')
    .get(id) as { bytes: Uint8Array; content_type: string } | undefined;
  return row ? { bytes: Buffer.from(row.bytes), contentType: row.content_type } : null;
}

function loadPhotoInputs(
  reportId: string,
  entries: Array<{ imageId: string; caption: string }>,
): PhotoInput[] {
  const rows = db()
    .prepare('SELECT id, bytes, content_type, width, height FROM iaq_photos WHERE report_id = ?')
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

// ── יצירת DOCX ──────────────────────────────────────────────────────

export interface GeneratedIaq {
  bytes: Buffer;
  fileName: string;
  durationMs: number;
}

export async function generateIaqReport(
  report: IaqReport,
  reportId?: string,
): Promise<GeneratedIaq> {
  const started = process.hrtime.bigint();
  const template = activeTemplateBytes('iaq');

  const zip = new PizZip(template);
  removeTableRecommendationBlock(zip);
  const photos = reportId ? loadPhotoInputs(reportId, report.photos) : [];
  const photosXml = buildIaqPhotosXml(zip, photos);
  const withPhotos = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });

  const bytes = mergeDocx(withPhotos, {
    ...buildIaqMergeData(report),
    photosXml,
  });

  // The job-number register: this report's number, issued on first production.
  recordJob('iaq', reportId, { customerName: customerOf(report), inspectorName: report.authorName });

  return {
    bytes,
    fileName: iaqFileName(report),
    durationMs: Number(process.hrtime.bigint() - started) / 1e6,
  };
}

/**
 * Older IAQ templates use `{recommendations}` twice: once in the proper closing
 * recommendations section and once below the TVOC table, under another literal
 * "המלצות" heading. The latter is case-specific source-document residue: global
 * report recommendations do not belong below one measurement table, normal or not.
 *
 * This deliberately runs against `activeTemplateBytes`, rather than only changing
 * the bundled DOCX. Production may have an already-active template in its database.
 */
function removeTableRecommendationBlock(zip: PizZip): void {
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) return;

  const xml = documentPart.asText();
  const paragraphPattern = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  const paragraphs: Array<{ start: number; end: number; text: string }> = [];
  for (const match of xml.matchAll(paragraphPattern)) {
    const start = match.index;
    const paragraph = match[0];
    paragraphs.push({
      start,
      end: start + paragraph.length,
      text: textOf(paragraph).replace(/\s+/g, ' ').trim(),
    });
  }

  const tvocConclusionIndex = paragraphs.findIndex((paragraph) =>
    paragraph.text.includes('{tvocConclusion}'),
  );
  let fieldIndex =
    tvocConclusionIndex >= 0
      ? paragraphs.findIndex(
          (paragraph, index) =>
            index > tvocConclusionIndex &&
            (paragraph.text === '{recommendations}' || paragraph.text === '{tvocRecommendations}'),
        )
      : -1;

  // Compatibility for a Word-edited copy that retained the duplicate fields but
  // removed the TVOC conclusion placeholder: the legacy table copy is the second
  // recommendations field in document order.
  if (fieldIndex < 0) {
    const recommendationFields = paragraphs
      .map((paragraph, index) => ({ paragraph, index }))
      .filter(({ paragraph }) => paragraph.text === '{recommendations}');
    if (recommendationFields.length >= 2) fieldIndex = recommendationFields[1]!.index;
  }
  if (fieldIndex < 0) return;

  let headingIndex = -1;
  for (let index = fieldIndex - 1; index > tvocConclusionIndex; index--) {
    if (paragraphs[index]!.text === 'המלצות') {
      headingIndex = index;
      break;
    }
  }

  const removals = [paragraphs[fieldIndex], headingIndex >= 0 ? paragraphs[headingIndex] : null]
    .filter((span): span is { start: number; end: number; text: string } => Boolean(span))
    .sort((a, b) => b.start - a.start);
  let cleaned = xml;
  for (const removal of removals) {
    cleaned = cleaned.slice(0, removal.start) + cleaned.slice(removal.end);
  }
  zip.file('word/document.xml', cleaned);
}

/** נחשף לטסטים: הטקסט שהתבנית יצרה, לאסרשן מה רונדר בפועל. */
export function iaqDocumentText(bytes: Buffer): string {
  return textOf(new PizZip(bytes).file('word/document.xml')?.asText() ?? '');
}
