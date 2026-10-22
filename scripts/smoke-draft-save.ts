/**
 * Checks that a report in progress can be stored.
 *
 * The editor used to hold the whole report in the browser until the last step, where
 * "הפקת הדוח" saved and produced together. Everything before that was one locked phone
 * away from being lost. The autosave now stores between steps — which only works if the
 * half-written state it stores is one the schema accepts, so that is what this checks.
 *
 * The two schemas answer different questions, and the split is the point: the draft
 * schema decides what may be *kept*, the strict one what may be *issued*.
 *
 *   npx tsx scripts/smoke-draft-save.ts
 */
import { DraftReportSchema, ReportSchema } from '../src/lib/report-schema';
import { DraftRadonReportSchema, RadonReportSchema } from '../src/lib/radon-schema';
import { sampleReport } from '../src/lib/sample-report';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// ── A radiation report a minute into the survey ─────────────────────
//
// No site named yet, no customer chosen, and one table laid out whose rows have not been
// described. Every one of those is normal at this point and none may block the save.

console.log('\nדוח קרינה באמצע כתיבה:');

const midSurvey = {
  ...sampleReport(),
  referenceNumber: '',
  recipientName: '',
  siteName: '',
  measurementDate: '',
  elfProtocols: [
    {
      title: '',
      referenceLabel: '',
      normalizationFactor: '1',
      normalizationNote: '',
      rows: [{ description: '', distance: '0.3', height: '', measured: '', normalized: '', occupancy: '', compliance: '' }],
    },
  ],
  rfProtocols: [],
};

const draft = DraftReportSchema.safeParse(midSurvey);
check(draft.success, 'נשמר כטיוטה', draft.success ? '' : draft.error.issues.map((i) => i.path.join('.')).join(', '));
check(ReportSchema.safeParse(midSurvey).success, 'ניתן להפקה גם עם פרטים חלקיים');

// A table with no rows at all — the moment after "הוספת טבלה".
const emptyTable = { ...midSurvey, elfProtocols: [{ title: '', referenceLabel: '', normalizationFactor: '1', normalizationNote: '', rows: [] }] };
check(DraftReportSchema.safeParse(emptyTable).success, 'טבלה חדשה בלי שורות נשמרת');

// A finished report must still satisfy both: relaxing the draft must not have relaxed
// what it means to be finished.
const finished = sampleReport();
check(ReportSchema.safeParse(finished).success, 'דוח מלא עובר את הסכימה המחמירה');
check(DraftReportSchema.safeParse(finished).success, 'ודוח מלא הוא גם טיוטה תקינה');

// ── The radon report, same question ─────────────────────────────────

console.log('\nדוח ראדון באמצע כתיבה:');

const radonMid = {
  referenceNumber: '',
  reportDate: '2026-08-31',
  recipientName: '',
  detectors: [{ detectorNumber: '', roomName: '', floor: '', testLength: 'ארוכה', ventilation: 'ת.מ.ר', concentration: '', uncertainty: '' }],
};

const radonDraft = DraftRadonReportSchema.safeParse(radonMid);
check(radonDraft.success, 'נשמר כטיוטה', radonDraft.success ? '' : radonDraft.error.issues.map((i) => i.message).slice(0, 3).join(', '));
check(!RadonReportSchema.safeParse(radonMid).success, 'ועדיין אינו ניתן להפקה');

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
