'use client';

import { useTransition } from 'react';
import { removeIaqReport } from './actions';

export function DeleteIaqButton({ id, title }: { id: string; title: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn-danger btn-sm"
      disabled={pending}
      onClick={() => {
        if (!confirm(`למחוק את "${title}"? הפעולה אינה הפיכה.`)) return;
        startTransition(() => {
          void removeIaqReport(id);
        });
      }}
    >
      {pending ? 'מוחק…' : 'מחיקה'}
    </button>
  );
}
