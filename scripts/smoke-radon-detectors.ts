/**
 * Radon detectors on a customer: the series, the assignment rules, and the draft report.
 *
 * Runs against a throwaway database. The rules worth pinning are that one number
 * belongs to one customer, that a second press drafts no second report, and that a
 * private customer's draft is judged against 200 and not the workplace 500.
 *
 *   npx tsx scripts/smoke-radon-detectors.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'radon-detectors-'));
process.env.REPORT_DB_PATH = join(dir, 'test.db');

const { createCustomer, deleteCustomer } = await import('../src/lib/customer-service');
const { assignDetectors, createReportFromDetectors, listCustomerDetectors, releaseDetectors } = await import(
  '../src/lib/radon-detectors'
);
const { deleteRadonReport, loadRadonReport } = await import('../src/lib/radon-service');
const { detectorKey, detectorSeries, radonVerdict } = await import('../src/lib/radon-rules');
const { RADON_VERDICTS } = await import('../src/lib/radon-schema');
const { db } = await import('../src/lib/db');

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const person = (contactName: string, kind: 'company' | 'private' = 'private') =>
  createCustomer({
    kind,
    contactName,
    contactTitle: '',
    companyName: kind === 'company' ? 'חברת בדיקה' : '',
    addressLine: 'הרצל 1',
    city: 'חיפה',
    phone: '050-0000000',
    email: 'a@example.com',
  });

const reading = (detectorNumber: string, concentration: string, uncertainty: string) =>
  [detectorNumber, { detectorNumber, concentration, uncertainty, status: '' }] as const;

console.log('סדרה:');
const series = detectorSeries('100012', 25);
check(series.length === 25, '25 מספרים, כולל הראשון');
check(series[0] === '100012' && series[1] === '100013' && series[24] === '100036', 'רצופים מהנסרק', series[24]);
check(detectorSeries('שלום', 25).length === 0, 'סריקה בלי מספר לא יוצרת סדרה');
check(detectorKey('RV-0100012') === '100012', 'מספר נסרק מתנרמל למפתח של המעבדה');

console.log('שיוך:');
const home = person('דנה כהן');
const office = person('יוסי לוי', 'company');
const first = assignDetectors(home.id, series);
check(first.added.length === 25, 'כל הסדרה נוספה ללקוח');
check(assignDetectors(home.id, ['100012']).alreadyHere.length === 1, 'סריקה כפולה לא מוסיפה שורה');
check(listCustomerDetectors(home.id).length === 25, 'הרשימה נשארה 25');

const clash = assignDetectors(office.id, ['100036', '100037']);
check(clash.added.join() === '100037', 'גלאי פנוי בסדרה נוסף למרות התנגשות');
check(clash.elsewhere[0]?.detectorNumber === '100036', 'גלאי של לקוח אחר לא עובר אליו');
check(clash.elsewhere[0]?.customerName === 'דנה כהן', 'ההודעה מציינת למי הגלאי שייך');
check(assignDetectors(home.id, ['12']).invalid.length === 1, 'מספר קצר מדי נדחה');
check(assignDetectors(home.id, ['0100012']).alreadyHere.join() === '100012', 'אפס מוביל בברקוד הוא אותו גלאי');
check(detectorSeries('0100012', 2).join() === '100012,100013', 'סדרה מברקוד עם אפס מוביל');

releaseDetectors(home.id, ['100036']);
check(listCustomerDetectors(home.id).length === 24, 'הסרת גלאי');

console.log('טיוטת דוח:');
const readings = new Map([
  reading('100012', '50', '10'),
  reading('100013', '190', '10'),
  reading('100014', '30', '46'),
]);
const reportId = createReportFromDetectors(home.id, readings);
const report = loadRadonReport(reportId)!;
const rowOf = (n: string) => report.detectors.find((d) => d.detectorNumber === n)!;

check(report.detectors.length === 24, 'כל הגלאים בדוח, גם אלה בלי תוצאה');
check(report.customerId === home.id && report.recipientName === 'דנה כהן', 'פרטי הלקוח נכנסו לדוח');
check(report.siteKind === 'מגורים' && rowOf('100012').threshold === '200', 'לקוח פרטי נבחן מול 200');
check(rowOf('100012').concentration === '50' && rowOf('100012').uncertainty === '10', 'התוצאה נכנסה לשורה');
check(radonVerdict(rowOf('100013')) === RADON_VERDICTS.exceeds, '190 ± 10% מעל 200 בלקוח פרטי');
check(rowOf('100014').concentration === '' && rowOf('100014').uncertainty === '', 'אי ודאות רחבה לא נכנסת לבד');
check(rowOf('100015').concentration === '', 'גלאי בלי תוצאה נשאר ריק');
check(rowOf('100012').roomName === '', 'שם החדר לא מומצא');

let second = '';
try {
  createReportFromDetectors(home.id, readings);
} catch (err) {
  second = String(err);
}
check(second !== '', 'לחיצה שנייה לא יוצרת דוח כפול');
check(listCustomerDetectors(home.id).every((d) => d.reportId === reportId), 'הגלאים מסומנים כשייכים לדוח');

releaseDetectors(home.id, ['100012']);
check(listCustomerDetectors(home.id).length === 24, 'גלאי שכבר בדוח לא מוסר');

deleteRadonReport(reportId);
check(listCustomerDetectors(home.id).every((d) => d.reportId === ''), 'מחיקת הדוח מחזירה את הגלאים להמתנה');

const companyReport = loadRadonReport(createReportFromDetectors(office.id, new Map()))!;
check(companyReport.siteKind === 'מקום עבודה' && companyReport.companyName === 'חברת בדיקה', 'חברה נבחנת כמקום עבודה');

deleteCustomer(home.id);
check(assignDetectors(office.id, ['100012']).added.length === 1, 'מחיקת לקוח משחררת את הגלאים שלו');

db().close();
rmSync(dir, { recursive: true, force: true });

console.log(failures === 0 ? '\nהכול תקין' : `\n${failures} בדיקות נכשלו`);
process.exit(failures === 0 ? 0 : 1);
