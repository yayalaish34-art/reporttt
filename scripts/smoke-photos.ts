/**
 * Renders a report with photographs and verifies the archive stays consistent.
 *
 * Injecting an image touches three parts that must agree — the media file, the
 * relationship, and the content-type default. A mistake in any one of them
 * produces the same symptom: Word offers to repair the file. This checks all
 * three explicitly rather than trusting that the merge did not throw.
 *
 *   npx tsx scripts/smoke-photos.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { mergeDocx } from '../src/lib/docx/merge-docx';
import { buildPhotosXml, type PhotoInput } from '../src/lib/docx/photos';
import { buildMergeData } from '../src/lib/report-mapper';
import { sampleReport } from '../src/lib/sample-report';
import { readImageSize } from '../src/lib/image-size';
import { textOf } from '../src/lib/docx/ooxml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = resolve(ROOT, 'templates/report-template.docx');
const OUT = resolve(ROOT, 'out/smoke-photos.docx');

// Borrow real images out of the template's own media so the test exercises
// actual photographs rather than a synthetic one-pixel file.
const source = new PizZip(readFileSync(resolve(ROOT, 'templates/source/report-source.docx')));
const candidates = Object.keys(source.files).filter((n) => /^word\/media\/.*\.(png|jpe?g)$/i.test(n)).slice(0, 3);

const photos: PhotoInput[] = candidates.map((name, i) => {
  const bytes = Buffer.from(source.file(name)!.asUint8Array());
  const size = readImageSize(bytes);
  if (!size) throw new Error(`לא ניתן לקרוא את מידות התמונה ${name}`);
  return {
    bytes,
    contentType: size.contentType,
    width: size.width,
    height: size.height,
    caption: `לוח חשמל קומה ${26 - i} צד דרומי`,
  };
});

console.log('תמונות לבדיקה:');
for (const p of photos) console.log(`  ${p.width}×${p.height} ${p.contentType} — ${p.caption}`);

const report = sampleReport();
const merged = mergeDocx(readFileSync(TEMPLATE), buildMergeData(report), {
  prepare: (zip) => ({ photosXml: buildPhotosXml(zip, photos) }),
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, merged);
console.log(`\nנכתב: ${OUT} (${(merged.length / 1024 / 1024).toFixed(1)} MB)`);

// ── Assertions ──────────────────────────────────────────────────────

const zip = new PizZip(merged);
let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\nבדיקות:');

const entries = Object.keys(zip.files);
check(entries[0] === '[Content_Types].xml', 'הפריט הראשון בארכיון הוא [Content_Types].xml', entries[0]);

const media = entries.filter((e) => e.startsWith('word/media/report-photo-'));
check(media.length === photos.length, 'קבצי התמונה נוספו לארכיון', `${media.length}/${photos.length}`);

const doc = zip.file('word/document.xml')!.asText();
const rels = zip.file('word/_rels/document.xml.rels')!.asText();
const types = zip.file('[Content_Types].xml')!.asText();

// Every relationship the document references must exist in the rels part.
const referenced = [...doc.matchAll(/r:embed="(rId\d+)"/g)].map((m) => m[1]);
const declared = new Set([...rels.matchAll(/Id="(rId\d+)"/g)].map((m) => m[1]));
const dangling = [...new Set(referenced)].filter((id) => !declared.has(id));
check(dangling.length === 0, 'כל הפניות התמונה מוגדרות ב-rels', dangling.join(', '));

// Relationship ids must be unique, or Word takes the first and drops the rest.
const allIds = [...rels.matchAll(/Id="(rId\d+)"/g)].map((m) => m[1]);
check(allIds.length === new Set(allIds).size, 'אין מזהי rId כפולים', `${allIds.length} הפניות`);

// Every relationship target must point at a part that is actually present.
const targets = [...rels.matchAll(/Target="(media\/[^"]+)"/g)].map((m) => `word/${m[1]}`);
const missingTargets = targets.filter((t) => !zip.file(t));
check(missingTargets.length === 0, 'כל היעדים של ההפניות קיימים בארכיון', missingTargets.slice(0, 3).join(', '));

// Every media extension must have a content-type default.
const extensions = new Set(entries.filter((e) => e.startsWith('word/media/')).map((e) => e.split('.').pop()!.toLowerCase()));
const undeclared = [...extensions].filter((ext) => !new RegExp(`Extension="${ext}"`, 'i').test(types));
check(undeclared.length === 0, 'לכל סיומת תמונה יש הגדרת content-type', undeclared.join(', '));

// The captions must have rendered. `textOf` decodes the XML entities, so the
// apostrophe in "תמונה מס'" is compared as the character, not as `&apos;`.
const text = textOf(doc);
const missingCaptions = photos.filter((p) => !text.includes(p.caption));
check(missingCaptions.length === 0, 'כל הכיתובים רונדרו', `${missingCaptions.length} חסרים`);
check(text.includes("תמונה מס' 1"), 'התמונות ממוספרות');

// ── One photograph per page ─────────────────────────────────────────
//
// The count is taken from the appendix alone: the report body has page breaks
// of its own, and counting the whole document would pass no matter what the
// appendix did.

const appendix = buildPhotosXml(new PizZip(readFileSync(TEMPLATE)), photos);
const breaks = (appendix.match(/<w:br w:type="page"\/>/g) ?? []).length;
check(breaks === photos.length, 'מעבר עמוד לכל תמונה', `${breaks} מעברים ל-${photos.length} תמונות`);
check(appendix.startsWith('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'), 'הנספח נפתח בעמוד חדש');
check(!appendix.endsWith('<w:br w:type="page"/></w:r></w:p>'), 'הדוח לא מסתיים בעמוד ריק');

// Between every pair of photographs, and only between them: a caption must be
// followed by a break before the next image begins.
// The caption is matched without its apostrophe: in the raw XML it is escaped
// to `&apos;`, so the rendered form never appears.
const order = [...appendix.matchAll(/<w:br w:type="page"\/>|תמונה מס/g)].map((m) =>
  m[0].startsWith('<') ? '⏎' : '🖼',
);
check(order.join('') === '⏎🖼'.repeat(photos.length), 'הסדר הוא מעבר-תמונה חוזר', order.join(''));

check(
  buildPhotosXml(new PizZip(readFileSync(TEMPLATE)), []) === '<w:p/>',
  'דוח בלי תמונות לא מקבל מעבר עמוד',
);

// The caption titles the page, so it comes before the picture and is set large
// enough to read as a heading rather than as a footnote under it.
const layout = [...appendix.matchAll(/תמונה מס|<w:drawing>/g)].map((m) =>
  m[0] === '<w:drawing>' ? '🖼' : '📝',
);
check(layout.join('') === '📝🖼'.repeat(photos.length), 'הכיתוב מעל התמונה', layout.join(''));

const captionRun = appendix.match(/<w:r><w:rPr>[^<]*(?:<[^>]+>)*?<\/w:rPr><w:t[^>]*>תמונה מס/);
check(/<w:b\/>/.test(captionRun?.[0] ?? ''), 'הכיתוב מודגש');
check(/<w:sz w:val="28"\/>/.test(captionRun?.[0] ?? ''), 'הכיתוב בגודל 14pt');

// ── A photograph the report lists but the database has lost ─────────
//
// The captions live in the report's own JSON and the image bytes live in the `photos`
// table, so the two can come apart — which is exactly what a deploy without a
// persistent volume at REPORT_DB_PATH does: the file is recreated empty, the reports
// come back from elsewhere with their captions intact, and the pictures are gone.
//
// The generation deliberately does not fail on that; a half-uploaded photograph should
// not block a deadline. What it must not do is stay silent, which is how radiation
// reports reached customers with an empty appendix and nobody knew why.

console.log('\nתמונה שרשומה בדוח אך חסרה במסד:');

{
  const { createReport, deleteReport, addPhoto, loadReport, saveReport, generateReport } =
    await import('../src/lib/report-service');
  const { db } = await import('../src/lib/db');

  const id = createReport({ ...sampleReport(), photos: [] } as never);
  try {
    const imageId = addPhoto(id, photos[0].bytes, photos[0].contentType, photos[0].width, photos[0].height);
    const stored = loadReport(id)!;
    stored.photos.push({ imageId, caption: 'לוח חשמל ראשי' });
    saveReport(id, stored);

    const whole = await generateReport(loadReport(id)!, id);
    const wholeXml = new PizZip(whole.bytes).file('word/document.xml')!.asText();
    check(whole.missingPhotos === 0, 'תמונה קיימת — אין דיווח על חוסר', String(whole.missingPhotos));
    check(/תמונה מס/.test(textOf(wholeXml)), 'והיא נכללת בנספח');

    // Now the bytes vanish while the caption survives — the shape the lost volume leaves.
    db().prepare('DELETE FROM photos WHERE id = ?').run(imageId);

    const short = await generateReport(loadReport(id)!, id);
    const shortXml = new PizZip(short.bytes).file('word/document.xml')!.asText();
    check(short.missingPhotos === 1, 'התמונה החסרה נספרת ומדווחת', String(short.missingPhotos));
    check(!/תמונה מס/.test(textOf(shortXml)), 'הנספח אכן יוצא בלעדיה');
    check(loadReport(id)!.photos.length === 1, 'והדוח עדיין מציג אותה — זה מה שמבלבל את הסוקר');
  } finally {
    deleteReport(id);
  }
}

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
