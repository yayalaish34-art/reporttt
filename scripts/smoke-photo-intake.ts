/**
 * Photo intake: what an upload from a phone is allowed to be.
 *
 * The bug this pins down: an iPhone shoots HEIC by default, the camera input accepts
 * `image/*` so the phone handed one over, and nothing downstream could read it — the
 * surveyor photographed the element they had come to photograph and were told the
 * file type was unsupported. An Android, whose camera writes JPEG, worked on the same
 * screen, which is why it looked like "some phones" rather than "one format".
 *
 *   npx tsx scripts/smoke-photo-intake.ts
 */
import { isHeic, readImageSize } from '../src/lib/image-size';
import { acceptPhoto } from '../src/lib/photo-intake';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const { default: sharp } = await import('sharp');

/** A picture whose dimensions are distinctive enough to prove it survived a round trip. */
const source = sharp({
  create: { width: 320, height: 200, channels: 3, background: { r: 180, g: 90, b: 40 } },
});

console.log('\nזיהוי HEIC');

// AVIF is the same ISO-BMFF container Apple's HEIC uses, and is what sharp can write
// here — a real .HEIC from a phone has one of the other brands the detector lists.
const heifBytes = await source.clone().avif({ quality: 40 }).toBuffer();
check(isHeic(heifBytes), 'קובץ מסוג HEIF מזוהה', heifBytes.subarray(4, 12).toString('ascii'));
check(readImageSize(heifBytes) === null, 'ומנתח הכותרות לבדו אינו יודע לקרוא אותו');

const jpegBytes = await source.clone().jpeg().toBuffer();
const pngBytes = await source.clone().png().toBuffer();
check(!isHeic(jpegBytes), 'JPEG אינו מזוהה בטעות כ-HEIC');
check(!isHeic(pngBytes), 'וגם PNG לא');
check(!isHeic(Buffer.alloc(4)), 'קובץ קצר מדי אינו מפיל את הבדיקה');
check(!isHeic(Buffer.from('ftyp just some text here')), 'טקסט שמכיל ftyp אינו נחשב תמונה');

console.log('\nקליטת התמונה');

const converted = await acceptPhoto(heifBytes);
check(converted !== null, 'HEIC מתקבל ולא נדחה — זה הבאג שדווח');
check(converted?.size.contentType === 'image/jpeg', 'והומר ל-JPEG', converted?.size.contentType);
check(
  converted?.size.width === 320 && converted?.size.height === 200,
  'המידות נשמרו',
  `${converted?.size.width}x${converted?.size.height}`,
);
check(
  converted !== null && readImageSize(converted.bytes) !== null,
  'והתוצאה קריאה לנספח התמונות',
);

console.log('\nפורמטים שכבר עבדו');

const asJpeg = await acceptPhoto(jpegBytes);
check(asJpeg?.size.contentType === 'image/jpeg', 'JPEG עובר');
check(
  asJpeg !== null && asJpeg.bytes === jpegBytes,
  'ואינו מקודד מחדש — קידוד מחדש היה עולה באיכות בלי סיבה',
);

const asPng = await acceptPhoto(pngBytes);
check(asPng?.size.contentType === 'image/png', 'PNG עובר');
check(asPng !== null && asPng.bytes === pngBytes, 'וגם הוא נשאר כמות שהוא');

console.log('\nמה שבאמת אינו תמונה');

check((await acceptPhoto(Buffer.from('not an image at all'))) === null, 'טקסט נדחה');
check((await acceptPhoto(Buffer.alloc(0))) === null, 'קובץ ריק נדחה');
// A HEIC header with nothing behind it must fail the conversion rather than throw.
check(
  (await acceptPhoto(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic')]))) === null,
  'כותרת HEIC פגומה נדחית בלי לקרוס',
);

console.log('\nסיבוב לפי EXIF');

/**
 * A photograph taken sideways records its rotation in metadata rather than in the
 * pixels, and Word ignores that tag — so the rotation has to be baked in on the way
 * through, or a portrait photograph prints on its side.
 */
const rotated = await sharp({
  create: { width: 400, height: 100, channels: 3, background: { r: 20, g: 120, b: 200 } },
})
  .withMetadata({ orientation: 6 }) // 6 = rotate 90° clockwise
  .jpeg()
  .toBuffer();
const rotatedHeif = await sharp(rotated).avif({ quality: 40 }).withMetadata({ orientation: 6 }).toBuffer();
const out = await acceptPhoto(rotatedHeif);
check(
  out !== null && out.size.width === 100 && out.size.height === 400,
  'תמונה שצולמה מסובבת יוצאת מסובבת נכון',
  `${out?.size.width}x${out?.size.height}`,
);

console.log(failures === 0 ? '\nהכול עבר\n' : `\n${failures} בדיקות נכשלו\n`);
process.exit(failures === 0 ? 0 : 1);
