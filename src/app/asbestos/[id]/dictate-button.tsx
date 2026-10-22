'use client';

import { useEffect, useRef, useState } from 'react';
import type { DictationField } from '@/lib/transcribe';

/**
 * Records a spoken note and writes it into the field beside it.
 *
 * The descriptive fields of a survey are written standing in a car park with a meter in
 * one hand. They are also the longest things the surveyor has to type, which is why they
 * come back as three words and a full stop. Speaking them is the natural way to record
 * them, and the phone already has the microphone.
 *
 * Appends rather than replaces: a surveyor who has typed half a sentence and then speaks
 * the rest means both, and losing the typed half to a recording would be the kind of
 * surprise that stops people using the button at all.
 *
 * Hidden where the browser has no recorder, and where the page is not on HTTPS —
 * `getUserMedia` is unavailable on plain HTTP, so a button offered there could only fail.
 */
export function DictateButton({
  field,
  onText,
  disabled,
}: {
  /**
   * Which field is being dictated — steers the tidy pass.
   *
   * Widened to the shared type: the mould report dictates its own §3, which asks a
   * different question and carries its own worked example. See `FIELD_GUIDANCE`.
   */
  field: DictationField;
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /** The tracks to stop, so the browser's recording indicator goes out. */
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    setSupported(
      typeof navigator !== 'undefined' &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof MediaRecorder !== 'undefined',
    );
  }, []);

  // A recording still running when the step is left would hold the microphone open.
  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const start = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        void send(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }));
      };
      recorder.start();
      setRecording(true);
    } catch {
      // Refused permission, or no microphone. Either way the surveyor can type.
      setError('אין גישה למיקרופון. אפשרו הרשאה בדפדפן, או הקלידו ידנית.');
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const send = async (audio: Blob) => {
    if (audio.size === 0) return;
    setWorking(true);
    try {
      const form = new FormData();
      // The extension matters: the transcription API decides how to decode by it.
      form.set('audio', audio, audio.type.includes('mp4') ? 'note.mp4' : 'note.webm');
      form.set('field', field);

      const res = await fetch('/api/dictate', { method: 'POST', body: form });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || !data.text) {
        setError(data.error ?? 'התמלול נכשל');
        return;
      }
      onText(data.text);
    } catch {
      setError('התמלול נכשל. בדקו את החיבור ונסו שוב.');
    } finally {
      setWorking(false);
    }
  };

  if (!supported) return null;

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        className={recording ? 'btn-danger btn-sm' : 'btn-sm'}
        disabled={disabled || working}
        onClick={recording ? stop : start}
      >
        {working ? 'מתמלל…' : recording ? '■ עצור והוסף' : '🎤 הקלטה'}
      </button>
      {recording && (
        <span className="hint" style={{ marginInlineStart: 8, color: 'var(--danger)' }}>
          מקליט… דברו ואז לחצו לעצירה
        </span>
      )}
      {error && (
        <span className="hint" style={{ marginInlineStart: 8, color: 'var(--danger)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
