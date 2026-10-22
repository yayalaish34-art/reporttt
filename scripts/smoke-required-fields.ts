/**
 * Which fields a step refuses to be left without.
 *
 * Everything the surveyor types is required, with one deliberate exception: the
 * cells of a measurement table. Every other field prints on the opening pages, so
 * a gap there is a blank line in a signed document — but a protocol row is written
 * while walking a floor with a meter, and it stands half-filled for as long as the
 * survey takes. Demanding every cell would lock the surveyor out of the rest of
 * their own report until the last measurement was taken.
 *
 * What the tables still owe is what makes them printable: a source name and at
 * least one row.
 *
 * The other rule these checks defend is that only what the surveyor can *see* is
 * demanded. A required cell the editor never renders is a dead "המשך" button with
 * no way to work out what the app is waiting for.
 *
 *   npx tsx scripts/smoke-required-fields.ts
 */
import { sampleReport } from '../src/lib/sample-report';
import {
  customerMissing,
  orderDetailsMissing,
  protocolsMissing,
  siteMissing,
} from '../src/lib/report-complete';
import type { Report } from '../src/lib/report-schema';
import {
  BOARD_POINT_OPTIONS,
  RF_POINT_DISTANCES,
  SLOW_SCAN_SUFFIX,
  withSlowScan,
} from '../src/lib/measurement-rules';

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** The worked example, which is a complete survey. */
const full = sampleReport();

console.log('\nפרטי ההזמנה');

check(orderDetailsMissing(full) === null, 'דוח מלא עובר', orderDetailsMissing(full) ?? '');

const orderFields: Array<[keyof Report, string]> = [
  ['requesterName', 'יבוצע בנוכחות'],
  ['measurementDate', 'תאריך הבדיקה'],
  // "מקום" is deliberately absent — see below.
  ['siteCharacter', 'אפיון המקום'],
  ['weather', 'תנאי מזג אוויר'],
  ['fieldSource', 'מקור השדה'],
  ['measurementType', 'סוג המדידות'],
];

for (const [field, label] of orderFields) {
  const gaps = orderDetailsMissing({ ...full, [field]: '' } as Report);
  check(gaps !== null && gaps.includes(label), `${label} ריק חוסם`, gaps ?? 'לא נחסם');
}

/*
 * "מקום" is no longer demanded on this step.
 *
 * It was a second box asking what "שם האתר" already asks one step earlier — the same
 * answer typed twice, which is both wasted keystrokes and a way for two halves of one
 * document to disagree. The editor now fills it from the site name, so naming it as a
 * gap here would send the surveyor looking for a box that is not on the screen.
 */
check(
  orderDetailsMissing({ ...full, location: '' } as Report) === null,
  'מקום ריק אינו חוסם — הוא נמלא משם האתר',
  orderDetailsMissing({ ...full, location: '' } as Report) ?? '',
);

// The date and the time are one stored value, so a date without a time has to be
// caught on its own — otherwise the document prints a measurement taken at midnight.
const noTime = orderDetailsMissing({ ...full, measurementDateTime: '21/06/26' } as Report);
check(noTime !== null && noTime.includes('שעת הבדיקה'), 'תאריך בלי שעה חוסם', noTime ?? 'לא נחסם');


console.log('\nטבלאות מדידה — מבנה בלבד');

check(protocolsMissing(full) === null, 'דוח מלא עובר', protocolsMissing(full) ?? '');

check(
  protocolsMissing({ ...full, elfProtocols: [], rfProtocols: [] } as Report)?.includes(
    'לפחות טבלת מדידה אחת',
  ) === true,
  'בלי טבלאות בכלל — נחסם',
);

/**
 * A half-written row does not block, and that is the point of this step.
 *
 * A protocol is filled in while walking a floor with a meter: the point is described
 * when it is reached, the reading arrives when the instrument settles, and the height
 * gets typed when there is a hand free. Demanding every cell would lock the surveyor
 * out of the rest of the report until the last measurement was taken.
 */
const halfWritten: Report = {
  ...full,
  elfProtocols: full.elfProtocols.map((p, i) =>
    i === 0
      ? {
          ...p,
          rows: p.rows.map((r, j) =>
            j === 0 ? { ...r, distance: '', height: '', measured: '', occupancy: '' } : r,
          ),
        }
      : p,
  ),
};
check(
  protocolsMissing(halfWritten) === null,
  'שורת ELF חצי-מלאה אינה חוסמת',
  protocolsMissing(halfWritten) ?? '',
);

const blankRow: Report = {
  ...full,
  rfProtocols: full.rfProtocols.map((p, i) =>
    i === 0
      ? {
          ...p,
          rows: p.rows.map((r, j) =>
            j === 0
              ? { ...r, description: '', measured: '', threshold: '', distance: '', height: '' }
              : r,
          ),
        }
      : p,
  ),
};
check(protocolsMissing(blankRow) === null, 'שורת RF ריקה לגמרי אינה חוסמת');

console.log('\nמה כן נדרש בטבלאות');

const unnamed: Report = {
  ...full,
  elfProtocols: full.elfProtocols.map((p, i) => (i === 0 ? { ...p, title: '' } : p)),
};
check(
  protocolsMissing(unnamed)?.includes('שם המקור המקרין') === true,
  'טבלה בלי שם מקור נחסמת — הכותרת המודפסת נבנית ממנו',
  protocolsMissing(unnamed) ?? 'לא נחסם',
);

const noRows: Report = {
  ...full,
  elfProtocols: full.elfProtocols.map((p, i) => (i === 0 ? { ...p, rows: [] } : p)),
};
check(
  protocolsMissing(noRows)?.includes('אין שורות מדידה') === true,
  'טבלה בלי שורות נחסמת',
  protocolsMissing(noRows) ?? 'לא נחסם',
);

console.log('\nלקוח');

check(customerMissing(full) === null, 'דוח מלא עובר', customerMissing(full) ?? '');

for (const [field, label] of [
  ['recipientName', 'שם איש הקשר'],
  ['companyName', 'שם החברה'],
  ['addressLine', 'כתובת החברה'],
  ['city', 'עיר'],
  ['phone', 'טלפון'],
  ['email', 'דוא״ל'],
] as const) {
  const gaps = customerMissing({ ...full, [field]: '' } as Report);
  check(gaps !== null && gaps.includes(label), `${label} ריק חוסם`, gaps ?? 'לא נחסם');
}

// A private customer has no company line to print, so it is not demanded of them.
check(
  customerMissing({ ...full, customerType: 'private', companyName: '' } as Report) === null,
  'לקוח פרטי אינו נדרש לשם חברה',
);

// The role is optional in the form itself and stays optional here.
check(
  customerMissing({ ...full, recipientTitle: '' } as Report) === null,
  'תפקיד נשאר לא חובה',
);

console.log('\nסוג הסקר והאתר');

check(siteMissing(full) === null, 'דוח מלא עובר');
check(
  siteMissing({ ...full, siteName: '' } as Report)?.includes('שם האתר') === true,
  'שם האתר ריק חוסם',
);


// ── The slow-scan phrase completes every point description ──────────
//
// A reading is taken across an area rather than at a spot: the surveyor sweeps the
// meter and records the highest value it settles on. Saying so is what makes the number
// in the next column mean "the worst reading here", and the wording is identical on
// every row of every report — so it is completed on confirm rather than retyped.

console.log('\nהשלמת תיאור נקודת המדידה:');

check(
  withSlowScan('במדרכה סמוך לאנטנה') === `במדרכה סמוך לאנטנה ${SLOW_SCAN_SUFFIX}`,
  'התיאור מושלם במשפט הקבוע',
  withSlowScan('במדרכה סמוך לאנטנה'),
);

// Saving a description a second time — reopening the editor and pressing save — must
// not append the phrase again.
check(
  withSlowScan(withSlowScan('בחצר האחורית')) === withSlowScan('בחצר האחורית'),
  'שמירה חוזרת אינה מכפילה את המשפט',
);

// The board faces already say it, in more detail. Appending would be redundant.
check(
  withSlowScan(BOARD_POINT_OPTIONS[0]) === BOARD_POINT_OPTIONS[0],
  'פאת לוח שכבר מנוסחת כך נשארת כמות שהיא',
);

check(withSlowScan('') === '', 'תיאור ריק נשאר ריק ולא הופך למשפט');

// ── The RF point profile ────────────────────────────────────────────
//
// An antenna is measured by walking in from far off, so a point is six readings rather
// than one. Descending, because that is the order the survey is walked.

console.log('\nפרופיל המרחקים ב-RF:');

check(RF_POINT_DISTANCES.length === 6, 'שש מדרגות', String(RF_POINT_DISTANCES.length));
check(
  RF_POINT_DISTANCES.join(',') === '300,200,100,50,20,10',
  'מ-300 עד 10, בסדר יורד',
  RF_POINT_DISTANCES.join(','),
);

console.log(failures === 0 ? '\nהכול עבר\n' : `\n${failures} בדיקות נכשלו\n`);
process.exit(failures === 0 ? 0 : 1);
