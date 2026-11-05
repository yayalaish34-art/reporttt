/** Calls to the engine, which serves this app from the same address. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly missing: string[] = [],
  ) {
    super(message);
  }
}

/** Raised when the engine's session has ended; the prediction layout shows its login again. */
export const LOGGED_OUT_EVENT = 'prediction:logged-out';

function describe(detail: unknown): { message: string; missing: string[] } {
  if (typeof detail === 'string') return { message: detail, missing: [] };
  if (Array.isArray(detail)) {
    const lines = detail.map(
      (item: { msg?: string; loc?: unknown[] }) => `${item.loc?.slice(1).join('.') ?? ''}: ${item.msg ?? ''}`,
    );
    return { message: lines.join('; '), missing: [] };
  }
  if (detail && typeof detail === 'object') {
    const record = detail as { message?: string; missing?: string[]; blockers?: { message: string }[] };
    return {
      message: record.message ?? 'הפעולה נכשלה',
      missing: record.missing ?? record.blockers?.map((item) => item.message) ?? [],
    };
  }
  return { message: 'הפעולה נכשלה', missing: [] };
}

export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(`/api${path}`, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (response.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new Event(LOGGED_OUT_EVENT));
    throw new ApiError('נדרשת התחברות למערכת החיזוי', 401);
  }
  if (!response.ok) {
    let detail: unknown;
    try {
      detail = (await response.json()).detail;
    } catch {
      detail = `שגיאת שרת (${response.status})`;
    }
    const { message, missing } = describe(detail);
    throw new ApiError(message, response.status, missing);
  }
  return response.json();
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'הפעולה נכשלה';
}

/** A file the engine serves: a plan page, a document, a report. */
export function fileUrl(path: string): string {
  return `/api${path}`;
}
