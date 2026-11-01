'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from './modal';
import { detectorKey, isDetectorKey } from '@/lib/radon-rules';
import { shrinkPhoto } from '@/lib/shrink-photo';

/** How long the same code is ignored, since the camera keeps reading whatever it faces. */
const REPEAT_COOLDOWN_MS = 2500;

/** A short tone, because whoever is scanning is looking at the detector and not the screen. */
export function beep(ok: boolean) {
  try {
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    tone.frequency.value = ok ? 1200 : 300;
    tone.connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + (ok ? 0.08 : 0.3));
    tone.onended = () => void audio.close();
  } catch {
    /* no sound available; the message on screen says the same */
  }
}

/** How close the live view zooms where the camera allows it, since a label this small fills little of the frame. */
const LIVE_ZOOM = 2;

/**
 * Reading a detector's number: hardware scanner, label photo, or live camera.
 *
 * The box takes the focus because a hardware scanner is a keyboard: it types the number
 * and presses Enter.
 *
 * The photo is there because the labels defeat the camera. They are small and curved, and
 * their thin bars print broken or not at all, so a decoder often fails even on a sharp
 * picture. The digits under the barcode stay legible, so the photo is read for those, and
 * the number waits in the box to be checked against the label.
 *
 * The live camera asks for the same code twice in a row before accepting it, since a bad
 * print can also decode as a wrong number. Its decoder is loaded only when this opens.
 */
export function BarcodeScanner({
  onCode,
  onClose,
  title = 'סריקת ברקוד',
  hint,
  error: refusal,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
  title?: string;
  hint?: string;
  /** Why the last code was refused, shown here because the prompt stays open for another try. */
  error?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [typed, setTyped] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [ready, setReady] = useState(false);
  const [reading, setReading] = useState(false);
  const [photoNote, setPhotoNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLInputElement>(null);

  // Held in a ref so a re-render of the page does not restart the camera mid-scan.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    const last = { seen: '', accepted: '', at: 0 };

    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (cancelled || !videoRef.current) return;
        // Bar codes only, read harder: looking for square codes costs time and adds misreads.
        const hints = new Map<number, unknown>([
          [
            DecodeHintType.POSSIBLE_FORMATS,
            [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8],
          ],
          [DecodeHintType.TRY_HARDER, true],
        ]);
        const controls = await new BrowserMultiFormatReader(hints).decodeFromConstraints(
          {
            video: {
              facingMode: 'environment',
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
            },
          },
          videoRef.current,
          (result) => {
            // Most frames hold no barcode; those arrive here with no result and are not errors.
            if (!result) return;
            const code = result.getText();
            if (!isDetectorKey(detectorKey(code))) return;
            const at = Date.now();
            if (code === last.accepted && at - last.at < REPEAT_COOLDOWN_MS) return;
            if (code !== last.seen) {
              last.seen = code;
              return;
            }
            last.seen = '';
            last.accepted = code;
            last.at = at;
            onCodeRef.current(code);
          },
        );
        // Closed while the permission prompt was up: nothing is left to attach the stream to.
        if (cancelled) {
          controls.stop();
          return;
        }
        stop = () => controls.stop();
        setReady(true);
        // Best effort: most iPhones and desktop browsers offer no zoom here.
        const [track] = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks() ?? [];
        const zoom = (track?.getCapabilities?.() as { zoom?: { max: number } } | undefined)?.zoom;
        if (zoom) {
          await track
            .applyConstraints({ advanced: [{ zoom: Math.min(LIVE_ZOOM, zoom.max) } as MediaTrackConstraintSet] })
            .catch(() => undefined);
        }
      } catch (err) {
        const denied = err instanceof DOMException && /NotAllowed|Permission/i.test(err.name);
        setCameraError(
          denied
            ? 'הדפדפן חסם את הגישה למצלמה. אפשר לאשר את ההרשאה בשורת הכתובת, לסרוק בסורק או להקליד.'
            : 'אין מצלמה זמינה. אפשר לסרוק בסורק או להקליד את המספר.',
        );
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const submit = () => {
    if (typed.trim() === '') return;
    onCodeRef.current(typed);
    setTyped('');
    setPhotoNote(null);
  };

  /** Reads the digits off a photo of the label. The number is only offered, never accepted here. */
  const readPhoto = async (file: File) => {
    setReading(true);
    setPhotoNote(null);
    setPhotoUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
    try {
      const form = new FormData();
      form.append('image', await shrinkPhoto(file));
      const response = await fetch('/api/radon/detector-label', { method: 'POST', body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? 'קריאת התמונה נכשלה');
      if (payload.number) {
        setTyped(payload.number);
        setPhotoNote({ tone: 'ok', text: 'בדקו שהמספר זהה לתווית ולחצו ״אישור״.' });
        box.current?.focus();
      } else {
        setPhotoNote({ tone: 'error', text: 'המספר לא נקרא בוודאות. צלמו מקרוב יותר, או הקלידו אותו.' });
      }
    } catch (err) {
      setPhotoNote({ tone: 'error', text: err instanceof Error ? err.message : 'קריאת התמונה נכשלה' });
    } finally {
      setReading(false);
    }
  };

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="field" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={box}
            className="ltr"
            autoFocus
            autoComplete="off"
            inputMode="numeric"
            value={typed}
            placeholder="סרקו או הקלידו מספר גלאי"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              // Scanners end a code with Enter or with Tab, depending on their setup.
              if ((e.key === 'Enter' || e.key === 'Tab') && typed.trim() !== '') {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button type="button" className="btn" disabled={typed.trim() === ''} onClick={submit}>
            אישור
          </button>
        </div>
      </div>

      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void readPhoto(file);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="btn-primary"
        style={{ inlineSize: '100%', padding: '14px 12px', justifyContent: 'center', textAlign: 'center', marginBottom: 12 }}
        disabled={reading}
        onClick={() => photoInput.current?.click()}
      >
        {reading ? 'קורא את המספר…' : '📸 צילום התווית'}
      </button>

      {photoUrl && (
        <img
          src={photoUrl}
          alt="צילום התווית"
          style={{ display: 'block', maxInlineSize: '100%', maxBlockSize: 180, margin: '0 auto 12px', borderRadius: 6 }}
        />
      )}
      {photoNote && <div className={`notice ${photoNote.tone}`}>{photoNote.text}</div>}
      {refusal && <div className="notice error">{refusal}</div>}

      {cameraError ? (
        <div className="notice warn">{cameraError}</div>
      ) : (
        <>
          <div className="camera-frame">
            <video ref={videoRef} muted playsInline autoPlay />
          </div>
          <p className="hint">
            {ready
              ? hint ?? 'אפשר גם לכוון את המצלמה אל הברקוד, במרחק של כ-15 ס״מ. אם הוא לא נקרא, צלמו את התווית.'
              : 'מפעיל מצלמה…'}
          </p>
        </>
      )}

      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          סגירה
        </button>
      </div>
    </Modal>
  );
}
