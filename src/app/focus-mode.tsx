'use client';

import { useEffect } from 'react';

/**
 * Strips the site down to the report being filled in.
 *
 * Filling in a survey is the one screen that is not browsing: the masthead, the logo and
 * the section navigation are all routes away from the thing in hand, and on a phone they
 * cost the top of a screen that has a measurement table to fit. The document body gets a
 * class while an editor is mounted and the chrome is hidden in CSS — leaving the step,
 * its fields, and the way back.
 *
 * A class on <body> rather than a layout split because the chrome lives in the root
 * layout, which both editor routes share with every other page. Removed on unmount, so
 * the topbar returns the moment the editor is left.
 */
export function FocusMode() {
  useEffect(() => {
    document.body.classList.add('focused');
    return () => document.body.classList.remove('focused');
  }, []);
  return null;
}
