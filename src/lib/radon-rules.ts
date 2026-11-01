import { RADON_THRESHOLDS, RADON_VERDICTS, type DetectorRow, type RadonReport } from './radon-schema';

/**
 * The rules a radon row follows.
 *
 * The report carries its own decision table — the two "המלצה" tables in the
 * template — and this is that table in code. It is worth restating the rule it
 * encodes, because it is not the obvious one: the comparison is not between the
 * reading and the action level, but between the action level and the reading
 * *plus its uncertainty*. A laboratory that returns 480 ± 10% has not shown the
 * room to be under 500.
 */

/**
 * The largest uncertainty a reading can plausibly carry, as a percentage.
 *
 * The laboratory's software will print a wider one — a track count near zero
 * produces figures like ±46 or ±62 — but a result that uncertain is not a
 * result, and copying it into a report gives a client a number with no meaning
 * standing behind it. Above this the surveyor is asked what the figure should
 * be rather than being handed a verdict computed from noise.
 */
export const MAX_PLAUSIBLE_UNCERTAINTY = 22;

/** How many detectors a scanned series covers unless the surveyor says otherwise. */
export const DEFAULT_SERIES_LENGTH = 25;

/** The most detectors one series may add, so a slip of the keyboard cannot add thousands. */
export const MAX_SERIES_LENGTH = 500;

/**
 * A detector number in the form the laboratory's readings are stored under.
 *
 * Digits only and no leading zeros, so a scanned barcode and a number read off the
 * laboratory's screen land on the same key.
 */
export function detectorKey(raw: string): string {
  return String(raw ?? '').replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
}

/**
 * Whether a scan looks like a detector number.
 *
 * The ceiling is what keeps the series arithmetic exact, and it also turns away a
 * scan of some other long code on the same box.
 */
export function isDetectorKey(key: string): boolean {
  return /^\d{3,15}$/.test(key);
}

/** The scanned number and the ones after it, `count` numbers in all. */
export function detectorSeries(start: string, count: number): string[] {
  const key = detectorKey(start);
  if (!isDetectorKey(key)) return [];
  const length = Math.min(Math.max(Math.trunc(count) || 0, 0), MAX_SERIES_LENGTH);
  return Array.from({ length }, (_, i) => String(Number(key) + i));
}

/** True when the uncertainty is too wide to use as printed. */
export function implausibleUncertainty(uncertainty: string): boolean {
  const percent = toNumber(uncertainty);
  return percent !== null && percent > MAX_PLAUSIBLE_UNCERTAINTY;
}

/** Parses a measurement cell, which is free text and may be blank or "<10". */
export function toNumber(value: string): number | null {
  const cleaned = String(value ?? '').trim().replace(/[^\d.,-]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * The reading with its uncertainty added, in Bq/m³.
 *
 * The uncertainty column is a percentage of the reading — the template says so
 * in its own footnote — so it is applied as one. Treating it as an absolute
 * figure would flatter every high reading and understate every low one.
 */
export function combinedValue(concentration: string, uncertainty: string): number | null {
  const value = toNumber(concentration);
  if (value === null) return null;
  const percent = toNumber(uncertainty);
  return percent === null ? value : value * (1 + percent / 100);
}

/** The action level for a site kind, in Bq/m³. */
export function actionLevel(siteKind: string): number {
  return siteKind.trim() === 'מקום עבודה' ? RADON_THRESHOLDS.workplace : RADON_THRESHOLDS.general;
}

/**
 * The verdict for one row, or '' when there is nothing to judge.
 *
 * A short-term test never concludes that a room is fine — at best it clears the
 * room for the long test, which is the one that decides. That asymmetry is the
 * whole point of running a short test first, and it is easy to lose by treating
 * both lengths as the same comparison against a number.
 */
export function radonVerdict(row: DetectorRow): string {
  if (row.recommendation.trim() !== '') return row.recommendation.trim();

  // An uncertainty this wide means the detector caught too little to say
  // anything. Better an empty cell the surveyor must deal with than a verdict
  // that reads as a finding.
  if (implausibleUncertainty(row.uncertainty)) return '';

  const combined = combinedValue(row.concentration, row.uncertainty);
  const limit = toNumber(row.threshold);
  if (combined === null || limit === null) return '';

  const under = combined < limit;
  if (row.testLength.trim() === 'קצרה') {
    return under ? RADON_VERDICTS.shortOk : RADON_VERDICTS.exceeds;
  }
  return under ? RADON_VERDICTS.ok : RADON_VERDICTS.exceeds;
}

/** True when the row's own numbers put it over its action level. */
export function isExceeding(row: DetectorRow): boolean {
  return radonVerdict(row) === RADON_VERDICTS.exceeds;
}

/** A new detector row, carrying the defaults a survey shares. */
export function newDetectorRow(report?: Pick<RadonReport, 'siteKind' | 'detectors'>): DetectorRow {
  const previous = report?.detectors?.[report.detectors.length - 1];
  return {
    detectorNumber: '',
    roomName: '',
    // The dates, floor and regime repeat across a survey — the detectors went
    // out together and came back together — so a new row starts from the last.
    floor: previous?.floor ?? '',
    testLength: previous?.testLength ?? 'ארוכה',
    ventilation: previous?.ventilation ?? 'ת.מ.ר',
    placedAt: previous?.placedAt ?? '',
    collectedAt: previous?.collectedAt ?? '',
    concentration: '',
    uncertainty: '',
    threshold: String(actionLevel(report?.siteKind ?? 'מקום עבודה')),
    recommendation: '',
  };
}

export interface RadonFindings {
  count: number;
  /** Rows whose combined value reaches the action level. */
  exceeding: DetectorRow[];
  /** The highest reading in the survey. */
  highest: DetectorRow | null;
  /** The action level the survey was judged against, in Bq/m³. */
  limit: number;
  siteKind: string;
}

export function computeRadonFindings(report: RadonReport): RadonFindings {
  const rows = report.detectors.filter((r) => toNumber(r.concentration) !== null);
  const highest = rows.reduce<DetectorRow | null>(
    (best, r) => (!best || (toNumber(r.concentration) ?? 0) > (toNumber(best.concentration) ?? 0) ? r : best),
    null,
  );
  return {
    count: rows.length,
    exceeding: rows.filter(isExceeding),
    highest,
    limit: actionLevel(report.siteKind),
    siteKind: report.siteKind,
  };
}

/** Hebrew for a small count, so a sentence reads "בחמישה מיקומים" not "ב-5". */
const HEBREW_COUNT = ['', 'מיקום אחד', 'שני מיקומים', 'שלושה מיקומים', 'ארבעה מיקומים', 'חמישה מיקומים',
  'שישה מיקומים', 'שבעה מיקומים', 'שמונה מיקומים', 'תשעה מיקומים', 'עשרה מיקומים'];

/**
 * The findings as a brief for the model, in the shape the radiation report uses.
 *
 * The quantifier is stated as an instruction for the same reason it is there:
 * "בכל המיקומים" and "בחלק מהמיקומים" are the difference between a clean survey
 * and one that needs work, and it is not a choice of wording.
 */
export function describeRadonFindings(f: RadonFindings): string {
  const lines: string[] = [];
  lines.push(`נבדקו ${f.count} מיקומים (${HEBREW_COUNT[f.count] || `${f.count} מיקומים`}), סוג האתר: ${f.siteKind}.`);
  lines.push(`רמת הפעולה שלפיה נבחנו התוצאות: ${f.limit} בקרל/מ"ק.`);

  if (f.highest) {
    lines.push(
      `הריכוז הגבוה ביותר: ${f.highest.concentration} בקרל/מ"ק ב"${f.highest.roomName}"` +
        (f.highest.uncertainty ? ` (אי ודאות ${f.highest.uncertainty}%)` : '') + '.',
    );
  }

  if (f.exceeding.length === 0) {
    lines.push('אף מיקום אינו מגיע לרמת הפעולה — יש לנסח "בכל המיקומים … נמוכים מרמת הפעולה".');
  } else if (f.exceeding.length >= f.count) {
    lines.push(
      `כל ${f.count} המיקומים מגיעים לרמת הפעולה או עוברים אותה — יש לנסח "בכל", אסור לנסח "בחלק".`,
    );
  } else {
    lines.push(
      `${f.exceeding.length} מתוך ${f.count} המיקומים מגיעים לרמת הפעולה: ` +
        `${f.exceeding.map((r) => `"${r.roomName}" (${r.concentration})`).join(', ')} — ` +
        `יש לנסח "בחלק מ…", אסור לנסח "בכל".`,
    );
  }

  lines.push('ההשוואה היא בין רמת הפעולה לבין הריכוז הנמדד בתוספת אי הוודאות שלו, לא לריכוז לבדו.');
  return lines.join('\n');
}
