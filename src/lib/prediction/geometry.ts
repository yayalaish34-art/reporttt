export type Point = [number, number];

export type Calibration = { scale_m_per_px: number; origin_px: number[] };

/** Image y grows downward and world y grows upward, hence the flipped sign. */
export function toWorld(px: Point, floor: Calibration): Point {
  return [(px[0] - floor.origin_px[0]) * floor.scale_m_per_px, (floor.origin_px[1] - px[1]) * floor.scale_m_per_px];
}

export function toPixel(world: number[], floor: Calibration): Point {
  return [world[0] / floor.scale_m_per_px + floor.origin_px[0], floor.origin_px[1] - world[1] / floor.scale_m_per_px];
}

export function pointsAttr(points: Point[]): string {
  return points.map((p) => p.join(',')).join(' ');
}

/** The heatmap's bands come from the engine. They are for display and carry no status. */
export type Band = { label: string; min: number; max: number | null; color: string };

export function bandColor(value: number, bands: Band[]): string {
  const band = bands.find((b) => b.max === null || value < b.max);
  return band?.color ?? '#999';
}
