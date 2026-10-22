/**
 * Marks a few values red in a copy of the source, standing in for what a person
 * would do in Word.
 *
 * Used to test the red-marking pipeline without needing someone to open Word
 * and colour text by hand. The values chosen are ones already known to be
 * dynamic, so the scan's proposals can be checked against the right answers.
 *
 *   npx tsx scripts/make-marked-fixture.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { MARKER_COLOR } from '../src/lib/docx/marked-runs';
import { findElementEnd, textOf } from '../src/lib/docx/ooxml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'templates/source/report-source.docx');
const OUT = resolve(ROOT, 'out/marked-source.docx');

/**
 * What to mark, and how.
 *
 * Covers all three ways a person can mark: highlight (the recommended one),
 * red text, and a highlight whose text names its own field.
 */
const TO_MARK: Array<{ value: string; how: 'highlight' | 'color'; rename?: string }> = [
  { value: 'ירון חכם', how: 'highlight' },
  { value: 'כרטיסי אשראי לישראל בע"מ', how: 'highlight' },
  { value: 'תפוצות ישראל 13', how: 'highlight' },
  { value: 'גבעתיים', how: 'color' },
  { value: '052-2857557', how: 'color' },
  { value: 'משרדים', how: 'highlight' },
  // Marked and renamed to its field, standing in for someone typing the name.
  { value: 'קיצי בהיר', how: 'highlight', rename: '{weather}' },
];

const zip = new PizZip(readFileSync(SOURCE));
let xml = zip.file('word/document.xml')!.asText();

let marked = 0;
for (const { value, how, rename } of TO_MARK) {
  const result = markFirstRunContaining(xml, value, how, rename);
  if (result) {
    xml = result;
    marked++;
    console.log(`${how === 'highlight' ? 'הודגש ' : 'נצבע  '}: ${value}${rename ? ` → ${rename}` : ''}`);
  } else {
    console.log(`לא נמצא כריצה שלמה: ${value}`);
  }
}

zip.file('word/document.xml', xml);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));

console.log(`\n${marked} ערכים נצבעו. נכתב: ${OUT}`);

/**
 * Paints the first run whose text is exactly `value`.
 *
 * Exact match rather than substring: painting half a run would need the run
 * split, which is Word's job, and this fixture only needs to produce something
 * the scanner can read.
 */
function markFirstRunContaining(
  input: string,
  value: string,
  how: 'highlight' | 'color',
  rename?: string,
): string | null {
  let i = 0;
  while (i < input.length) {
    if (input.startsWith('<w:r>', i) || input.startsWith('<w:r ', i)) {
      const end = findElementEnd(input, i, 'w:r');
      const run = input.slice(i, end);
      if (run.includes('<w:t') && textOf(run).trim() === value) {
        let marked = how === 'highlight' ? withHighlight(run) : withColor(run, MARKER_COLOR);
        if (rename) {
          // Keep the whitespace that sat around the value. Someone typing a
          // field name over it in Word selects the word, not the space before
          // it, and the sentence has to read the same afterwards.
          marked = marked.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/, (_all, open, body: string, close) => {
            const leading = body.match(/^\s*/)?.[0] ?? '';
            const trailing = body.match(/\s*$/)?.[0] ?? '';
            return `${open}${leading}${rename}${trailing}${close}`;
          });
        }
        return input.slice(0, i) + marked + input.slice(end);
      }
      i = end;
      continue;
    }
    i++;
  }
  return null;
}

/** Adds a yellow highlight to a run's properties, creating them if absent. */
function withHighlight(run: string): string {
  const tag = '<w:highlight w:val="yellow"/>';
  if (run.includes('<w:rPr>')) {
    // `w:highlight` sits late in the schema order Word expects, just before
    // `w:u`, so it goes in at the end of the properties rather than the front.
    return run.replace(/<\/w:rPr>/, `${tag}</w:rPr>`);
  }
  return run.replace(/^(<w:r(?:\s[^>]*)?>)/, `$1<w:rPr>${tag}</w:rPr>`);
}

/** Adds a colour to a run's properties, creating them if absent. */
function withColor(run: string, color: string): string {
  const colorTag = `<w:color w:val="${color}"/>`;

  if (run.includes('<w:rPr>')) {
    // `w:color` sits after `w:rFonts` and the bold/italic toggles in the schema
    // order Word expects, so it goes in after those rather than at the front.
    return run.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/, (_all, props: string) => {
      const stripped = props.replace(/<w:color[^>]*\/>/g, '');
      const afterToggles = /^([\s\S]*?<\/w:(?:rFonts|b|bCs|i|iCs)>|[\s\S]*?<w:(?:rFonts|b|bCs|i|iCs)[^>]*\/>)([\s\S]*)$/.exec(
        stripped,
      );
      return afterToggles
        ? `<w:rPr>${afterToggles[1]}${colorTag}${afterToggles[2]}</w:rPr>`
        : `<w:rPr>${colorTag}${stripped}</w:rPr>`;
    });
  }

  return run.replace(/^(<w:r(?:\s[^>]*)?>)/, `$1<w:rPr>${colorTag}</w:rPr>`);
}
