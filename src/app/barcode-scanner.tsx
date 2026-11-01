'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from './modal';

/** How long the same code is ignored, since the camera keeps reading whatever it faces. */
const REPEAT_COOLDOWN_MS = 2500;

/**
 * Reading a barcode with the camera, for a phone or a machine with no scanner attached.
 *
 * A hardware scanner needs none of this: it types into the box like a keyboard. The
 * decoder is loaded only when this opens, so the page does not carry it otherwise.
 */
export function BarcodeScanner({
  onCode,
  onClose,
  hint,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
  hint?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
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
        setError(
          denied
            ? 'הדפדפן חסם את הגישה למצלמה. אשרו את ההרשאה בשורת הכתובת ונסו שוב.'
            : 'לא ניתן היה להפעיל מצלמה. אפשר לסרוק בסורק או להקליד את המספר.',
        );
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <Modal title="סריקת ברקוד" onClose={onClose} wide>
      {error ? (
        <div className="notice error">{error}</div>
      ) : (
        <div className="camera-frame">
          <video ref={videoRef} muted playsInline autoPlay />
        </div>
      )}
      {!error && <p className="hint">{ready ? hint ?? 'כוונו את המצלמה אל הברקוד.' : 'מפעיל מצלמה…'}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          סיום
        </button>
      </div>
    </Modal>
  );
}
