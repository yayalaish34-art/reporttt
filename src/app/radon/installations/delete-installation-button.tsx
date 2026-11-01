'use client';

import { useTransition } from 'react';
import { removeInstallation } from '../actions';

/** Asks first, for the same reason as deleting a report. */
export function DeleteInstallationButton({ id, title }: { id: string; title: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn-danger btn-sm"
      disabled={pending}
      onClick={() => {
        if (!confirm(`למחוק את ההתקנה "${title}"? הפעולה אינה הפיכה.`)) return;
        startTransition(() => {
          void removeInstallation(id);
        });
      }}
    >
      {pending ? 'מוחק…' : 'מחיקה'}
    </button>
  );
}
