/**
 * Shrinks a photograph in the browser before it is uploaded.
 *
 * A phone camera writes eight to twelve megabytes per shot, and the survey is
 * uploaded from a plant room or a roof over whatever signal is there. A single
 * upload that size takes tens of seconds on a weak connection and fails outright
 * often enough to look like "photos don't work" — which is exactly how it was
 * reported, on Android as well as iPhone.
 *
 * The appendix renders each photograph about six inches wide, so nothing above
 * roughly 2000 pixels on the long edge survives to the printed page anyway. The
 * megabytes were being carried across a mobile connection to be thrown away by
 * the document. Shrinking first is not a compromise on quality; it is declining
 * to send what the report cannot use.
 *
 * Best-effort throughout: any failure returns the original file, because a
 * photograph uploaded large is far better than one not uploaded at all.
 */

/** The long edge the appendix can actually use, in pixels. */
const MAX_EDGE = 2000;

/** Below this a photograph is already small enough that re-encoding only costs quality. */
const SKIP_BELOW_BYTES = 1_500_000;

export async function shrinkPhoto(file: File): Promise<File> {
  if (typeof document === 'undefined') return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;
  // A HEIC cannot be decoded by every browser's canvas, and the server converts it
  // properly with libheif. Sending it untouched is the correct fallback.
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) {
      bitmap.close?.();
      return file;
    }

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close?.();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    // Nothing gained is a reason to keep the original, not to send a bigger file.
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    // A browser without createImageBitmap, a canvas the OS refused, an image too
    // large to decode — the original still uploads.
    return file;
  }
}
