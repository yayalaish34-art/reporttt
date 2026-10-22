import { NextResponse } from 'next/server';
import { resolve } from 'node:path';
import { activeTemplate } from '@/lib/docx/template-store';
import { storageDurability } from '@/lib/db';

/**
 * Liveness check, reachable without the password.
 *
 * Reports the things that decide whether the app can actually do its job: a template
 * to merge, whether access is protected, and whether what it stores will still be
 * there tomorrow. Never returns data.
 */
export async function GET() {
  let template: string | null = null;
  try {
    template = activeTemplate()?.name ?? null;
  } catch {
    template = null;
  }

  /*
   * Storage durability is reported here because its failure is otherwise invisible.
   * Everything works — reports save, photographs upload, thumbnails appear — right up
   * until a restart, and then the pictures are gone and the documents come out without
   * their appendix. A health check that says "ok" through all of that is not much of a
   * health check.
   */
  const storage = storageDurability();

  return NextResponse.json({
    ok: true,
    template,
    protected: Boolean(process.env.APP_PASSWORD),
    ai: Boolean(process.env.OPENAI_API_KEY),
    storage: {
      path: storage.path,
      durable: storage.durable,
      ...(storage.durable ? {} : { warning: storage.warning }),
    },
  });
}
