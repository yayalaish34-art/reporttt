'use client';

import { useState, type ReactNode } from 'react';
import type { TemplateKind, TemplateRecord } from '@/lib/docx/template-store';
import { TemplateManager } from './template-manager';

/**
 * The templates screen, one survey at a time.
 *
 * The three templates were stacked down one page while there were two of them, and
 * a third made that unworkable: the person here has come to change the wording of
 * *one* report, and every block that is not that report is noise they have to scroll
 * past and — worse — a set of field names that do not belong to the document they
 * are editing. Putting `{elfInstrument.serial}` in front of someone editing the
 * asbestos template is not a longer list, it is a wrong one.
 *
 * So the kind is chosen first and the whole screen follows it: uploads, version
 * history, and the field reference for that template alone.
 */
export function TemplateWorkspace({
  radiation,
  radon,
  asbestos,
  asbestosTables,
  mold,
  iaq,
}: {
  radiation: TemplateRecord[];
  radon: TemplateRecord[];
  asbestos: TemplateRecord[];
  asbestosTables: TemplateRecord[];
  mold: TemplateRecord[];
  iaq: TemplateRecord[];
}) {
  const [kind, setKind] = useState<TemplateKind>('radiation');

  const templates: Record<TemplateKind, TemplateRecord[]> = {
    radiation,
    radon,
    asbestos,
    'asbestos-tables': asbestosTables,
    mold,
    iaq,
  };
  const active = KINDS.find((k) => k.kind === kind)!;

  return (
    <>
      <div className="toggle" style={{ marginBottom: 20 }}>
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            className={kind === k.kind ? 'active' : undefined}
            onClick={() => setKind(k.kind)}
          >
            {k.label}
            {/* A kind with no template yet is the one thing worth flagging on the
                selector itself: it is why the report screen refuses to produce. */}
            {templates[k.kind].length === 0 ? ' ·' : ''}
          </button>
        ))}
      </div>

      <TemplateManager templates={templates[kind]} kind={kind} label={active.label} />

      <section className="card">
        <div className="card-head">
          <h2>איך לערוך את התבנית — {active.label}</h2>
        </div>
        <div className="card-body">
          <ol className="steps">
            <li>
              לוחצים <strong>הורדה</strong> על הגרסה הפעילה למעלה. זה הקובץ שבאמת מרונדר — לא הקובץ
              שבתיקיית <span className="mono">templates/</span>.
            </li>
            <li>
              פותחים ב-Word, עורכים נוסח, גופנים, טבלאות וכותרות כרגיל, ומשאירים את השדות בסוגריים
              מסולסלים במקומם.
            </li>
            <li>
              שומרים כ-<span className="mono">.docx</span> (לא <span className="mono">.doc</span>)
              ומעלים כאן. ההעלאה הופכת מיד לפעילה, והגרסה הקודמת נשמרת לחזרה אחורה.
            </li>
          </ol>

          <p>
            העיצוב של השדה הוא העיצוב שיחול על הערך. אם{' '}
            <span className="mono">{'{companyName}'}</span> מודגש עם קו תחתון — כך ייראה שם החברה.
          </p>

          <div className="notice" style={{ marginTop: 16 }}>
            <strong>המסקנות עובדות אחרת:</strong> אין בהן שדות. מה שמסומן ב<mark>הדגשה צהובה</mark>{' '}
            בסעיפי המסקנות הוא מה שמנוסח מחדש לפי הממצאים של אותה בדיקה — הנוסח שכתוב שם משמש כדוגמה
            לאורך ולסגנון, וכל השאר נשאר מילה במילה. הצהוב יורד מהמסמך שמופק, כך שהלקוח לא רואה
            אותו. להוסיף קטע שיתנסח לבד — לסמן אותו בצהוב ב-Word; להקפיא קטע — להוריד ממנו את הצהוב.
          </div>

          {active.warning}

          <p style={{ color: 'var(--muted)' }}>
            אם שדה מפסיק להתמלא, סימן ש-Word פיצל אותו לכמה קטעי טקסט בזמן ההקלדה. מחקו אותו, הקלידו
            מחדש ברצף אחד בלי לעצור, והחילו עיצוב אחיד על כולו.
          </p>

          <div className="table-scroll" style={{ marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>שדה</th>
                  <th>מה מוזרק</th>
                </tr>
              </thead>
              <tbody>
                {active.fields.map((row) => (
                  <tr key={row.tag}>
                    <td>
                      <span className="mono">{row.tag}</span>
                    </td>
                    <td>{row.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

interface FieldRow {
  tag: string;
  description: string;
}

/**
 * The fields each template may contain.
 *
 * Kept beside the upload form deliberately: whoever edits the template in Word is
 * the person who needs this list, and they will not be reading the code. Split per
 * kind because a field that does not exist in a template is worse than a missing
 * one — it gets typed in, renders as nothing, and looks like a bug in the app.
 */

/** The lines every report shares: who it is for and how to reach them. */
const RECIPIENT_FIELDS: FieldRow[] = [
  { tag: '{referenceNumber}', description: 'מספר הסימוכין — מודפס בכותרת העליונה של כל עמוד' },
  { tag: '{recipientName} / {recipientTitle}', description: 'שם הנמען ותפקידו' },
  { tag: '{companyName} / {addressLine} / {city}', description: 'פרטי החברה והכתובת' },
  { tag: '{phone} / {email}', description: 'פרטי קשר' },
];

const KINDS: Array<{
  kind: TemplateKind;
  label: string;
  fields: FieldRow[];
  warning?: ReactNode;
}> = [
  {
    kind: 'radiation',
    label: 'דוח קרינה',
    warning: (
      <div className="notice error" style={{ marginTop: 16 }}>
        <strong>שימו לב:</strong> הרצת <span className="mono">npm run build:template</span> בונה את
        תבנית הקרינה מחדש ממסמך המקור ו<strong>דורסת</strong> עריכות שנעשו כאן — כולל הסימון הצהוב
        של המסקנות. השתמשו בו רק לבנייה מאפס, ולא לשינוי נוסח.
      </div>
    ),
    fields: [
      ...RECIPIENT_FIELDS,
      { tag: '{subject}', description: 'נושא הדוח המלא' },
      { tag: '{siteName}', description: 'שם האתר, משולב במשפט הפתיחה' },
      { tag: '{measurementDate} / {measurementDateTime}', description: 'תאריך המדידה, ותאריך ושעה' },
      { tag: '{location} / {siteCharacter} / {weather}', description: 'אפיון המדידה' },
      { tag: '{fieldSource} / {measurementType}', description: 'מקורות הקרינה שנבדקו וסוג המדידות' },
      { tag: '{#inspectors} … {/inspectors}', description: 'שורה בטבלה לכל בודק מוסמך' },
      { tag: '{#authors} … {/authors}', description: 'שורה בטבלה לעורך ולמאשר' },
      { tag: '{elfInstrument.*} / {rfInstrument.*}', description: 'שורות מפרט מכשירי המדידה' },
      { tag: '{#elfProtocols} … {/elfProtocols}', description: 'חוזר על מקטע פרוטוקול ELF שלם' },
      { tag: '{#rfProtocols} … {/rfProtocols}', description: 'חוזר על מקטע פרוטוקול RF שלם' },
      { tag: '{#rows} … {/rows}', description: 'בתוך פרוטוקול — שורת מדידה בטבלה' },
      { tag: '{title} / {referenceLabel}', description: 'בתוך פרוטוקול — כותרת ועמודת ההשוואה' },
      {
        tag: '{normalizationFactor} / {normalizationNote}',
        description: 'בתוך פרוטוקול ELF — נתוני הנרמול',
      },
      { tag: '{@photosXml}', description: 'נספח התמונות — נבנה בקוד ומוזרק כ-XML' },
    ],
  },
  {
    kind: 'radon',
    label: 'דוח ראדון',
    fields: [
      ...RECIPIENT_FIELDS,
      { tag: '{reportDate}', description: 'תאריך הדוח' },
      { tag: '{#isCompany} … {/isCompany}', description: 'מקטע שמודפס רק ללקוח שהוא חברה' },
      { tag: '{siteKind}', description: 'סוג האתר — קובע את רמת הפעולה שמולה נבחנו התוצאות' },
      { tag: '{detectorType} / {detectorBrand}', description: 'סוג הגלאי ושמו' },
      { tag: '{laboratory}', description: 'שם המעבדה שפיתחה את הגלאים' },
      { tag: '{notesRooms}', description: 'אילו חדרים מתוארים בסעיף ההערות' },
      { tag: '{#detectors} … {/detectors}', description: 'שורה בטבלה לכל גלאי' },
      { tag: '{pointNumber} / {detectorNumber}', description: 'בתוך שורה — מספר סידורי ומספר הגלאי' },
      { tag: '{roomName} / {floor}', description: 'בתוך שורה — החדר והקומה' },
      { tag: '{testLength} / {ventilation}', description: 'בתוך שורה — אורך הבדיקה וקצב האוורור' },
      { tag: '{placedAt} / {collectedAt}', description: 'בתוך שורה — תאריכי הנחה ואיסוף' },
      {
        tag: '{concentration} / {uncertainty}',
        description: 'בתוך שורה — הריכוז בבקרל/מ״ק ואי הוודאות באחוזים',
      },
      { tag: '{threshold}', description: 'בתוך שורה — רמת הפעולה שמולה נבחנה השורה' },
      { tag: '{recommendation}', description: 'בתוך שורה — סיכום ההמלצה, מחושב או שנקבע ידנית' },
    ],
  },
  {
    kind: 'asbestos',
    label: 'דוח אסבסט',
    warning: (
      <div className="notice" style={{ marginTop: 16 }}>
        <strong>התבנית נבנתה מחוות הדעת החתומה של גלית</strong> (וייסבורג 11) ע״י{' '}
        <span className="mono">npm run build:asbestos</span>, שהופך כל סימון צהוב במסמך המקור לשדה.
        הכתובת סומנה שם שש פעמים — היא נשאלת פעם אחת, והמיפוי מרכיב ממנה את שלוש הצורות הדקדוקיות
        שהמשפטים דורשים.
      </div>
    ),
    fields: [
      ...RECIPIENT_FIELDS,
      { tag: '{reportDate}', description: 'תאריך הדוח כפי שמודפס בשער — למשל "אוגוסט 2026"' },
      { tag: '{#isCompany} … {/isCompany}', description: 'מקטע שמודפס רק ללקוח שהוא חברה' },
      { tag: '{clientName}', description: 'מזמין הסקר — בשער ובסעיף נושא חוות הדעת' },
      {
        tag: '{siteLabel}',
        description: 'הכתובת בצורת "מבנה מרחוב וייסבורג 11, תל אביב" — לשער ולסיכום',
      },
      {
        tag: '{siteAddress} / {siteAddressBare}',
        description: 'הכתובת לבדה, למשפטים שכבר מספקים את מילת היחס שלהם',
      },
      { tag: '{asbestosKind}', description: 'צמנט או פריך — מודפס בשער' },
      { tag: '{siteDescription} / {surroundings}', description: 'תיאור המקום וסביבתו' },
      { tag: '{#findings} … {/findings}', description: 'חוזר על שורת הממצא. בתוכה {text} — הממצא כפי שנכתב' },
      { tag: '{totalArea}', description: 'סה״כ השטח — מחושב מסכום הממצאים, לא מוקלד' },
      {
        tag: '{#hasFindings} … {/hasFindings}',
        description: 'מקטע שמודפס רק כשנמצא משהו — למשל משפט הפינוי לפני הריסה',
      },
      {
        tag: '{#hasBuried} … {/hasBuried}',
        description: 'מקטע שמודפס רק כשסומן ממצא קבור או בתוך קיר — משפט האסבסט בקרקע',
      },
      { tag: '{buriedSentence} / {removalSentence}', description: 'שני משפטי הסיכום, ניתנים לעריכה בדוח' },
      {
        tag: '{@photosXml}',
        description: 'נספח התמונות — נבנה בקוד: תמונה אחת בעמוד, ממוספרת אוטומטית לפי הסדר',
      },
    ],
  },
  {
    kind: 'asbestos-tables',
    label: 'אסבסט עם טבלאות',
    warning: (
      <div className="notice" style={{ marginTop: 16 }}>
        <strong>הגרסה עם הטבלאות</strong> — נבנתה מחוות הדעת של שלוותה ע״י{' '}
        <span className="mono">npm run build:asbestos-tables</span>. כאן כל מבנה מקבל טבלה של 15
        שורות: 3 כותרות שהתבנית מדפיסה ו-13 שדות שהסוקר ממלא. איזו משתי התבניות מרונדרת נקבע לפי
        סוג הדוח שנבחר בפתיחתו, לא כאן.
      </div>
    ),
    fields: [
      ...RECIPIENT_FIELDS,
      { tag: '{reportDate}', description: 'תאריך הדוח כפי שמודפס בשער — למשל "נובמבר 2025"' },
      { tag: '{clientName}', description: 'מזמין הסקר — בשער ובסעיף נושא חוות הדעת' },
      { tag: '{siteLabel} / {siteAddress} / {siteAddressBare}', description: 'הכתובת בשלוש צורותיה' },
      { tag: '{asbestosKind}', description: 'צמנט, פריך או "צמנט ופריך" — מודפס בשער' },
      { tag: '{siteDescription} / {surroundings}', description: 'תיאור המקום והמבוא למבנים' },
      {
        tag: '{#buildings} … {/buildings}',
        description: 'חוזר על טבלת המבנה כולה — טבלה אחת לכל מבנה שנסקר',
      },
      { tag: '{name} / {use}', description: 'בתוך טבלה — שם המבנה והשימוש בו' },
      { tag: '{appearance} / {barrier}', description: 'בתוך טבלה — מופע האסבסט ותקרת הביניים' },
      { tag: '{area} / {moisture}', description: 'בתוך טבלה — שטח מקורב ורטיבות' },
      {
        tag: '{sheetCondition} / {edgeCondition}',
        description: 'בתוך טבלה — מצב הלוחות ומצב השוליים',
      },
      { tag: '{debris} / {painted}', description: 'בתוך טבלה — שברים על הקרקע ולוחות צבועים' },
      { tag: '{roofCover} / {friable}', description: 'בתוך טבלה — כיסוי הגגות ואסבסט פריך' },
      { tag: '{instructions}', description: 'בתוך טבלה — הנחיות לביצוע, בשורה הסוגרת' },
      {
        tag: '{#summaryLines} … {/summaryLines}',
        description: 'חוזר על שורת הנחיה בסיכום. בתוכה {text} — ההנחיה כפי שנכתבה',
      },
      {
        tag: '{@photosXml}',
        description: 'נספח התמונות — נבנה בקוד: תמונה אחת בעמוד, ממוספרת אוטומטית לפי הסדר',
      },
    ],
  },
  {
    kind: 'mold',
    label: 'דוח עובשים',
    warning: (
      <div className="notice" style={{ marginTop: 16 }}>
        <strong>התבנית נבנתה מדוח העובשים החתום של גלית</strong> (פעמונית 2, הוד השרון) ע״י{' '}
        <span className="mono">npm run build:mold</span>, שהופך כל סימון צהוב במסמך המקור לשדה. שאר
        המסמך — טבלאות המעבדה, ההסבר על אופן האבחון ותיאורי האורגניזמים — הוא נוסח קבוע ששייך
        לתבנית ואינו נשאל בטופס.
      </div>
    ),
    fields: [
      ...RECIPIENT_FIELDS,
      { tag: '{reportDate}', description: 'תאריך הדוח כפי שמודפס בשער — למשל "30 ביולי 2026"' },
      { tag: '{#isCompany} … {/isCompany}', description: 'מקטע שמודפס רק ללקוח שהוא חברה' },
      { tag: '{clientName} / {clientPhone} / {clientEmail}', description: 'פרטי המבקש' },
      { tag: '{requestDate}', description: 'תאריך הבקשה' },
      {
        tag: '{samplerName} / {authorName}',
        description: 'מבצע הדיגום ועורך הדוח (סעיף 1) — נבחרים בעורך: יורם גבאי או אביחי מוכתר',
      },
      {
        tag: '{#signedByYoram} … {/signedByYoram}',
        description: 'החתימה של יורם גבאי כשהוא עורך הדוח; {^signedByYoram} — החתימה של ד״ר אביחי מוכתר בכל מקרה אחר',
      },
      {
        tag: '{siteSubject}',
        description: 'נושא השער — מורכב מ"בדירת מגורים של" + שם המחזיק',
      },
      {
        tag: '{siteStreet} / {siteAddress}',
        description: 'הכתובת עם מילת היחס ("ברחוב…") ובלעדיה',
      },
      { tag: '{surveyDateTime} / {weather} / {attendedBy}', description: 'פרטי הבדיקה בשטח' },
      {
        tag: '{inspectorName} / {inspectorTitle} / {inspectorPhone}',
        description: 'מבצע הבדיקה — מודפס גם בחתימה',
      },
      { tag: '{samplesReceived} / {labReportNumber}', description: 'כמה דגימות התקבלו ומספר דוח המעבדה' },
      {
        tag: '{buildingDescription}',
        description: 'סעיף 1 — שורה אחת על המבנה, למשל "דירה בקומה 2 מעל קומת עמודים"',
      },
      {
        tag: '{siteDescription} / {customerClaim} / {methodDescription}',
        description: 'תיאור מקום הבדיקה, טענת המזמין ואופן ביצוע הבדיקה',
      },
      {
        tag: '{#hasUnrecordedProtocol} … {/hasUnrecordedProtocol}',
        description: 'אזהרת "פרוטוקול לא הושלם" בסעיף 4 — מודפסת רק כשאחד מארבעת השדות עדיין ריק',
      },
      {
        tag: '{#summaryRows} … {/summaryRows}',
        description:
          'טבלת 2.1 — שורה לכל דגימה: {location} {totalCount} {aspergillus} {cladosporium} {moistureReading}',
      },
      {
        tag: '{#samples} … {/samples}',
        description: 'חוזר על שורת דגימה. בתוכה {location} {kind} {scope} {labNumber} {totalCount} {organisms}',
      },
      {
        tag: '{comparison}',
        description: 'בתוך שורה — "רגיל" / "מעט גבוה" / "גבוה משמעותית" מול דגימת החוץ, מחושב ולא מוקלד',
      },
      {
        tag: '{markers}',
        description: 'בתוך שורה — סמני נזקי מים שזוהו בדגימה (Stachybotrys וכו׳)',
      },
      {
        tag: '{#hasOutdoor} … {/hasOutdoor}',
        description: 'מקטע שמודפס רק כשנלקחה דגימת חוץ. בתוכו {outdoorCount} {outdoorLocation}',
      },
      {
        tag: '{#hasMoisture} … {/hasMoisture}',
        description: 'פרק בדיקת הלחות בקירות (4.1) כולו — מודפס רק אם בוחרים "בוצעה" בעורך. בתוכו {moistureInstrument}',
      },
      {
        tag: '{#labBlocks} … {#interpretationLines} … {/interpretationLines} … {#moistureNote} … {/moistureNote} … {/labBlocks}',
        description:
          'סעיף 6 — לכל דגימה: פסקאות "פרשנות מקצועית" ({interpretationLines}), ותיבת לחות מוצללת ({moistureNote}) שמודפסת רק כשיש מה לומר בה',
      },
      {
        tag: '{#hasMoistureSummary} … {#moistureSummaryRows} … {/moistureSummaryRows} … {#moistureNarrativeLines} … {/moistureNarrativeLines} … {/hasMoistureSummary}',
        description:
          'סעיף 6.5 — טבלת {location}/{reading}/{assessment} לכל דגימה שקיבלה קריאה, ואחריה פסקת "פרשנות משולבת"',
      },
      { tag: '{airSummary} / {surfaceSummary}', description: 'סיכום תוצאות דיגום האוויר והמשטח' },
      {
        tag: '{#conclusionLines} … {/conclusionLines}',
        description: 'חוזר על שורת מסקנה. בתוכה {text}',
      },
      {
        tag: '{#recommendationLines} … {/recommendationLines}',
        description: 'חוזר על שורת המלצה. בתוכה {text}',
      },
      {
        tag: '{@photosXml}',
        description: 'נספח התמונות — נבנה בקוד: תמונה אחת בעמוד, ממוספרת אוטומטית לפי הסדר',
      },
    ],
  },
  {
    kind: 'iaq',
    label: 'דוח איכות אוויר',
    warning: (
      <div className="notice" style={{ marginTop: 16 }}>
        <strong>התבנית מיועדת לדוח בדיקת איכות אוויר תוך-מבנית.</strong> כל פרק מדידה
        מופיע רק אם יש בו נתונים (באמצעות <span className="mono">{'{#hasCo2}'}</span>,
        <span className="mono">{'{#hasFormaldehyde}'}</span> וכו׳). מסקנה אוטומטית לפי
        הספים נדפסת מתוך <span className="mono">{'{co2Conclusion}'}</span> ושאר ה-X-Conclusion.
      </div>
    ),
    fields: [
      ...RECIPIENT_FIELDS,
      { tag: '{referenceNumber}', description: 'סימוכין הדוח (YYMMDD + סדרה)' },
      { tag: '{reportTitle}', description: 'כותרת הדוח — "דוח איכות אוויר — <שם>"' },
      {
        tag: '{#isCompany} … {/isCompany}',
        description: 'מקטע שמודפס רק ללקוח שהוא חברה',
      },
      {
        tag: '{customerName} / {contactPhone}',
        description: 'שם המזמין (לפי סוג לקוח) וטלפון',
      },
      {
        tag: '{fullAddress} / {address} / {city}',
        description: 'כתובת מלאה, הרחוב והעיר בנפרד',
      },
      {
        tag: '{surveyDate} / {surveyTime} / {requestDate}',
        description: 'תאריכי הבדיקה והבקשה + טווח השעות',
      },
      {
        tag: '{weather} / {presentAt} / {siteCharacter} / {reason} / {airConditioning}',
        description: 'תנאי הבדיקה, בנוכחות מי, תיאור המקום, סיבת הזימון ומערכות המיזוג',
      },
      {
        tag: '{authorName} / {authorTitle} / {authorPhone} / {authorEmail}',
        description: 'מבצע הבדיקה (בחתימה ובסעיף פרטי המבצע)',
      },
      {
        tag: '{calibrationGraywolf} / {calibrationFormaldehyde}',
        description: 'תוקף הכיול של המכשירים (DSII-8 ו-FM-801)',
      },
      {
        tag: '{#locations} … {/locations}',
        description: 'לכל נקודת דיגום: {index} {name}',
      },
      {
        tag: '{locationCount} / {measuredCount}',
        description: 'ספירה — כמה נקודות וכמה פרמטרים נבדקו',
      },
      {
        tag: '{#hasCo2} … {/hasCo2}',
        description: 'כל פרק CO₂ — יש גם hasCo / hasNo2 / hasSo2 / hasTvoc / hasFormaldehyde / hasTemperature / hasHumidity',
      },
      {
        tag: '{#co2Rows} … {/co2Rows}',
        description: 'שורות טבלת CO₂: {index} {location} {value}. אותו דפוס לכל פרמטר (coRows, no2Rows וכו׳)',
      },
      {
        tag: '{co2Conclusion} / {co2Exceeded}',
        description: 'מסקנה אוטומטית לפי הסף. אותו דפוס: coConclusion, no2Conclusion, tvocConclusion וכו׳',
      },
      {
        tag: '{#summaryConclusions} … {/summaryConclusions}',
        description: 'לולאה של כל שורות המסקנה — אחת לפרמטר שבו הייתה מדידה. {text}',
      },
      {
        tag: '{summaryText} / {recommendations}',
        description: 'תקציר ההקדמה והמלצות הסיום — ברירת-מחדל אוטומטית, ניתנים לעריכה',
      },
      {
        tag: '{@photosXml}',
        description: 'נספח התמונות — נבנה בקוד: תמונה אחת בעמוד, ממוספרת אוטומטית לפי הסדר',
      },
    ],
  },
];
