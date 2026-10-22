/**
 * Israeli Transverse Mercator (ITM, EPSG:2039) ↔ WGS84 (EPSG:4326) conversions.
 *
 * These are needed because the antenna database from the Ministry of Environmental
 * Protection uses ITM coordinates, while geocoding services return WGS84.
 * Distances between ITM points are in metres (Euclidean ≈ geodesic at this scale).
 */

const a = 6378137.0;                              // GRS80 semi-major axis
const f = 1 / 298.257222101;                      // GRS80 flattening
const e2 = f * (2 - f);                           // first eccentricity squared
const k0 = 1.0000067;                             // scale factor on central meridian
const lat0 = 31.734393611 * Math.PI / 180;        // origin latitude
const lon0 = 35.204516944 * Math.PI / 180;        // central meridian
const FE = 219529.584;                            // false easting
const FN = 626907.390;                            // false northing
const d2r = Math.PI / 180;
const r2d = 180 / Math.PI;
const ep2 = e2 / (1 - e2);                        // second eccentricity squared

function M(phi: number): number {
  return a * (
    (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi)
  );
}

/** WGS84 (lat/lon in degrees) → ITM (x = Easting, y = Northing in metres). */
export function wgs84ToITM(latDeg: number, lonDeg: number): { x: number; y: number } {
  const phi = latDeg * d2r;
  const lam = lonDeg * d2r;
  const sinp = Math.sin(phi);
  const cosp = Math.cos(phi);
  const tanp = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sinp * sinp);
  const T = tanp * tanp;
  const C = ep2 * cosp * cosp;
  const A = (lam - lon0) * cosp;

  const x = k0 * N * (
    A
    + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120
  );
  const y = k0 * (
    M(phi) - M(lat0)
    + N * tanp * (
      A * A / 2
      + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720
    )
  );
  return { x: FE + x, y: FN + y };
}

/** ITM (Easting, Northing) → WGS84 (lat/lon in degrees). */
export function itmToWgs84(E: number, N_: number): { lat: number; lon: number } {
  const M1 = (N_ - FN) / k0 + M(lat0);
  const mu = M1 / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);

  const sinp1 = Math.sin(phi1);
  const cosp1 = Math.cos(phi1);
  const tanp1 = Math.tan(phi1);
  const C1 = ep2 * cosp1 * cosp1;
  const T1 = tanp1 * tanp1;
  const R1 = a * (1 - e2) / (1 - e2 * sinp1 * sinp1) ** 1.5;
  const N1 = a / Math.sqrt(1 - e2 * sinp1 * sinp1);
  const D = (E - FE) / (N1 * k0);

  const lat = phi1 - (N1 * tanp1 / R1) * (
    D * D / 2
    - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720
  );
  const lon = lon0 + (
    D
    - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120
  ) / cosp1;

  return { lat: lat * r2d, lon: lon * r2d };
}

/** Euclidean distance in metres between two ITM points (accurate for distances < ~50 km). */
export function itmDistance(
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}
