import type {
  LabResult,
  MoistureReading,
  MoldReport,
  MoldSample,
} from './mold-schema';

/**
 * The rules the mould report follows.
 *
 * There is one piece of reasoning in this report and everything else hangs off
 * it: an indoor spore count means nothing on its own, and only becomes a finding
 * when it is set against the outdoor sample taken the same morning. There are no
 * national standards for indoor mould — the laboratory's own notes say so, and
 * the report prints that paragraph — so the outdoor control *is* the reference
 * value, and the comparison between it and each room is the report's conclusion.
 *
 * That comparison used to be done in the surveyor's head and typed into the
 * summary as prose. It is done here instead, for the reason the asbestos total
 * area is added up in code: a number worked out by hand is the number that goes
 * stale when a laboratory sheet is transcribed a second time, and this one is
 * the difference between "elevated" and "significantly elevated" in a document
 * somebody may act on.
 */

/**
 * Parses a concentration as the laboratory writes it.
 *
 * The laboratory reports "<37,000" and "38,009" and "37000" in the same column,
 * and the thousands separators are inconsistent between sheets. The comparison
 * only needs the magnitude, so the qualifier and the punctuation come off and
 * the digits are what is read. Returns null for a cell that carries no number at
 * all — a surface sample has no concentration, and a blank is not a zero.
 */
export function toCount(value: string): number | null {
  const cleaned = String(value ?? '')
    .trim()
    // "<" and ">" say the count ran past the countable range; the digits beside
    // them are still the figure the report compares.
    .replace(/[<>~≈]/g, '')
    .replace(/[,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** The samples the surveyor actually entered — a blank row is an empty editor line. */
export function realSamples(report: Pick<MoldReport, 'samples'>): MoldSample[] {
  return report.samples.filter(
    (s) => s.location.trim() !== '' || s.organisms.trim() !== '' || s.totalCount.trim() !== '',
  );
}

/** The moisture readings the surveyor actually took. */
export function realMoistureReadings(
  report: Pick<MoldReport, 'moistureReadings'>,
): MoistureReading[] {
  return report.moistureReadings.filter(
    (r) => r.location.trim() !== '' || r.reading.trim() !== '',
  );
}

/**
 * Whether a laboratory/sample name identifies the outdoor control.
 *
 * Hayes commonly calls this row "OUTSIDE". Older scans only recognised OUTDOOR and
 * EXTERIOR, so an OUTSIDE row was saved as an indoor sample and every conclusion was
 * then drafted as if no control existed. The name is authoritative: it deliberately
 * wins even when an already-saved report still carries scope="פנים".
 */
export function isOutdoorLocation(location: string): boolean {
  const name = location.trim();
  return /חוץ/.test(name) || /\b(?:outside|outdoor|exterior)\b/i.test(name);
}

export function isOutdoorSample(
  sample: Pick<MoldSample, 'location' | 'scope'>,
): boolean {
  return sample.scope === 'חוץ' || isOutdoorLocation(sample.location);
}

/** Air samples taken inside the building — the ones the conclusion is about. */
export function indoorAirSamples(report: Pick<MoldReport, 'samples'>): MoldSample[] {
  return realSamples(report).filter((s) => s.kind === 'אוויר' && !isOutdoorSample(s));
}

/**
 * The outdoor control, or null when none was taken.
 *
 * Singular deliberately: the report compares against one reference, and a survey
 * that took two outdoor samples is describing two references without saying which
 * the conclusion used. The first is taken, and the editor warns when there is
 * none — see `moldSamplesMissing`.
 */
export function outdoorAirSample(report: Pick<MoldReport, 'samples'>): MoldSample | null {
  return realSamples(report).find((s) => s.kind === 'אוויר' && isOutdoorSample(s)) ?? null;
}

/** Surface samples, indoor or out — reported in their own summary section. */
export function surfaceSamples(report: Pick<MoldReport, 'samples'>): MoldSample[] {
  return realSamples(report).filter((s) => s.kind === 'משטח');
}

/**
 * How an indoor count compares with the outdoor control.
 *
 * The three bands are the laboratory's own, printed in the report's explanatory
 * section and therefore the vocabulary the reader already has by the time they
 * reach the conclusions:
 *
 *   'רגיל'    — at or below the outdoor count. Indoor air always carries spores;
 *               this is what "normal" looks like and is not a finding.
 *   'מעט גבוה' — above outdoor, but not by enough to point at a source on its own.
 *   'גבוה משמעותית' — far enough above outdoor to indicate an indoor source.
 *
 * The threshold between the last two is a factor of five. That is a judgement,
 * and it is written here rather than left to whoever is typing the summary, so
 * that two reports on two mornings describe the same ratio the same way. It is
 * deliberately conservative: the wording it selects goes into a signed document
 * and "significantly elevated" is the phrase a customer acts on.
 *
 * Returns null when the comparison cannot be made — no outdoor sample, or a
 * count that is not a number. A missing comparison is not a passing one, and the
 * caller has to say so rather than print a reassuring word it did not earn.
 */
export type Comparison = 'רגיל' | 'מעט גבוה' | 'גבוה משמעותית';

/** How far above outdoor a count must sit before it is called significant. */
const SIGNIFICANT_RATIO = 5;

export function compareWithOutdoor(
  sample: MoldSample,
  outdoor: MoldSample | null,
): Comparison | null {
  const indoor = toCount(sample.totalCount);
  const control = outdoor ? toCount(outdoor.totalCount) : null;
  if (indoor === null || control === null) return null;

  // An outdoor count of zero cannot be divided by, and every indoor spore is then
  // above it by definition — which is exactly the significant case.
  if (control <= 0) return indoor > 0 ? 'גבוה משמעותית' : 'רגיל';

  if (indoor <= control) return 'רגיל';
  return indoor >= control * SIGNIFICANT_RATIO ? 'גבוה משמעותית' : 'מעט גבוה';
}

/**
 * The genera that indicate water damage rather than ordinary airborne spores.
 *
 * The report's own explanatory section calls these "מסמנים של נזק למים": they
 * grow on wet cellulose — plasterboard, ceiling tiles, paper — and finding them
 * indoors says something an elevated total count does not. Stachybotrys is the
 * one a customer will have heard of as "black mould".
 *
 * Matched case-insensitively against the laboratory's Latin names, which is how
 * the surveyor transcribes them.
 */
export const WATER_DAMAGE_MARKERS = ['Stachybotrys', 'Chaetomium', 'Memnoniella', 'Ulocladium'];

/** The water-damage markers named in a sample, in the order the constant lists them. */
export function waterDamageMarkersIn(sample: MoldSample): string[] {
  const organisms = sample.organisms.toLowerCase();
  return WATER_DAMAGE_MARKERS.filter((marker) => organisms.includes(marker.toLowerCase()));
}

/** True when any indoor sample carries a water-damage marker. */
export function hasWaterDamageMarkers(report: Pick<MoldReport, 'samples'>): boolean {
  return realSamples(report)
    .filter((s) => !isOutdoorSample(s))
    .some((s) => waterDamageMarkersIn(s).length > 0);
}

/** True when any indoor air sample is significantly above the outdoor control. */
export function hasSignificantFinding(report: Pick<MoldReport, 'samples'>): boolean {
  const outdoor = outdoorAirSample(report);
  return indoorAirSamples(report).some(
    (s) => compareWithOutdoor(s, outdoor) === 'גבוה משמעותית',
  );
}

/** True when a moisture reading came back above normal — gates the damp findings. */
export function hasElevatedMoisture(report: Pick<MoldReport, 'moistureReadings'>): boolean {
  return realMoistureReadings(report).some((r) => r.level !== 'תקין');
}

/**
 * The findings in one line each, for the drafter and for the on-screen summary.
 *
 * Written as sentences rather than as a table because that is what both consumers
 * need: the model is asked to word a summary from them, and the surveyor is
 * checking that what the report is about to say matches the laboratory sheet in
 * their hand. A row of columns serves neither.
 */
export function describeMoldFindings(report: MoldReport): string[] {
  const outdoor = outdoorAirSample(report);
  const lines: string[] = [];

  for (const sample of indoorAirSamples(report)) {
    const comparison = compareWithOutdoor(sample, outdoor);
    const markers = waterDamageMarkersIn(sample);
    lines.push(
      [
        `${sample.location}: ${sample.totalCount || 'ללא תוצאה'} נבגים/מ״ק`,
        sample.organisms ? `עיקר הממצא ${sample.organisms}` : '',
        comparison ? `ביחס לחוץ — ${comparison}` : 'אין דגימת חוץ להשוואה',
        markers.length > 0 ? `סמני נזקי מים: ${markers.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('. '),
    );
  }

  if (outdoor) {
    lines.push(
      `דגימת חוץ (ביקורת) — ${outdoor.location}: ${outdoor.totalCount || 'ללא תוצאה'} נבגים/מ״ק` +
        (outdoor.organisms ? `, ${outdoor.organisms}` : ''),
    );
  }

  for (const sample of surfaceSamples(report)) {
    lines.push(
      `דגימת משטח — ${sample.location}: ${sample.organisms || 'ללא ממצא מדווח'}`,
    );
  }

  for (const reading of realMoistureReadings(report)) {
    lines.push(
      `לחות — ${reading.location}: ${moistureLevelDescription(reading.level)}` +
        (reading.reading ? ` (${reading.reading})` : ''),
    );
  }

  return lines;
}

/**
 * `level` in words, without "תקין"/"חריג" — the meter has no standard threshold
 * matching the measurement method, so neither this text (fed to the drafter as a
 * fact) nor anything printed may imply one exists (Galit, 2026-09-16). `level`
 * itself stays as an internal three-way classification (it still drives
 * `hasElevatedMoisture`); only its wording here is softened to a comparative term.
 */
function moistureLevelDescription(level: MoistureReading['level']): string {
  switch (level) {
    case 'לחות גבוהה':
      return 'קריאה גבוהה יחסית';
    case 'לחות מוגברת':
      return 'קריאה מוגברת יחסית';
    default:
      return 'קריאה נמוכה יחסית';
  }
}

/** A new sample row. Air and indoor, which is what most samples are. */
export function newSampleRow(): MoldSample {
  return {
    location: '',
    kind: 'אוויר',
    scope: 'פנים',
    labNumber: '',
    totalCount: '',
    organisms: '',
    note: '',
    moistureReading: '',
  };
}

/** A new moisture row. */
export function newMoistureRow(): MoistureReading {
  return { location: '', reading: '', level: 'לחות מוגברת' };
}

/**
 * The rooms a mould survey is usually sampled in.
 *
 * A shortcut, never a limit — the box stays free text. Sampling happens standing
 * in the room with a pump running, on a phone, and "חדר שינה" is a word the
 * surveyor writes on most jobs.
 */
export const LOCATION_OPTIONS = [
  'סלון',
  'חדר שינה',
  'חדר ילדים',
  'חדר אמבטיה',
  'מטבח',
  'מסדרון',
  'ממ״ד',
  'מרתף',
  'חוץ',
] as const;

// ── The laboratory's own result blocks ──────────────────────────────

/**
 * The laboratory block belonging to a sample, or null when none was read.
 *
 * Matched on the laboratory's number first, because that is the identifier the
 * laboratory itself uses and the only one guaranteed to be on both sides. The room
 * name is the fallback: a surveyor who did not write the number down still recorded
 * where they stood, and the laboratory prints that too.
 *
 * Names are compared loosely — the surveyor writes "חדר בן" and the sheet may carry
 * "חדר בן " or "Bedroom" transcribed back — so a match is only claimed when one name
 * contains the other. A wrong match here would print one room's counts under another
 * room's heading, which is worse than printing no table at all.
 */
export function labResultFor(
  report: Pick<MoldReport, 'labResults'>,
  sample: Pick<MoldSample, 'labNumber' | 'location'>,
): LabResult | null {
  const number = sample.labNumber.trim();
  if (number) {
    const byNumber = report.labResults.find((r) => r.labNumber.trim() === number);
    if (byNumber) return byNumber;
  }

  const name = sample.location.trim();
  if (!name) return null;
  return (
    report.labResults.find((r) => {
      const theirs = r.sampleName.trim();
      if (!theirs) return false;
      return theirs === name || theirs.includes(name) || name.includes(theirs);
    }) ?? null
  );
}

/**
 * Laboratory blocks that could not be tied to any sample the surveyor recorded.
 *
 * Worth surfacing rather than dropping: it means the sheet describes a sample the
 * survey does not know about, which is either a sample row nobody filled in or a
 * page from somebody else's job. Both are things the surveyor needs to see before
 * the report is issued, and neither is something to guess at.
 */
export function unmatchedLabResults(report: Pick<MoldReport, 'labResults' | 'samples'>): LabResult[] {
  return report.labResults.filter(
    (result) => !report.samples.some((sample) => labResultFor(report, sample) === result),
  );
}

/**
 * Fills a sample's own summary fields from the laboratory block matched to it.
 *
 * The surveyor records a sample on site with a location and little else; the counts
 * arrive a week later on the sheet. Rather than asking them to copy the total and the
 * genera across by hand — the transcription this whole path exists to remove — the
 * scan writes them in.
 *
 * Only empty fields are filled. Anything the surveyor typed themselves wins, because
 * a figure they entered deliberately is a decision and an overwrite would be silent.
 */
export function sampleWithLabResult(sample: MoldSample, result: LabResult | null): MoldSample {
  if (!result) return sample;

  // The genera worth naming in a summary are the ones actually found. A blank row on
  // the sheet means the laboratory did not find that genus, so it is not listed.
  const found = result.organisms
    .filter((o) => o.perCubicMetre.trim() !== '' || o.raw.trim() !== '')
    .map((o) => o.organism.trim())
    .filter(Boolean);

  return {
    ...sample,
    // "OUTSIDE" on the laboratory block is the comparison sample even when an old
    // editor row had already been saved as indoor before that name was recognised.
    scope:
      isOutdoorLocation(sample.location) || isOutdoorLocation(result.sampleName)
        ? 'חוץ'
        : sample.scope,
    labNumber: sample.labNumber.trim() || result.labNumber,
    totalCount: sample.totalCount.trim() || result.totalPerCubicMetre,
    organisms: sample.organisms.trim() || found.join(', '),
  };
}
