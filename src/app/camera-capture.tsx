'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './modal';

/**
 * Taking a photograph on a machine that has a camera but is not a phone.
 *
 * The photo steps offer `<input capture="environment">`, which is exactly right on a
 * phone: the operating system opens its own camera app, and the result is a full-quality
 * shot with none of this code involved. Desktop browsers ignore `capture` entirely and
 * fall back to a file picker — which is what the "הוספת תמונות" button already does — so
 * the camera button was hidden there rather than offering a second way to browse folders.
 *
 * That was right about `capture` and wrong about the room. A mould survey is written on
 * whatever is to hand, and a laptop on the kitchen table has a camera; so does the
 * desktop back at the office when a photograph arrives on a memory stick and someone
 * would rather point the webcam at a damp wall than dig through Explorer. Hiding the
 * button there left a machine that *can* take a picture with no way to take one.
 *
 * So this is the desktop half: `getUserMedia` into a `<video>`, one frame onto a
 * `<canvas>`, out as a JPEG file that reaches the same upload path as everything else.
 * The phone keeps its native camera app, which is better than this in every respect.
 *
 * Deliberately unopinionated about *what* is photographed: the caller gets a File and
 * decides where it goes, so the same component serves a survey appendix and a per-table
 * shot without knowing about either.
 */

/** Whether this browser can open a camera at all — see `CameraCapture`. */
export function useCameraSupported(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    // `mediaDevices` is undefined on plain HTTP, so a button offered there could only
    // fail — the same check the dictate button makes, and for the same reason.
    setSupported(typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);
  return supported;
}

export function CameraCapture({
  onCapture,
  onClose,
}: {
  /** The captured frame, as a file ready to upload. */
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  /**
   * Releases the camera.
   *
   * Called on unmount and before closing. Without it the browser's camera indicator
   * stays lit after the prompt is gone, which reads as the page still watching.
   */
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // `environment` asks for the rear camera where there is a choice and is simply
        // ignored on a laptop, which has one. Not `exact`: that *fails* on a machine
        // with only a front camera rather than falling back to it.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        // The prompt can be dismissed while the permission dialog is still up; the
        // stream then arrives with nothing to attach it to and must be released here.
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {
            /* autoplay refusals are not fatal — the frame still arrives */
          });
        }
        setReady(true);
      } catch (err) {
        // Refusing the permission and having no camera are different problems with
        // different fixes, so they do not share a message.
        const denied = err instanceof DOMException && /NotAllowed|Permission/i.test(err.name);
        setError(
          denied
            ? 'הדפדפן חסם את הגישה למצלמה. אשרו את ההרשאה בשורת הכתובת ונסו שוב.'
            : 'לא נמצאה מצלמה זמינה במחשב. אפשר להוסיף תמונה מהקובץ במקום.',
        );
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  const shoot = () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    /*
     * JPEG at 0.92 rather than PNG: the appendix prints a photograph, and a PNG of a
     * camera frame is several times the size for no visible gain. The upload path
     * shrinks it again anyway — see `shrinkPhoto`.
     */
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('לא ניתן היה לצלם. נסו שוב.');
          return;
        }
        // Named by the moment it was taken, so a caption left empty still says something
        // in the file list rather than reading "image".
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        onCapture(new File([blob], `צילום ${stamp}.jpg`, { type: 'image/jpeg' }));
        stop();
        onClose();
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <Modal
      title="צילום תמונה"
      onClose={() => {
        stop();
        onClose();
      }}
      wide
    >
      {error ? (
        <div className="notice error">{error}</div>
      ) : (
        <div className="camera-frame">
          {/* muted+playsInline are what let the preview run without a user gesture and
              without going full-screen on iOS Safari. */}
          <video ref={videoRef} muted playsInline autoPlay />
        </div>
      )}

      <div className="modal-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            stop();
            onClose();
          }}
        >
          ביטול
        </button>
        {!error && (
          <button type="button" className="btn-primary" disabled={!ready} onClick={shoot}>
            {ready ? '📷 צלם' : 'מפעיל מצלמה…'}
          </button>
        )}
      </div>
    </Modal>
  );
}
