/**
 * What the fields are, in one list.
 *
 * Used two ways: the red-mark scanner proposes a field for a marked value from
 * it, and the template page shows it to whoever edits the document in Word.
 * Keeping one list means the reference and the guesser cannot drift apart.
 */

export interface FieldDefinition {
  /** The placeholder name, without braces. */
  field: string;
  /** What it holds, in Hebrew. */
  description: string;
  /**
   * The value in the source report, used to recognise it when marked red.
   * Omitted for fields with no single literal value, such as loop bodies.
   */
  sample?: string;
  /** The label that precedes it, used to recognise it by context. */
  label?: string;
}

export const KNOWN_FIELDS: FieldDefinition[] = [
  // Header
  { field: 'referenceNumber', description: 'מספר הסימוכין — בכותרת של כל עמוד', sample: '2126062303', label: 'סימוכין' },
  { field: 'headerWeekday', description: 'יום בשבוע בכותרת', sample: 'יום שלישי' },
  { field: 'headerHebrewDate', description: 'תאריך עברי בכותרת', sample: 'ח\' תמוז תשפ"ו' },
  { field: 'headerDate', description: 'תאריך לועזי בכותרת', sample: '23 יוני 2026' },

  // Recipient
  { field: 'recipientLine', description: 'שורת איש הקשר — שם ותפקיד' },
  { field: 'recipientName', description: 'שם הנמען', sample: 'ירון חכם' },
  { field: 'recipientTitle', description: 'תפקיד הנמען', sample: 'רמ"ד אחזקה ובינוי' },
  { field: 'companyName', description: 'שם החברה — מודגש עם קו תחתון', sample: 'כרטיסי אשראי לישראל בע"מ' },
  { field: 'addressLine', description: 'כתובת', sample: 'תפוצות ישראל 13' },
  { field: 'city', description: 'עיר — מודגשת עם קו תחתון', sample: 'גבעתיים' },
  { field: 'phone', description: 'טלפון', sample: '052-2857557', label: 'נייד' },
  { field: 'email', description: 'דוא"ל', sample: 'yaron.haham@icc.co.il', label: 'מייל' },

  // Cover wording
  { field: 'subject', description: 'נושא הדוח — נבנה מסוג הסקר ומשם האתר' },
  { field: 'openingSentence', description: 'משפט הפתיחה — נבנה מסוג הסקר' },
  { field: 'instrumentSentence', description: 'משפט המכשור — נבנה מסוג הסקר' },
  { field: 'siteName', description: 'שם האתר', sample: 'משרדי חברת כ.א.ל, מוקד בני ברק' },
  { field: 'measurementDate', description: 'תאריך המדידה', sample: '21/06/26' },

  // Order details
  // כמו ב-fieldSource: `label` הוא *מזהה* מול מסמך המקור ולכן נשאר בניסוח הישן.
  // הכותרת המודפסת היא REQUESTER_LABEL ("יבוצע בנוכחות"), ואותה כותב build-template.
  { field: 'requesterName', description: 'יבוצע בנוכחות', sample: 'ירון חכם', label: 'שם המבקש' },

  // Measurement characterization
  { field: 'measurementDateTime', description: 'תאריך ושעת המדידה', sample: '21/06/26, 11:00', label: 'תאריך ושעה' },
  { field: 'location', description: 'כתובת האתר שנמדד', sample: 'מצדה 3, בני ברק', label: 'מקום' },
  { field: 'siteCharacter', description: 'אפיון המקום', sample: 'משרדים', label: 'אפיון המקום' },
  { field: 'weather', description: 'תנאי מזג האוויר', sample: 'קיצי בהיר', label: 'תנאי מזג אוויר' },
  // מקור אחד או יותר, מופרדים בפסיק.
  //
  // `label` כאן הוא *מזהה* — הוא מותאם מול הטקסט במסמך המקור, שעדיין נושא את
  // הניסוח הישן "מקור שדה אל מ״ג". הכותרת המודפסת שונתה ל-FIELD_SOURCE_LABEL
  // ("מקורות הקרינה שנבדקו"), וזו שנכתבת ע"י build-template. אין לאחד ביניהם:
  // שינוי ה-label כאן ישבור את זיהוי השדה בבניית התבנית.
  { field: 'fieldSource', description: 'מקורות הקרינה שנבדקו', sample: 'אנטנות, לוח חשמל', label: 'מקור שדה אל מ"ג' },
  { field: 'measurementType', description: 'סוג המדידות', sample: 'מדידות שדה מגנטי', label: 'סוג המדידות' },

  // Instruments
  { field: 'elfInstrument.modelLine', description: 'דגם מכשיר ה-ELF' },
  { field: 'elfInstrument.serialLine', description: 'מספר סידורי ELF', sample: 'S.N: 37401' },
  { field: 'elfInstrument.frequencyRangeEn', description: 'טווח תדירות ELF (אנגלית)' },
  { field: 'elfInstrument.frequencyRangeHe', description: 'טווח תדירות ELF (עברית)' },
  { field: 'elfInstrument.sensitivity', description: 'רגישות ELF' },
  { field: 'elfInstrument.calibrationValidity', description: 'תוקף כיול ELF', sample: '29.01.27' },
  { field: 'rfInstrument.modelLine', description: 'יצרן מכשיר ה-RF', sample: 'מכשיר מתוצרת LATNEX' },
  { field: 'rfInstrument.descriptionLine', description: 'תיאור מכשיר ה-RF' },
  { field: 'rfInstrument.serialLine', description: 'דגם ומספר סידורי RF' },
  { field: 'rfInstrument.frequencyRangeEn', description: 'טווח תדירות RF' },
  { field: 'rfInstrument.calibrationValidity', description: 'תוקף כיול RF', sample: '04/08/26' },

  // Loops
  { field: '#inspectors', description: 'לולאה — שורה בטבלה לכל בודק מוסמך' },
  { field: '#authors', description: 'לולאה — שורה בטבלה לעורך ולמאשר' },
  { field: '#elfProtocols', description: 'לולאה — מקטע פרוטוקול ELF שלם' },
  { field: '#rfProtocols', description: 'לולאה — מקטע פרוטוקול RF שלם' },
  { field: '#rows', description: 'לולאה — שורת מדידה בתוך פרוטוקול' },
  { field: '#isCompany', description: 'תנאי — שורת שם החברה, ללקוח מסוג חברה בלבד' },

  // Injected XML
  { field: '@photosXml', description: 'נספח התמונות — נבנה בקוד ומוזרק כ-XML' },
  { field: '@signatureXml', description: 'חתימה — אחת לכל שורה בטבלאות האנשים' },

  // Protocol fields
  { field: 'title', description: 'בתוך פרוטוקול — כותרת הטבלה' },
  { field: 'referenceLabel', description: 'בתוך פרוטוקול — כותרת עמודת ההשוואה' },
  { field: 'normalizationFactor', description: 'בתוך פרוטוקול ELF — מקדם הנרמול' },
  { field: 'normalizationNote', description: 'בתוך פרוטוקול ELF — הערת הנרמול' },
  { field: 'pointNumber', description: 'בתוך שורת מדידה — מספר הנקודה, רץ על פני כל הטבלאות' },
];

/**
 * Marked text to field name.
 *
 * Keyed by the text as it appears in the document, because that is what the
 * build has to match, and it keeps the file readable for whoever fills in the
 * names the scanner could not work out.
 */
export type FieldMap = Record<string, string>;

/** Field names the system knows how to fill, for validating a map. */
export const KNOWN_FIELD_NAMES = new Set(KNOWN_FIELDS.map((f) => f.field));
