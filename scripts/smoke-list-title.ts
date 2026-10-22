/**
 * Checks how a report names itself — in the lists and in the editor's header.
 *
 * One rule for all four departments: "דוח קרינה — (שם החברה / שם הלקוח)". The lists used
 * to lead with the site or the street address, each department its own way, and the
 * office finds a report by its customer.
 *
 *   npx tsx scripts/smoke-list-title.ts
 */
import { reportListTitle, reportSubject } from '../src/lib/report-mapper';
import { DraftReportSchema } from '../src/lib/report-schema';
import { sampleReport } from '../src/lib/sample-report';
import { reportTitle, storedReportTitle } from '../src/lib/report-title';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// The draft schema, because a title has to work for a report still being written — an
// unnamed customer is exactly the case the list has to render.
const at = (patch: Record<string, unknown>) => DraftReportSchema.parse({ ...sampleReport(), ...patch });

console.log('\nכותרת הדוח:');

// A company: its name, never the site — even when a site is typed.
const company = at({ customerType: 'company', companyName: 'כ.א.ל', siteName: 'מוקד בני ברק', recipientName: 'דנה לוי' });
check(reportListTitle(company) === 'דוח קרינה — כ.א.ל', 'חברה — שם החברה', reportListTitle(company));

// A private customer: the person's name, not their street.
const priv = at({ customerType: 'private', recipientName: 'ישראל ישראלי', siteName: 'רחוב הרצל 5', companyName: '' });
check(reportListTitle(priv) === 'דוח קרינה — ישראל ישראלי', 'לקוח פרטי — שם הלקוח', reportListTitle(priv));

// A company whose name is not typed yet falls back to the contact rather than the site.
const unnamedCompany = at({ customerType: 'company', companyName: '', siteName: 'רעננה', recipientName: 'דנה לוי' });
check(reportListTitle(unnamedCompany) === 'דוח קרינה — דנה לוי', 'חברה בלי שם — איש הקשר', reportListTitle(unnamedCompany));

// Nothing named at all: the department alone, not an address.
const fresh = at({ customerType: 'company', siteName: 'הרצליה', companyName: '', recipientName: '' });
check(reportListTitle(fresh) === 'דוח קרינה', 'בלי לקוח — סוג הדוח בלבד', reportListTitle(fresh));

// The other three departments follow the same rule.
check(
  reportTitle('mold', { customerType: 'private', recipientName: 'ערן פינגר', companyName: '' }) === 'דוח עובשים — ערן פינגר',
  'עובשים — לקוח פרטי',
);
check(
  reportTitle('radon', { customerType: 'company', companyName: 'גלית', recipientName: 'יורם' }) === 'דוח ראדון — גלית',
  'ראדון — חברה',
);
// The mould and asbestos "מזמין" is the last resort, and the asbestos "—" placeholder is no name.
check(
  reportTitle('asbestos', { companyName: '—', recipientName: '', clientName: 'פרפקט וייסבורג' }) === 'דוח אסבסט — פרפקט וייסבורג',
  'אסבסט — "—" אינו שם, והמזמין משמש כגיבוי',
);

// A stored row is named from its data, so rows saved under the old rule read correctly.
check(
  storedReportTitle('mold', JSON.stringify({ customerType: 'company', companyName: 'וליד גרייב' }), 'דוח עובשים — הרצליה, הרצליה') ===
    'דוח עובשים — וליד גרייב',
  'שורה שמורה — הכותרת נגזרת מהנתונים ולא מהעמודה הישנה',
);
check(storedReportTitle('mold', '{not json', 'כותרת ישנה') === 'כותרת ישנה', 'שורה שלא נקראת — הכותרת השמורה');

// The cover subject itself must be untouched — it is what the document prints.
check(reportSubject(company).includes('סקר בטיחות קרינה אלקטרומגנטית'), 'נושא השער נשאר כשהיה');

console.log(failures === 0 ? '\nכל הבדיקות עברו.' : `\n${failures} בדיקות נכשלו.`);
process.exit(failures === 0 ? 0 : 1);
