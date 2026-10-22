/** No-network regression test for the locked antenna-map image template. */
import {
  ANTENNA_MAP_PIXEL_SIZE,
  composeAntennaMapHtml,
  type AntennaBasemap,
} from '../src/lib/antenna-map-html.ts';
import type { AntennaSearchResult, AntennaSiteGroup } from '../src/lib/antennas.ts';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`);
  if (!ok) failures++;
}

function group(n: number): AntennaSiteGroup {
  return {
    n,
    x: 200000 + n,
    y: 740000 + n,
    lat: 32.8 + n * 0.0002,
    lon: 34.98 + n * 0.0002,
    dist: 35 * n,
    address: `אנטנת בדיקה ${n}`,
    city: 'חיפה',
    operators: [`מפעיל ${n}`],
    generations: [4, 5],
    maxPct: 1,
    types: ['תורן'],
    items: [],
    status: 'active',
  };
}

const result: AntennaSearchResult = {
  center: { x: 200000, y: 740000 },
  centerWgs: { lat: 32.8, lon: 34.98 },
  radius: 500,
  groups: Array.from({ length: 11 }, (_, index) => group(index + 1)),
  totalRecords: 11,
  dataFetchedAt: '2026-10-01T00:00:00.000Z',
};
const basemap: AntennaBasemap = {
  dataUri: 'data:image/png;base64,iVBORw0KGgo=',
  ox: 500000,
  oy: 300000,
  mpp: 1,
  zoom: 16,
};
const html = composeAntennaMapHtml(result, {
  pointLabel: 'בית ספר & בדיקה',
  pointAddress: 'דרך הבדיקה 37, חיפה',
  pointCity: 'חיפה',
  pointClassification: 'טקסט שאסור להדפיס',
}, basemap);

console.log('\nתבנית מפת אנטנות:');
check(ANTENNA_MAP_PIXEL_SIZE.width === 1094, 'רוחב התמונה נעול ל-1094 פיקסלים');
check(ANTENNA_MAP_PIXEL_SIZE.height === 819, 'גובה התמונה נעול ל-819 פיקסלים');
check(html.includes('.figure{width:1094px;height:819px'), 'מסגרת ה-HTML נעולה לאותו גודל');
check(html.includes('מפת אנטנות סלולריות ליד בית ספר &amp; בדיקה – חיפה'), 'שם המקום והעיר דינמיים ומקודדים בבטחה');
check(html.includes('בית ספר &amp; בדיקה, דרך הבדיקה 37, חיפה'), 'שורת המיקום מציגה את שם וכתובת הנכס');
check(!html.includes('טקסט שאסור להדפיס'), 'סיווג משתנה אינו משנה את התבנית הנעולה');
check(html.includes('אנטנת בדיקה 1'), 'שם האנטנה הראשונה מוצג');
check(html.includes('אנטנת בדיקה 7'), 'שמות האנטנות הנכנסות ללוח מוצגים');
check(html.includes('4 אתרים נוספים'), 'ריבוי אנטנות נשאר בתוך המסגרת עם הפניה לפירוט');
check(html.includes('>11</text>'), 'כל האנטנות, גם מעבר ללוח, ממוספרות על המפה');
check(html.includes('עדכון 01.10.2026'), 'שורת המקור נשארת זהה לתמונת הייחוס');
check(html.includes('500 מטר'), 'סרגל קנה המידה מסתיים ב-500 מטר');

if (failures > 0) {
  console.error(`\n${failures} בדיקות נכשלו`);
  process.exit(1);
}

console.log('\nכל בדיקות תבנית מפת האנטנות עברו.');
