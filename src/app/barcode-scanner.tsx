'use client';

import { useEffect, useRef, useState, type KeyboardEventHandler, type RefObject } from 'react';
import { Modal } from './modal';
import {
  DETECTOR_PREFIX,
  detectorKey,
  isDetectorKey,
  isWholeDetectorEntry,
  withDetectorPrefix,
} from '@/lib/radon-rules';
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

/**
 * The detector number's box, holding the "00" every label starts with.
 *
 * The caret is kept after the prefix, on every route to it. Typed in front of the zeros,
 * "18469" would become "1018469": a valid-looking number for a detector that does not exist.
 * A selection is left alone, so select-all and type still replaces the number.
 */
export function DetectorInput({
  inputRef,
  value,
  onChange,
  onKeyDown,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
}) {
  const keepAfterPrefix = (input: HTMLInputElement) => {
    const { selectionStart, selectionEnd } = input;
    if (selectionStart !== selectionEnd) return;
    if ((selectionStart ?? 0) < DETECTOR_PREFIX.length) {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  };

  // autoFocus lands before React's handlers are attached, so onFocus never hears of it.
  useEffect(() => {
    const input = inputRef.current;
    if (input) input.setSelectionRange(input.value.length, input.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      ref={inputRef}
      className="ltr"
      autoFocus
      autoComplete="off"
      inputMode="numeric"
      value={value}
      aria-label="מספר גלאי"
      onFocus={(e) => keepAfterPrefix(e.currentTarget)}
      onSelect={(e) => keepAfterPrefix(e.currentTarget)}
      onChange={(e) => onChange(withDetectorPrefix(e.target.value))}
      onKeyDown={onKeyDown}
    />
  );
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
  const [typed, setTyped] = useState(DETECTOR_PREFIX);
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
    if (!isWholeDetectorEntry(typed)) return;
    onCodeRef.current(typed);
    setTyped(DETECTOR_PREFIX);
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
        setTyped(withDetectorPrefix(payload.number));
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
          <DetectorInput
            inputRef={box}
            value={typed}
            onChange={setTyped}
            onKeyDown={(e) => {
              // Scanners end a code with Enter or with Tab, depending on their setup.
              if ((e.key === 'Enter' || e.key === 'Tab') && typed !== DETECTOR_PREFIX) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button type="button" className="btn" disabled={!isWholeDetectorEntry(typed)} onClick={submit}>
            אישור
          </button>
        </div>
        <span className="hint">הקלידו את 5 הספרות שאחרי ה-00, או סרקו.</span>
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
