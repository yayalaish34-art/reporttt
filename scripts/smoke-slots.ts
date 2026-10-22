/**
 * The conclusion slots: what the template offers, and what the findings say.
 *
 * The conclusions are the part of a survey a client acts on, so the two halves
 * of the mechanism are checked separately. The template half — that highlighted
 * passages are found, grouped and written back with the yellow gone — needs no
 * model. The findings half — the brief the model is handed — is where a wrong
 * word does real damage, and the quantifier is the word that does most of it:
 * a total exceedance drafted as "בחלק מהאזורים" understates a finding somebody
 * relies on. That one is pinned here in both directions.
 *
 *   npx tsx scripts/smoke-slots.ts
 */
import PizZip from 'pizzip';
import { collectConclusionSlots, applyConclusionSlots } from '../src/lib/docx/conclusion-slots';
import { computeFindings, describeFindings } from '../src/lib/report-findings';
import { ReportSchema, type Report } from '../src/lib/report-schema';
import { sampleReport } from '../src/lib/sample-report';
import { textOf } from '../src/lib/docx/ooxml';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// ── The template half ───────────────────────────────────────────────

/** A minimal document: two ELF paragraphs, a "מסקנות" divider, one RF paragraph. */
const run = (text: string, highlighted: boolean) =>
  `<w:r><w:rPr><w:b/>${highlighted ? '<w:highlight w:val="yellow"/>' : ''}</w:rPr>` +
  `<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`;

const DOC =
  '<w:document><w:body>' +
  para(run('מסקנות', false)) +
  para(run('בכל נקודות המדידה נמדדו ערכים נמוכים', true), run(' (ראה דו"ח תוצאות).', false)) +
  para(run('פסקה שלמה ראשונה.', true)) +
  para(run('פסקה שלמה שנייה.', true)) +
  para(run('מסקנות', false)) +
  para(run('בהשוואה לערכי הסף, ', false), run('כל האזורים נמוכים מהסף.', true)) +
  '</w:body></w:document>';

console.log('משבצות בתבנית:');
const slots = collectConclusionSlots(DOC);
check(slots.length === 3, 'שלוש משבצות זוהו', `${slots.length}`);
check(slots[0]?.kind === 'elf' && !slots[0].wholeParagraphs, 'הראשונה — קטע בתוך משפט ELF');
check(
  slots[1]?.kind === 'elf' && slots[1].wholeParagraphs && slots[1].example.length === 2,
  'פסקאות שלמות רצופות התאחדו למשבצת אחת',
  `${slots[1]?.example.length} פסקאות`,
);
check(slots[2]?.kind === 'rf', 'האחרונה שייכת ל-RF אחרי הכותרת השנייה', slots[2]?.kind);
check(
  slots[0]?.surrounding.includes('ראה דו"ח תוצאות'),
  'קטע בתוך משפט מקבל את המשפט השלם כהקשר',
);

console.log('\nהחלה על המסמך:');
const applied = applyConclusionSlots(DOC, slots, [
  ['נוסח חדש לקטע'],
  ['פסקה חדשה א.', 'פסקה חדשה ב.'],
  ['נוסח חדש ל-RF.'],
]);
check(!/<w:highlight w:val="yellow"/.test(applied), 'הצהוב ירד מהמסמך המופק');
check(/<w:b\/>/.test(applied), 'ההדגשה נשארה');
const text = textOf(applied);
check(text.includes('נוסח חדש לקטע (ראה דו"ח תוצאות).'), 'הקטע הוחלף והזנב הקבוע נשאר');
check(text.includes('פסקה חדשה א.') && text.includes('פסקה חדשה ב.'), 'שתי הפסקאות הוחלפו');
check(!text.includes('פסקה שלמה ראשונה'), 'הנוסח הישן לא נשאר');
check(text.includes('בהשוואה לערכי הסף, נוסח חדש ל-RF.'), 'הפתיח הקבוע של RF נשמר');

// A slot with no replacement keeps its own wording rather than emptying out.
const untouched = textOf(applyConclusionSlots(DOC, slots, [[], [], []]));
check(untouched.includes('בכל נקודות המדידה נמדדו ערכים נמוכים'), 'משבצת בלי החלפה נשארת כמות שהיא');

// ── The findings half ───────────────────────────────────────────────

const elfPoint = (description: string, value: string, occupancy: string, compliance: string) => ({
  description, distance: '0.3', height: '1', measured: value, normalized: value, occupancy, compliance,
});
const rfPoint = (description: string, measured: string) => ({
  description, occupancy: 'רציף', measured, threshold: '40', compliance: '', distance: '0.3', height: '1',
});

const elfWith = (rows: ReturnType<typeof elfPoint>[]): Report =>
  ReportSchema.parse({
    ...sampleReport(),
    elfProtocols: [{ title: 'פרוטוקול ELF', referenceLabel: 'ללוח', normalizationFactor: '1', normalizationNote: '', rows }],
    rfProtocols: [],
  });
const rfWith = (rows: ReturnType<typeof rfPoint>[]): Report =>
  ReportSchema.parse({
    ...sampleReport(),
    elfProtocols: [],
    rfProtocols: [{ title: 'פרוטוקול RF', referenceLabel: 'לארון תקשורת', rows }],
  });

const brief = (report: Report, kind: 'elf' | 'rf') => describeFindings(computeFindings(report), kind);

console.log('\nכימות בממצאים — ELF:');
const elfAll = brief(elfWith([elfPoint('א', '18', 'קבועה', 'חורג'), elfPoint('ב', '15', 'קבועה', 'חורג')]), 'elf');
check(elfAll.includes('יש לנסח "בכל"'), 'כל הנקודות חורגות → "בכל"');
check(!elfAll.includes('יש לנסח "בחלק'), 'ולא "בחלק"');

const elfSome = brief(elfWith([elfPoint('א', '18', 'קבועה', 'חורג'), elfPoint('ב', '1.2', 'קבועה', 'לא חורג')]), 'elf');
check(elfSome.includes('יש לנסח "בחלק מ…"'), 'חלק חורגות → "בחלק מ…"');
check(elfSome.includes('אסור לנסח "בכל"'), 'ואיסור מפורש על "בכל"');

const elfNone = brief(elfWith([elfPoint('א', '1.1', 'קבועה', 'לא חורג')]), 'elf');
check(elfNone.includes('אף אחת מנקודות המדידה אינה חורגת'), 'אף נקודה לא חורגת');

console.log('\nכימות בממצאים — RF:');
const rfAll = brief(rfWith([rfPoint('א', '120'), rfPoint('ב', '75')]), 'rf');
check(rfAll.includes('יש לנסח "בכל"'), 'כל האזורים חורגים → "בכל"');
check(!rfAll.includes('יש לנסח "בחלק'), 'ולא "בחלק"');

const rfSome = brief(rfWith([rfPoint('א', '120'), rfPoint('ב', '0.4')]), 'rf');
check(rfSome.includes('יש לנסח "בחלק מ…"'), 'חלק חורגים → "בחלק מ…"');

const rfNone = brief(rfWith([rfPoint('א', '0.2'), rfPoint('ב', '0.4')]), 'rf');
check(rfNone.includes('כל הנקודות עומדות בדרישות'), 'אף אזור לא חורג');

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
