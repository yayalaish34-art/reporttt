import type { Author, Inspector } from './report-schema';
import type { InspectorRecord } from './inspector-service';

/**
 * Who signs a report, given who carried out the survey.
 *
 * A radiation report is signed twice over: by the inspectors who took the measurements,
 * and — separately — by whoever wrote the report and whoever approved it. The approval
 * is the point of the second signature: it says someone other than the surveyor has read
 * the document and stands behind it. A report approved by the person who measured it has
 * had no second reading at all, so the two must be different people.
 *
 * The rule is applied here rather than left to the surveyor to remember, because it is
 * exactly the kind of thing that gets missed at the end of a long day — and it is
 * invisible in the finished document, which looks properly signed either way.
 */

/** The roles as the report prints them, and as `inspectorsMissing` looks for them. */
export const WRITER_ROLE = 'עורך הדו"ח';
export const APPROVER_ROLE = 'מאשר הדו"ח';

/** The directory record as the report stores it. */
export function toInspector(record: InspectorRecord): Inspector {
  return {
    name: record.name,
    title: record.title,
    permitType: record.permitType,
    permitNumber: record.permitNumber,
    permitValidity: record.permitValidity,
    signatureId: record.signatureId,
  };
}

/**
 * The authors block for a report, given who surveyed it.
 *
 * The writer is the surveyor — whoever measured it writes it up — and the approver is
 * somebody else. Both keep their own signature from the directory, which is what stops
 * the merge stamping one person's mark on both rows.
 */
export function buildAuthors(
  directory: readonly InspectorRecord[],
  surveyors: readonly Inspector[],
  currentAuthors: readonly Author[] = [],
): Author[] {
  const currentWriter = currentAuthors.find((a) => a.role.includes('עורך'));
  const currentApprover = currentAuthors.find((a) => a.role.includes('מאשר'));

  // The writer follows the first surveyor unless someone has deliberately named another.
  const lead = surveyors[0];
  const writerName = currentWriter?.name.trim() || lead?.name.trim() || '';
  const writerSignature =
    currentWriter?.name.trim() === writerName && currentWriter?.signatureId
      ? currentWriter.signatureId
      : directory.find((r) => r.name.trim() === writerName)?.signatureId ?? lead?.signatureId ?? '';

  /*
   * An approver row is kept only where one was already named.
   *
   * The field was removed from the editor: the rule it enforced — that the person who
   * measured may not also approve — left a company with one licensed inspector unable
   * to issue anything, because there was nobody else to name. Choosing an approver
   * automatically is worse than not having one: it puts a colleague's name and mark on
   * a report they never read.
   *
   * Reports that already carry an approver keep them, so reissuing an old report
   * produces the same document it did before.
   */
  const keptApprover = currentApprover?.name.trim()
    ? [
        {
          name: currentApprover.name,
          role: APPROVER_ROLE,
          signatureId: currentApprover.signatureId,
        },
      ]
    : [];

  return [
    { name: writerName, role: WRITER_ROLE, signatureId: writerSignature },
    ...keptApprover,
  ];
}
