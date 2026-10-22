'use client';

import { useTransition } from 'react';
import { removeReport } from './actions';

/**
 * Deleting a report cannot be undone, so it asks first — the button sits beside
 * "עריכה" in a dense list and is easy to hit by accident.
 */
export function DeleteReportButton({ id, title }: { id: string; title: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn-danger btn-sm"
      disabled={pending}
      onClick={() => {
        if (!confirm(`למחוק את "${title}"? הפעולה אינה הפיכה.`)) return;
        startTransition(() => {
          void removeReport(id);
        });
      }}
    >
      {pending ? 'מוחק…' : 'מחיקה'}
    </button>
  );
}
