'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { Photo, Report } from '@/lib/report-schema';
import { removePhoto, uploadPhoto } from '../../actions';
import { savePhotoToDevice } from '@/lib/save-to-device';
import { CameraCapture, useCameraSupported } from '../../camera-capture';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { CollapsibleCard } from '../../collapsible-card';
import { useCaptionPrompt } from '../../caption-prompt';

/**
 * A file name a camera or a phone gave itself, rather than one a person chose.
 *
 * Covers what the handsets in use actually produce — IMG_2081, DSC00042, PXL_20260830…,
 * 20260830_141233, and the bare-number names some galleries hand back. Anything with a
 * letter that is not part of such a prefix is treated as deliberate.
 */
function isCameraFileName(caption: string): boolean {
  const name = caption.trim();
  if (name === '') return true; // nothing to prefer over the table heading
  // Beyond a known prefix the name may carry only digits, spacing, and the "(2)" a
  // browser appends to a duplicate download — including "image (3)", where the prefix is
  // followed by nothing but that suffix.
  return /^(img|dsc|dscn|pxl|mvimg|photo|image|screenshot|wa)?[\s_-]*(\d[\d\s_.()-]*|\(\d+\))$/i.test(name);
}

/**
 * The heading of the photo section, and the key the card group identifies it by.
 *
 * Exported because the editor asks whether this section is open (to fire the camera) and
 * a group keys its cards by title — two places that must not drift apart.
 */
export const PHOTOS_CARD_TITLE = 'נספח תמונות';

/**
 * The photo appendix.
 *
 * Uploads go straight to the server rather than being held in the form: the
 * images are megabytes each, and a survey routinely carries thirty of them.
 * Captions stay in the report data and are saved with everything else.
 */
export function PhotosSection({
  reportId,
  report,
  photos,
  onChange,
  open,
  defaultCaption,
  bare = false,
  runExclusive,
}: {
  reportId: string;
  /** The report as the editor currently holds it, unsaved edits included. */
  report: Report;
  photos: Photo[];
  onChange: (photos: Photo[]) => void;
  /** Whether the section is the one currently unfolded. */
  open: boolean;
  /**
   * The caption a newly taken photo starts with — the heading of the last table
   * worked on. Photographs are taken per source, in the order the tables were
   * filled, so the table just finished is nearly always what is being pictured.
   */
  defaultCaption: string;
  /** Renders without the folding card — the wizard already gives the step a panel. */
  bare?: boolean;
  /**
   * Holds the autosave off while an upload or a deletion is in flight.
   *
   * Both write the report row on the server, and an autosave landing in the middle would
   * send the browser's copy — the one without the new photograph — straight over the top
   * of it. See `runExclusive` in `use-autosave`.
   */
  runExclusive?: <R>(work: () => Promise<R>) => Promise<R>;
}) {
  // Without an autosave to coordinate with — an older caller — the work simply runs.
  const exclusive = runExclusive ?? (<R,>(work: () => Promise<R>) => work());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  // Asked per photo as it is uploaded, so a caption gets typed while the subject is
  // still fresh — not after thirty shots when the appendix is a long list.
  const { ask, node: promptNode } = useCaptionPrompt();

  /**
   * Whether the camera can be opened straight away.
   *
   * `capture` is honoured by phones and tablets and ignored by desktop browsers, which
   * would otherwise show a file picker that this section already offers a button for.
   * A coarse pointer catches the devices a survey is actually photographed on without
   * guessing at screen widths.
   */
  const [handheld, setHandheld] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const apply = () => setHandheld(coarse.matches);
    apply();
    coarse.addEventListener('change', apply);
    return () => coarse.removeEventListener('change', apply);
  }, []);

  /*
   * A desktop has no `capture`, but it often has a camera. It gets `getUserMedia` in a
   * prompt instead — see `camera-capture.tsx`. The auto-open above stays phone-only:
   * a permission dialog that appears the moment a section unfolds is startling, whereas
   * a phone's camera app opening on a step called "תמונות" is what was asked for.
   */
  const webcam = useCameraSupported();
  const [cameraOpen, setCameraOpen] = useState(false);

  /**
   * Opens the camera as soon as the section is unfolded.
   *
   * What the surveyor came here to do is photograph the thing they just measured, and a
   * button in between is a tap that never has another answer. Fires once per opening —
   * `opened` latches so that a re-render, or coming back from the camera, does not
   * reopen it — and never when the appendix already has photographs in it, where the
   * intent is as likely to be reviewing them.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (!open) {
      opened.current = false; // armed again for the next time the section is unfolded
      return;
    }
    if (opened.current || !handheld || photos.length > 0) return;
    opened.current = true;
    cameraInput.current?.click();
  }, [open, handheld, photos.length]);

  /**
   * `fromCamera` separates the two inputs that share this path: a shot just taken
   * exists only inside the report until it is also saved to the phone, while a picture
   * chosen from the gallery is already there and copying it back would only duplicate it.
   */
  const upload = (files: FileList | File[] | null, fromCamera = false) => {
    if (!files || files.length === 0) return;
    setError(null);

    startTransition(async () => {
      await exclusive(async () => {
      // Uploaded one at a time so a single unsupported file names itself in the
      // error rather than failing the whole batch anonymously.
      let added = [...photos];
      for (const file of Array.from(files)) {
        // Shrunk before it goes — see `shrinkPhoto`. The original is what is saved to
        // the phone, so the surveyor keeps the full-resolution shot.
        const toSend = await shrinkPhoto(file);
        const form = new FormData();
        form.set('file', toSend);
        // Carried along so the server saves what is on screen, not the older
        // stored copy — otherwise adding a photo reverts the whole report.
        form.set('report', JSON.stringify({ ...report, photos: added }));

        // A rejected upload used to end the transition silently, leaving the button
        // looking as though nothing had gone wrong — see the note in `photo-button`.
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
          // Pre-filled with the last table's heading or the deliberate file name,
          // whichever is a better guess. The surveyor confirms or edits — a step
          // that would otherwise live in the final review list.
          const fromName = result.photo.caption;
          const suggested = isCameraFileName(fromName)
            ? defaultCaption || fromName
            : fromName || defaultCaption;
          const answered = await ask(suggested);
          const photo = { ...result.photo, caption: answered ?? suggested };
          added = [...added, photo];
          onChange(added);
          if (fromCamera) savePhotoToDevice(file, photo.caption);
        }
      }
      // Both are cleared so the same file — or another shot from the camera, which
      // hands back the same name every time — fires change again.
      if (fileInput.current) fileInput.current.value = '';
      if (cameraInput.current) cameraInput.current.value = '';
      });
    });
  };

  const remove = (imageId: string) =>
    startTransition(async () => {
      await exclusive(async () => {
        await removePhoto(reportId, imageId);
        onChange(photos.filter((p) => p.imageId !== imageId));
      });
    });

  const actions = (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => upload(e.target.files)}
          />
          {/* נפרד מבורר הקבצים: capture פותח את המצלמה, ולכן הוא לא יכול לשמש
              גם לבחירה מהגלריה. לא multiple — המצלמה מצלמת אחת בכל פעם. */}
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => upload(e.target.files, true)}
          />
          {(handheld || webcam) && (
            <button
              type="button"
              className="btn-sm"
              disabled={pending}
              onClick={() => (handheld ? cameraInput.current?.click() : setCameraOpen(true))}
            >
              {pending ? 'מעלה…' : 'צילום'}
            </button>
          )}
          {cameraOpen && (
            <CameraCapture
              // `true`, like a phone shot: a frame captured here exists only inside the
              // report until it is also saved to the machine.
              onCapture={(file) => upload([file], true)}
              onClose={() => setCameraOpen(false)}
            />
          )}
          <button type="button" className="btn-sm" disabled={pending} onClick={() => fileInput.current?.click()}>
            {pending ? 'מעלה…' : 'הוספת תמונות'}
          </button>
        </>
  );

  const body = (
      <div>
        {error && <div className="notice error">{error}</div>}

        {photos.length === 0 ? (
          <div className="empty">
            התמונות מופיעות בסוף הדוח, ממוספרות אוטומטית — &quot;תמונה מס׳ 1&quot;, &quot;תמונה מס׳ 2&quot; וכן הלאה.
          </div>
        ) : (
          <div className="photo-grid">
            {photos.map((photo, index) => (
              <div className="photo-card" key={photo.imageId}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/photos/${photo.imageId}`} alt={photo.caption || `תמונה ${index + 1}`} />
                <div className="body">
                  <label>תמונה מס׳ {index + 1}</label>
                  <input
                    value={photo.caption}
                    placeholder="כיתוב"
                    onChange={(e) =>
                      onChange(photos.map((p, i) => (i === index ? { ...p, caption: e.target.value } : p)))
                    }
                  />
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    disabled={pending}
                    onClick={() => {
                      if (confirm('למחוק את התמונה?')) remove(photo.imageId);
                    }}
                  >
                    מחיקה
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
  );

  // Bare: the wizard's panel is already the frame, and the upload controls move to the
  // top of the step where the card's title bar used to carry them.
  if (bare) {
    return (
      <div className="photos-bare">
        <div className="photos-bare-actions">{actions}</div>
        {body}
        {promptNode}
      </div>
    );
  }

  return (
    <>
      <CollapsibleCard
        title={PHOTOS_CARD_TITLE}
        hint={photos.length ? `${photos.length} תמונות` : 'אין תמונות'}
        action={actions}
      >
        {body}
      </CollapsibleCard>
      {promptNode}
    </>
  );
}
