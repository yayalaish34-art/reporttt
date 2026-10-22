import { findElementEnd, textOf } from './ooxml';
import { collectRows } from './protocol-loops';
import type { SurveyScope } from '../report-text';

/**
 * Drops the inspector licence row for the survey that was not carried out.
 *
 * The licence table names the inspector once per permit class — an ELF permit with its
 * own number and expiry, and an RF permit with another — and both rows are written into
 * the template as literal text. There is no `{#inspectors}` loop behind them, so
 * narrowing the merge data has no effect on what prints: the rows are in the document
 * whatever the survey measured.
 *
 * That is not a formatting detail. The table is the report's statement of who was
 * licensed to take these measurements, and an ELF-only survey that prints an RF permit
 * claims a qualification the survey never drew on. Same reasoning as `stripUnusedSurvey`,
 * which cuts the whole unused half of the document for the same reason.
 *
 * Applied to the rendered XML rather than to the template, so it works against the
 * template already in the database and survives a rebuild.
 */

/** The heading cells that identify the licence table among the document's tables. */
const LICENCE_TABLE_MARKERS = ['סוג היתר', 'מספר ההיתר'];

export function stripUnusedPermitRow(xml: string, scope: SurveyScope): string {
  if (scope === 'both') return xml;
  const drop = scope === 'elf' ? 'RF' : 'ELF';

  const table = findLicenceTable(xml);
  if (!table) return xml; // table not recognised — leave the document as authored

  const fragment = xml.slice(table.start, table.end);
  const rows = collectRows(fragment);

  // Cut from the end so an earlier row's offsets stay valid as later ones are removed.
  let out = fragment;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!rowDeclaresPermit(fragment.slice(row.start, row.end), drop)) continue;
    out = out.slice(0, row.start) + out.slice(row.end);
  }

  return xml.slice(0, table.start) + out + xml.slice(table.end);
}

/** The table whose headings name a permit class and a permit number. */
function findLicenceTable(xml: string): { start: number; end: number } | null {
  let i = 0;
  while (i < xml.length) {
    if (!xml.startsWith('<w:tbl>', i) && !xml.startsWith('<w:tbl ', i)) {
      i++;
      continue;
    }
    const end = findElementEnd(xml, i, 'w:tbl');
    const text = textOf(xml.slice(i, end));
    if (LICENCE_TABLE_MARKERS.every((m) => text.includes(m))) return { start: i, end };
    i = end;
  }
  return null;
}

/**
 * Whether a row's permit-class cell holds exactly this class.
 *
 * Matched on a whole cell rather than anywhere in the row: the row also carries the
 * inspector's name and title, and a substring test over the whole row would drop a row
 * belonging to someone whose name or title happened to contain the letters.
 */
function rowDeclaresPermit(row: string, permit: string): boolean {
  const wanted = permit.toUpperCase();
  return cellTexts(row).some((cell) => cell.toUpperCase() === wanted);
}

/** The trimmed text of each `<w:tc>` in a row. */
function cellTexts(row: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < row.length) {
    if (row.startsWith('<w:tc>', i) || row.startsWith('<w:tc ', i)) {
      const end = findElementEnd(row, i, 'w:tc');
      out.push(textOf(row.slice(i, end)).trim());
      i = end;
      continue;
    }
    i++;
  }
  return out;
}
