'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionResult } from './actions';

/**
 * Keeps the report on the server while it is being written.
 *
 * The report used to live only in the browser until the last step, where "הפקת הדוח"
 * saved and produced in one go. Everything before that was a tab's worth of state: a
 * phone locking in a plant room, a browser reclaiming memory behind a camera app, a
 * mistaken back gesture — any of them took the morning's readings with it, silently and
 * with nothing on screen having suggested the work was at risk.
 *
 * Two triggers, because they answer different risks:
 *
 *   - A step change, or a table edited, saves at once. These are the moments the
 *     surveyor has finished a thought, and the moment the phone is most likely to be put
 *     down — which is exactly when it locks.
 *   - Otherwise a save follows the last keystroke by `IDLE_MS`. Typing a site name
 *     should not be one request per character, but nor should a pause of a few seconds
 *     leave the text unsaved.
 *
 * Saves are never concurrent: one in flight makes the next wait, and only the newest
 * pending state is sent when it does. What reaches the server is always the whole report
 * as it stands, so an overtaken save costs nothing.
 */

/** How long after the last change an idle save fires. */
const IDLE_MS = 2500;

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: number }
  | { status: 'error'; message: string };

export function useAutosave<T>(
  value: T,
  save: (value: T) => Promise<ActionResult>,
  /** False while the report is not yet ready to be stored — nothing is sent. */
  enabled = true,
): { state: SaveState; saveNow: () => void; runExclusive: <R>(work: () => Promise<R>) => Promise<R> } {
  const [state, setState] = useState<SaveState>({ status: 'idle' });

  /**
   * The report as it stands, read by the save rather than passed to it.
   *
   * A ref because the timer and the unload handler both fire outside the render that
   * scheduled them, and a captured value would be the report as it was when the timer
   * was set rather than as it is when it goes off.
   */
  const latest = useRef(value);
  latest.current = value;

  const saveFn = useRef(save);
  saveFn.current = save;

  const inFlight = useRef(false);
  /** Set when a change arrives mid-save, so the newer state is not lost. */
  const again = useRef(false);
  /** What was last successfully stored, so an unchanged report is not re-sent. */
  const stored = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Guards against setting state after the editor has gone. */
  const alive = useRef(true);

  /**
   * Set while something *else* is writing the same report row on the server.
   *
   * The photo upload is the case that matters. It sends the report to the server, which
   * appends the new photograph and saves the whole thing — so for the length of that
   * request the server's copy is ahead of the browser's. An autosave landing in that
   * window would send the report as the browser still holds it, without the photograph,
   * and overwrite the server's copy: the image bytes survive in the photos table but the
   * caption that points at them is gone, and a photograph with no caption pointing at it
   * is invisible to both the editor and the merged document. That is a photograph lost.
   *
   * So autosaves wait, and the work that follows the upload re-syncs the baseline.
   */
  const suspended = useRef(false);

  const run = useCallback(async () => {
    if (!alive.current) return;
    if (inFlight.current || suspended.current) {
      again.current = true;
      return;
    }

    const snapshot = JSON.stringify(latest.current);
    if (snapshot === stored.current) return; // nothing has changed since the last save

    inFlight.current = true;
    setState({ status: 'saving' });
    try {
      const result = await saveFn.current(latest.current);
      if (result.ok) {
        stored.current = snapshot;
        if (alive.current) setState({ status: 'saved', at: Date.now() });
      } else if (alive.current) {
        setState({ status: 'error', message: result.message || 'השמירה נכשלה' });
      }
    } catch {
      // Offline in a plant room is normal, and is not the surveyor's mistake. The state
      // stays unsaved and the next change tries again.
      if (alive.current) setState({ status: 'error', message: 'השמירה נכשלה — אין חיבור' });
    } finally {
      inFlight.current = false;
      if (again.current) {
        again.current = false;
        void run();
      }
    }
  }, []);

  /**
   * Asks for a save of whatever the *next* render holds.
   *
   * Not an immediate `run()`. A caller asking to save is almost always inside the same
   * event that changed the report — leaving a step, adding a row — and at that moment
   * React has not re-rendered, so `latest.current` is still the state from before the
   * change. Saving there would store the report one edit behind, which is the bug that
   * an autosave exists to not have.
   *
   * Instead the request is recorded and the effect below acts on it after the render
   * that carries the change. `pending` is a counter rather than a flag so that two
   * requests in one event are not collapsed into one.
   */
  const [pending, setPending] = useState(0);
  const saveNow = useCallback(() => {
    if (!enabled) return;
    setPending((n) => n + 1);
  }, [enabled]);

  useEffect(() => {
    if (pending === 0) return;
    if (timer.current) clearTimeout(timer.current);
    void run();
  }, [pending, run]);

  // The idle save. Re-armed on every change, so it fires once the typing stops.
  useEffect(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), IDLE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, enabled, run]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * A last save when the page is being put away.
   *
   * `visibilitychange` rather than `beforeunload`: locking a phone or switching to the
   * camera hides the page without unloading it, and on mobile browsers a tab is often
   * discarded from that hidden state without `beforeunload` ever firing. This is the
   * event that actually happens when a surveyor pockets the phone.
   */
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') void run();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [enabled, run]);

  /**
   * Runs work that writes the report on the server, with autosaves held off.
   *
   * Whatever the work returns is passed through. Once it is done the autosave is
   * released and, if anything asked to save while it was held, allowed to catch up —
   * and by then the editor is holding the result of the work, so what it sends includes
   * it rather than overwriting it.
   */
  const runExclusive = useCallback(async <R,>(work: () => Promise<R>): Promise<R> => {
    suspended.current = true;
    try {
      return await work();
    } finally {
      suspended.current = false;
      if (again.current) {
        again.current = false;
        // After the render that applies the work's result, for the reason `saveNow`
        // exists: saving now would send the state from before it.
        setPending((n) => n + 1);
      }
    }
  }, []);

  return { state, saveNow, runExclusive };
}
