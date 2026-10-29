/**
 * The mould report: the template's fields, the outdoor comparison, and the two
 * chapters that print conditionally.
 *
 * Three things are worth pinning. The address is answered once and printed in five
 * places in two grammatical forms — a change that broke the shaping would produce
 * "ברחוב רחוב הפעמונית" in a signed report. The comparison against the outdoor
 * control is the report's entire conclusion and is computed rather than typed, so
 * the bands it selects are asserted directly. And the moisture chapter must vanish
 * whole when the survey did not measure it, rather than printing four paragraphs
 * explaining a test nobody ran.
 *
 *   npx tsx scripts/smoke-mold.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { mergeDocx } from '../src/lib/docx/merge-docx';
import { textOf } from '../src/lib/docx/ooxml';
import {
  DraftMoldReportSchema,
  LAB_ORGANISMS,
  MoldReportSchema,
  parseIssuableMoldReport,
  type MoldReport,
} from '../src/lib/mold-schema';
import {
  compareWithOutdoor,
  hasSignificantFinding,
  labResultFor,
  sampleWithLabResult,
  unmatchedLabResults,
  hasWaterDamageMarkers,
  indoorAirSamples,
  moistureText,
  newOutdoorSampleRow,
  newSampleRow,
  outdoorAirSample,
  photosInRoomOrder,
  realSamples,
  surfaceSamples,
  toCount,
  waterDamageMarkersIn,
} from '../src/lib/mold-rules';
import { buildMoldMergeData, moldFileName, moldSubject } from '../src/lib/mold-mapper';
import { buildPhotosXml } from '../src/lib/docx/photos';
import { moldSamplesMissing } from '../src/lib/report-complete';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = resolve(ROOT, 'templates/mold-template.docx');


/**
 * Every opened tag closed, in order.
 *
 * This is what Word actually refuses over, and it is the check the laboratory tables
 * needed: `<w:t[^>]*>` also matches `<w:tc>`, so a rule meant to rewrite a text run
 * silently ate the cell's opening tag. The document's *text* stayed perfectly correct
 * and every content assertion passed — Word simply would not open the file, and
 * docxtemplater blamed a loop tag several sections away.
 */
function wellFormed(xml: string): string | null {
  const stack: string[] = [];
  for (const m of xml.matchAll(/<(\/?)(w:[a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m;
    if (self === '/' || attrs.endsWith('/')) continue;
    if (close) {
      if (stack.pop() !== tag) return `סגירה לא תואמת: ${tag}`;
    } else stack.push(tag);
  }
  return stack.length ? `תגים לא נסגרו: ${stack.slice(0, 3).join(', ')}` : null;
}

let failures = 0;
function check(ok: boolean, label: string, extra = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

/** The source report's own figures, so the assertions are against a real survey. */
const report: MoldReport = MoldReportSchema.parse({
  referenceNumber: '2126081107',
  reportDate: '30 ביולי 2026',
  customerType: 'company',
  recipientName: 'מואנס גרייב - מנהל',
  companyName: 'וליד גרייב בע"מ',
  addressLine: "רואוס אל-ג'יבאל 52",
  city: 'נצרת',
  phone: '052-6680532',
  email: 'moanesg@waled-g.com',
  clientName: 'ערן פינגר',
  clientPhone: '053-8895495',
  clientEmail: 'fingeran@gmail.com',
  requestDate: '29/07/2026',
  occupantName: 'ערן פינגר',
  siteKind: 'בדירת מגורים של',
  siteAddress: 'פעמונית 2, הוד השרון',
  surveyDateTime: '30/07/2026, 08:00-09:30',
  weather: 'קיצי, בהיר',
  attendedBy: 'ערן',
  samplesReceived: 'שבע',
  labReportNumber: '26039243',
  siteDescription: 'דירת המגורים נמצאת בקומה 2 של בית המחולק ליחידות דיור.',
  buildingDescription: 'דירה בקומה 2 מעל קומת עמודים',
  customerClaim: 'חשש להימצאות עובש על רקע תלונות על ריחות חריגים.',
  methodDescription: 'נלקחו ארבע דגימות אוויר ושתי דגימות משטח.',
  moistureSurveyed: 'כן',
  moistureReadings: [
    { location: 'חדר בן, קיר מערבי', reading: '78%', level: 'לחות גבוהה' },
    { location: 'סלון, מתחת לחלון', reading: '61%', level: 'לחות מוגברת' },
  ],
  moistureFindings: 'נמצאו מספר מוקדים שבהם נמדדו ערכי לחות גבוהים בחדר הבן.',
  samples: [
    {
      location: 'חדר בן',
      kind: 'אוויר',
      scope: 'פנים',
      labNumber: '807-1',
      totalCount: '38,009',
      organisms: 'Aspergillus/Penicillium, Stachybotrys, Chaetomium',
      moistureReading: '2.1%',
    },
    {
      location: 'סלון',
      kind: 'אוויר',
      scope: 'פנים',
      labNumber: '807-2',
      totalCount: '26,067',
      organisms: 'Aspergillus/Penicillium',
      moistureReading: '0.3%',
    },
    {
      location: 'חוץ',
      kind: 'אוויר',
      scope: 'חוץ',
      labNumber: '807-5',
      totalCount: '327',
      organisms: 'Cladosporium',
    },
    {
      location: 'קיר סמוך לארון',
      kind: 'משטח',
      scope: 'פנים',
      labNumber: '807-6',
      organisms: 'Aspergillus, Penicillium',
    },
  ],
  interpretations: {
    '807-1': 'בחדר בן נמצא ריכוז גבוה משמעותית.\nהממצא כולל סמני נזקי מים.',
    '807-2': 'בסלון נמצא ריכוז גבוה משמעותית של Aspergillus/Penicillium.',
    '807-5': 'דגימת הביקורת משמשת בסיס להשוואה.',
  },
  moistureNotes: {
    '807-1': 'נמדדה קריאה גבוהה יחסית לנקודה האחרת בדירה.',
    '807-2': 'נמדדה קריאה נמוכה יחסית לנקודה האחרת בדירה.',
    '807-5': 'לא נמדדה לחות בנקודה זו — דגימת אוויר חיצונית.',
  },
  moistureAssessments: {
    '807-1': 'גבוה יחסית לנקודת המדידה האחרת',
    '807-2': 'נמוך יחסית לנקודת המדידה האחרת',
  },
  moistureNarrative: 'הקריאה בחדר בן גבוהה יחסית לזו שבסלון.\nשתי הקריאות עדיין נמוכות ואינדיקטיביות בלבד.',
  airSummary: 'בכל דגימות האוויר הפנימיות נמצאו ריכוזים חריגים.',
  surfaceSummary: 'דיגומי המשטח מאשרים הימצאות עובש.',
  conclusions: [
    'במועד הבדיקה נמצאה אינדיקציה חריגה לריכוזי נבגי עובש.',
    'נמצאו נבגים מסוג Stachybotrys ו-Chaetomium.',
    'נמצאו מוקדי לחות מוגברת בקירות.',
  ],
  recommendations: [
    'מומלץ לבצע בירור מקצועי לאיתור מקור הרטיבות.',
    'מומלץ לבצע טיפול מקצועי בעובש.',
  ],
});

// ── Reading the laboratory's numbers ────────────────────────────────
//
// The laboratory writes "<37,000" as readily as a plain figure, and the "<" means the
// count ran past the countable range. Dropping the digits with the qualifier would put
// the comparison on the wrong side of every threshold it decides.

console.log('\nקריאת מספרי המעבדה:');
check(toCount('38,009') === 38009, 'מספר עם מפריד אלפים');
check(toCount('<37,000') === 37000, 'מספר עם סימן "קטן מ" — הספרות נקראות');
check(toCount('') === null, 'תא ריק אינו אפס', String(toCount('')));
check(toCount('—') === null, 'תא בלי מספר אינו אפס');

// ── The comparison the whole report turns on ────────────────────────
//
// There is no national standard for indoor spore counts, so the outdoor sample taken
// the same morning is the reference. These bands are what the conclusions are worded
// from, and they are computed rather than typed so that two reports describe the same
// ratio the same way.

console.log('\nהשוואה לדגימת החוץ:');
{
  const outdoor = outdoorAirSample(report);
  check(outdoor?.location === 'חוץ', 'דגימת החוץ אותרה');

  const [bedroom, livingRoom] = indoorAirSamples(report);
  check(
    compareWithOutdoor(bedroom, outdoor) === 'גבוה משמעותית',
    '38,009 מול 327 — גבוה משמעותית',
    String(compareWithOutdoor(bedroom, outdoor)),
  );
  check(
    compareWithOutdoor(livingRoom, outdoor) === 'גבוה משמעותית',
    '26,067 מול 327 — גבוה משמעותית',
  );

  // Just above outdoor is not the same finding, and must not be worded as one.
  const slight = { ...newSampleRow(), location: 'מטבח', totalCount: '500' };
  check(
    compareWithOutdoor(slight, outdoor) === 'מעט גבוה',
    '500 מול 327 — מעט גבוה, לא משמעותי',
    String(compareWithOutdoor(slight, outdoor)),
  );

  const normal = { ...newSampleRow(), location: 'מטבח', totalCount: '300' };
  check(compareWithOutdoor(normal, outdoor) === 'רגיל', '300 מול 327 — רגיל');

  // Exactly five times outdoor is the boundary, and the boundary belongs to the
  // significant band — a threshold that excluded its own value would make the wording
  // depend on a rounding nobody can see.
  const boundary = { ...newSampleRow(), location: 'מטבח', totalCount: String(327 * 5) };
  check(
    compareWithOutdoor(boundary, outdoor) === 'גבוה משמעותית',
    'בדיוק פי 5 — נכלל בגבוה משמעותית',
  );

  // No control means no comparison. A missing comparison must not read as a passing one.
  const noControl = MoldReportSchema.parse({
    ...report,
    samples: report.samples.filter((s) => s.scope !== 'חוץ'),
  });
  check(
    compareWithOutdoor(indoorAirSamples(noControl)[0], outdoorAirSample(noControl)) === null,
    'בלי דגימת חוץ — אין השוואה, ולא "רגיל"',
  );

  /*
   * Hayes labels the control "OUTSIDE". Reports scanned before that spelling was
   * recognised already carry scope="פנים", so the name must repair the meaning at
   * read time rather than relying on the user to rescan or edit old data.
   */
  const outsideNamed = MoldReportSchema.parse({
    ...report,
    samples: report.samples.map((sample) =>
      sample.scope === 'חוץ' ? { ...sample, location: 'OUTSIDE', scope: 'פנים' as const } : sample,
    ),
  });
  check(outdoorAirSample(outsideNamed)?.location === 'OUTSIDE', 'OUTSIDE מזוהה תמיד כדגימת החוץ');
  check(indoorAirSamples(outsideNamed).length === 2, 'OUTSIDE אינו נספר כדגימת פנים');
  check(moldSamplesMissing(outsideNamed) === null, 'OUTSIDE מספק את דרישת דגימת ההשוואה');

  const outsideMerge = buildMoldMergeData(outsideNamed);
  check(outsideMerge.hasOutdoor === true, 'הדוח מודפס עם מקטע דגימת החוץ');
  check(
    String(outsideMerge.sampleCountLine).includes('דגימת חוץ אחת'),
    'שורת מניין הדגימות סופרת את OUTSIDE כדגימת חוץ',
    String(outsideMerge.sampleCountLine),
  );
}

// ── Water-damage markers ────────────────────────────────────────────
//
// These grow on wet cellulose and say something an elevated total count does not, so
// they are identified from the laboratory's Latin names rather than left to the eye.

console.log('\nסמני נזקי מים:');
check(
  waterDamageMarkersIn(report.samples[0]).join(',') === 'Stachybotrys,Chaetomium',
  'זוהו Stachybotrys ו-Chaetomium',
  waterDamageMarkersIn(report.samples[0]).join(','),
);
check(waterDamageMarkersIn(report.samples[1]).length === 0, 'דגימה בלי סמנים');
check(hasWaterDamageMarkers(report), 'הדוח כולו מסומן כנושא סמני נזקי מים');
check(hasSignificantFinding(report), 'הדוח כולו מסומן כנושא ממצא משמעותי');

// ── What the step will and will not let past ────────────────────────
//
// The outdoor sample is demanded on site, while the pump is still in the van — not a
// week later when the laboratory answers and the air has moved on.

console.log('\nמה שלב הדגימות דורש:');
check(moldSamplesMissing(report) === null, 'סקר מלא עובר');
{
  const noOutdoor = DraftMoldReportSchema.parse({
    ...report,
    samples: report.samples.filter((s) => s.scope !== 'חוץ'),
  });
  const gap = moldSamplesMissing(noOutdoor as MoldReport);
  check(gap !== null && gap.includes('חיצונית'), 'בלי דגימת חוץ — נחסם', gap ?? '');

  const unplaced = DraftMoldReportSchema.parse({
    ...report,
    samples: [...report.samples, { ...newSampleRow(), totalCount: '900' }],
  });
  const placeGap = moldSamplesMissing(unplaced as MoldReport);
  check(placeGap !== null && placeGap.includes('מיקום'), 'דגימה בלי מיקום — נחסמת', placeGap ?? '');

  // A survey of surfaces alone needs no control: it reports a presence, not a
  // concentration, so there is nothing to compare against.
  const surfaceOnly = DraftMoldReportSchema.parse({
    ...report,
    samples: [{ ...newSampleRow(), location: 'קיר', kind: 'משטח', organisms: 'Aspergillus' }],
  });
  check(
    moldSamplesMissing(surfaceOnly as MoldReport) === null,
    'סקר משטחים בלבד — לא נדרשת דגימת חוץ',
  );
}

// ── Rows the editor is not showing ──────────────────────────────────
//
// A moisture row left behind in a report whose moisture survey is switched off is not
// a gap in the document; it is a row with no screen to fix it on.

console.log('\nשמירת דוח שהעורך רואה כשלם:');
{
  const withStrandedRow = {
    ...report,
    moistureSurveyed: 'לא' as const,
    moistureReadings: [{ location: '', reading: '', level: 'תקין' as const }],
  };
  const parsed = parseIssuableMoldReport(withStrandedRow);
  check(
    parsed.success,
    'שורת לחות יתומה בדוח בלי בדיקת לחות — לא חוסמת',
    parsed.success ? '' : parsed.error.issues.map((i) => i.message).join(' | '),
  );

  // And a brand-new report autosaves, starter rows and all.
  check(
    DraftMoldReportSchema.safeParse({
      referenceNumber: '',
      samples: [newSampleRow(), { ...newSampleRow(), location: 'חוץ', scope: 'חוץ' }],
    }).success,
    'שמירה אוטומטית של דוח חדש לגמרי',
  );
}

// ── Naming ──────────────────────────────────────────────────────────

console.log('\nשם הקובץ והנושא:');
check(moldSubject(report) === 'דוח עובשים — וליד גרייב בע"מ', 'כותרת — סוג הדוח ושם החברה', moldSubject(report));
check(
  moldFileName(report) === 'פעמונית 2, הוד השרון - דוח בדיקת עובשים - סימוכין 2126081107.docx',
  'שם הקובץ',
  moldFileName(report),
);
{
  // Windows rejects these outright, and a download named with one silently fails.
  const awkward = MoldReportSchema.parse({ ...report, siteAddress: 'רח\' א/ב: 3' });
  check(!/[\\/:*?"<>|]/.test(moldFileName(awkward)), 'תווים אסורים בשם קובץ מנוקים', moldFileName(awkward));
}

// ── The merged document ─────────────────────────────────────────────

if (!existsSync(TEMPLATE)) {
  console.log('\n(תבנית העובשים לא נמצאה — דילוג על בדיקות המיזוג)');
} else {
  console.log('\nמיזוג מלא:');
  const bytes = readFileSync(TEMPLATE);
  const render = (r: MoldReport) =>
    textOf(
      new PizZip(mergeDocx(bytes, { ...buildMoldMergeData(r), labSheetsXml: '<w:p/>' }))
        .file('word/document.xml')!
        .asText(),
    );

  const out = render(report);

  // ── The identity block, filled by the system ──────────────────────
  check(out.includes('2126081107'), 'מספר הסימוכין');
  check(out.includes('פעמונית 2, הוד השרון'), 'המיקום הודפס');

  // ── §1, asked of the surveyor ─────────────────────────────────────
  check(out.includes('ערן פינגר'), 'מזמין הבדיקה');
  check(out.includes('דירה בקומה 2 מעל קומת עמודים'), 'תיאור המבנה — סעיף 1');
  check(out.includes('26039243'), 'מספר דוח המעבדה');

  /*
   * §1 — the two names are chosen, not fixed in the template.
   *
   * Asserted beside their labels: the closing signature block names both people as
   * fixed text, so a bare `includes` would pass even if §1 printed nothing.
   */
  {
    const swapped = render({ ...report, samplerName: 'אביחי מוכתר', authorName: 'יורם גבאי' });
    check(swapped.includes('אביחי מוכתרמבצע הדיגום'), 'מבצע הדיגום נבחר — אביחי מוכתר');
    check(swapped.includes('יורם גבאיעורך הדוח'), 'עורך הדוח נבחר — יורם גבאי');

    const fresh = MoldReportSchema.parse({ referenceNumber: '1', reportDate: '1' });
    check(fresh.authorName === 'אביחי מוכתר', 'דוח חדש — עורך ברירת המחדל כפי שהודפס עד היום', fresh.authorName);
    check(fresh.samplerName === '', 'דוח חדש — מבצע הדיגום לא מנוחש', fresh.samplerName);

    const legacy = MoldReportSchema.parse({
      ...report,
      authorName: 'ד״ר אביחי מוכתר (Ph.D.), מדעי החיים ואיכות הסביבה',
    });
    check(
      render(legacy).includes('אביחי מוכתרעורך הדוח'),
      'דוח ישן עם ברירת המחדל הארוכה — ממשיך להדפיס "אביחי מוכתר"',
    );

    // The signature follows the author: exactly one of the two, never both.
    const yoramSignature = 'יורם גבאי – בודק ויועץ לאיכות אוויר תוך־מבנית, עובשים ומפגעים סביבתיים';
    const avichaiSignature = 'ד״ר אביחי מוכתר (Ph.D.)מדעי החיים ומומחה לאיכות סביבה';
    check(swapped.includes(`בכבוד רב,${yoramSignature}גלית`), 'עורך יורם — החתימה של יורם');
    check(!swapped.includes(avichaiSignature), 'עורך יורם — בלי החתימה של ד״ר אביחי');
    const byAvichai = render({ ...report, authorName: 'אביחי מוכתר' });
    check(byAvichai.includes(`בכבוד רב,${avichaiSignature}גלית`), 'עורך אביחי — החתימה של ד״ר אביחי');
    check(!byAvichai.includes(yoramSignature), 'עורך אביחי — בלי החתימה של יורם');

    // Yoram does not approve his own report; the approval returns with any other author.
    const approval = 'אישור מנהל: יורם גבאי, מנכ״ל';
    check(!swapped.includes(approval), 'עורך יורם — בלי "אישור מנהל"');
    check(byAvichai.includes(`החברה לאיכות הסביבה בע״מ${approval}`), 'עורך אביחי — "אישור מנהל" במקומו');
  }

  /*
   * §4 — the sample count is counted, not typed.
   *
   * Retyping it is how a report comes to claim nine samples above eight tables, which
   * is the failure this line exists to prevent.
   */
  check(
    /4 – שלוש פנימיות ודגימת חוץ אחת/.test(out),
    'מספר הדגימות מחושב מהדגימות עצמן',
    (out.match(/\d+ – \S+ פנימיות[^א-ת]{0,20}[א-ת ]{0,20}/) ?? [''])[0],
  );

  /*
   * The four protocol details the source file never carried keep their standing note.
   *
   * That sentence tells whoever delivers the report that the protocol is incomplete;
   * an empty cell in its place would read as though nothing were missing.
   */
  check(out.includes('יש להשלים מטופס השטח'), 'שדות פרוטוקול שלא מולאו שומרים על הנוסח');

  /*
   * The moisture chapter — §4.1, the §2.1 column, the box under each sample, §6.5,
   * and the dynamic §9 citation.
   *
   * Rendered against `report` plus matching lab results: `moistureReading` is only
   * ever set on a sample the LabResultsReview card is already open for (see
   * `MoistureField`, mold editor.tsx), so a sample with a reading and no matched
   * laboratory block is not a case the real editor can produce. `out` (the bare
   * `report`) carries no `labResults` at all, so it cannot exercise this chapter.
   */
  {
    const minimalResult = (labNumber: string, sampleName: string, totalPerCubicMetre: string) => ({
      labNumber,
      sampleName,
      volume: '',
      reportingLimit: '',
      background: '',
      fragments: '',
      organisms: [],
      totalRaw: '',
      totalPerCubicMetre,
      totalPercent: '',
    });
    const withMoisture = MoldReportSchema.parse({
      ...report,
      labResults: [
        minimalResult('807-1', 'חדר בן', '38009'),
        minimalResult('807-2', 'סלון', '26067'),
        minimalResult('807-5', 'חוץ', '327'),
      ],
    });
    const moist = render(withMoisture);

    check(moist.includes('4.1 בדיקת לחות בקירות'), 'סעיף 4.1 מודפס כשבוצעה בדיקת לחות');
    check(moist.includes('באמצעות המכשיר Laserliner MoistureFinder Compact.'), 'שם המכשיר מודפס במשפט אחד');
    check(moist.includes('כולל בדיקות לחות אינדיקטיביות בקירות'), 'כותרת המשנה בשער');

    // §2.1 — location, total, both genera ("לא זוהה" — no organism rows given), then
    // the sample's own moisture reading; the outdoor row prints "לא נמדדה" in its place.
    check(moist.includes('חדר בן38009לא זוההלא זוהה2.1%'), '2.1 — שורת חדר בן, כולל קריאת הלחות בסופה');
    check(moist.includes('סלון26067לא זוההלא זוהה0.3%'), '2.1 — שורת הסלון');
    check(moist.includes('Outdoors327לא זוההלא זוההלא נמדדה'), '2.1 — דגימת החוץ מדפיסה "לא נמדדה", לא תא ריק');

    // §6 — the moisture box under a sample that has one, and its content.
    check(moist.includes('נמדדה קריאה גבוהה יחסית לנקודה האחרת בדירה'), 'תיבת הלחות מתחת לדגימת חדר בן');
    check(moist.includes('לא נמדדה לחות בנקודה זו — דגימת אוויר חיצונית'), 'תיבת הלחות מתחת לדגימת החוץ');
    check(moist.includes('בחדר בן נמצא ריכוז גבוה משמעותית'), 'פרשנות מקצועית — פסקה ראשונה');
    check(moist.includes('הממצא כולל סמני נזקי מים'), 'פרשנות מקצועית — פסקה שנייה, אותה דגימה');

    // §6.5 — the summary table (location, reading, assessment) and its narrative.
    check(moist.includes('6.5 סיכום בדיקות הלחות'), 'סעיף 6.5 מודפס');
    check(moist.includes('חדר בן2.1%גבוה יחסית לנקודת המדידה האחרת'), '6.5 — שורת הטבלה של חדר בן');
    check(moist.includes('סלון0.3%נמוך יחסית לנקודת המדידה האחרת'), '6.5 — שורת הטבלה של הסלון');
    check(moist.includes('הקריאה בחדר בן גבוהה יחסית לזו שבסלון'), '6.5 — הפרשנות המשולבת');

    // §9 — the Hayes citation reads the report's own numbers, not the source document's.
    check(
      moist.includes('Laboratory Report 26039243, Spore Trap SOP HMC#101, collected 30/07/2026, received , reported .'),
      '9 — הציטוט של הייס דינמי, לא התאריכים והמספר של דוח הטכניון',
      (moist.match(/Laboratory Report[^.]*\./) ?? [''])[0],
    );
    check(!moist.includes('26042301'), '9 — המספר הישן של דוח הטכניון לא נשאר בקובץ');
    check(moist.includes('Laserliner MoistureFinder Compact – מידע יצרן'), '9 — מקור ה-Laserliner מודפס כשבוצעה בדיקת לחות');
    check(!moist.includes('{'), 'עם לחות מלאה — לא נשארו שדות שלא מולאו', moist.match(/\{[^}]{0,40}/)?.[0] ?? '');
  }

  /*
   * A survey with no moisture testing at all — the whole chapter must vanish, not
   * print with empty boxes and a heading over nothing.
   */
  {
    const noMoisture = MoldReportSchema.parse({ ...report, moistureSurveyed: 'לא' });
    const bare = render(noMoisture);
    check(!bare.includes('בדיקת לחות בקירות'), 'בלי בדיקת לחות — סעיף 4.1 נעלם');
    check(!bare.includes('כולל בדיקות לחות'), 'בלי בדיקת לחות — כותרת המשנה בשער נעלמת');
    check(!bare.includes('נמדדה קריאה גבוהה'), 'בלי בדיקת לחות — תיבות הלחות נעלמות');
    check(!bare.includes('6.5 סיכום בדיקות הלחות'), 'בלי בדיקת לחות — סעיף 6.5 נעלם');
    check(!bare.includes('Laserliner'), 'בלי בדיקת לחות — מקור ה-Laserliner נעלם מסעיף 9');
    check(!bare.includes('{'), 'בלי בדיקת לחות — לא נשארו שדות שלא מולאו', bare.match(/\{[^}]{0,40}/)?.[0] ?? '');
    check(bare.includes('11. מקורות ומסמכי ייחוס'), 'בלי בדיקת לחות — שאר הדוח נשאר במקומו');
  }

  // ── The drafted prose ─────────────────────────────────────────────
  check(out.includes('נמצאה אינדיקציה חריגה'), 'מסקנה ראשונה');
  check(out.includes('נמצאו מוקדי לחות'), 'מסקנה שלישית — הלולאה חוזרת');
  check(out.includes('מומלץ לבצע טיפול מקצועי'), 'המלצה שנייה');

  check(!out.includes('{'), 'לא נשארו שדות שלא מולאו', out.match(/\{[^}]{0,40}/)?.[0] ?? '');

  /*
   * The standing text is the document.
   *
   * The accreditation statement and the principles of interpretation are what make this
   * an opinion rather than a printout, and they are identical in every report — so
   * nothing the builder does may disturb them.
   *
   * "מגבלות הדוח" is gone on purpose (2026-09-15): Galit had it removed from the report
   * outright, and the sources section moved up to take its number.
   */
  check(out.includes('AIHA'), 'הצהרת ההסמכה נשמרה');
  check(out.includes('אין ערך סף מספרי יחיד'), 'עקרונות הפרשנות נשמרו');
  check(!out.includes('מגבלות הדוח'), 'סעיף "מגבלות הדוח" הוסר');
  check(!out.includes('אבחון רפואי אישי'), 'ואף תבליט שלו לא נשאר');
  /*
   * The sources section moved twice: to 9 when "מגבלות הדוח" was removed
   * (2026-09-15), then to 11 when §7 "פרשנות מקצועית" and §8 "השפעות בריאותיות
   * אפשריות" were inserted before it (2026-09-16).
   */
  check(out.includes('11. מקורות ומסמכי ייחוס'), 'המקורות הם עכשיו סעיף 11');
  check(out.includes('ד״ר אביחי מוכתר'), 'בלוק החתימה נשמר');

  /*
   * A sample the laboratory did not report gets no block.
   *
   * An empty table under a room heading reads as "the laboratory found nothing",
   * which is a very different statement from "these results have not arrived yet".
   */
  const noResults = MoldReportSchema.parse({ ...report, labResults: [] });
  const bare = render(noResults);
  check(!bare.includes('807-1'), 'בלי תוצאות מעבדה — לא מודפס בלוק');
  check(bare.includes('11. מקורות ומסמכי ייחוס'), 'ושאר הדוח נשאר במקומו');
}


// ── The laboratory's own result tables ──────────────────────────────
//
// The Hayes sheet is transcribed by a model and printed as a block per sample. Two
// things have to hold for that to be safe: a block must be tied to the right sample,
// and a genus the laboratory left blank must stay blank. A blank means the laboratory
// looked and did not find it — turning that into a zero, or dropping the row, would
// be inventing evidence in a document a customer acts on.

console.log('\nתוצאות המעבדה:');

const labResult = {
  labNumber: '807-1',
  sampleName: 'חדר בן',
  volume: '150 ליטר',
  reportingLimit: '7',
  background: '3',
  fragments: '73',
  organisms: [
    { organism: 'Alternaria', raw: '2', perCubicMetre: '13', percent: '1%>' },
    { organism: 'Aspergillus |Penicillium', raw: '5600<', perCubicMetre: '37000<', percent: '97.4%' },
    { organism: 'Stachybotrys', raw: '133', perCubicMetre: '890', percent: '2.3%' },
  ],
  totalRaw: '5751<',
  totalPerCubicMetre: '38009<',
  totalPercent: '100%',
};

{
  const withLab = MoldReportSchema.parse({ ...report, labResults: [labResult] });

  // Matched on the laboratory's own number first.
  const bedroom = withLab.samples.find((s) => s.location === 'חדר בן')!;
  check(labResultFor(withLab, bedroom)?.labNumber === '807-1', 'תוצאה שויכה לפי מספר הדגימה');

  // And on the room name when the surveyor never wrote the number down.
  const noNumber = { ...bedroom, labNumber: '' };
  check(labResultFor(withLab, noNumber)?.sampleName === 'חדר בן', 'ובלי מספר — שויכה לפי שם החדר');

  // A sample the sheet says nothing about gets no block, rather than an empty table.
  const stranger = { ...bedroom, labNumber: '999-9', location: 'מחסן' };
  check(labResultFor(withLab, stranger) === null, 'דגימה בלי תוצאה תואמת אינה מקבלת בלוק');

  // A sheet describing a sample nobody recorded is surfaced, not swallowed.
  const orphan = MoldReportSchema.parse({
    ...report,
    labResults: [labResult, { ...labResult, labNumber: '807-9', sampleName: 'חדר לא מוכר' }],
  });
  check(
    unmatchedLabResults(orphan).some((r) => r.labNumber === '807-9'),
    'תוצאה שלא שויכה לאף דגימה מדווחת',
  );
}

// The scan fills what the surveyor left blank and never overwrites what they typed:
// a figure entered by hand is a decision, and a silent overwrite would erase it.
{
  const blank = { ...newSampleRow(), location: 'חדר בן', labNumber: '807-1' };
  const filled = sampleWithLabResult(blank, labResult);
  check(filled.totalCount === '38009<', 'הסריקה מילאה את הריכוז הכללי', filled.totalCount);
  check(
    filled.organisms.includes('Stachybotrys'),
    'ורשמה את האורגניזמים שנמצאו',
    filled.organisms,
  );

  const typed = { ...blank, totalCount: '12345', organisms: 'משהו שהוקלד ידנית' };
  const kept = sampleWithLabResult(typed, labResult);
  check(kept.totalCount === '12345', 'מה שהוקלד ידנית לא נדרס');
  check(kept.organisms === 'משהו שהוקלד ידנית', 'וגם לא רשימת האורגניזמים');
}

if (existsSync(TEMPLATE)) {
  console.log('\nטבלאות המעבדה במסמך:');
  const bytes = readFileSync(TEMPLATE);
  const renderWith = (r: MoldReport) =>
    textOf(
      new PizZip(
        mergeDocx(bytes, { ...buildMoldMergeData(r), photosXml: '<w:p/>', labSheetsXml: '<w:p/>' }),
      )
        .file('word/document.xml')!
        .asText(),
    );

  const twoBlocks = MoldReportSchema.parse({
    ...report,
    labReportNumber: '26039243',
    labResults: [
      labResult,
      {
        ...labResult,
        labNumber: '807-2',
        sampleName: 'סלון',
        totalPerCubicMetre: '26067',
        organisms: [
          { organism: 'Aspergillus |Penicillium', raw: '3900', perCubicMetre: '26000', percent: '99%' },
        ],
      },
    ],
  });
  const out = renderWith(twoBlocks);

  // The XML itself, before anything about its text: a table whose cells lost their
  // opening tags renders text that reads perfectly and a file Word will not open.
  const renderedXml = new PizZip(
    mergeDocx(bytes, { ...buildMoldMergeData(twoBlocks), photosXml: '<w:p/>', labSheetsXml: '<w:p/>' }),
  )
    .file('word/document.xml')!
    .asText();
  const malformed = wellFormed(renderedXml);
  check(malformed === null, 'ה-XML של המסמך תקין', malformed ?? '');
  const tcOpen = (renderedXml.match(/<w:tc(?:\s[^>]*)?>/g) ?? []).length;
  const tcClose = (renderedXml.match(/<\/w:tc>/g) ?? []).length;
  check(tcOpen === tcClose, 'כל תאי הטבלאות נסגרים', `${tcOpen}/${tcClose}`);

  check(out.includes('26039243'), 'מספר דוח המעבדה הודפס');
  check(out.includes('807-1') && out.includes('807-2'), 'שני מספרי דגימה — הלולאה חוזרת');
  check(out.includes('150 ליטר'), 'נפח הדגימה');
  check(out.includes('38009<') && out.includes('26067'), 'הסימן "<" נשמר כפי שהמעבדה כתבה');
  check(out.includes('37000<'), 'ריכוז האספרגילוס נשמר עם הסימן');

  /*
   * Only the genera the laboratory actually found are printed.
   *
   * The template this replaced listed the full roster of eighteen with blanks against
   * the ones not found, on the reasoning that a blank is itself a finding. The revised
   * report drops them, and that is the better call for a document somebody reads:
   * three lines they can take in beat eighteen of which fifteen say nothing. What was
   * looked for is stated once, in §4.
   */
  const printedGenera = LAB_ORGANISMS.filter((g) => out.includes(g));
  check(
    printedGenera.length > 0 && printedGenera.length < LAB_ORGANISMS.length,
    'מודפסים רק האורגניזמים שנמצאו, לא כל הרשימה',
    `${printedGenera.length}/${LAB_ORGANISMS.length}`,
  );
  check(
    !out.includes('Memnoniella'),
    'גנוס שהמעבדה לא מצאה אינו מודפס כשורה ריקה',
  );

  check(!out.includes('{'), 'לא נשארו שדות שלא מולאו בבלוקי המעבדה', out.match(/\{[^}]{0,40}/)?.[0] ?? '');

  // A survey whose results have not arrived prints no laboratory block at all, rather
  // than an empty table that reads as "nothing was found".
  const noResults = MoldReportSchema.parse({ ...report, labResults: [] });
  const bare = renderWith(noResults);
  check(!bare.includes('807-1'), 'בלי תוצאות מעבדה — לא מודפס בלוק');
  check(bare.includes('נמצאה אינדיקציה חריגה'), 'ושאר הדוח נשאר במקומו');
}

// ── The survey-photo appendix ────────────────────────────────────────
//
// The template carried {@labSheetsXml} but never {@photosXml} — every uploaded
// survey photo sat in the produced file as an orphaned media part, invisible when
// the document was opened (Donia Abu Zayed's report, 2026-09-16: three photos in
// the system, none in the file she was sent). Confirmed against the earliest
// template backup available (id 27, 2026-09-15) — this predates every change made
// this week, not a regression from any of them.

if (!existsSync(TEMPLATE)) {
  console.log('\n(תבנית העובשים לא נמצאה — דילוג על בדיקת נספח התמונות)');
} else {
  console.log('\nנספח תמונות הסקר:');
  const bytes = readFileSync(TEMPLATE);
  const zip = new PizZip(bytes);

  // A minimal real PNG (1×1, transparent) — buildPhotosXml reads real image bytes
  // to size and embed the picture, so a stub buffer would not exercise the path.
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const photosXml = buildPhotosXml(zip, [
    { bytes: onePixelPng, contentType: 'image/png', width: 1, height: 1, caption: 'סימני רטיבות בחדר' },
  ]);

  const merged = mergeDocx(zip.generate({ type: 'nodebuffer' }), {
    ...buildMoldMergeData(report),
    photosXml,
    labSheetsXml: '<w:p/>',
  });
  const mergedText = textOf(new PizZip(merged).file('word/document.xml')!.asText());

  check(photosXml !== '<w:p/>', 'buildPhotosXml בונה XML אמיתי כשיש תמונה');
  check(
    mergedText.split('30/07/2026, בשעה 08:00-09:30').length - 1 === 2,
    'שעת הדיגום מודפסת ליד התאריך — בשער ובסעיף 1',
  );
  check(mergedText.includes('collected 30/07/2026, received'), 'שורת Hayes — תאריך בלבד');
  check(mergedText.includes('נספח א׳ – תמונות מהסקר'), 'כותרת הנספח מודפסת');
  check(
    mergedText.indexOf('נספח א׳ – תמונות מהסקר') < mergedText.indexOf('נספח ב׳ – דוח המעבדה של Hayes'),
    'נספח התמונות לפני דוח Hayes — דוח המעבדה בסוף',
  );
  check(mergedText.includes('כתובת') && !/מיקום\s*\{?siteAddress/.test(mergedText), 'סעיף 1 — ״כתובת״ במקום ״מיקום״');
  check(mergedText.includes('סימני רטיבות בחדר'), 'הכיתוב של התמונה מודפס');
  check(!mergedText.includes('{@photosXml}'), 'התג הוחלף בפועל ולא נשאר כטקסט');

  // No photos at all: the appendix still prints (matching נספח א׳'s own behaviour
  // with no lab sheets), just with nothing under the heading.
  const emptyPhotos = buildPhotosXml(new PizZip(bytes), []);
  check(emptyPhotos === '<w:p/>', 'בלי תמונות — buildPhotosXml מחזיר פסקה ריקה בלבד');
}

console.log('\nחדרים — מספר מדיה, קירות ותמונות:');
{
  const room = {
    ...newSampleRow(),
    location: 'חדר שינה',
    mediaNumber: '21734455',
    wallReadings: [
      { surface: 'קיר מזרחי', reading: '0.8' },
      { surface: 'רצפה', reading: '1.3%' },
      { surface: 'תקרה', reading: '' },
    ],
    photoIds: ['b', 'a'],
  };
  check(moistureText(room) === 'קיר מזרחי 0.8%, רצפה 1.3%', `קריאות לחות לפי משטח — ${moistureText(room)}`);
  check(
    moistureText({ ...newSampleRow(), moistureReading: '2.1%' }) === '2.1%',
    'קריאה בודדת מדוח ישן עדיין מודפסת',
  );

  const emptyLab = () => ({
    labNumber: '', sampleName: '', volume: '', reportingLimit: '', background: '', fragments: '',
    organisms: [], totalRaw: '', totalPerCubicMetre: '', totalPercent: '',
  });
  const results = [
    { ...emptyLab(), labNumber: '900-1', sampleName: '21734455' },
    { ...emptyLab(), labNumber: '900-2', sampleName: 'A217344559' },
  ];
  check(labResultFor({ labResults: results }, room)?.labNumber === '900-1', 'התוצאה משויכת לחדר לפי מספר המדיה');
  check(
    labResultFor({ labResults: [results[1]] }, { ...room, location: '' }) === null,
    'מספר מדיה אינו משויך לחלק ממספר אחר',
  );

  const outdoor = newOutdoorSampleRow();
  check(outdoorAirSample({ samples: [room, outdoor] }) === outdoor, 'דגימת חוץ חדשה מזוהה כביקורת');

  const ordered = photosInRoomOrder({
    samples: [room],
    photos: [
      { imageId: 'loose', caption: 'כללי' },
      { imageId: 'a', caption: '' },
      { imageId: 'b', caption: 'כתם' },
    ],
  });
  check(ordered.map((p) => p.imageId).join(',') === 'b,a,loose', 'הנספח מסודר חדר אחר חדר');
  check(ordered[1].caption === 'חדר שינה', 'תמונה בלי כיתוב מקבלת את שם החדר');
}

console.log(failures === 0 ? '\nהכול עבר\n' : `\n${failures} בדיקות נכשלו\n`);
process.exit(failures === 0 ? 0 : 1);
