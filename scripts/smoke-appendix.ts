/**
 * Checks that Appendix ח matches the site that was surveyed.
 *
 * The appendix argues for repeating the survey, and the argument is not the same in a
 * factory as in a flat. The template carries the workplace version — the employer's duty
 * of care, the Work Safety Ordinance — so until this was wired up, a family that had
 * their home surveyed received a page about their employer's statutory obligations.
 *
 *   npx tsx scripts/smoke-appendix.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { mergeDocx } from '../src/lib/docx/merge-docx';
import { applySiteAppendix } from '../src/lib/docx/site-appendix';
import { appendixForSite } from '../src/lib/appendix-text';
import { buildMergeData } from '../src/lib/report-mapper';
import { sampleReport } from '../src/lib/sample-report';
import { ReportSchema } from '../src/lib/report-schema';
import { textOf } from '../src/lib/docx/ooxml';
import { SITE_CHARACTER_OPTIONS } from '../src/lib/measurement-rules';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = readFileSync(resolve(ROOT, 'templates/report-template.docx'));

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Renders a report for one site character and returns its visible text. */
function renderFor(siteCharacter: string): string {
  const report = ReportSchema.parse({ ...sampleReport(), siteCharacter });
  const bytes = mergeDocx(TEMPLATE, buildMergeData(report), {
    rewrite: (xml) => applySiteAppendix(xml, siteCharacter),
  });
  return textOf(new PizZip(bytes).file('word/document.xml')!.asText());
}

// ── Every site character has its own appendix ───────────────────────

console.log('\nנוסח הנספח לפי אפיון המקום:');

for (const site of SITE_CHARACTER_OPTIONS) {
  const body = renderFor(site);
  const expected = appendixForSite(site).heading;
  check(body.includes(expected), `${site} — הכותרת המתאימה`, expected.slice(35));
}

// The four headings are genuinely four, not the same text relabelled.
const headings = new Set(SITE_CHARACTER_OPTIONS.map((s) => appendixForSite(s).heading));
check(headings.size === SITE_CHARACTER_OPTIONS.length, 'ארבעה נוסחים שונים', String(headings.size));

// ── The workplace argument must not reach a home ────────────────────
//
// This is the failure the whole change exists to prevent, so it is checked on the
// rendered document rather than on the source text.

console.log('\nמה שאסור לדלוף בין נוסחים:');

const home = renderFor('מגורים');
check(!home.includes('המעסיק'), 'דוח מגורים אינו מזכיר את המעסיק');
check(!home.includes('פקודת הבטיחות בעבודה'), 'ואינו מזכיר את פקודת הבטיחות בעבודה');
check(home.includes('חדרי שינה'), 'ומדבר על אזורי שהייה בבית');

const school = renderFor('מוסדות חינוך');
check(!school.includes('המעסיק'), 'דוח מוסד חינוכי אינו מזכיר את המעסיק');
check(school.includes('כיתות'), 'ומדבר על כיתות');

const work = renderFor('מקומות עבודה');
check(work.includes('המעסיק'), 'דוח מקום עבודה כן מזכיר את המעסיק');

// ── What every version shares ───────────────────────────────────────

console.log('\nמה שמשותף לכל הנוסחים:');

for (const site of SITE_CHARACTER_OPTIONS) {
  const body = renderFor(site);
  check(body.includes('IARC') || body.includes('2B'), `${site} — סיווג IARC נשמר`);
}

// The sign-off closes the appendix and must survive the swap.
check(work.includes('יורם גבאי'), 'החתימה בסוף הדוח נשארה');

// ── An unrecognised character falls back rather than blanking ───────

console.log('\nאפיון שאינו ברשימה:');
const other = appendixForSite('מחסן לוגיסטי');
check(other.heading === appendixForSite('מקומות עבודה').heading, 'נופל לנוסח מקומות העבודה');
check(appendixForSite('').heading === appendixForSite('מקומות עבודה').heading, 'וכך גם אפיון ריק');

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
