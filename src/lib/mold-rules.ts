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
    (s) =>
      s.location.trim() !== '' ||
      s.organisms.trim() !== '' ||
      s.totalCount.trim() !== '' ||
      s.mediaNumber.trim() !== '',
  );
}

/** "0.8" → "0.8%"; a reading that already carries its unit is left as it is. */
export function withPercent(reading: string): string {
  const value = reading.trim();
  if (value === '') return '';
  return /%$/.test(value) ? value : `${value}%`;
}

/**
 * A room's wall-moisture readings as one line — "קיר מזרחי 0.8%, רצפה 1.3%".
 *
 * The per-surface readings win where any were taken; otherwise the single reading a
 * report carried before rooms had surfaces. Every consumer — §2.1, §6.5, the drafter —
 * reads moisture through this, so the two shapes never print differently.
 */
export function moistureText(sample: Pick<MoldSample, 'moistureReading' | 'wallReadings'>): string {
  const walls = (sample.wallReadings ?? [])
    .filter((w) => w.reading.trim() !== '')
    .map((w) => [w.surface.trim(), withPercent(w.reading)].filter(Boolean).join(' '));
  return walls.length > 0 ? walls.join(', ') : sample.moistureReading.trim();
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
    mediaNumber: '',
    wallReadings: [],
    photoIds: [],
    sampleNameEn: '',
    analysis: 'S',
    volume: '150 Lit.',
    cocNote: '',
  };
}

/** A new outdoor control row — the reference every room is compared against. */
export function newOutdoorSampleRow(): MoldSample {
  return { ...newSampleRow(), location: 'חוץ', scope: 'חוץ' };
}

/**
 * The report's photographs in appendix order: room by room, then any not tied to one.
 *
 * An uncaptioned photo taken in a room is captioned with the room's name, so the
 * appendix never prints a bare "תמונה מס' 3 :".
 */
export function photosInRoomOrder(
  report: Pick<MoldReport, 'photos' | 'samples'>,
): MoldReport['photos'] {
  const byId = new Map(report.photos.map((p) => [p.imageId, p]));
  const ordered: MoldReport['photos'] = [];
  const used = new Set<string>();
  for (const sample of report.samples) {
    const room = sample.location.trim() || (isOutdoorSample(sample) ? 'חוץ' : '');
    for (const imageId of sample.photoIds ?? []) {
      const photo = byId.get(imageId);
      if (!photo || used.has(imageId)) continue;
      used.add(imageId);
      ordered.push({ ...photo, caption: photo.caption.trim() || room });
    }
  }
  for (const photo of report.photos) if (!used.has(photo.imageId)) ordered.push(photo);
  return ordered;
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
  sample: Pick<MoldSample, 'labNumber' | 'location'> & { mediaNumber?: string },
): LabResult | null {
  const number = sample.labNumber.trim();
  if (number) {
    const byNumber = report.labResults.find((r) => r.labNumber.trim() === number);
    if (byNumber) return byNumber;
  }

  /*
   * The media number is what the surveyor wrote on the chain of custody, and Hayes
   * prints it back as the sample's name or beside it. Compared without spaces and
   * case, and only as a whole token — "12" must not claim the block named "A123".
   */
  const media = (sample.mediaNumber ?? '').replace(/\s+/g, '').toLowerCase();
  if (media) {
    const tokens = (value: string) => value.toLowerCase().split(/[^0-9a-z֐-׿-]+/).filter(Boolean);
    const byMedia = report.labResults.find(
      (r) =>
        r.sampleName.replace(/\s+/g, '').toLowerCase() === media ||
        tokens(r.sampleName).includes(media) ||
        r.labNumber.trim().toLowerCase() === media,
    );
    if (byMedia) return byMedia;
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

/** The sheet's own particulars, as the scan reads them off the laboratory's header. */
export interface LabSheetHeader {
  labReportNumber: string;
  labCollectedDate: string;
  labReceivedDate: string;
  labReportedDate: string;
}

/**
 * Folds a scan of the laboratory's report into a mould report.
 *
 * One path for both places a scan arrives from — the editor's drop zone and the
 * e-mail from Hayes that the CRM forwards — so a report reads the same whichever way
 * its results came in.
 *
 * The scan replaces the previous reading rather than adding to it: re-scanning is how
 * a bad read is corrected, and appending would double every block. Each block is
 * matched to its room (media number, laboratory number, then name — `labResultFor`);
 * a block no room claims becomes a room of its own, named as the laboratory named it
 * and recognised as the outdoor control by that name. The sheet's number and dates
 * fill §1 only where it is still blank — anything typed is a decision and wins.
 */
export function applyLabScan(
  report: MoldReport,
  results: LabResult[],
  details?: Partial<LabSheetHeader>,
): { report: MoldReport; added: number; stray: LabResult[] } {
  const merged = { ...report, labResults: results };
  const updated = report.samples.map((sample) => sampleWithLabResult(sample, labResultFor(merged, sample)));

  const claimed = new Set(updated.map((sample) => labResultFor(merged, sample)).filter(Boolean));
  const added = results
    .filter((result) => !claimed.has(result))
    .map((result) => {
      const name = result.sampleName.trim();
      return sampleWithLabResult(
        {
          ...newSampleRow(),
          location: name,
          scope: isOutdoorLocation(name) ? ('חוץ' as const) : ('פנים' as const),
        },
        result,
      );
    });

  const samples = [...updated, ...added];
  const fill = (current: string, value?: string) => (current.trim() || !value ? current : value);

  return {
    report: {
      ...merged,
      samples,
      labReportNumber: fill(report.labReportNumber, details?.labReportNumber),
      labReceivedDate: fill(report.labReceivedDate, details?.labReceivedDate),
      labReportedDate: fill(report.labReportedDate, details?.labReportedDate),
      // The sheet's "Collected" date is the day of the visit.
      surveyDateTime: fill(report.surveyDateTime, details?.labCollectedDate),
    },
    added: added.length,
    stray: unmatchedLabResults({ labResults: results, samples }),
  };
}
