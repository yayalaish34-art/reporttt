import { AiDraftError, aiDraftingAvailable, callOpenAi } from './ai-text';
import { db } from './db';
import { chainOfCustody, cocSamples, englishRoomName, withCocNumbers } from './mold-coc';
import type { MoldReport } from './mold-schema';

/**
 * What happens to a report just before its Chain of Custody is printed.
 *
 * Three things the form needs and the browser cannot do on its own: a job number from
 * the shared sequence, English for everything Hayes will read, and the sample numbers
 * written into the rooms. The result is stored and handed back to the editor, so what
 * the surveyor sees afterwards is exactly what the PDF printed.
 */

/** The first job number this system hands out; earlier jobs were numbered by hand. */
const FIRST_JOB_NUMBER = 817;

/** The next Hayes job number — one above the highest any mould report carries. */
export function nextMoldJobNumber(): string {
  const rows = db()
    .prepare(`SELECT json_extract(data, '$.coc.jobNumber') AS job FROM mold_reports`)
    .all() as Array<{ job: unknown }>;
  let highest = FIRST_JOB_NUMBER - 1;
  for (const row of rows) {
    const n = Number(String(row.job ?? '').trim());
    if (Number.isInteger(n)) highest = Math.max(highest, n);
  }
  return String(highest + 1);
}

const HEBREW = /[֐-׿]/;

const TRANSLATE_PROMPT = `You translate short labels on a laboratory Chain of Custody form from Hebrew to English.

The form goes to Hayes Microbial Consulting, a mould laboratory in the United States, and every
label names a place a sample was taken, a client or job, or a short note to the laboratory.

Rules:
- Translate places and rooms to the plain English a US lab uses: "בית מלון" → "Hotel",
  "חדר שינה" → "Bedroom", "לובי" → "Lobby", "חדר שינה של הילדים" → "Children's bedroom".
- Transliterate the names of people, companies and streets rather than translating them:
  "יוסי כהן" → "Yossi Cohen", "אופק רכשים" → "Ofek Richasim".
- Keep numbers, codes and anything already in English exactly as written.
- Short, Title Case, no explanations, no quotes.

Answer with JSON only: {"translations": ["...", "..."]} — one entry per input, same order.`;

/** Hebrew labels in English, in one call. Anything that cannot be translated stays as written. */
async function toEnglish(texts: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(texts.filter((t) => HEBREW.test(t)))];
  const out = new Map<string, string>();
  if (unique.length === 0 || !aiDraftingAvailable()) return out;

  try {
    const content = await callOpenAi(TRANSLATE_PROMPT, JSON.stringify({ texts: unique }), 800);
    const parsed = JSON.parse(content) as { translations?: unknown };
    const list = Array.isArray(parsed.translations) ? parsed.translations : [];
    unique.forEach((text, i) => {
      const english = typeof list[i] === 'string' ? list[i].trim() : '';
      if (english && !HEBREW.test(english)) out.set(text, english);
    });
  } catch (err) {
    // The form still prints — with the Hebrew as typed — rather than not at all.
    console.error('תרגום טופס Hayes לאנגלית נכשל', err instanceof AiDraftError ? err.message : err);
  }
  return out;
}

export async function prepareChainOfCustody(report: MoldReport): Promise<MoldReport> {
  let next: MoldReport = report.coc.jobNumber.trim()
    ? report
    : { ...report, coc: { ...report.coc, jobNumber: nextMoldJobNumber() } };

  // What the form would print as things stand — Hebrew anywhere in it is what goes to
  // the model.
  const form = chainOfCustody(next);
  const listed = cocSamples(next);
  const english = await toEnglish([
    form.jobName,
    form.collector,
    form.note,
    ...form.rows.flatMap((r) => [r.sample, r.notes, r.volume]),
  ]);
  const en = (value: string) => english.get(value) ?? value;

  /*
   * Translations go into the override fields, so the editor shows the English the
   * PDF printed and a second print does not translate again. A value that was not
   * Hebrew is left where it was — derived or typed.
   */
  const coc = { ...next.coc };
  if (english.has(form.jobName)) coc.jobName = en(form.jobName);
  if (english.has(form.collector)) coc.collector = en(form.collector);
  if (english.has(form.note)) coc.note = en(form.note);

  next = {
    ...next,
    coc,
    samples: next.samples.map((sample) => {
      if (!listed.includes(sample)) return sample;
      const name = sample.sampleNameEn.trim() || englishRoomName(sample);
      return {
        ...sample,
        sampleNameEn: english.has(name) ? en(name) : sample.sampleNameEn,
        cocNote: en(sample.cocNote.trim()),
        volume: en(sample.volume.trim()),
      };
    }),
  };

  return withCocNumbers(next);
}
