/**
 * The asbestos opinion: the template's fields, the address forms, and the total.
 *
 * Two things are worth pinning. The address is answered once and printed six
 * times in three grammatical forms — a change that broke the shaping would
 * produce "מבנה מרחוב רחוב הרצל" in a signed document. And the total area is a
 * sum of the findings: in the source opinion it was typed by hand, which is the
 * number that goes stale the moment a finding is added on site.
 *
 *   npx tsx scripts/smoke-asbestos.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { mergeDocx } from '../src/lib/docx/merge-docx';
import { textOf } from '../src/lib/docx/ooxml';
import {
  AsbestosReportSchema,
  DraftAsbestosReportSchema,
  parseIssuableReport,
  type AsbestosReport,
  type FindingRow,
} from '../src/lib/asbestos-schema';
import {
  hasBuried,
  hasFindings,
  newFindingRow,
  realFindings,
  totalArea,
} from '../src/lib/asbestos-rules';
import { draftAsbestosFindings } from '../src/lib/asbestos-draft';
import {
  buildAsbestosMergeData,
  asbestosFileName,
  asbestosSubject,
} from '../src/lib/asbestos-mapper';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = resolve(ROOT, 'templates/asbestos-template.docx');

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const finding = (over: Partial<FindingRow> = {}): FindingRow => ({
  text: '3 צינורות ביוב עשויים אסבסט בתוך קירות הבניין כל אחד 9 מטרים סה"כ 27 מטרים',
  element: 'צינורות ביוב',
  quantity: '3',
  placement: 'בתוך קירות הבניין',
  dimensions: 'כל אחד 9 מטרים',
  condition: 'לא ניתן לראות',
  area: '27',
  buried: 'כן',
  photos: [],
  ...over,
});

const report: AsbestosReport = AsbestosReportSchema.parse({
  referenceNumber: '2609020001',
  reportDate: 'אוגוסט 2026',
  clientName: 'פרפקט וייסבורג התחדשות בע"מ',
  companyName: 'פרפקט וייסבורג התחדשות בע"מ',
  recipientName: 'ישראל ישראלי',
  siteAddress: 'וייסבורג 11, תל אביב',
  asbestosKind: 'צמנט',
  siteDescription: 'בניין מגורים בן 3 קומות ו-2 כניסות בלב שכונת מגורים בתל אביב.',
  surroundings: 'בין הבניין הנ"ל למבנים הסמוכים בין 6 מטרים ל-20 מטרים.',
  findings: [
    finding(),
    finding({ text: 'ארובה עשויה אסבסט על גבי חזית מערבית 8 צול 8 מטרים', area: '5', buried: 'לא' }),
    finding({ text: '8 עדניות עשויות אסבסט על גג הבניין', area: '16', buried: 'לא' }),
  ],
});

console.log('\nסכימת השטח');

check(totalArea(report) === '48 מ"ר', 'סה״כ מחושב מהממצאים', totalArea(report));
check(
  totalArea({ findings: [finding({ area: '27.5' }), finding({ area: '5' })] }) === '32.5 מ"ר',
  'סכום לא שלם נשמר עם ספרה אחת',
);
check(totalArea({ findings: [] }) === '', 'בלי ממצאים אין סה״כ — לא "0 מ״ר"');
check(
  totalArea({ findings: [finding({ area: '' })] }) === '',
  'ממצא בלי שטח אינו נספר כאפס',
);

console.log('\nשורה ריקה');

const withBlank = DraftAsbestosReportSchema.parse({
  ...report,
  findings: [...report.findings, newFindingRow()],
});
check(realFindings(withBlank).length === 3, 'שורה ריקה אינה ממצא');
check(
  !AsbestosReportSchema.safeParse(withBlank).success,
  'שורה ריקה נחסמת בהפקה — אפשר לשמור כטיוטה, אי אפשר להפיק',
);

console.log('\nהמשפטים המותנים');

check(hasFindings(report) && hasBuried(report), 'יש ממצאים ויש ממצא קבור');
check(
  !hasBuried({ findings: [finding({ buried: 'לא' })] }),
  'בלי ממצא קבור — משפט האסבסט בקרקע לא יודפס',
);
check(!hasFindings({ findings: [] }), 'בלי ממצאים — משפט הפינוי לא יודפס');

console.log('\nצורות הכתובת');

const merged = buildAsbestosMergeData(report) as Record<string, unknown>;
check(
  merged.siteLabel === 'מבנה מרחוב וייסבורג 11, תל אביב',
  'הכתובת מקבלת את הקידומת "מבנה מרחוב"',
  String(merged.siteLabel),
);
check(merged.siteAddress === 'וייסבורג 11, תל אביב', 'והצורה החשופה נשמרת');

const withStreetWord = buildAsbestosMergeData(
  AsbestosReportSchema.parse({ ...report, siteAddress: 'רחוב הרצל 5, חיפה' }),
) as Record<string, unknown>;
check(
  withStreetWord.siteLabel === 'מבנה ברחוב הרצל 5, חיפה',
  'כתובת שכבר מתחילה ב"רחוב" לא מקבלת "מרחוב רחוב"',
  String(withStreetWord.siteLabel),
);

const boulevard = buildAsbestosMergeData(
  AsbestosReportSchema.parse({ ...report, siteAddress: 'שדרות רוטשילד 1, תל אביב' }),
) as Record<string, unknown>;
check(
  boulevard.siteLabel === 'מבנה בשדרות רוטשילד 1, תל אביב',
  'וגם "שדרות" מזוהה',
  String(boulevard.siteLabel),
);

console.log('\nנתוני המיזוג');

check((merged.findings as unknown[]).length === 3, 'רק ממצאים אמיתיים עוברים לתבנית');
check(merged.totalArea === '48 מ"ר', 'סה״כ נשלח לתבנית');
check(merged.hasFindings === true && merged.hasBuried === true, 'שני הדגלים דלוקים');

const privateReport = buildAsbestosMergeData(
  AsbestosReportSchema.parse({
    ...report,
    customerType: 'private',
    companyName: 'לא אמור להידפס',
  }),
) as Record<string, unknown>;
check(privateReport.isCompany === false, 'לקוח פרטי — isCompany כבוי');
check(privateReport.companyName === '', 'לקוח פרטי — שם החברה לא מודפס');

console.log('\nשם הקובץ והנושא');

check(
  asbestosFileName(report) === 'וייסבורג 11, תל אביב - סקר אסבסט - סימוכין 2609020001.docx',
  'שם הקובץ נבנה מהכתובת ומהסימוכין',
  asbestosFileName(report),
);
check(
  asbestosSubject(report) === 'דוח אסבסט — פרפקט וייסבורג התחדשות בע"מ',
  'הכותרת — סוג הדוח ושם החברה',
  asbestosSubject(report),
);
check(
  !asbestosFileName(
    AsbestosReportSchema.parse({ ...report, siteAddress: 'גג/מרתף: אגף א*' }),
  ).match(/[\\/:*?"<>|]/),
  'תווים ש-Windows פוסל מנוקים משם הקובץ',
);

console.log('\nהתבנית עצמה');

if (!existsSync(TEMPLATE)) {
  check(false, 'תבנית האסבסט קיימת', 'הריצו npm run build:asbestos');
} else {
  const bytes = readFileSync(TEMPLATE);
  const xml = new PizZip(bytes).file('word/document.xml')!.asText();
  const plain = textOf(xml);

  check(plain.includes('{siteLabel}'), 'התבנית מכילה את שדה הכתובת');
  check(plain.includes('{clientName}'), 'ואת שדה המזמין');
  check(plain.includes('{#findings}'), 'ואת לולאת הממצאים');
  // The summary is a loop of drafted bullets now, not a total and two fixed sentences.
  check(plain.includes('{#summaryLines}'), 'ואת לולאת הסיכום');
  check(plain.includes('{@photosXml}'), 'ואת נספח התמונות');
  check(
    !plain.includes('וייסבורג 11'),
    'שום כתובת מהמסמך המקורי לא נשארה מקודדת בתבנית',
  );
  check(
    !plain.includes('פרפקט וייסבורג התחדשות'),
    'ושם המזמין המקורי לא נשאר מקודד',
  );
  check(!/48 מ"ר/.test(plain), 'וגם לא הסה״כ המקורי');
  check(
    !/<w:highlight w:val="(?!none)/.test(xml),
    'לא נשארו סימוני צהוב — הלקוח לא יראה אותם',
  );

  // The signed parts must survive: they are the document.
  check(plain.includes('יורם גבאי'), 'שם הסוקר נשמר');
  check(plain.includes('57399'), 'מספר הרישיון נשמר');
  check(plain.includes('חוות דעת זו ניתנת במקום עדות'), 'הצהרת חוות הדעת נשמרה');
  check(plain.includes('1-700-505054'), 'פרטי הקשר בתחתית נשמרו');

  console.log('\nמיזוג מלא');
  const produced = mergeDocx(bytes, { ...buildAsbestosMergeData(report), photosXml: '<w:p/>' });
  const out = textOf(new PizZip(produced).file('word/document.xml')!.asText());

  check(out.includes('מבנה מרחוב וייסבורג 11, תל אביב'), 'הכתובת הורכבה במסמך המופק');
  check(out.includes('פרפקט וייסבורג התחדשות בע"מ'), 'המזמין הודפס');
  check(out.includes('ארובה עשויה אסבסט'), 'ממצא שני הודפס — הלולאה חוזרת');
  check(out.includes('8 עדניות עשויות אסבסט'), 'וגם ממצא שלישי');
  check(!out.includes('{'), 'לא נשארו שדות שלא מולאו');

  /*
   * The summary is three bullets, drafted at production.
   *
   * It used to be a total and two standing sentences assembled in the template, which
   * gave a survey of any size the same two lines and said nothing about what the client
   * should do. `summaryLines` carries the drafted section — here the code-written
   * fallback, since no model is called in a test.
   */
  const summarised = mergeDocx(bytes, {
    ...buildAsbestosMergeData({
      ...report,
      summaryBullets: [
        'במבנה מרחוב וייסבורג 11, תל אביב נמצאו אלמנטים עשויים אסבסט בגודל כולל של כ-48 מ"ר.',
        'חלק מהאלמנטים אינם במצב תקין, ולפיכך קיים פוטנציאל לשחרור סיבי אסבסט לסביבה.',
        'יש לפנות את האלמנטים הפגומים בידי קבלן אסבסט מורשה ולאתר מורשה לסילוק.',
      ],
    }),
    photosXml: '<w:p/>',
  });
  const summaryOut = textOf(new PizZip(summarised).file('word/document.xml')!.asText());
  check(summaryOut.includes('בגודל כולל של כ-48 מ"ר'), 'נקודה 1 — מה נמצא');
  check(summaryOut.includes('פוטנציאל לשחרור סיבי אסבסט'), 'נקודה 2 — מה המשמעות');
  check(summaryOut.includes('קבלן אסבסט מורשה'), 'נקודה 3 — מה לעשות');

  // A survey that found nothing must not inherit the source's conclusions.
  const cleanReport = AsbestosReportSchema.parse({
    ...report,
    findings: [finding({ text: 'לא נמצאו אלמנטים עשויים אסבסט', area: '', buried: 'לא' })],
  });
  const cleanOut = textOf(
    new PizZip(
      mergeDocx(bytes, { ...buildAsbestosMergeData(cleanReport), photosXml: '<w:p/>' }),
    ).file('word/document.xml')!.asText(),
  );
  check(
    !cleanOut.includes('פוטנציאל להימצאות נוכחות אסבסט בקרקע'),
    'סקר בלי ממצא קבור אינו מדפיס את משפט הקרקע',
  );
  check(!cleanOut.includes('{'), 'וגם הוא אינו משאיר שדות ריקים');
}

// ── The findings are worded from structured facts ───────────────────
//
// The sentence a reader sees is composed at production from what the surveyor recorded —
// the element, the count, where it sits, its size. What is checked here is the path that
// runs when the model is unreachable: a surveyor who pressed "סיום" is owed a document,
// so drafting must never be able to fail one.

console.log('\nניסוח הממצאים:');

const structured = finding({ text: '', element: 'צינורות ביוב', quantity: '3' });
check(realFindings({ findings: [structured] }).length === 1, 'ממצא עם שדות מובנים ובלי טקסט נספר');
check(realFindings({ findings: [newFindingRow()] }).length === 0, 'שורה ריקה לגמרי אינה נספרת');

// Without a key the drafter returns the surveyor's own text untouched.
const savedKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
const offline = await draftAsbestosFindings(
  AsbestosReportSchema.parse({ ...report, findings: [finding()] }),
);
if (savedKey) process.env.OPENAI_API_KEY = savedKey;

check(offline.bullets.length === 1, 'בלי מפתח — משפט אחד לכל ממצא', String(offline.bullets.length));
check(offline.bullets[0] === finding().text, 'והוא הניסוח שהסוקר כתב');

// ── One bullet per line ─────────────────────────────────────────────
//
// Both loops and both conditionals were once written inline —
// `{#findings}{text}{/findings}` inside a single paragraph. docxtemplater then repeats the
// *text* within that paragraph, so three findings came out as three sentences run together
// on one bullet; and a false condition emptied the text but left the bulleted paragraph
// behind, printing a blank bullet in the middle of the summary.
//
// Both produced a document that read wrong but merged without complaint, which is why
// this is checked on the rendered paragraphs rather than on the merge data.

console.log('\nתבליט לכל שורה:');

const bulletsOf = (bytes: Buffer, data: Record<string, unknown>) => {
  const xml = new PizZip(mergeDocx(bytes, { ...data, photosXml: '<w:p/>' }))
    .file('word/document.xml')!
    .asText();
  return [...xml.matchAll(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g)]
    .map((m) => m[0])
    .filter((p) => /<w:numPr>/.test(p))
    .map((p) => ({
      text: (p.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ''))
        .join('')
        .trim(),
    }));
};

if (existsSync(TEMPLATE)) {
  const bytes = readFileSync(TEMPLATE);

  const bullets = bulletsOf(bytes, buildAsbestosMergeData(report));
  const findingBullets = bullets.filter(
    (b) => /עשוי(?:ה|ים|ות)? אסבסט/.test(b.text) && !b.text.includes('נמצאו אלמנטים'),
  );
  check(findingBullets.length >= 3, 'שלושה ממצאים — שלושה תבליטים נפרדים', String(findingBullets.length));
  check(
    !findingBullets.some((b) => b.text.includes('מטריםארובה')),
    'הממצאים אינם משורשרים לתבליט אחד',
  );
  check(bullets.every((b) => b.text !== ''), 'אין תבליט ריק', String(bullets.filter((b) => b.text === '').length));

  // Nothing buried: the soil line must vanish entirely, bullet included.
  const noBuried = AsbestosReportSchema.parse({ ...report, findings: [finding({ buried: 'לא' })] });
  const dry = bulletsOf(bytes, buildAsbestosMergeData(noBuried));
  check(dry.every((b) => b.text !== ''), 'בלי ממצא קבור — לא נשאר תבליט ריק');
  check(
    !dry.some((b) => b.text.includes('פוטנציאל להימצאות')),
    'ומשפט הקרקע אינו מודפס',
  );
}

// ── Issuing a survey the editor calls complete ──────────────────────
//
// The findings step has no box for `text`: the surveyor records the element, the
// count, where it sits and its size, and the sentence is composed at production.
// So a strict schema that demanded `text` refused to save a finished survey with
// "תיאור הממצא — שדה חובה" — naming a field that is not on the screen and cannot
// be filled in. What a finding must have is checked on the row as a whole, and both
// ways of answering it count.

console.log('\nשמירת דוח שהעורך רואה כשלם:');

{
  const base = {
    referenceNumber: '2609030001',
    reportDate: 'ספטמבר 2026',
    clientName: 'חברה לבנייה בע"מ',
    siteAddress: 'וייסבורג 11, תל אביב',
    layout: 'prose' as const,
  };

  // The reported failure, exactly: findings entered through the structured fields,
  // no sentence anywhere, and the blank starter row every new report is created with
  // still sitting untouched at the end of the list.
  const structured = {
    ...newFindingRow(),
    element: 'צינורות ביוב',
    quantity: '3',
    placement: 'בתוך קירות הבניין',
    area: '27',
  };
  const issued = parseIssuableReport({ ...base, findings: [structured, newFindingRow()] });
  check(
    issued.success,
    'ממצא מהשדות המובנים + שורה ריקה — נשמר',
    issued.success ? '' : issued.error.issues.map((i) => i.message).join(' | '),
  );

  // An opinion written before the structured fields existed carries its whole
  // sentence in `text` and nothing else. Those are in the archive and must stay
  // reissuable, which is what stops the fix from swapping one blocked case for another.
  const legacy = parseIssuableReport({
    ...base,
    findings: [{ ...newFindingRow(), text: '3 צינורות ביוב עשויים אסבסט סה"כ 27 מטרים' }],
  });
  check(legacy.success, 'ממצא ישן שנכתב כמשפט שלם — עדיין ניתן להפקה');

  // The check still does its job: a card the surveyor opened and left unanswered is
  // named, because that one they can actually go and fix.
  const halfWritten = parseIssuableReport({
    ...base,
    findings: [{ ...newFindingRow(), quantity: '3', area: '27' }],
  });
  check(!halfWritten.success, 'ממצא שנפתח ולא נענה — עדיין נחסם');
  check(
    !halfWritten.success &&
      halfWritten.error.issues.some((i) => i.message.includes('סוג האלמנט')),
    'וההודעה מפנה לשדה שקיים במסך',
    halfWritten.success ? '' : halfWritten.error.issues.map((i) => i.message).join(' | '),
  );

  // A brand-new report autosaves, starter row and all.
  check(
    DraftAsbestosReportSchema.safeParse({ referenceNumber: '', findings: [newFindingRow()] })
      .success,
    'שמירה אוטומטית של דוח חדש לגמרי',
  );
}

console.log(failures === 0 ? '\nהכול עבר\n' : `\n${failures} בדיקות נכשלו\n`);
process.exit(failures === 0 ? 0 : 1);
