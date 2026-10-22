'use client';

import type { SaveState } from './use-autosave';

/**
 * Says whether the work is safe.
 *
 * Small and quiet while things are going well: a surveyor who has to watch a save
 * indicator is being asked to do the system's worrying for it. It earns attention only
 * when a save has actually failed — that is the state where carrying on typing means
 * carrying on losing work, and the one thing worth interrupting for.
 */
export function SaveIndicator({ state }: { state: SaveState }) {
  if (state.status === 'idle') return null;

  if (state.status === 'error') {
    return (
      <span className="save-indicator error" role="status">
        לא נשמר — {state.message}
      </span>
    );
  }

  return (
    <span className="save-indicator" role="status">
      {state.status === 'saving' ? 'שומר…' : '✓ נשמר'}
    </span>
  );
}
