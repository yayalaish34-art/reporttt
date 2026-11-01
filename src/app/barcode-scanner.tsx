'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from './modal';

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
 * Reading a barcode with a hardware scanner or the camera.
 *
 * The box takes the focus because a hardware scanner is a keyboard: it types the number
 * and presses Enter. The camera runs beside it for a phone. The decoder is loaded only
 * when this opens, so the page does not carry it otherwise.
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

  // Held in a ref so a re-render of the page does not restart the camera mid-scan.
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    const last = { code: '', at: 0 };

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled || !videoRef.current) return;
        const controls = await new BrowserMultiFormatReader().decodeFromConstraints(
          { video: { facingMode: 'environment', width: { ideal: 1280 } } },
          videoRef.current,
          (result) => {
            // Most frames hold no barcode; those arrive here with no result and are not errors.
            if (!result) return;
            const code = result.getText();
            const at = Date.now();
            if (code === last.code && at - last.at < REPEAT_COOLDOWN_MS) return;
            last.code = code;
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
  };

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="field" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
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

      {refusal && <div className="notice error">{refusal}</div>}

      {cameraError ? (
        <div className="notice warn">{cameraError}</div>
      ) : (
        <>
          <div className="camera-frame">
            <video ref={videoRef} muted playsInline autoPlay />
          </div>
          <p className="hint">{ready ? hint ?? 'כוונו את המצלמה אל הברקוד.' : 'מפעיל מצלמה…'}</p>
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
