/**
 * Keeps a copy of a photograph on the phone, not only in the report.
 *
 * A picture taken through the browser's camera input never reaches the phone's own
 * photo album: the camera hands the file to the page and nothing else happens to it.
 * The surveyor who photographs a site all morning would find the album empty that
 * evening, with the only copies inside the report.
 *
 * No browser can write to the gallery — there is no such API — so the closest thing is
 * a download. On Android the media scanner picks the file up and it appears in the
 * gallery; on iOS it lands in "Files" rather than in Photos. That difference is a
 * platform limit, not a setting we can change.
 *
 * Only camera shots are saved. A picture chosen from the gallery is already on the
 * phone, and copying it back would just make duplicates.
 */

/**
 * A name the photograph can be found by later.
 *
 * The camera names every shot the same thing ("image.jpg"), which would leave a folder
 * of files nobody can tell apart, so the caption and the moment it was taken are used
 * instead — "לוח חשמל ראשי 01-09-2026 0955.jpg".
 */
function fileNameFor(file: File, caption?: string): string {
  const ext = (file.name.match(/\.[A-Za-z0-9]+$/)?.[0] ?? '.jpg').toLowerCase();
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const when = `${p(now.getDate())}-${p(now.getMonth() + 1)}-${now.getFullYear()} ${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  // The same characters Windows and Android reject in a file name.
  const base = (caption ?? '').trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').slice(0, 60);
  return base ? `${base} ${when}${ext}` : `תמונה ${when}${ext}`;
}

/**
 * Saves one photograph to the device's downloads.
 *
 * Best-effort by design: the report already holds the picture, so a browser that
 * refuses the download must not surface as an upload error over a photo that was in
 * fact uploaded.
 */
export function savePhotoToDevice(file: File, caption?: string): void {
  try {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileNameFor(file, caption);
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked late rather than at once: releasing the URL immediately can cancel a
    // download the browser has not started reading yet.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    // Nothing to report — the photograph is safe in the report either way.
  }
}
