/**
 * Hayes' Chain of Custody — the form's values, and (when a browser is present) the PDF.
 *
 *   npx tsx scripts/smoke-mold-coc.ts [out.pdf]
 */
import { writeFileSync } from 'node:fs';
import { DraftMoldReportSchema } from '../src/lib/mold-schema';
import { chainOfCustody, longDate, shortDate, withCocNumbers } from '../src/lib/mold-coc';
import { renderChainOfCustodyPdf } from '../src/lib/mold-coc-pdf';
import { applyLabScan, labResultFor, newOutdoorSampleRow, newSampleRow } from '../src/lib/mold-rules';

let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures++;
};

const report = DraftMoldReportSchema.parse({
  samplerName: 'אביחי מוכתר',
  clientName: 'Ofek Richasim',
  coc: { jobNumber: '511', dateCollected: '2023-02-13' },
  samples: [
    { ...newSampleRow(), location: 'סלון', sampleNameEn: "Shimi's desk" },
    { ...newSampleRow(), location: 'West wing reception' },
    { ...newSampleRow(), location: 'חדר שינה', mediaNumber: '21734455' },
    newOutdoorSampleRow(),
    { ...newSampleRow() },
  ],
});

console.log('\nטופס Chain of Custody:');
const form = chainOfCustody(report);
check(form.collector === 'Avihay Mukhtar', `אוסף הדגימות באנגלית — ${form.collector}`);
check(form.mobile === '+972-54-4274143' && form.email === 'avihay@galit.co.il', 'נייד ומייל לפי המדגם');
check(form.note === 'Email (2): yoram@galit.co.il', `הערה — ${form.note}`);
check(form.jobName === 'Ofek Richasim', 'Job Name מהמזמין');
check(form.dateCollected === 'February 13, 2023' && form.releasedDate === 'Feb. 13, 2023', 'תאריכים');
check(longDate('2023-05-02') === 'May 2, 2023' && shortDate('2023-05-02') === 'May 2, 2023', 'חודש קצר בלי נקודה');
check(form.rows.length === 4, `חדר ריק לא מודפס — ${form.rows.length} שורות`);
check(form.rows.map((r) => r.number).join(',') === '511-1,511-2,21734455,511-4', 'מספרים: מדיה או מספר עבודה-שורה');
check(form.rows[0].sample === "Shimi's desk" && form.rows[3].sample === 'Outdoors', 'שם הדגימה באנגלית');
check(form.rows[2].sample === 'Bedroom', 'שם חדר מתורגם');
check(form.rows.every((r) => r.analysis === 'S' && r.volume === '150 Lit.'), 'S ו-150 Lit. כברירת מחדל');

const numbered = withCocNumbers(report);
check(numbered.samples[0].mediaNumber === '511-1' && numbered.samples[2].mediaNumber === '21734455', 'המספרים נרשמים בחדרים');
check(
  labResultFor({ labResults: [{ labNumber: '511-2', sampleName: 'West wing reception' } as never] }, numbered.samples[1]) !== null,
  'תוצאת Hayes 511-2 חוזרת לחדר שלה',
);

console.log('\nקליטת תוצאות Hayes (מהעורך או מהמייל):');
{
  const lab = (labNumber: string, sampleName: string, total: string) => ({
    labNumber, sampleName, volume: '150', reportingLimit: '', background: '', fragments: '',
    organisms: [], totalRaw: '', totalPerCubicMetre: total, totalPercent: '',
  });
  const scanned = applyLabScan(
    numbered,
    [lab('511-1', "Shimi's desk", '900'), lab('511-4', 'Outdoors', '300'), lab('511-9', 'Garage', '50')],
    { labReportNumber: '#26042301', labCollectedDate: '13/02/2023', labReceivedDate: '', labReportedDate: '' },
  );
  check(scanned.report.samples[0].totalCount === '900', 'התוצאה נכנסה לחדר לפי המספר מטופס ה-CoC');
  check(scanned.report.samples[3].totalCount === '300', 'ודגימת החוץ קיבלה את שלה');
  check(scanned.added === 1 && scanned.report.samples.at(-1)?.location === 'Garage', 'תוצאה בלי חדר — נוצר חדר חדש');
  check(scanned.report.labReportNumber === '#26042301', 'מספר דוח המעבדה מולא');
  check(scanned.stray.length === 0, 'לא נשארו תוצאות לא משויכות');
}

const out = process.argv[2];
if (out) {
  const pdf = await renderChainOfCustodyPdf(report);
  check(pdf !== null && pdf.subarray(0, 4).toString() === '%PDF', 'הופק PDF');
  if (pdf) writeFileSync(out, pdf);
}

console.log(failures === 0 ? '\nהכול עבר\n' : `\n${failures} בדיקות נכשלו\n`);
process.exit(failures === 0 ? 0 : 1);
