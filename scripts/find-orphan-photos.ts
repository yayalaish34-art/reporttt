/**
 * Finds photographs whose caption row has been lost.
 *
 * The image bytes live in the `photos` table; the caption that points at one lives in
 * `reports.data.photos`. Everything that reads a report — the editor and the merge both
 * — walks the captions, so a photograph the captions no longer mention is invisible even
 * though its bytes are perfectly intact. That is what "the photos disappeared" looks like
 * from the database side.
 *
 *   npx tsx scripts/find-orphan-photos.ts           # report only
 *   npx tsx scripts/find-orphan-photos.ts --restore # re-attach them to their report
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const restore = process.argv.includes('--restore');
const path = process.env.REPORT_DB_PATH ?? resolve(process.cwd(), 'data/reports.db');
const db = new DatabaseSync(path);

const reports = db.prepare('SELECT id, title, data, updated_at FROM reports ORDER BY updated_at DESC').all() as Array<{
  id: string; title: string; data: string; updated_at: string;
}>;

console.log(`בסיס נתונים: ${path}`);
console.log(`דוחות: ${reports.length}\n`);

let totalOrphans = 0;

for (const report of reports) {
  const rows = db.prepare('SELECT id, created_at FROM photos WHERE report_id = ? ORDER BY created_at').all(report.id) as Array<{
    id: string; created_at: string;
  }>;
  const data = JSON.parse(report.data) as { photos?: Array<{ imageId: string; caption: string }> };
  const captions = data.photos ?? [];
  const known = new Set(captions.map((p) => p.imageId));
  const orphans = rows.filter((r) => !known.has(r.id));

  if (rows.length === 0 && captions.length === 0) continue;

  const flag = orphans.length > 0 ? '  ⚠ יתומות: ' + orphans.length : '';
  console.log(`${report.updated_at.slice(0, 16)}  ${report.title.slice(0, 45)}`);
  console.log(`   תמונות מאוחסנות: ${rows.length}   מוזכרות בדוח: ${captions.length}${flag}`);

  if (orphans.length === 0) continue;
  totalOrphans += orphans.length;

  if (restore) {
    // Appended in the order they were taken, with no caption: the surveyor names them.
    // Better an unnamed photograph in the report than one that is not there at all.
    for (const orphan of orphans) captions.push({ imageId: orphan.id, caption: '' });
    data.photos = captions;
    db.prepare('UPDATE reports SET data = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(data), new Date().toISOString(), report.id);
    console.log(`   ✓ ${orphans.length} תמונות הוחזרו לדוח`);
  }
}

console.log(
  totalOrphans === 0
    ? '\nלא נמצאו תמונות יתומות.'
    : restore
      ? `\n${totalOrphans} תמונות הוחזרו.`
      : `\n${totalOrphans} תמונות יתומות. לשחזור: npx tsx scripts/find-orphan-photos.ts --restore`,
);
