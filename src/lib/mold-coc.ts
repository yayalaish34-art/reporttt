import type { MoldReport, MoldSample } from './mold-schema';
import { isOutdoorSample } from './mold-rules';

/**
 * Hayes' Chain of Custody (Form #20), worked out from the report.
 *
 * The form travels with the samples to the laboratory, and every value on it is
 * something the report already knows: who sampled, on which day, and the rooms with
 * their media numbers. So it is produced rather than typed — the `coc` fields on the
 * report only override what is derived here, and an empty one falls back.
 *
 * Pure and browser-safe: the editor shows the same rows the PDF prints, and fills the
 * media numbers it is about to print back into the rooms — see `withCocNumbers`.
 */

/** Rows the printed form has room for; a longer survey continues on another page. */
export const COC_ROWS_PER_PAGE = 16;

/** The two people who sample for Galit, as Hayes knows them. */
const STAFF_EN: Record<string, { name: string; mobile: string; email: string }> = {
  'אביחי מוכתר': { name: 'Avihay Mukhtar', mobile: '+972-54-4274143', email: 'avihay@galit.co.il' },
  'יורם גבאי': { name: 'Yoram Gabay', mobile: '', email: 'yoram@galit.co.il' },
};

/** Galit's own block at the top of the form — the same on every job. */
export const COC_COMPANY = {
  name: 'Galit Environment Company',
  address: ['11 Ostrovski street', 'PO Box 425, Ra’anana, Israel 4310302'],
};

/**
 * The rooms Hayes will read back, in English.
 *
 * The laboratory's sheet prints the "Sample" column as written, and the report
 * matches it back to the room — so a name in English is one the laboratory copies
 * correctly. A room not listed keeps the surveyor's own wording.
 */
const ROOM_NAMES_EN: Record<string, string> = {
  'סלון': 'Living room',
  'חדר שינה': 'Bedroom',
  'חדר שינה הורים': 'Master bedroom',
  'חדר ילדים': "Children's room",
  'חדר אמבטיה': 'Bathroom',
  'שירותים': 'Toilet',
  'מטבח': 'Kitchen',
  'מסדרון': 'Hallway',
  'ממ״ד': 'Safe room',
  'ממ"ד': 'Safe room',
  'מרתף': 'Basement',
  'משרד': 'Office',
  'חדר עבודה': 'Study',
  'מחסן': 'Storage room',
  'חוץ': 'Outdoors',
};

export function englishRoomName(sample: Pick<MoldSample, 'location' | 'scope'>): string {
  const name = sample.location.trim();
  if (ROOM_NAMES_EN[name]) return ROOM_NAMES_EN[name];
  if (!name && isOutdoorSample(sample)) return 'Outdoors';
  return name;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2023-02-13" → "February 13, 2023"; anything unparseable prints as typed. */
export function longDate(iso: string): string {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso.trim();
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** "2023-02-13" → "Feb. 13, 2023" — the form's "Released by" date. */
export function shortDate(iso: string): string {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso.trim();
  const month = MONTHS[Number(m[2]) - 1];
  const short = month.length <= 4 ? month : `${month.slice(0, 3)}.`;
  return `${short} ${Number(m[3])}, ${m[1]}`;
}

/** Today as an ISO date, in Israel — the day the form is filled in is the day of sampling. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

/** "13.02.2023" (or with slashes) → "2023-02-13"; '' when it is not such a date. */
export function isoFromNumeric(value: string): string {
  const m = value.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

/** "2023-02-13" → "13.02.2023", the way the report prints a date. */
export function numericFromIso(iso: string): string {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

/** Today as the report prints it — "13.02.2023". */
export function todayNumeric(): string {
  return numericFromIso(todayIso());
}

export interface CocRow {
  /** The row's position on the form, 1-based. */
  index: number;
  number: string;
  sample: string;
  analysis: string;
  volume: string;
  notes: string;
}

export interface ChainOfCustodyForm {
  jobNumber: string;
  jobName: string;
  collector: string;
  mobile: string;
  email: string;
  dateCollected: string;
  note: string;
  releasedBy: string;
  releasedDate: string;
  rows: CocRow[];
}

/**
 * The sample number the form prints for a room — "<job number>-<media number>",
 * e.g. "817-20546".
 *
 * A room without a media number falls back to its row: "817-3". A media number already
 * written with the job in front is not prefixed twice.
 */
export function cocNumber(report: Pick<MoldReport, 'coc'>, sample: MoldSample, index: number): string {
  const job = report.coc.jobNumber.trim();
  const media = sample.mediaNumber.trim();
  if (!job) return media;
  if (!media) return `${job}-${index}`;
  return media.startsWith(`${job}-`) ? media : `${job}-${media}`;
}

/** The rooms that go on the form: every sample with a name or a number. */
export function cocSamples(report: Pick<MoldReport, 'samples'>): MoldSample[] {
  return report.samples.filter(
    (s) => s.location.trim() !== '' || s.mediaNumber.trim() !== '' || s.sampleNameEn.trim() !== '',
  );
}

/** The whole form, with every empty override replaced by what the report knows. */
export function chainOfCustody(report: MoldReport): ChainOfCustodyForm {
  const coc = report.coc;
  const staff = STAFF_EN[report.samplerName.trim()];
  const other = Object.entries(STAFF_EN).find(([name]) => name !== report.samplerName.trim())?.[1];
  // The form's date is the sampling date, unless the form says otherwise.
  const date = coc.dateCollected.trim() || isoFromNumeric(report.surveyDateTime) || todayIso();
  const collector = coc.collector.trim() || staff?.name || report.samplerName.trim();

  return {
    jobNumber: coc.jobNumber.trim(),
    jobName:
      coc.jobName.trim() ||
      report.clientName.trim() ||
      report.occupantName.trim() ||
      report.siteAddress.trim(),
    collector,
    mobile: coc.mobile.trim() || staff?.mobile || '',
    email: coc.email.trim() || staff?.email || '',
    dateCollected: longDate(date),
    note: coc.note.trim() || (staff && other ? `Email (2): ${other.email}` : ''),
    releasedBy: collector,
    releasedDate: shortDate(date),
    rows: cocSamples(report).map((sample, i) => ({
      index: i + 1,
      number: cocNumber(report, sample, i + 1),
      sample: sample.sampleNameEn.trim() || englishRoomName(sample),
      analysis: sample.analysis.trim() || 'S',
      volume: sample.volume.trim(),
      notes: sample.cocNote.trim(),
    })),
  };
}

/**
 * The report with the number each room is printed under recorded as its laboratory
 * number.
 *
 * Hayes reports every result under the number on the form ("817-20546"), and the
 * laboratory number is the first thing a result is matched to its room by — see
 * `labResultFor`. The media number itself is left as the surveyor typed it.
 */
export function withCocNumbers(report: MoldReport): MoldReport {
  const listed = cocSamples(report);
  return {
    ...report,
    samples: report.samples.map((sample) => {
      const i = listed.indexOf(sample);
      if (i < 0) return sample;
      const number = cocNumber(report, sample, i + 1);
      return number ? { ...sample, labNumber: number } : sample;
    }),
  };
}
