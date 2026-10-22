/**
 * Each building's photograph prints after that building's own table.
 *
 * The tabled opinion used to send every picture to one appendix at the end, which
 * left a reader who had just read fifteen rows about a roof matching photographs to
 * buildings by name nine pages later. Now the picture follows its table, the way the
 * radiation report puts a photograph under the measurement table it documents.
 *
 * What this pins down is the part that is easy to get wrong: the numbering runs once
 * across the whole document, and the images have to be written into the archive
 * before it is sealed. A lazy renderer called during the merge produced a file whose
 * pages referenced pictures that were not in it — a document Word opens as broken
 * rather than as visibly wrong.
 *
 *   npx tsx scripts/smoke-building-photos.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PizZip from 'pizzip';

process.env.REPORT_DB_PATH = join(mkdtempSync(join(tmpdir(), 'building-photos-')), 'test.db');

const { db, now } = await import('../src/lib/db');
const { generateAsbestosReport } = await import('../src/lib/asbestos-service');
const { DraftAsbestosReportSchema } = await import('../src/lib/asbestos-schema');
const { newBuildingRow } = await import('../src/lib/asbestos-rules');
const { storeTemplate } = await import('../src/lib/docx/template-store');
const { readFileSync } = await import('node:fs');
const { dirname, resolve } = await import('node:path');
const { fileURLToPath } = await import('node:url');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
storeTemplate(
  readFileSync(resolve(ROOT, 'templates/asbestos-tables-template.docx')),
  'asbestos-tables-template.docx',
  'בדיקה',
  'asbestos-tables',
);

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A 1×1 PNG — enough to be a real image part in the archive. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const reportId = randomUUID();
db()
  .prepare(
    `INSERT INTO asbestos_reports (id, reference, title, data, created_at, updated_at)
     VALUES (?, '', '', '{}', ?, ?)`,
  )
  .run(reportId, now(), now());

function storePhoto(): string {
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO asbestos_photos (id, report_id, bytes, content_type, width, height, created_at)
       VALUES (?, ?, ?, 'image/png', 1, 1, ?)`,
    )
    .run(id, reportId, PNG, now());
  return id;
}

const roofPhoto = storePhoto();
const shedPhoto = storePhoto();
const appendixPhoto = storePhoto();

const report = DraftAsbestosReportSchema.parse({
  referenceNumber: '2609070001',
  reportDate: 'ספטמבר 2026',
  layout: 'tables',
  clientName: 'מזמין לדוגמה',
  siteAddress: 'הרצל 5, חיפה',
  buildings: [
    { ...newBuildingRow(), name: 'ביתן 3', photos: [{ imageId: roofPhoto, caption: 'גג ביתן 3' }] },
    { ...newBuildingRow(), name: 'ביתן זכוכית', photos: [{ imageId: shedPhoto, caption: '' }] },
  ],
  photos: [{ imageId: appendixPhoto, caption: 'צילום אוויר' }],
});

const { bytes } = await generateAsbestosReport(report as never, reportId);
const zip = new PizZip(bytes);
const xml = zip.file('word/document.xml')!.asText();
/**
 * The document's text, with XML entities turned back into characters.
 *
 * `escapeXml` writes an apostrophe as `&apos;` — valid XML that Word renders as an
 * apostrophe — so a caption searched for as plain "תמונה מס'" would never match the
 * markup even though the page is correct.
 */
const unescape = (s: string) =>
  s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const text = unescape(
  (xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''),
);

console.log('\nהמסמך נוצר');

check(!/\{[^}]{1,40}\}/.test(text), 'לא נשארו שדות שלא מולאו');
check(
  Object.keys((zip as unknown as { files: Record<string, unknown> }).files)[0] ===
    '[Content_Types].xml',
  '[Content_Types].xml ראשון בארכיון',
);

console.log('\nהתמונות באמת בקובץ');

const media = Object.keys((zip as unknown as { files: Record<string, unknown> }).files).filter((f) =>
  f.startsWith('word/media/'),
);
check(media.length >= 3, 'שלוש התמונות נכתבו לארכיון', `${media.length} קבצי מדיה`);

// A page that references a picture the archive does not hold is the failure mode a
// lazily-rendered image produces, and Word reports it as a damaged file.
const rels = zip.file('word/_rels/document.xml.rels')!.asText();
const drawn = [...xml.matchAll(/r:embed="([^"]+)"/g)].map((m) => m[1]);
const declared = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
check(
  drawn.length >= 3 && drawn.every((id) => declared.has(id)),
  'כל תמונה שמוצגת מוכרזת ביחסי המסמך',
  `${drawn.length} הפניות`,
);

console.log('\nמספור רץ אחד לכל המסמך');

for (const [n, caption] of [
  [1, 'גג ביתן 3'],
  [3, 'צילום אוויר'],
] as const) {
  check(text.includes(`תמונה מס' ${n} : ${caption}`), `תמונה מס' ${n} — ${caption}`);
}

// A building photo with no caption of its own takes the building's name, which the
// surveyor already typed at the top of the table.
check(text.includes("תמונה מס' 2 : ביתן זכוכית"), 'כיתוב ריק נופל לשם המבנה');

console.log('\nכל תמונה אחרי הטבלה שלה');

/*
 * Positions are taken from the captions rather than from the building names.
 *
 * The names are not unique in the text: "ביתן 3" occurs inside its own caption
 * "גג ביתן 3", so `indexOf` on the bare name finds whichever came first and the
 * comparison says nothing. The captions carry their number and appear once each.
 */
const posOf = (needle: string) => text.indexOf(needle);
const firstPhoto = posOf("תמונה מס' 1");
const secondPhoto = posOf("תמונה מס' 2");
const appendix = posOf("תמונה מס' 3");

check(
  firstPhoto > 0 && firstPhoto < secondPhoto,
  'תמונת המבנה הראשון קודמת לתמונת השני',
  `${firstPhoto} < ${secondPhoto}`,
);
// The second building's table opens after the first building's photograph, which is
// what "the picture sits between the two tables" means in a flat run of text.
/*
 * The second building's name has to be one the template does not print itself.
 * "מחסן" is listed in the label of the "שימוש" row — "בית מגורים, שטח עבודה בעסק,
 * משרד, מחסן, סככה וכו'" — so it occurs in every table and says nothing about where
 * this building's own table begins.
 */
check(posOf('ביתן זכוכית') > firstPhoto, 'טבלת המבנה השני פותחת אחרי תמונת הראשון');
check(secondPhoto > posOf('ביתן זכוכית'), 'ותמונת המבנה השני אחרי הטבלה שלו');
// The appendix is last, after both buildings.
check(appendix > secondPhoto, 'נספח התמונות בסוף');

console.log('\nמבנה בלי תמונה');

const noPhotos = DraftAsbestosReportSchema.parse({
  ...report,
  buildings: [{ ...newBuildingRow(), name: 'ביתן ריק' }],
  photos: [],
});
const plain = await generateAsbestosReport(noPhotos as never, reportId);
const plainText = unescape(
  (
    new PizZip(plain.bytes)
      .file('word/document.xml')!
      .asText()
      .match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? []
  )
    .map((t) => t.replace(/<[^>]+>/g, ''))
    .join(''),
);
check(plainText.includes('ביתן ריק'), 'הטבלה נדפסת');
check(!plainText.includes("תמונה מס'"), 'ובלי כיתוב תמונה מיותר');

console.log(failures === 0 ? '\nהכול עבר\n' : `\n${failures} בדיקות נכשלו\n`);
process.exit(failures === 0 ? 0 : 1);
