import { db, now } from './db';
import { draftMoldReport } from './mold-draft';
import { scanMoldLabImages } from './mold-lab-scan';
import { applyLabScan } from './mold-rules';
import type { LabResult, MoldReport } from './mold-schema';
import { addMoldPhoto, deleteMoldPhoto, listMoldReports, loadMoldReport, saveMoldReport } from './mold-service';
import { renderPdfPages } from './pdf-pages-server';

/**
 * A laboratory report from Hayes, arrived by e-mail, turned into a mould report.
 *
 * The CRM watches the mailboxes for reporting@hayesmicrobial.com, the way it watches
 * for new leads, and hands each PDF here. What happens next is what the surveyor did
 * by hand in the editor's second step: the pages are read into the result tables, the
 * results find the rooms they belong to, the pages become the closing appendix, and
 * the closing sections are drafted — so the report is waiting, written, when somebody
 * opens it.
 *
 * Which report it belongs to is read off the numbers. The Chain of Custody gave every
 * room a number ("511-3", or the cassette's media number) and Hayes reports each result
 * under it, so the report whose rooms carry the most of those numbers is the job. When
 * none does — the survey was never opened here — a new report is made from the sheet.
 */

export interface MoldIntakeResult {
  reportId: string;
  /** True when no existing report matched and a new one was made. */
  created: boolean;
  /** True when this e-mail had already been processed — nothing was changed. */
  duplicate: boolean;
  samples: number;
  warning?: string;
}

const norm = (value: string) => value.replace(/\s+/g, '').toLowerCase();

/** How many of the scanned results a report's own numbers account for. */
function matchScore(report: MoldReport, results: LabResult[], labReportNumber: string): number {
  const numbers = new Set(
    report.samples.flatMap((s) => [s.mediaNumber, s.labNumber]).map(norm).filter(Boolean),
  );
  const job = norm(report.coc.jobNumber);
  let score = 0;
  for (const r of results) {
    if (numbers.has(norm(r.labNumber)) || numbers.has(norm(r.sampleName))) score += 2;
    else if (job && norm(r.labNumber).split('-')[0] === job) score += 1;
  }
  if (labReportNumber && norm(report.labReportNumber) === norm(labReportNumber)) score += 3;
  return score;
}

/** The report these results belong to, or null when no report's numbers match. */
function findReportFor(results: LabResult[], labReportNumber: string): { id: string; report: MoldReport } | null {
  let best: { id: string; report: MoldReport; score: number } | null = null;
  // Newest first, so a tie goes to the survey most recently worked on.
  for (const row of listMoldReports()) {
    const report = loadMoldReport(row.id);
    if (!report) continue;
    const score = matchScore(report, results, labReportNumber);
    if (score > 0 && (!best || score > best.score)) best = { id: row.id, report, score };
  }
  return best;
}

export async function intakeHayesReport(input: {
  pdf: Buffer;
  /** The e-mail's internet message id — the same in every mailbox it reached. */
  messageId: string;
  /** Opens a blank report when none matches — the editor's own "new report". */
  createReport: () => Promise<string>;
}): Promise<MoldIntakeResult> {
  const seen = db()
    .prepare('SELECT report_id FROM mold_intake WHERE message_id = ?')
    .get(input.messageId) as { report_id: string } | undefined;
  if (seen) return { reportId: seen.report_id, created: false, duplicate: true, samples: 0 };

  const pages = await renderPdfPages(input.pdf);
  if (pages.length === 0) throw new Error('ה-PDF ריק');
  const scan = await scanMoldLabImages(pages.map((bytes) => ({ bytes, contentType: 'image/png' })));
  if (scan.results.length === 0) throw new Error('לא נקראו תוצאות מה-PDF — ייתכן שאינו דוח תוצאות');

  const match = findReportFor(scan.results, scan.details?.labReportNumber ?? '');
  const reportId = match?.id ?? (await input.createReport());
  const base = match?.report ?? loadMoldReport(reportId);
  if (!base) throw new Error('הדוח החדש לא נמצא');

  let report = applyLabScan(base, scan.results, scan.details).report;

  // The pages replace any sheets a previous scan left: the scan itself replaces the
  // previous reading, and the appendix must show the pages the figures came from.
  for (const sheet of report.labSheets) deleteMoldPhoto(sheet.imageId);
  report = {
    ...report,
    labSheets: pages.map((bytes, i) => ({
      imageId: addMoldPhoto(reportId, bytes, 'image/png', ...pngSize(bytes)),
      caption: `תוצאות המעבדה — Hayes, עמוד ${i + 1} מתוך ${pages.length}`,
    })),
  };

  // Drafted only when nothing has been written yet — wording somebody already edited
  // is theirs, and a corrected laboratory report must not silently reword it.
  if (!report.executiveSummary.trim() && report.conclusions.every((c) => !c.trim())) {
    report = { ...report, ...(await draftMoldReport(report)) };
  }

  saveMoldReport(reportId, report);
  db()
    .prepare('INSERT OR IGNORE INTO mold_intake (message_id, report_id, created_at) VALUES (?, ?, ?)')
    .run(input.messageId, reportId, now());

  return {
    reportId,
    created: !match,
    duplicate: false,
    samples: scan.results.length,
    warning:
      scan.emptyPages > 0 ? `${scan.emptyPages} מתוך ${scan.pages} עמודים לא נקראו` : undefined,
  };
}

/** A PNG's width and height, from its header. */
function pngSize(bytes: Buffer): [number, number] {
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}
