import { isHeic, readImageSize, type ImageDimensions } from './image-size';

/**
 * Turns whatever a phone uploaded into something the document can carry.
 *
 * Every photo upload goes through here. The reason it exists is HEIC: an iPhone
 * shoots HEIC by default, the camera input accepts `image/*` so the phone hands
 * one over quite happily, and nothing downstream could read it — not the header
 * parser, not Word. The surveyor photographed the thing they had come to
 * photograph and were told the file type was unsupported. On an Android, whose
 * camera writes JPEG, the identical screen worked, which is why the fault looked
 * like "some phones" rather than "one format".
 *
 * So a HEIC is converted rather than refused. Everything else is passed through
 * untouched: a JPEG from an Android is already what the appendix wants, and
 * re-encoding it would cost quality for nothing.
 */

export interface IntakeResult {
  bytes: Buffer;
  size: ImageDimensions;
}

/**
 * The decoder, loaded only when a HEIC actually arrives.
 *
 * `sharp` is a native module, and importing it at module scope would make every
 * route that touches this file pay for loading it — including the ones that only
 * ever see JPEGs. It is also the one part of this that can legitimately be
 * missing from an environment, and a static import would turn that into a crash
 * on startup rather than a message about one photograph.
 */
async function toJpeg(bytes: Buffer): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  return (
    sharp(bytes)
      // Phones record orientation in metadata rather than in the pixels. Word
      // ignores that tag, so a photograph taken sideways would print sideways
      // unless the rotation is baked in here.
      .rotate()
      .jpeg({ quality: 85 })
      .toBuffer()
  );
}

/**
 * Reads an uploaded photograph, converting it if the format cannot be used.
 *
 * Returns null when the bytes are not an image this can make sense of, which the
 * caller turns into a message naming the file.
 */
export async function acceptPhoto(bytes: Buffer): Promise<IntakeResult | null> {
  const direct = readImageSize(bytes);
  if (direct) return { bytes, size: direct };

  if (!isHeic(bytes)) return null;

  try {
    const converted = await toJpeg(bytes);
    const size = readImageSize(converted);
    // A conversion that produces something unreadable is a failure, not a photo.
    return size ? { bytes: converted, size } : null;
  } catch (err) {
    console.error('המרת HEIC נכשלה', err);
    return null;
  }
}

/** Whether the upload was a HEIC — for a message that says what happened. */
export function wasConverted(original: Buffer): boolean {
  return readImageSize(original) === null && isHeic(original);
}
