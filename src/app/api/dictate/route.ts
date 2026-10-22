import { NextResponse } from 'next/server';
import { AiDraftError } from '@/lib/ai-text';
import {
  MAX_AUDIO_BYTES,
  dictateField,
  transcriptionAvailable,
  type DictationField,
} from '@/lib/transcribe';

/**
 * Turns a recorded note into text for one field.
 *
 * A route rather than a server action because the body is an audio blob: actions carry
 * their payload through the React stream, and several megabytes of audio does not belong
 * there. A plain POST with FormData is what the browser's own recorder produces anyway.
 */

const FIELDS: DictationField[] = ['siteDescription', 'surroundings', 'moldSiteDescription'];

export async function POST(request: Request) {
  if (!transcriptionAvailable()) {
    return NextResponse.json({ error: 'תמלול אינו זמין — לא הוגדר מפתח OpenAI.' }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 });

  const audio = form.get('audio');
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: 'לא התקבלה הקלטה' }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'ההקלטה ארוכה מדי. הקליטו קטע קצר יותר.' }, { status: 413 });
  }

  // Matched against the known fields rather than cast: the field decides which example
  // steers the tidy pass, and an unrecognised one would steer it with nothing.
  const requested = String(form.get('field') ?? '');
  const field = FIELDS.find((f) => f === requested);
  if (!field) return NextResponse.json({ error: 'שדה לא מוכר' }, { status: 400 });

  try {
    const { text, raw } = await dictateField(audio, audio.name || 'note.webm', field);
    return NextResponse.json({ text, raw });
  } catch (err) {
    if (err instanceof AiDraftError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error('תמלול ההקלטה נכשל', err);
    return NextResponse.json({ error: 'התמלול נכשל. נסו שוב.' }, { status: 500 });
  }
}
