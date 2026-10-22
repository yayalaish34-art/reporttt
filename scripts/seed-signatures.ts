/**
 * Lifts the signature images out of the source report into the signature library.
 *
 * The signatures are already in the document — they were baked into the
 * inspector and author rows. This pulls them out so a report can pick one per
 * person instead, which is what stops one person's mark being stamped on
 * everybody's row.
 *
 * Idempotent: a signature already on file under the same name is left alone.
 *
 *   npx tsx scripts/seed-signatures.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { createSignature, findSignatureByLabel, listSignatures } from '../src/lib/signature-service';
import { readImageSize } from '../src/lib/image-size';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'templates/source/report-source.docx');

/**
 * Which image in the source belongs to whom.
 *
 * Read off the source document: the inspector rows both embed `image3`, the
 * report author's row `image4`, and the approver's `image5`. The two יורם גבאי
 * images are separate scans of the same signature, so both are kept and named
 * for where they were used.
 */
const SIGNATURES: Array<{ media: string; label: string }> = [
  { media: 'word/media/image3.png', label: 'יורם גבאי — בודק' },
  { media: 'word/media/image4.png', label: 'חיים כהן' },
  { media: 'word/media/image5.png', label: 'יורם גבאי — מאשר' },
];

if (!existsSync(SOURCE)) {
  console.error(`מסמך המקור לא נמצא: ${SOURCE}`);
  process.exit(1);
}

const zip = new PizZip(readFileSync(SOURCE));
let added = 0;

for (const { media, label } of SIGNATURES) {
  if (findSignatureByLabel(label)) {
    console.log(`קיימת כבר: ${label}`);
    continue;
  }

  const file = zip.file(media);
  if (!file) {
    console.error(`  ${media} לא נמצא בארכיון — מדלג על ${label}`);
    continue;
  }

  const bytes = Buffer.from(file.asUint8Array());
  const size = readImageSize(bytes);
  if (!size) {
    console.error(`  לא ניתן לקרוא את מידות ${media} — מדלג על ${label}`);
    continue;
  }

  createSignature(label, bytes, size.contentType, size.width, size.height);
  added++;
  console.log(`נוספה: ${label} (${size.width}×${size.height}, ${(bytes.length / 1024).toFixed(1)} KB)`);
}

console.log(`\n${added} חתימות נוספו. סה"כ בספרייה: ${listSignatures().length}`);
