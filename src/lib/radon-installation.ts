import { z } from 'zod';
import { TEST_LENGTHS } from './radon-schema';

/**
 * A detector installation: which customer, and which detector went where.
 *
 * The first half of a radon survey. The detectors go up on one day and the laboratory
 * answers months later, so what is known on the day — the room, the floor, the number on
 * the barcode — is recorded here and carried into the report when it is drafted.
 */

const text = z.string().trim();

export const FLOOR_MIN = -20;
export const FLOOR_MAX = 20;

const floor = z.number().int().min(FLOOR_MIN).max(FLOOR_MAX).default(0);

/** A room holds one detector. */
export const InstalledRoomSchema = z.object({
  kind: z.literal('room'),
  description: text.default(''),
  floor,
  detectorNumber: text.default(''),
});

/** One position in a hall, with its own detector. */
export const HallRowSchema = z.object({
  position: text.default(''),
  detectorNumber: text.default(''),
});

/** A hall is too large for one reading, so it holds a row per position. */
export const InstalledHallSchema = z.object({
  kind: z.literal('hall'),
  name: text.default(''),
  floor,
  rows: z.array(HallRowSchema).default([]),
});

export const InstallationSchema = z.object({
  customerType: z.enum(['company', 'private']).default('company'),
  customerId: text.default(''),
  recipientName: text.default(''),
  companyName: text.default(''),
  addressLine: text.default(''),
  city: text.default(''),
  phone: text.default(''),
  email: text.default(''),
  /** Decides how long the detectors stay up, and how the report judges them. */
  testLength: z.enum(TEST_LENGTHS).default('ארוכה'),
  /**
   * When the detectors went up: "2026-05-06", or "2026-05-06T10:30" for a short test,
   * whose 72 hours are counted from the hour. Israel time, as typed.
   */
  installedOn: text.default(''),
  spaces: z.array(z.discriminatedUnion('kind', [InstalledRoomSchema, InstalledHallSchema])).default([]),
});

export type InstalledRoom = z.infer<typeof InstalledRoomSchema>;
export type InstalledHall = z.infer<typeof InstalledHallSchema>;
export type InstalledSpace = InstalledRoom | InstalledHall;
export type Installation = z.infer<typeof InstallationSchema>;

export const ROOM_DESCRIPTIONS = [
  'סלון',
  'מטבח',
  'פינת אוכל',
  'חדר שינה',
  'חדר שינה הורים',
  'חדר ילדים',
  'חדר עבודה',
  'ממ"ד',
  'מרתף',
  'מקלט',
  'מחסן',
  'משרד',
  'חדר ישיבות',
  'כיתה',
  'לובי',
  'חדר שרתים',
] as const;

export const HALL_POSITIONS = [
  'מרכז האולם',
  'כניסה מזרחית',
  'כניסה מערבית',
  'כניסה צפונית',
  'כניסה דרומית',
  'קיר מזרחי',
  'קיר מערבי',
  'קיר צפוני',
  'קיר דרומי',
  'פינה צפון-מזרחית',
  'פינה צפון-מערבית',
  'פינה דרום-מזרחית',
  'פינה דרום-מערבית',
  'ליד הבמה',
  'ליד היציאה',
] as const;

/** A floor as the report's table prints it: "צמוד קרקע", "3", or "1-" below ground. */
export function floorLabel(value: number): string {
  if (value === 0) return 'צמוד קרקע';
  return value < 0 ? `${Math.abs(value)}-` : String(value);
}

/** A floor as a heading says it. */
export function floorTitle(value: number): string {
  return value === 0 ? 'צמוד קרקע' : `קומה ${floorLabel(value)}`;
}

/** How long a long test stays up, in days. */
export const LONG_TEST_DAYS = 90;

/** How long a short test stays up, in hours. */
export const SHORT_TEST_HOURS = 72;

/** "2026-05-06" as the report's table prints it, "06/05/26", with the hour when there is one. */
export function placementDate(iso: string): string {
  const match = /^\d{2}(\d{2})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(iso);
  if (!match) return '';
  const date = `${match[3]}/${match[2]}/${match[1]}`;
  return match[4] ? `${date} ${match[4]}` : date;
}

const ISRAEL = 'Asia/Jerusalem';

/** A moment as Israel's wall clock reads it, "2026-05-06T10:30". */
function israelWallClock(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** The moment Israel's wall clock reads this, or null for a value that is not one. */
function fromIsraelWallClock(wall: string): Date | null {
  const asUtc = new Date(`${wall}:00Z`);
  if (Number.isNaN(asUtc.getTime())) return null;
  const shown = new Date(`${israelWallClock(asUtc)}:00Z`);
  return new Date(asUtc.getTime() - (shown.getTime() - asUtc.getTime()));
}

/** Now in Israel. Named by zone because the server runs in UTC and the browser may not be here. */
export function israelNow(): string {
  return israelWallClock(new Date());
}

/**
 * When the test ends: 90 days on for a long test, 72 hours on for a short one.
 *
 * The short one is counted in elapsed hours, so a test running across a clock change
 * still lasts 72 hours and ends an hour off the hour it started at.
 */
export function installationEnd(testLength: string, start: string): string {
  // Checked first: given an empty date, the engine's lenient parser invents a year.
  if (!/^\d{4}-\d{2}-\d{2}/.test(start)) return '';
  if (testLength === 'קצרה') {
    const at = fromIsraelWallClock(start.length === 10 ? `${start}T00:00` : start.slice(0, 16));
    return at ? israelWallClock(new Date(at.getTime() + SHORT_TEST_HOURS * 3_600_000)) : '';
  }
  const day = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return '';
  return new Date(day.getTime() + LONG_TEST_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** A printed date back to a moment: "04/08/26", or "04/08/26 10:30" for a short test. */
export function printedDateToMoment(printed: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})(?: (\d{2}:\d{2}))?$/.exec(printed.trim());
  if (!match) return null;
  return fromIsraelWallClock(`20${match[3]}-${match[2]}-${match[1]}T${match[4] ?? '00:00'}`);
}

/**
 * How far a detector's test has run, from its printed dates.
 *
 * In hours where the dates carry an hour, since a short test is measured in them.
 * Empty for a detector with no dates, which was scanned on without an installation.
 */
export function testProgress(placedAt: string, collectedAt: string, now = new Date()): string {
  const end = printedDateToMoment(collectedAt);
  if (!end) return '';
  const start = printedDateToMoment(placedAt);
  if (start && now < start) return 'טרם התחיל';

  const left = end.getTime() - now.getTime();
  if (left <= 0) return 'הסתיים';
  if (collectedAt.includes(':')) {
    const hours = Math.ceil(left / 3_600_000);
    return hours === 1 ? 'נותרה שעה' : `נותרו ${hours} שעות`;
  }
  const days = Math.ceil(left / 86_400_000);
  return days === 1 ? 'נותר יום אחד' : `נותרו ${days} ימים`;
}

export interface InstalledSpot {
  detectorNumber: string;
  /** The room name the report prints for this detector. */
  roomName: string;
  floor: string;
}

/** Every place a detector can go, in the order the surveyor added them. */
export function installationSpots(installation: Pick<Installation, 'spaces'>): InstalledSpot[] {
  return installation.spaces.flatMap((space): InstalledSpot[] => {
    if (space.kind === 'room') {
      return [
        { detectorNumber: space.detectorNumber, roomName: space.description, floor: floorLabel(space.floor) },
      ];
    }
    const hall = space.name || 'אולם';
    return space.rows.map((row) => ({
      detectorNumber: row.detectorNumber,
      roomName: row.position ? `${hall} — ${row.position}` : hall,
      floor: floorLabel(space.floor),
    }));
  });
}
