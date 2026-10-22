'use client';

import { useRef, useState, useTransition, type ReactNode } from 'react';
import type { Photo, Report } from '@/lib/report-schema';
import { uploadPhoto } from '../../actions';
import { savePhotoToDevice } from '@/lib/save-to-device';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { useCaptionPrompt } from '../../caption-prompt';

/**
 * Photograph the source this table describes, from the table itself.
 *
 * The appendix used to be a step of its own, which meant leaving the table, taking the
 * pictures, and coming back — per source, per floor. But a photograph is taken at the
 * moment the source is measured, so the button belongs beside the readings, and the
 * caption is the heading already typed above it.
 *
 * Opens the camera, not the gallery: `capture` asks the phone for the camera directly.
 * There is deliberately no gallery button beside it — a photograph belonging to this
 * table is taken now, at the source. Pictures taken earlier are still added from the
 * appendix on the last step, which is also where a desktop adds them.
 */
export function PhotoButton({
  reportId,
  report,
  caption,
  onAdd,
  after,
  runExclusive,
}: {
  reportId: string;
  /** The report as the editor holds it, so an upload cannot save a stale copy. */
  report: Report;
  /** The table's heading — what the photograph is of. */
  caption: string;
  onAdd: (photos: Photo[]) => void;
  /**
   * Controls that belong beside the camera button — adding the next table, crossing to
   * RF. They sit at the foot of the last table rather than at the top of the section:
   * that is where the thumb already is when a table has just been filled in, and it is
   * the moment the next table is wanted.
   */
  after?: ReactNode;
  /**
   * Holds the autosave off while the upload is in flight.
   *
   * The upload saves the report on the server; an autosave landing in that window would
   * send the browser's copy, which does not yet carry the new photograph, over the top
   * of it — losing the caption and with it the photograph. See `use-autosave`.
   */
  runExclusive?: <R>(work: () => Promise<R>) => Promise<R>;
}) {
  const exclusive = runExclusive ?? (<R,>(work: () => Promise<R>) => work());
  const camera = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(0);
  // Pre-filled with the table's own source name — in a radiation report that
  // is what the photograph is of, and the whole reason the button lives
  // beside the table rather than in the appendix.
  const { ask, node: promptNode } = useCaptionPrompt();

  const upload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    start(async () => {
      await exclusive(async () => {
      let photos = [...report.photos];
      for (const file of Array.from(files)) {
        // Shrunk before it goes: a full camera shot is ten megabytes, and the appendix
        // prints it six inches wide. The original is what gets saved to the phone.
        const toSend = await shrinkPhoto(file);
        const form = new FormData();
        form.set('file', toSend);
        // The report travels with the upload so the server saves what is on screen
        // rather than the older stored copy.
        form.set('report', JSON.stringify({ ...report, photos }));

        /**
         * The upload itself can reject, and used not to be caught.
         *
         * A server action that throws — a dropped connection halfway through a
         * ten-megabyte photograph, a proxy giving up, the signal going in a plant
         * room — rejected this promise, and with nothing catching it the transition
         * simply ended. The button went back to reading "צילום" and said nothing at
         * all, which is indistinguishable from an upload that worked: the surveyor
         * carried on, and the photograph was never in the report.
         *
         * Now the failure is named. It is still a failure, but a visible one.
         */
        let result: Awaited<ReturnType<typeof uploadPhoto>>;
        try {
          result = await uploadPhoto(reportId, form);
        } catch (err) {
          console.error('העלאת התמונה נכשלה', err);
          setError(
            `העלאת "${file.name}" נכשלה — ייתכן שהחיבור נותק. נסו שוב, או צלמו באיכות נמוכה יותר.`,
          );
          break;
        }

        if (!result.ok) {
          setError(result.message ?? 'העלאה נכשלה');
          break;
        }
        if (result.photo) {
          // The caption prompt is asked now, with the table heading pre-filled: the
          // surveyor is still at the source and remembers what the shot was of, so
          // this is where a per-photo wording ("לוח ראשי, חזית, קומה 2") gets typed
          // rather than later from the appendix. Dismiss keeps the pre-fill.
          const suggested = caption.trim() || result.photo.caption;
          const answered = await ask(suggested);
          const photo = { ...result.photo, caption: answered ?? suggested };
          photos = [...photos, photo];
          onAdd(photos);
          setAdded((n) => n + 1);
          // A copy on the phone too: this button only ever opens the camera, so the
          // shot exists nowhere else until it is saved. Deliberately after the upload
          // succeeded — a picture the report rejected is not worth keeping.
          savePhotoToDevice(file, photo.caption);
        }
      }
      // Cleared so the next shot — which the camera names the same thing — fires change.
      if (camera.current) camera.current.value = '';
      });
    });
  };

  return (
    <div className="photo-button">
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => upload(e.target.files)}
      />
      <button type="button" className="btn-sm" disabled={pending} onClick={() => camera.current?.click()}>
        {pending ? 'מעלה…' : '📷 צילום'}
      </button>
      {added > 0 && <span className="hint">{added} תמונות נוספו</span>}
      {error && <span className="hint error-text">{error}</span>}
      {after}
      {promptNode}
    </div>
  );
}
