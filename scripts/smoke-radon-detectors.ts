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
const { deleteRadonReport, generateRadonReport, loadRadonReport, radonDocumentText } = await import('../src/lib/radon-service');
const { RADON_QUESTIONS, printedAnswers, unansweredQuestions } = await import('../src/lib/radon-questions');
const { activeTemplate, storeTemplate } = await import('../src/lib/docx/template-store');
const { readFileSync } = await import('node:fs');
const { createHash } = await import('node:crypto');
const { detectorKey, detectorSeries, isWholeDetectorEntry, radonVerdict, withDetectorPrefix } = await import('../src/lib/radon-rules');
const { RADON_VERDICTS, RadonReportSchema } = await import('../src/lib/radon-schema');
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

console.log('הקלדה ידנית:');
check(withDetectorPrefix('0018467') === '0018467', 'מספר עם הקידומת נשאר כמו שהוא');
check(withDetectorPrefix('0') === '00' && withDetectorPrefix('') === '00', 'אי אפשר למחוק את ה-00');
check(withDetectorPrefix('018467') === '0018467', 'מחיקת אפס אחד מחזירה אותו');
check(withDetectorPrefix('18467') === '0018467', 'הדבקת מספר בלי קידומת');
check(isWholeDetectorEntry('0018467'), '00 ועוד 5 ספרות הוא מספר מלא');
check(!isWholeDetectorEntry('001846') && !isWholeDetectorEntry('00'), 'מספר חלקי נדחה');
check(isWholeDetectorEntry('000018467') && detectorKey('000018467') === '18467', 'סורק שמקליד את כל התווית אחרי ה-00');

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

console.log('התקנה:');
const { claimDetector, createInstallation, createReportFromInstallation, deleteInstallation, listInstallations, loadInstallation, saveInstallation } = await import('../src/lib/radon-installation-service');
const { floorLabel, floorTitle, installationEnd, israelNow, placementDate, testProgress, InstallationSchema } = await import('../src/lib/radon-installation');
const site = person('רות אבן');
const installationId = createInstallation();
check(loadInstallation(installationId)!.spaces.length === 0, 'התקנה חדשה נפתחת ריקה');
check(floorLabel(0) === 'צמוד קרקע' && floorTitle(-2) === 'קומה 2-' && floorLabel(20) === '20', 'קומה 0 נקראת צמוד קרקע');
check(placementDate('2026-05-06') === '06/05/26', 'תאריך ההתקנה בפורמט הדוח');
check(placementDate('2026-05-06T10:30') === '06/05/26 10:30', 'בדיקה קצרה מודפסת עם שעה');
check(installationEnd('ארוכה', '2026-05-06') === '2026-08-04', 'ארוך טווח: סיום אחרי 90 ימים');
check(installationEnd('קצרה', '2026-11-01T10:30') === '2026-11-04T10:30', 'קצר טווח: סיום אחרי 72 שעות');
check(installationEnd('קצרה', '2026-10-23T10:00') === '2026-10-26T09:00', '72 שעות בדיוק גם כשהשעון משתנה');
check(installationEnd('ארוכה', '') === '' && installationEnd('קצרה', '') === '', 'בלי התחלה אין סיום');
check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(israelNow()), 'שעון ישראל בפורמט שדה תאריך');
check(InstallationSchema.safeParse({ spaces: [{ kind: 'room', floor: 21 }] }).success === false, 'קומה מחוץ לסקאלה נדחית');

const at = new Date('2026-11-01T10:00:00+02:00');
check(testProgress('01/11/26', '30/01/27', at) === 'נותרו 90 ימים', 'ארוך טווח: ימים שנותרו', testProgress('01/11/26', '30/01/27', at));
check(testProgress('01/11/26 10:00', '04/11/26 10:00', at) === 'נותרו 72 שעות', 'קצר טווח: שעות שנותרו', testProgress('01/11/26 10:00', '04/11/26 10:00', at));
check(testProgress('01/11/26 10:00', '01/11/26 10:30', at) === 'נותרה שעה', 'שעה אחרונה');
check(testProgress('01/08/26', '30/10/26', at) === 'הסתיים', 'בדיקה שהסתיימה');
check(testProgress('02/11/26', '30/01/27', at) === 'טרם התחיל', 'בדיקה עתידית');
check(testProgress('', '', at) === '', 'גלאי בלי תאריכים');
const fromCard = loadInstallation(createInstallation(office.id))!;
check(fromCard.customerId === office.id && fromCard.companyName === 'חברת בדיקה', 'התקנה מכרטיס הלקוח נפתחת עם הלקוח');

check(claimDetector(installationId, '', '300001').ok === false, 'בלי לקוח אין סריקה');
const claimed = claimDetector(installationId, site.id, '0300001');
check(claimed.ok && claimed.detectorNumber === '300001', 'סריקה מחזירה את המספר המנורמל');
const taken = claimDetector(installationId, site.id, '100037');
check(!taken.ok && taken.message.includes('יוסי לוי'), 'גלאי של לקוח אחר נדחה עם שם הלקוח', taken.ok ? '' : taken.message);
const otherInstallation = createInstallation();
check(!claimDetector(otherInstallation, site.id, '300001').ok, 'גלאי לא נרשם בשתי התקנות');

const installed = (over = {}) => InstallationSchema.parse({
  customerId: site.id, customerType: 'private', recipientName: 'רות אבן', phone: '050-1111111', email: 'ruth@example.com',
  addressLine: 'הגפן 2', city: 'עכו', installedOn: '2026-05-06',
  spaces: [
    { kind: 'hall', name: 'אולם ספורט', floor: -1, rows: [
      { position: 'מרכז האולם', detectorNumber: '300002' },
      { position: 'קיר צפוני', detectorNumber: '300003' },
      { position: 'כניסה מזרחית', detectorNumber: '' },
    ] },
    { kind: 'room', description: 'סלון', floor: 0, detectorNumber: '300001' },
    { kind: 'room', description: 'מרתף', floor: -2, detectorNumber: '' },
  ],
  ...over,
});
saveInstallation(installationId, installed());
const summary = listInstallations().find((i) => i.id === installationId)!;
check(summary.title === 'רות אבן', 'כותרת ההתקנה היא שם הלקוח');
check(summary.scanned === 3 && summary.spots === 5, '3 מתוך 5 מקומות עם גלאי');
check(summary.unreported.length === 3, 'שלושה גלאים ממתינים לדוח');

const firstDraft = loadRadonReport(createReportFromInstallation(installationId, new Map([reading('300001', '40', '10')])))!;
check(firstDraft.detectors.map((d) => d.detectorNumber).join() === '300002,300003,300001', 'הדוח בסדר ההתקנה');
const hallRow = firstDraft.detectors[0];
check(hallRow.roomName === 'אולם ספורט — מרכז האולם' && hallRow.floor === '1-', 'שורת אולם עוברת לדוח', hallRow.roomName);
const roomRow = firstDraft.detectors[2];
check(roomRow.roomName === 'סלון' && roomRow.floor === 'צמוד קרקע', 'חדר וקומה עוברים לדוח');
check(roomRow.placedAt === '06/05/26' && roomRow.concentration === '40', 'תאריך ההתקנה והתוצאה בשורה');
check(roomRow.collectedAt === '04/08/26' && roomRow.testLength === 'ארוכה', 'ארוך טווח: סיום וסוג עוברים לדוח');
check(firstDraft.recipientName === 'רות אבן' && firstDraft.phone === '050-1111111', 'פרטי הלקוח מההתקנה');
let againDraft = '';
try { createReportFromInstallation(installationId, new Map()); } catch (err) { againDraft = String(err); }
check(againDraft !== '', 'אין דוח כפול מאותה התקנה');

const fresh = createInstallation();
const other = person('נועם גל');
check(claimDetector(fresh, site.id, '300010').ok, 'סריקה בהתקנה נוספת');
const room = (detectorNumber: string, description = 'משרד') => ({ kind: 'room', description, floor: 2, detectorNumber });
saveInstallation(fresh, installed({ spaces: [room('300010')] }));
check(!claimDetector(createInstallation(), other.id, '300010').ok, 'הגלאי תפוס גם ללקוח אחר');
saveInstallation(fresh, installed({ customerId: other.id, spaces: [room('300010', 'מחסן')] }));
const moved = listInstallations().find((i) => i.id === fresh)!;
check(moved.unreported.join() === '300010', 'החלפת לקוח משאירה את הגלאי בהתקנה');
check(assignDetectors(site.id, ['300010']).elsewhere[0]?.customerName === 'נועם גל', 'החלפת לקוח מעבירה את הגלאי');
saveInstallation(fresh, installed({ customerId: other.id, spaces: [] }));
check(claimDetector(otherInstallation, site.id, '300010').ok, 'מחיקת חדר משחררת את הגלאי');
saveInstallation(fresh, installed({ customerId: other.id, spaces: [room('300011')] }));
deleteInstallation(fresh);
check(assignDetectors(site.id, ['300011']).added.length === 1, 'מחיקת התקנה משחררת את הגלאים');
const shortId = createInstallation();
saveInstallation(shortId, installed({
  testLength: 'קצרה',
  installedOn: '2026-11-01T10:30',
  spaces: [{ kind: 'room', description: 'מטבח', floor: 1, detectorNumber: '300020' }],
}));
const shortRow = loadRadonReport(createReportFromInstallation(shortId, new Map([reading('300020', '40', '10')])))!.detectors[0];
check(shortRow.testLength === 'קצרה', 'קצר טווח עובר לדוח');
check(shortRow.placedAt === '01/11/26 10:30' && shortRow.collectedAt === '04/11/26 10:30', 'קצר טווח: תאריך ושעה בדוח', shortRow.collectedAt);
check(radonVerdict(shortRow) === RADON_VERDICTS.shortOk, 'קצר טווח תקין מפנה לבדיקה ארוכה');

deleteInstallation(installationId);
check(listCustomerDetectors(site.id).some((d) => d.detectorNumber === '300001' && d.reportId !== ''), 'גלאי שכבר בדוח נשאר רשום');

console.log('שאלון:');
check(RADON_QUESTIONS.length === 12, '12 שאלות כמו בטופס');
check(unansweredQuestions({}) === 12, 'שאלון ריק — 12 חסרות');
const answers = {
  noteForm4: { answer: 'כן', detail: '' },
  noteMitigation: { answer: 'לא', detail: '' },
  notePlacedBy: { answer: 'מקבל השירות הניח ואסף', detail: '' },
  noteSkipShort: { answer: 'לא מתאים', detail: '' },
  noteSensitiveArea: { answer: 'לא ידוע', detail: '' },
  noteExtension: { answer: 'לא', detail: '' },
  noteSealing: { answer: 'כמעט הרמטי', detail: '' },
  noteVentOpenings: { answer: 'כן', detail: 'צוהר בגג' },
  noteVentSystems: { answer: 'כן', detail: '' },
  noteRadonPaths: { answer: 'לא', detail: 'לא אמור להודפס' },
  noteSolutions: { answer: 'לא ידוע', detail: '' },
  noteApproved: { answer: 'כן', detail: '' },
};
check(unansweredQuestions(answers) === 0, 'שאלון מלא — אין חסרות');
const printed = printedAnswers(answers);
check(printed.notePlacedBy === 'מ/מ' && printed.noteSealing === 'כ"ה', 'תשובה מודפסת בקיצור של הטופס');
check(printed.noteVentOpenings === 'כן — צוהר בגג', 'אילו? מודפס ליד הכן', printed.noteVentOpenings);
check(printed.noteVentSystems === 'כן' && printed.noteRadonPaths === 'לא', 'פירוט בלי כן לא מודפס');
check(printedAnswers({}).noteForm4 === '', 'בלי תשובה מודפס ריק');

const qId = createInstallation(office.id);
saveInstallation(qId, installed({
  customerId: office.id,
  answers,
  wattStart: '120',
  wattEnd: '130',
  spaces: [{ kind: 'room', description: 'משרד', floor: 1, detectorNumber: '700001' }],
}));
check(loadInstallation(qId)!.wattStart === '120' && loadInstallation(qId)!.answers.noteForm4.answer === 'כן', 'תשובות וואט נשמרים בהתקנה');
const qReport = loadRadonReport(createReportFromInstallation(qId, new Map([reading('700001', '40', '10')])))!;
check(qReport.noteForm4 === 'כן' && qReport.notePlacedBy === 'מ/מ' && qReport.noteVentOpenings === 'כן — צוהר בגג', 'התשובות עברו לדוח');
const noteText = radonDocumentText((await generateRadonReport(qReport as never)).bytes);
const answerAfter = (needle: string, value: string) => {
  const i = noteText.indexOf(needle);
  return i >= 0 && noteText.slice(i, i + needle.length + 200).includes(value);
};
check(!noteText.includes('{note'), 'בדוח לא נשארו שדות לא ממולאים');
check(answerAfter('פתחי אוורור', 'צוהר בגג'), 'בקובץ Word: פירוט הפתחים');
check(answerAfter('האם הנחת הגלאים ואיסופם', 'מ/מ'), 'בקובץ Word: מי הניח ואסף');
check(answerAfter('נורמלי (נ)', 'כ"ה'), 'בקובץ Word: רמת האיטום ומקרא חדש');

const bare = RadonReportSchema.parse({ referenceNumber: '1', reportDate: '2026-01-01', recipientName: 'א' });
check(bare.noteForm4 === 'לא' && bare.notePlacedBy === 'ב/ב' && bare.noteApproved === 'כן', 'דוח ישן מדפיס את מה שתמיד הדפיס');

console.log('שדרוג תבנית:');
const OLD_SHA = 'c5ffb3f3b87cf34328219da32ac04cd84e4f369a9e790c594d3e6fb119d95489';
const bundled = readFileSync('templates/radon-template.docx');
check(createHash('sha256').update(bundled).digest('hex') !== OLD_SHA, 'הקובץ המצורף אינו הגרסה הישנה');
const uploaded = storeTemplate(bundled, 'העלאה ידנית.docx', '', 'radon');
check(activeTemplate('radon')?.id === uploaded.id, 'תבנית קיימת לא מוחלפת');

console.log('קריאת תווית:');
const { readDetectorLabel } = await import('../src/lib/radon-lab-scan');
process.env.OPENAI_API_KEY = 'test';
const realFetch = globalThis.fetch;
const modelSays = (content: string) => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }))) as typeof fetch;
};
modelSays('{"number": "0018467"}');
const label = await readDetectorLabel(Buffer.from('x'), 'image/jpeg');
check(label === '0018467', 'המספר חוזר כפי שהודפס', label);
check(detectorKey(label) === '18467', 'התווית מתאימה למספר של המעבדה');
modelSays('{"number": ""}');
check((await readDetectorLabel(Buffer.from('x'), 'image/jpeg')) === '', 'לא נקרא בוודאות — אין מספר');
modelSays('{"number": "00184x7"}');
check((await readDetectorLabel(Buffer.from('x'), 'image/jpeg')) === '', 'תשובה שאינה ספרות נדחית');
globalThis.fetch = realFetch;

deleteCustomer(home.id);
check(assignDetectors(office.id, ['100012']).added.length === 1, 'מחיקת לקוח משחררת את הגלאים שלו');

db().close();
rmSync(dir, { recursive: true, force: true });

console.log(failures === 0 ? '\nהכול תקין' : `\n${failures} בדיקות נכשלו`);
process.exit(failures === 0 ? 0 : 1);
