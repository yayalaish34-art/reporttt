import type { Report } from './report-schema';
import type { RadonReport } from './radon-schema';
import type { AsbestosReport } from './asbestos-schema';
import type { MoldReport } from './mold-schema';
import { isOutdoorSample } from './mold-rules';

/**
 * What is still missing from a step, so the wizard can refuse to leave it.
 *
 * Kept apart from the schema on purpose. The schema has to stay permissive —
 * the autosave stores whatever is on screen every few seconds, and a survey is
 * legitimately half-written for most of its life. These are the rules for
 * *moving on*, which is a different question from whether the work may be kept.
 *
 * Only fields the surveyor can actually see are required. A cell the editor
 * never renders cannot be filled in, and demanding it would leave someone
 * pressing a dead button with no idea what the app wanted.
 */

/** Human-readable list of what is missing, or null when the step is complete. */
function missing(parts: Array<string | null>): string | null {
  const gaps = parts.filter((p): p is string => Boolean(p));
  if (gaps.length === 0) return null;
  // Long lists are cut: naming twenty empty cells is not guidance, it is a wall.
  const shown = gaps.slice(0, 4);
  const rest = gaps.length - shown.length;
  return shown.join(' · ') + (rest > 0 ? ` ועוד ${rest}` : '');
}

/** "פרטי ההזמנה" — every field on the step. */
export function orderDetailsMissing(report: Report): string | null {
  return missing([
    report.requesterName.trim() === '' ? 'יבוצע בנוכחות' : null,
    report.measurementDate.trim() === '' ? 'תאריך הבדיקה' : null,
    // The date and the time share one stored value; a date with no time reads as
    // midnight in the document, which is not a measurement anyone took.
    !/\d{1,2}:\d{2}/.test(report.measurementDateTime) ? 'שעת הבדיקה' : null,
    /*
     * "מקום" is not listed here any more.
     *
     * It is no longer a field on this step: it was the same answer as "שם האתר"
     * one step earlier, asked twice, and it is now filled from there. Naming it as a
     * gap would send the surveyor looking for a box that is not on the screen — the
     * site name carries its own check on the step that does ask for it.
     */
    report.siteCharacter.trim() === '' ? 'אפיון המקום' : null,
    report.weather.trim() === '' ? 'תנאי מזג אוויר' : null,
    report.fieldSource.trim() === '' ? 'מקור השדה' : null,
    report.measurementType.trim() === '' ? 'סוג המדידות' : null,
  ]);
}

/** "לקוח" — the recipient block, which prints on the opening page. */
export function customerMissing(report: Report): string | null {
  const isCompany = report.customerType !== 'private';
  return missing([
    report.recipientName.trim() === '' ? (isCompany ? 'שם איש הקשר' : 'שם הלקוח') : null,
    // A company recipient prints a company line; a private one has none to print.
    isCompany && report.companyName.trim() === '' ? 'שם החברה' : null,
    report.addressLine.trim() === '' ? (isCompany ? 'כתובת החברה' : 'כתובת הלקוח') : null,
    report.city.trim() === '' ? 'עיר' : null,
    report.phone.trim() === '' ? 'טלפון' : null,
    report.email.trim() === '' ? 'דוא״ל' : null,
    // "תפקיד" is marked optional in the form itself and stays that way: a private
    // customer has no role, and plenty of contacts at a company have none either.
  ]);
}

/** "סוג הסקר והאתר". The scope always carries a value, so only the name can be blank. */
export function siteMissing(report: Report): string | null {
  return missing([report.siteName.trim() === '' ? 'שם האתר' : null]);
}

/**
 * "טבלאות מדידה" — that tables exist and each one is named, nothing more.
 *
 * The cells are deliberately not required. A protocol is filled in while walking a
 * floor with a meter, and a row legitimately stands half-written for the length of
 * a survey: the point is described when it is reached, the reading arrives when the
 * instrument settles, and the height gets typed when there is a hand free. Refusing
 * to leave the step until every cell is full would mean the surveyor cannot look at
 * anything else in the report until the last measurement is taken — which is the
 * opposite of how the work goes.
 *
 * What is still demanded is what makes a table a table: it has a source name, and
 * it has at least one row. Those are structural, they are set once when the table
 * is created, and a table without them prints as an untitled empty box.
 */
export function protocolsMissing(report: Report): string | null {
  if (report.elfProtocols.length + report.rfProtocols.length === 0) {
    return 'יש להוסיף לפחות טבלת מדידה אחת כדי להמשיך.';
  }

  const gaps: string[] = [];

  for (const [index, protocol] of report.elfProtocols.entries()) {
    if (protocol.title.trim() === '') gaps.push(`טבלת ELF ${index + 1}: שם המקור המקרין`);
    if (protocol.rows.length === 0) {
      gaps.push(`${protocol.title.trim() || `טבלת ELF ${index + 1}`}: אין שורות מדידה`);
    }
  }

  for (const [index, protocol] of report.rfProtocols.entries()) {
    if (protocol.title.trim() === '') gaps.push(`טבלת RF ${index + 1}: שם המקור המקרין`);
    if (protocol.rows.length === 0) {
      gaps.push(`${protocol.title.trim() || `טבלת RF ${index + 1}`}: אין שורות מדידה`);
    }
  }

  return missing(gaps);
}

/**
 * "בודקים וחתימות" — who measured, who wrote the report and who approved it.
 *
 * The rule that matters here is the separation: the person who approves a report must
 * not be the person who carried out the survey. An approval is a second pair of eyes on
 * someone else's work, and a report where the same name appears as surveyor and as
 * approver has not been reviewed by anyone — it merely says it has, which is worse than
 * saying nothing.
 *
 * Compared on the name rather than on the directory id, so picking the same person
 * through two different permit rows — the ELF licence and the RF licence of one
 * inspector — is still caught.
 */
export function inspectorsMissing(report: Report): string | null {
  if (report.inspectors.length === 0) return 'יש לבחור לפחות בודק אחד שביצע את הבדיקה.';

  /*
   * The approver is no longer asked for.
   *
   * The rule it enforced — that the person who measured may not also approve — was
   * sound in principle and unworkable here: a company with one licensed inspector has
   * nobody else to name, so the field could only ever be blank and the report could
   * never be issued. The screen said as much ("אין בודק אחר במערכת שיכול לאשר את
   * הדוח") and then refused to move on, which is a demand with no answer.
   *
   * What remains is the writer, which is a fact about the document rather than a
   * control on it. Reports produced before this still carry their approver row; the
   * template prints whatever authors it is given, so nothing about them changes.
   */
  const writer = report.authors.find((a) => a.role.includes('עורך'));
  return missing([writer?.name.trim() ? null : 'עורך הדו"ח']);
}

// ── Radon ───────────────────────────────────────────────────────────

/** "לקוח" in the radon report — the same recipient block, same reasoning. */
export function radonCustomerMissing(report: RadonReport): string | null {
  const isCompany = report.customerType !== 'private';
  return missing([
    report.recipientName.trim() === '' ? (isCompany ? 'איש הקשר' : 'שם הלקוח') : null,
    isCompany && report.companyName.trim() === '' ? 'שם החברה' : null,
    report.addressLine.trim() === '' ? (isCompany ? 'כתובת החברה' : 'כתובת הלקוח') : null,
    report.city.trim() === '' ? 'ישוב' : null,
    report.phone.trim() === '' ? 'נייד' : null,
    report.email.trim() === '' ? 'דוא״ל' : null,
  ]);
}

/**
 * "פרטי הבדיקה" — the survey's own details.
 *
 * `siteKind` is a select that always carries a value, so it cannot be blank. The
 * rest are typed, and each prints in the report's own tables.
 */
export function radonSurveyMissing(report: RadonReport): string | null {
  return missing([
    report.reportDate.trim() === '' ? 'תאריך הדוח' : null,
    report.detectorType.trim() === '' ? 'סוג הגלאי' : null,
    report.detectorBrand.trim() === '' ? 'שם הגלאי' : null,
    report.laboratory.trim() === '' ? 'שם המעבדה' : null,
    report.notesRooms.trim() === '' ? 'הערות לגבי הבדיקה' : null,
  ]);
}

/**
 * "תוצאות" — that detectors exist, not that every cell is filled.
 *
 * Same rule as the radiation protocols: a detector row is written when the detector
 * is placed and completed weeks later when the laboratory answers, so demanding a
 * concentration before the results are back would lock the surveyor out of their own
 * report for the whole of that wait.
 */
export function radonDetectorsMissing(report: RadonReport): string | null {
  if (report.detectors.length === 0) return 'יש להוסיף לפחות גלאי אחד כדי להמשיך.';
  return missing(
    report.detectors.map((row, i) =>
      row.roomName.trim() === '' ? `גלאי ${i + 1}: שם החדר` : null,
    ),
  );
}

// ── Asbestos ────────────────────────────────────────────────────────

/**
 * "מזמין ומבנה" — everything the opinion's opening pages print.
 *
 * The address is the one that matters most: it appears six times in the document
 * and also names the file, the subject line and the entry on the customer's card.
 * The rest print in the cover and in "תיאור המקום וסביבתו".
 */
export function asbestosDetailsMissing(report: AsbestosReport): string | null {
  return missing([
    report.clientName.trim() === '' ? 'מזמין הסקר' : null,
    report.siteAddress.trim() === '' ? 'כתובת המבנה' : null,
    report.reportDate.trim() === '' ? 'תאריך הדוח' : null,
    report.siteDescription.trim() === '' ? 'תיאור המקום' : null,
    report.surroundings.trim() === '' ? 'סביבת המבנה' : null,
    // `asbestosKind` is a select carrying a value from the moment the report opens.
  ]);
}

/**
 * "מבנים" — that buildings exist and each one is named.
 *
 * The thirteen rows per building are the survey's own table and follow the same
 * rule as the measurement protocols: they are answered while walking the site, and
 * a row left blank is a question that had no answer there. Only the name is
 * demanded, because it is what the printed table is headed with and what the
 * summary groups the buildings by.
 */
export function asbestosBuildingsMissing(report: AsbestosReport): string | null {
  const named = report.buildings.filter((b) => b.name.trim() !== '');
  if (named.length === 0) return 'יש להוסיף לפחות מבנה אחד עם שם כדי להמשיך.';
  return null;
}

// ── Mould ───────────────────────────────────────────────────────────

/**
 * "מזמין ומקום" — who asked for the survey and where it was taken.
 *
 * The address is here for the reason the asbestos one is: it is printed in five
 * places and it also names the file, the subject line and the entry on the
 * customer's card, so a report written without one has a hole on every page rather
 * than one blank field.
 */
export function moldDetailsMissing(report: MoldReport): string | null {
  return missing([
    report.clientName.trim() === '' ? 'שם המבקש' : null,
    report.siteAddress.trim() === '' ? 'כתובת הבדיקה' : null,
    report.reportDate.trim() === '' ? 'תאריך הדוח' : null,
  ]);
}

/**
 * "דגימות" — that samples exist, that each is placed, and that one is the control.
 *
 * The outdoor sample is demanded, and it is the only requirement here that is about
 * the survey's reasoning rather than its bookkeeping. A mould report states its
 * conclusion by comparing indoor counts against outdoor air sampled the same
 * morning — there is no national standard to compare against instead, and the
 * report prints that fact in its own explanatory section. So a survey with no
 * outdoor sample cannot conclude anything, and it is far better to say so while
 * the surveyor is still on site than to discover it when the laboratory results
 * come back a week later and the air has moved on.
 *
 * A surface-only survey is exempt: it reports what was growing on a wall, which is
 * a presence rather than a concentration and needs no control.
 */
export function moldSamplesMissing(report: MoldReport): string | null {
  const real = report.samples.filter(
    (s) => s.location.trim() !== '' || s.organisms.trim() !== '' || s.totalCount.trim() !== '',
  );
  if (real.length === 0) return 'יש להוסיף לפחות דגימה אחת כדי להמשיך.';

  const unplaced = real.filter((s) => s.location.trim() === '').length;
  if (unplaced > 0) {
    return `יש לציין מיקום לכל דגימה — ${unplaced} דגימות ללא מיקום.`;
  }

  const air = real.filter((s) => s.kind === 'אוויר');
  if (air.length > 0 && !air.some(isOutdoorSample)) {
    return 'חסרה דגימת אוויר חיצונית. היא דגימת הביקורת שאליה משווים את תוצאות הפנים, ובלעדיה לא ניתן להסיק מסקנה.';
  }

  return null;
}
