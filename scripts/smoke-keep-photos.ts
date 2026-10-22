/**
 * A save must never drop a photograph by forgetting it.
 *
 * The bug this pins down: every save sends the whole report from the browser, and the
 * server stored it verbatim. When the browser's copy was a moment out of date — an
 * upload that had not reached the state yet, a component holding `report` from an
 * earlier render, a result lost on the way back — the next save wrote a photo list
 * missing a picture the database still held, and the photograph vanished from a table
 * the surveyor had already filled in.
 *
 *   npx tsx scripts/smoke-keep-photos.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A database of its own, so the check cannot touch a real report.
process.env.REPORT_DB_PATH = join(mkdtempSync(join(tmpdir(), 'keep-photos-')), 'test.db');

const { db, now } = await import('../src/lib/db');
const { keepStoredPhotos } = await import('../src/lib/keep-photos');

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const reportId = randomUUID();
db()
  .prepare(
    `INSERT INTO reports (id, reference, title, data, created_at, updated_at)
     VALUES (?, '', 'בדיקה', '{}', ?, ?)`,
  )
  .run(reportId, now(), now());

/** Stores a photograph against the report and returns its id. */
function storePhoto(): string {
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO photos (id, report_id, bytes, content_type, width, height, created_at)
       VALUES (?, ?, ?, 'image/jpeg', 10, 10, ?)`,
    )
    .run(id, reportId, Buffer.alloc(8), now());
  return id;
}

console.log('\nשמירה שמכירה את כל התמונות');

const first = storePhoto();
const second = storePhoto();

const complete = [
  { imageId: first, caption: 'לוח חשמל' },
  { imageId: second, caption: 'ארון תקשורת' },
];
const unchanged = keepStoredPhotos('photos', reportId, complete);
check(unchanged.length === 2, 'שתי תמונות נשארות שתיים');
check(
  unchanged[0]!.caption === 'לוח חשמל' && unchanged[1]!.caption === 'ארון תקשורת',
  'והכיתובים של הדפדפן הם שקובעים',
);

console.log('\nשמירה שהגיעה עם רשימה ישנה — הבאג');

// What a save in flight carried: the list from before the second upload landed.
const stale = [{ imageId: first, caption: 'לוח חשמל' }];
const repaired = keepStoredPhotos('photos', reportId, stale);
check(repaired.length === 2, 'התמונה החסרה הוחזרה', `${stale.length} → ${repaired.length}`);
check(
  repaired.some((p) => p.imageId === second),
  'וזו בדיוק התמונה שהעלאה שמרה במסד',
);
check(
  repaired.find((p) => p.imageId === first)?.caption === 'לוח חשמל',
  'כיתוב שכן נשלח לא נדרס',
);
check(
  repaired.find((p) => p.imageId === second)?.caption === '',
  'ולתמונה שהוחזרה אין כיתוב מומצא — עדיף ריק שרואים מתווית שגויה',
);

console.log('\nמחיקה מכוונת');

/*
 * Deleting is a real delete, not an omission. That distinction is the whole design:
 * omissions are no longer honoured, so removal has to remove the row — which is what
 * `removePhoto` does before saving.
 */
db().prepare('DELETE FROM photos WHERE id = ?').run(second);
const afterDelete = keepStoredPhotos('photos', reportId, [
  { imageId: first, caption: 'לוח חשמל' },
]);
check(afterDelete.length === 1, 'תמונה שנמחקה מהמסד אינה חוזרת', String(afterDelete.length));

console.log('\nמקרי קצה');

const emptyReport = randomUUID();
db()
  .prepare(
    `INSERT INTO reports (id, reference, title, data, created_at, updated_at)
     VALUES (?, '', '', '{}', ?, ?)`,
  )
  .run(emptyReport, now(), now());
check(
  keepStoredPhotos('photos', emptyReport, []).length === 0,
  'דוח בלי תמונות נשאר בלי תמונות',
);

// An empty list arriving for a report that has photographs is the worst case of the
// bug — the whole appendix wiped in one save — and must be fully repaired.
const third = storePhoto();
const wiped = keepStoredPhotos('photos', reportId, []);
check(
  wiped.length === 2 && wiped.some((p) => p.imageId === third),
  'רשימה ריקה לגמרי מוחזרת במלואה',
  `${wiped.length} תמונות`,
);

check(
  keepStoredPhotos('photos', randomUUID(), []).length === 0,
  'דוח שאינו קיים אינו מפיל את השמירה',
);

console.log(failures === 0 ? '\nהכול עבר\n' : `\n${failures} בדיקות נכשלו\n`);
process.exit(failures === 0 ? 0 : 1);
