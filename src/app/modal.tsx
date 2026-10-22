'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A small prompt over the page.
 *
 * Built on <dialog> rather than a positioned div so the browser supplies what a prompt
 * has to do to be usable: it takes focus, traps it while open, closes on Escape, and
 * renders above everything without a z-index to maintain.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** For a prompt whose content is long text rather than a single short field. */
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // showModal() rather than the `open` attribute — only the modal form gets the
    // backdrop, the focus trap, and Escape.
    if (!dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      // Fires on Escape as well as on close(), so the caller's state cannot be left
      // thinking the prompt is still open after the browser has shut it.
      onClose={onClose}
      // The backdrop is part of the dialog element, so a click lands on it rather than
      // on the panel; comparing the target is what tells the two apart.
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="modal-body">
        <h3>{title}</h3>
        {children}
      </div>
    </dialog>
  );
}
