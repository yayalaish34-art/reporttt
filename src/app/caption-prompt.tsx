'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './modal';

/**
 * Ask for the caption that belongs on the photo just taken.
 *
 * The appendix lets a caption be edited later, but the moment the shot was
 * taken is the moment the surveyor still remembers what it was of — a photo
 * stacked onto a long list is captioned "IMG_2081" because by then it is one of
 * forty. A prompt immediately after upload closes that loop while the context
 * is fresh: pre-filled with whatever this screen can infer (a table's source
 * name, the building being documented), skippable when nothing fits.
 *
 * The modal is driven through `useCaptionPrompt`, which returns both the prompt
 * node and the `ask` function. `ask(defaultCaption)` resolves with the caption
 * the surveyor confirmed, or `null` when they skipped (keep the pre-fill).
 */
export function useCaptionPrompt() {
  const [state, setState] = useState<{
    defaultCaption: string;
    resolve: (caption: string | null) => void;
  } | null>(null);

  const ask = useCallback((defaultCaption: string) => {
    return new Promise<string | null>((resolve) => {
      setState({ defaultCaption, resolve });
    });
  }, []);

  const close = useCallback(
    (value: string | null) => {
      state?.resolve(value);
      setState(null);
    },
    [state],
  );

  const node = state ? (
    <CaptionPrompt
      defaultCaption={state.defaultCaption}
      onConfirm={(caption) => close(caption)}
      onSkip={() => close(null)}
    />
  ) : null;

  return { ask, node };
}

function CaptionPrompt({
  defaultCaption,
  onConfirm,
  onSkip,
}: {
  defaultCaption: string;
  onConfirm: (caption: string) => void;
  onSkip: () => void;
}) {
  const [value, setValue] = useState(defaultCaption);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Caret at the end: a prefilled caption is nearly always kept or appended to,
    // so landing between the first two characters is extra typing to skip past.
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const commit = () => onConfirm(value.trim() || defaultCaption);

  return (
    <Modal title="כיתוב לתמונה" onClose={onSkip}>
      <div className="field">
        <label>מה הכיתוב לתמונה?</label>
        <input
          ref={inputRef}
          value={value}
          placeholder="תיאור קצר של התמונה"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
        {defaultCaption && (
          <span className="hint">הוצע מראש לפי מה שעל המסך — ניתן לערוך או לדלג.</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="btn-primary btn-sm" onClick={commit}>
          אישור
        </button>
        <button type="button" className="btn-sm" onClick={onSkip}>
          דילוג
        </button>
      </div>
    </Modal>
  );
}
