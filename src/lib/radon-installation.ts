import { z } from 'zod';

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
  /** ISO date; it prints as the placement date of every detector in the report. */
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

/** "2026-05-06" as the report's table prints it, "06/05/26". */
export function placementDate(iso: string): string {
  const match = /^\d{2}(\d{2})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
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
