import { randomUUID } from 'node:crypto';
import PizZip from 'pizzip';
import { db, now } from './db';
import { collectConclusionSlots, applyConclusionSlots } from './docx/conclusion-slots';
import { aiDraftingAvailable, draftConclusionSlot } from './ai-text';
import { computeFindings, describeFindings } from './report-findings';
import { mergeDocx } from './docx/merge-docx';
import { stripRfAppendix, stripUnusedSurvey } from './docx/survey-sections';
import { applySiteAppendix } from './docx/site-appendix';
import { applyConclusionPreamble } from './docx/conclusion-preamble';
import { appendCalibrationTag, buildCalibrationXml } from './docx/calibration-appendix';
import { appendAntennaMapTag, buildAntennaMapXml, type AntennaMapInput } from './docx/antenna-appendix';
import { stripUnusedPermitRow } from './docx/permit-rows';
import { activeTemplateBytes } from './docx/template-store';
import { buildPhotosXml, type PhotoInput } from './docx/photos';
import { buildSignatureXml, type SignatureInput } from './docx/signatures';
import { loadSignature } from './signature-service';
import { buildMergeData, inspectorsForScope, reportListTitle, reportSubject } from './report-mapper';
import { storedReportTitle } from './report-title';
import { StoredReportSchema, type DraftReport, type Report } from './report-schema';
import { measuredProtocols, shouldIncludeAntennaMap } from './measurement-rules';

/**
 * Report persistence and generation.
 *
 * The generation path is deliberately short: load the active template, attach
 * the photos, merge, hand back bytes. Everything that could vary per report is
 * data, not code.
 */

export interface ReportSummary {
  id: string;
  reference: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  photoCount: number;
}

/** Reports in the drafts list, most recently edited first. */
export function listReports(): ReportSummary[] {
  const rows = db()
    .prepare(
      `SELECT r.id, r.reference, r.title, r.data, r.created_at, r.updated_at,
              (SELECT COUNT(*) FROM photos p WHERE p.report_id = r.id) AS photo_count
         FROM reports r
        ORDER BY r.updated_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row.id),
    reference: String(row.reference),
    title: storedReportTitle('radiation', row.data, row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    photoCount: Number(row.photo_count),
  }));
}

/** A single report's data, or null when the id is unknown. */
export function loadReport(id: string): Report | null {
  const row = db().prepare('SELECT data FROM reports WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return null;
  return StoredReportSchema.parse(JSON.parse(row.data));
}

/** Creates a report and returns its id. */
/**
 * The next reference number ("סימוכין"), which is printed on every page.
 *
 * Assigned at creation rather than typed, because the field is required to save
 * and is no longer shown in the editor — a report with no reference could
 * neither be saved nor fixed.
 *
 * `YYMMDD` then a serial within that day: sortable, unique without a counter
 * table, and readable back to the day it was issued. The serial is taken from
 * the highest reference already issued today, so deleting a report does not
 * hand its number to the next one.
 */
export function nextReferenceNumber(today = new Date()): string {
  const yy = String(today.getFullYear()).slice(2);
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const prefix = `${yy}${mm}${dd}`;

  const rows = db()
    .prepare('SELECT reference FROM reports WHERE reference LIKE ?')
    .all(`${prefix}%`) as Array<{ reference: string }>;

  let highest = 0;
  for (const row of rows) {
    const serial = Number(String(row.reference).slice(prefix.length));
    if (Number.isFinite(serial)) highest = Math.max(highest, serial);
  }
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

export function createReport(report: Report): string {
  const id = randomUUID();
  const timestamp = now();
  db()
    .prepare('INSERT INTO reports (id, reference, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, report.referenceNumber, reportListTitle(report), JSON.stringify(report), timestamp, timestamp);
  return id;
}

/**
 * Overwrites a report. Throws when the id is unknown.
 *
 * Takes a draft rather than a finished report: the autosave stores whatever is on screen
 * between steps, and what is on screen halfway through a survey has no site name yet.
 * `reportListTitle` composes from whatever is there, so an unnamed site simply produces
 * a shorter title in the drafts list until it is filled in.
 */
export function saveReport(id: string, report: DraftReport): void {
  const result = db()
    .prepare('UPDATE reports SET reference = ?, title = ?, data = ?, updated_at = ? WHERE id = ?')
    .run(report.referenceNumber, reportListTitle(report), JSON.stringify(report), now(), id);
  if (result.changes === 0) throw new Error(`דוח ${id} לא נמצא`);
}

export function deleteReport(id: string): void {
  db().prepare('DELETE FROM reports WHERE id = ?').run(id);
}

// ── Photos ──────────────────────────────────────────────────────────

/** Stores an uploaded photograph and returns its id. */
export function addPhoto(
  reportId: string,
  bytes: Buffer,
  contentType: string,
  width: number,
  height: number,
): string {
  const id = randomUUID();
  db()
    .prepare('INSERT INTO photos (id, report_id, bytes, content_type, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, reportId, bytes, contentType, width, height, now());
  return id;
}

export function deletePhoto(id: string): void {
  db().prepare('DELETE FROM photos WHERE id = ?').run(id);
}

/** A stored photograph's bytes, for previewing it in the browser. */
export function photoBytes(id: string): { bytes: Buffer; contentType: string } | null {
  const row = db().prepare('SELECT bytes, content_type FROM photos WHERE id = ?').get(id) as
    | { bytes: Uint8Array; content_type: string }
    | undefined;
  return row ? { bytes: Buffer.from(row.bytes), contentType: row.content_type } : null;
}

// ── Generation ──────────────────────────────────────────────────────

export interface GeneratedReport {
  bytes: Buffer;
  fileName: string;
  /** Milliseconds the merge took, for the timing shown after a download. */
  durationMs: number;
  /**
   * Photographs the report lists but whose files were not in the database.
   *
   * Zero on every healthy generation. Anything else means the document went out
   * without part of its appendix, which the surveyor has to be told — see
   * `loadPhotoInputs`.
   */
  missingPhotos: number;
}

/**
 * Renders a report to a .docx.
 *
 * The photos are read here rather than being carried in the report data: they
 * are megabytes of binary that only matter at the moment of generation.
 */
export async function generateReport(report: Report, reportId?: string): Promise<GeneratedReport> {
  // Export a copy: unfinished tables stay available for the next editing session.
  report = {
    ...report,
    elfProtocols: measuredProtocols(report.elfProtocols),
    rfProtocols: measuredProtocols(report.rfProtocols),
  };
  const started = process.hrtime.bigint();
  const template = await rewordConclusions(activeTemplateBytes(), report);
  const { inputs: photos, missing: missingPhotos } = reportId
    ? loadPhotoInputs(reportId, report)
    : { inputs: [], missing: 0 };

  // Signatures are resolved once here and attached per row. They cannot live in
  // the template: it repeats a single row per table, so a signature baked into
  // that row would be stamped on everyone in it.
  const signatures = new Map<string, SignatureInput | null>();
  const printedInspectors = inspectorsForScope(report.inspectors, report.surveyScope);
  for (const person of [...printedInspectors, ...report.authors]) {
    if (!person.signatureId || signatures.has(person.signatureId)) continue;
    const stored = loadSignature(person.signatureId);
    signatures.set(
      person.signatureId,
      stored
        ? {
            bytes: stored.bytes,
            contentType: stored.contentType,
            width: stored.width,
            height: stored.height,
            label: stored.label,
          }
        : null,
    );
  }

  // ── Antenna map ────────────────────────────────────────────────────
  //
  // Request the appendix automatically, without blocking the report if its data
  // or the mapping service is unavailable.
  let antennaInput: AntennaMapInput | null = null;
  let antennaMapOmitted = false;
  if (shouldIncludeAntennaMap(report)) {
    try {
      antennaInput = await buildAntennaInput(report);
    } catch (err) {
      console.error('[antenna-map] generation failed:', err);
      antennaMapOmitted = true;
    }
  }

  const bytes = mergeDocx(template, buildMergeData(report), {
    // An ELF-only or RF-only survey prints only its own half of the document — and
    // only the licence that covers it, which is written into the template as literal
    // rows rather than as a loop and so has to be cut here too. The closing appendix
    // then argues for a repeat survey in the terms of the site that was surveyed.
    rewrite: (xml) => {
      // Read inside out: drop the survey that was not carried out, then its licence row
      // and its appendix, then state the thresholds this site is held to, argue for a
      // repeat survey in the terms of that same site, and close with the calibration
      // certificates of the instruments that took the measurements.
      let out = appendCalibrationTag(
        applySiteAppendix(
          applyConclusionPreamble(
            stripRfAppendix(
              stripUnusedPermitRow(stripUnusedSurvey(xml, report.surveyScope), report.surveyScope),
              report.surveyScope,
            ),
            report.siteCharacter,
          ),
          report.siteCharacter,
        ),
      );
      // Insert the antenna map tag before the calibration appendix when we have data.
      if (antennaInput || antennaMapOmitted) {
        out = appendAntennaMapTag(out);
      }
      return out;
    },
    prepare: (zip) => {
      // Each signature is added to the archive once, however many rows use it.
      let index = 0;
      const xmlById = new Map<string, string>();
      for (const [id, signature] of signatures) {
        xmlById.set(id, buildSignatureXml(zip, signature, index++));
      }
      const withSignature = <T extends { signatureId: string }>(person: T) => ({
        ...person,
        signatureXml: xmlById.get(person.signatureId) ?? '<w:p/>',
      });

      return {
        photosXml: buildPhotosXml(zip, photos),
        // The calibration certificates of the instruments this survey actually used.
        calibrationXml: buildCalibrationXml(zip, report.surveyScope),
        // Antenna map + detailed table (when available).
        antennaMapXml: antennaInput
          ? buildAntennaMapXml(zip, antennaInput)
          : antennaMapOmitted
            ? '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:t>נספח מפת האנטנות לא נכלל בדוח משום שלא היו זמינים נתונים להפקתו.</w:t></w:r></w:p>'
            : '<w:p/>',
        // Narrowed the same way as in the mapper — this assignment overrides it.
        inspectors: printedInspectors.map(withSignature),
        authors: report.authors.map(withSignature),
      };
    },
  });

  return {
    bytes,
    fileName: buildFileName(report),
    durationMs: Number(process.hrtime.bigint() - started) / 1e6,
    missingPhotos,
  };
}

/**
 * Pairs each caption in the report with its stored image.
 *
 * A caption whose image is missing is skipped rather than failing the whole
 * generation — a half-uploaded photo should not block a deadline.
 *
 * But it is no longer skipped *quietly*. The report's JSON holds the captions and the
 * `photos` table holds the bytes, and the two can come apart: the bytes live in the
 * SQLite file, so a deployment that restarts without a persistent volume at
 * `REPORT_DB_PATH` loses them while the captions survive. What the surveyor then sees
 * is a report that still lists its photographs, produced with none in it and with no
 * error anywhere — the appendix simply is not there, and nothing says why.
 *
 * So the mismatch is counted and logged, and `generateReport` puts it on the download
 * itself. Losing the pictures is bad; losing them silently is what let a report reach
 * a customer without the appendix it claims to have.
 */
function loadPhotoInputs(
  reportId: string,
  report: Report,
): { inputs: PhotoInput[]; missing: number } {
  const rows = db()
    .prepare('SELECT id, bytes, content_type, width, height FROM photos WHERE report_id = ?')
    .all(reportId) as Array<{ id: string; bytes: Uint8Array; content_type: string; width: number; height: number }>;
  const byId = new Map(rows.map((r) => [r.id, r]));

  const inputs: PhotoInput[] = [];
  let missing = 0;
  for (const photo of report.photos) {
    const stored = byId.get(photo.imageId);
    if (!stored) {
      missing++;
      continue;
    }
    inputs.push({
      bytes: Buffer.from(stored.bytes),
      contentType: stored.content_type,
      width: stored.width,
      height: stored.height,
      caption: photo.caption,
    });
  }

  if (missing > 0) {
    console.error(
      `דוח ${reportId}: ${missing} מתוך ${report.photos.length} תמונות רשומות בדוח אך הקבצים עצמם חסרים במסד — ` +
        'הן לא ייכללו בנספח. בדרך כלל הסיבה היא שמסד הנתונים נמחק בפריסה מחדש (REPORT_DB_PATH ללא volume קבוע).',
    );
  }

  return { inputs, missing };
}

// ── Antenna map ────────────────────────────────────────────────────

/**
 * A known, explainable reason the antenna appendix could not be built — a bad address,
 * a missing field. Its message is written for the surveyor and safe to show as-is.
 *
 * Anything else (a browser that failed to launch, data.gov.il unreachable, a timeout) is
 * a plain `Error` instead: `generateReport` logs those in full on the server but never
 * shows their raw text to a surveyor, who has no way to act on "stderr: Command
 * '/usr/bin/chromium-browser' requires the chromium snap to be installed".
 */
class AntennaMapError extends Error {}

/**
 * The address and city default from data the survey already carries, so the surveyor is
 * never asked to retype something already on screen. `addressLine`/`city` are the
 * recipient's address from step 1 — in practice the surveyed property, since the
 * customer being billed is normally the one whose site was measured. `location` (filled
 * from "שם האתר") is the fallback for the cases where it is not — an occasional branch
 * visit, or a private customer whose "מקום" was typed by hand.
 */
function antennaMapAddress(report: Report): string {
  return report.antennaMapAddress || report.addressLine || report.location || report.siteName || '';
}

function antennaMapCity(report: Report): string {
  return report.antennaMapCity || report.city || '';
}

async function buildAntennaInput(report: Report): Promise<AntennaMapInput | null> {
  const { findReportAntennas, geocodeAddress } = await import('./antennas');
  const { renderAntennaMapPng } = await import('./antenna-map-render');

  let centerX: number;
  let centerY: number;

  if (report.antennaMapX && report.antennaMapY) {
    centerX = report.antennaMapX;
    centerY = report.antennaMapY;
  } else {
    const address = antennaMapAddress(report);
    const city = antennaMapCity(report);
    if (!address && !city) {
      throw new AntennaMapError('חסרה כתובת של אתר הבדיקה לצורך מפת האנטנות.');
    }
    const geo = await geocodeAddress(address, city);
    if (!geo) {
      throw new AntennaMapError(
        'כתובת אתר הבדיקה לא נמצאה על המפה; יש לתקן את הכתובת או העיר בשדות נספח המפה.',
      );
    }
    centerX = geo.x;
    centerY = geo.y;
  }

  // Start at 500 m and expand to 1 km only if empty. The same result controls
  // the map's coverage, its caption and the detailed antenna table.
  const searchResult = await findReportAntennas(centerX, centerY);

  const label = report.antennaMapLabel || report.siteName || report.location || 'נקודת הבדיקה';
  const classification = report.antennaMapClassification || report.siteCharacter || '';

  const mapPng = await renderAntennaMapPng(searchResult, {
    pointLabel: label,
    pointAddress: [antennaMapAddress(report), antennaMapCity(report)]
      .map((part) => part.trim())
      .filter((part, index, parts) => part !== '' && parts.indexOf(part) === index)
      .join(', '),
    pointCity: antennaMapCity(report),
    pointClassification: classification,
  });

  if (!mapPng) {
    throw new Error('No headless browser was available to render the antenna map.');
  }

  return { mapPng, searchResult };
}

/**
 * Names the file the way the survey team files it: subject, then reference.
 *
 * Windows rejects a handful of characters in file names and silently truncates
 * very long ones, so both are handled here rather than in the browser.
 */
function buildFileName(report: Report): string {
  const parts = [reportSubject(report) || 'דוח בדיקת קרינה'];
  if (report.referenceNumber) parts.push(`סימוכין ${report.referenceNumber}`);

  const name = parts
    .join(' - ')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);

  return `${name}.docx`;
}

/**
 * Rewords the passages the template highlights, before anything is merged.
 *
 * The conclusions are not placeholders: the template holds a real, finished
 * example, and whatever is highlighted in it is what this survey has to say
 * differently. Each highlighted passage goes to the model with its own text as
 * the example and the measured facts as the content, and comes back the same
 * length in the same register.
 *
 * Never fatal. A model that is unreachable, out of credit or slow costs the
 * report its tailored wording, not the report — the example text stays, which
 * is wrong for this site but is at least a complete, readable document. That
 * trade is deliberate: a surveyor pressing "הורדת Word" gets a file.
 *
 * The one thing that happens either way is the highlight coming off. It marks
 * the passages for this code and means nothing to a customer, so a document
 * generated with no model behind it still leaves the building without yellow
 * on it.
 */
async function rewordConclusions(template: Buffer, report: Report): Promise<Buffer> {
  const zip = new PizZip(template);
  const file = zip.file('word/document.xml');
  if (!file) return template;

  const xml = file.asText();
  const slots = collectConclusionSlots(xml);
  if (slots.length === 0) return template;

  const findings = computeFindings(report);
  const unmeasuredText = (kind: 'elf' | 'rf') =>
    findings[kind].pointCount === 0
      ? [`לא הוזנו ערכי מדידה בתחום ${kind.toUpperCase()}. לא ניתן להסיק מסקנות מדידה בתחום זה.`]
      : null;

  const drafted = aiDraftingAvailable()
    ? await Promise.all(
        slots.map(async (slot) => {
          const empty = unmeasuredText(slot.kind === 'rf' ? 'rf' : 'elf');
          if (empty) return empty;
          try {
            return await draftConclusionSlot({
              kind: slot.kind,
              example: slot.example,
              wholeParagraphs: slot.wholeParagraphs,
              surrounding: slot.surrounding,
              // `collectConclusionSlots` only ever produces the two
              // electromagnetic kinds; radon builds its own slot elsewhere.
              findings: describeFindings(findings, slot.kind === 'rf' ? 'rf' : 'elf'),
              siteName: report.siteName,
              siteCharacter: report.siteCharacter,
            });
          } catch (err) {
            console.error('ניסוח קטע במסקנות נכשל — נשאר נוסח הדוגמה', err);
            return slot.example;
          }
        }),
      )
    : slots.map((slot) => unmeasuredText(slot.kind === 'rf' ? 'rf' : 'elf') ?? slot.example);

  zip.file('word/document.xml', applyConclusionSlots(xml, slots, drafted));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
