/**
 * The antenna appendix must be automatic whenever antennas are part of the
 * surveyed sources or a protocol is measured relative to an antenna.
 *
 * This is deliberately a pure smoke test: it exercises only the decision rule,
 * without geocoding, data.gov.il, map tiles or Chromium.
 *
 *   npx tsx scripts/smoke-antenna-map-rule.ts
 */
import { shouldIncludeAntennaMap } from '../src/lib/measurement-rules';
import { sampleReport } from '../src/lib/sample-report';

let failures = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`);
  if (!ok) failures++;
};

const sample = sampleReport();
const base = {
  ...sample,
  antennaMapEnabled: false,
  fieldSource: 'לוח חשמל',
  elfProtocols: [],
  rfProtocols: [],
};
const rfWithReference = (referenceLabel: string) => ({
  ...sample.rfProtocols[0],
  referenceLabel,
});
const elfWithReference = (referenceLabel: string) => ({
  ...sample.elfProtocols[0],
  referenceLabel,
});

console.log('\nכלל הפעלת נספח מפת אנטנות:');

check(
  shouldIncludeAntennaMap({ ...base, fieldSource: 'אנטנות' }),
  'מקורות הקרינה: אנטנות',
);
check(
  shouldIncludeAntennaMap({ ...base, fieldSource: 'לוח חשמל, אנטנות' }),
  'אנטנות בערך משולב',
);
check(
  shouldIncludeAntennaMap({ ...base, fieldSource: '\u2067אנט\u200fנות\u2069' }),
  'סימני bidi מסביב ובתוך המילה אנטנות',
);
check(
  shouldIncludeAntennaMap({ ...base, rfProtocols: [rfWithReference('אנטנות בסביבה')] }),
  'בדיקה ביחס ל: אנטנות בסביבה',
);
check(
  shouldIncludeAntennaMap({ ...base, rfProtocols: [rfWithReference('לאנטנות')] }),
  'בדיקה ביחס ל: לאנטנות',
);
check(
  shouldIncludeAntennaMap({ ...base, rfProtocols: [rfWithReference('אנטנה')] }),
  'ערך חופשי בדיקה ביחס ל: אנטנה',
);
check(
  shouldIncludeAntennaMap({ ...base, elfProtocols: [elfWithReference('לאנטנות')] }),
  'טבלת ELF עם בדיקה ביחס לאנטנות',
);
check(
  !shouldIncludeAntennaMap({ ...base, rfProtocols: [rfWithReference('ארון תקשורת')] }),
  'ללא אנטנות הנספח אינו מופעל',
);
check(
  shouldIncludeAntennaMap({ ...base, antennaMapEnabled: true }),
  'סימון ידני ממשיך להפעיל את הנספח',
);

if (failures > 0) {
  console.error(`\n${failures} בדיקות נכשלו`);
  process.exit(1);
}

console.log('\nכל בדיקות כלל מפת האנטנות עברו.');
