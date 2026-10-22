'use client';

import { useEffect } from 'react';

/**
 * Sends a newly opened browser to the start screen.
 *
 * Closing the browser and opening it again restores the last tab, which is a report
 * somebody was in the middle of — so the app reopened three steps into yesterday's
 * survey rather than ready for today's. That is the browser doing its job, not a
 * bug in a page, so no page can fix it by itself: something has to notice that this
 * is a *new session* rather than a reload.
 *
 * `sessionStorage` is exactly that signal. It is empty when a browser starts and
 * survives every navigation and refresh within the session, so the flag is missing
 * once — on the first page of a new session — and present for the rest of it.
 *
 * What it deliberately does not do:
 *
 *  - It never redirects twice. The flag is written before the redirect, so pressing
 *    back, or opening a report from the list, stays where it was asked to go.
 *  - It leaves a reload alone. Refreshing a report — which happens constantly on a
 *    phone, where the browser drops the tab while Word is open — keeps the report.
 *    Throwing the surveyor to the start screen there would lose their place.
 *  - It gives way to a shared link. A URL somebody was sent is where they meant to
 *    land, and `?step=` marks a report reopened rather than newly visited.
 */
export function FreshSession() {
  useEffect(() => {
    const KEY = 'session-started';

    let started: string | null = null;
    try {
      started = sessionStorage.getItem(KEY);
      sessionStorage.setItem(KEY, '1');
    } catch {
      // Private mode, or storage the browser refuses. Better to stay put than to
      // redirect on every single page load.
      return;
    }

    if (started) return; // not a new session

    // Already where a new session belongs.
    if (window.location.pathname === '/') return;

    /**
     * A page reached by a real navigation rather than restored with the window.
     *
     * `navigation.type` is "reload" for a refresh and "back_forward" for a history
     * move; both mean the person is where they intended to be. Only a fresh "navigate"
     * — which is what a restored tab looks like — is sent to the start screen.
     */
    const entry = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (entry && entry.type !== 'navigate') return;

    window.location.replace('/');
  }, []);

  return null;
}
