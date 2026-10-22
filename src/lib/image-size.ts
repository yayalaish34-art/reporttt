/**
 * Reads pixel dimensions straight from an image's header bytes.
 *
 * Word renders a drawing at exactly the size the document specifies, so the
 * aspect ratio has to be known before the photo appendix is built. Parsing the
 * few header bytes avoids a decoding dependency for what is a handful of
 * integers.
 */

export interface ImageDimensions {
  width: number;
  height: number;
  /** MIME type inferred from the magic bytes, not from the upload's claim. */
  contentType: string;
}

/** Dimensions and type of an image, or null when the format is unrecognised. */
export function readImageSize(bytes: Buffer): ImageDimensions | null {
  return readPng(bytes) ?? readJpeg(bytes) ?? readGif(bytes) ?? readBmp(bytes) ?? readWebp(bytes);
}

/**
 * True when the bytes are a HEIC/HEIF photograph — what an iPhone shoots by default.
 *
 * These carry no dimensions this file can read and Word cannot display them, so they
 * are not a format `readImageSize` can be taught. They are detected here so the upload
 * path can convert them to JPEG instead of rejecting them, which is what it did: the
 * camera input accepts `image/*`, the phone handed over a .HEIC, and the surveyor was
 * told the file type was unsupported after photographing the thing they came to
 * photograph. On an Android, whose camera writes JPEG, the same screen worked — which
 * is why this looked like "some phones".
 *
 * The container is ISO-BMFF: a four-byte length, the tag "ftyp", then a brand. The
 * brands below are the ones Apple writes (`heic`/`heix` for photographs, `mif1`/`msf1`
 * for the generic still-image profiles) plus `avif`, which is the same container.
 */
export function isHeic(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  if (bytes.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brand = bytes.toString('ascii', 8, 12);
  return ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avif', 'avis'].includes(
    brand,
  );
}

function readPng(b: Buffer): ImageDimensions | null {
  // 8-byte signature, then an IHDR chunk whose width and height are big-endian.
  if (b.length < 24) return null;
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), contentType: 'image/png' };
}

function readJpeg(b: Buffer): ImageDimensions | null {
  if (b.length < 4 || b.readUInt16BE(0) !== 0xffd8) return null;

  // Walk the marker segments to the first start-of-frame, which carries the
  // dimensions. Everything before it is metadata of unpredictable length.
  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset++; // resynchronise on a padding byte
      continue;
    }
    const marker = b[offset + 1];
    // SOF0-SOF15, excluding the non-frame markers DHT (c4), JPGA (c8), DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: b.readUInt16BE(offset + 5),
        width: b.readUInt16BE(offset + 7),
        contentType: 'image/jpeg',
      };
    }
    const segmentLength = b.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null; // malformed; refuse rather than loop
    offset += 2 + segmentLength;
  }
  return null;
}

function readGif(b: Buffer): ImageDimensions | null {
  if (b.length < 10 || b.toString('ascii', 0, 3) !== 'GIF') return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8), contentType: 'image/gif' };
}

function readBmp(b: Buffer): ImageDimensions | null {
  if (b.length < 26 || b.toString('ascii', 0, 2) !== 'BM') return null;
  // Height is signed: a negative value means the rows are stored top-down.
  return { width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)), contentType: 'image/bmp' };
}

function readWebp(b: Buffer): ImageDimensions | null {
  if (b.length < 30) return null;
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;

  const format = b.toString('ascii', 12, 16);
  if (format === 'VP8X') {
    return {
      width: 1 + b.readUIntLE(24, 3),
      height: 1 + b.readUIntLE(27, 3),
      contentType: 'image/webp',
    };
  }
  if (format === 'VP8 ') {
    return {
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff,
      contentType: 'image/webp',
    };
  }
  if (format === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      contentType: 'image/webp',
    };
  }
  return null;
}
