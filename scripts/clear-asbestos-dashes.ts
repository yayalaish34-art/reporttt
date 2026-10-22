/**
 * Clears the "—" placeholder out of reports created before it was removed.
 *
 * New opinions used to be seeded with a dash in the client and address fields so the
 * strict schema would accept them at creation. It was a real stored value: it sat in
 * the box looking like an answer and had to be deleted before anything could be typed.
 * Reports written since are created empty, but the ones already stored still carry it.
 *
 * Only the exact placeholder is touched. An address a surveyor genuinely wrote as a
 * dash is left alone — the point is to remove a value nobody chose, not to second-guess
 * one somebody did.
 *
 *   npx tsx scripts/clear-asbestos-dashes.ts          # report what would change
 *   npx tsx scripts/clear-asbestos-dashes.ts --apply  # change it
 */
import { db } from '../src/lib/db';

const apply = process.argv.includes('--apply');
const PLACEHOLDER = '—';

const rows = db()
  .prepare('SELECT id, data FROM asbestos_reports')
  .all() as Array<{ id: string; data: string }>;

let changed = 0;
for (const row of rows) {
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(row.data);
  } catch {
    console.log(`  ! ${row.id} — לא ניתן לקרוא, מדולג`);
    continue;
  }

  const fields = (['clientName', 'siteAddress'] as const).filter(
    (f) => String(report[f] ?? '').trim() === PLACEHOLDER,
  );
  if (fields.length === 0) continue;

  changed++;
  console.log(`  ${apply ? '✓' : '·'} ${row.id} — ${fields.join(', ')}`);
  if (!apply) continue;

  for (const field of fields) report[field] = '';
  db()
    .prepare('UPDATE asbestos_reports SET data = ? WHERE id = ?')
    .run(JSON.stringify(report), row.id);
}

console.log(
  changed === 0
    ? '\nאין דוחות עם המקף.'
    : apply
      ? `\n${changed} דוחות עודכנו.`
      : `\n${changed} דוחות ישתנו. הריצו עם --apply כדי לבצע.`,
);
