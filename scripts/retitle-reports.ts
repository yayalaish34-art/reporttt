/**
 * Rewrites the stored list title of every report.
 *
 * The title column used to hold the cover subject; it now holds the short list title
 * (site, or customer and site for a private one). New saves write the new form on their
 * own, but a report nobody has touched since keeps the old long one — so this brings the
 * existing rows over.
 *
 * Reads and rewrites only the title column. The report data itself is untouched, so this
 * is safe to run more than once.
 *
 *   npx tsx scripts/retitle-reports.ts          # shows what would change
 *   npx tsx scripts/retitle-reports.ts --write  # applies it
 */
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { reportListTitle } from '../src/lib/report-mapper';
import { StoredReportSchema } from '../src/lib/report-schema';

const write = process.argv.includes('--write');
const path = process.env.REPORT_DB_PATH ?? resolve(process.cwd(), 'data/reports.db');
const db = new DatabaseSync(path);

const rows = db.prepare('SELECT id, title, data FROM reports').all() as Array<{
  id: string;
  title: string;
  data: string;
}>;

let changed = 0;
for (const row of rows) {
  const parsed = StoredReportSchema.safeParse(JSON.parse(row.data));
  if (!parsed.success) {
    console.log(`  ⚠ ${row.id} — לא ניתן לקרוא, דולג`);
    continue;
  }
  const next = reportListTitle(parsed.data);
  // An empty title says less than the old one; a report with nothing named keeps it.
  if (next === '' || next === row.title) continue;

  console.log(`  ${row.title.slice(0, 50)}\n  → ${next}\n`);
  changed++;
  if (write) db.prepare('UPDATE reports SET title = ? WHERE id = ?').run(next, row.id);
}

console.log(
  changed === 0
    ? 'אין מה לעדכן.'
    : write
      ? `${changed} דוחות עודכנו.`
      : `${changed} דוחות ישתנו. להרצה בפועל: npx tsx scripts/retitle-reports.ts --write`,
);
