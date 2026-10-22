/**
 * Antenna data service — fetches active & under-construction cellular antenna
 * sites from the Ministry of Environmental Protection's open-data catalogue
 * (data.gov.il) and returns grouped, distance-sorted results around a point.
 *
 * The full table (~8,500 active + ~300 under-construction) is fetched once and
 * cached in memory for 6 hours (updated quarterly by the ministry).
 */

import { itmDistance, itmToWgs84 } from "./itm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single antenna record from the ministry's dataset. */
export interface AntennaRecord {
  id: number;
  company: string;
  siteNumber: string;
  city: string;
  address: string;
  municipality: string;
  jurisdiction: string;
  x: number;                       // ITM easting
  y: number;                       // ITM northing
  siteType: string;
  constructionPermitDate: string;
  operationPermitDate: string;
  lastPeriodicInspection: string;
  radiationPermit: string;
  maxTheoreticalPower: number;     // µW/cm²
  maxHealthThresholdPct: number;   // % of health threshold
  maxMeasurementDescription: string;
  constructionPdfUrl: string;
  operationPdfUrl: string;
  technology: string;              // e.g. "דור 3 4 5"
  status: "active" | "planned";
  /** Only on planned antennas. */
  permitType?: string;
  applicationDate?: string;
  referenceNumber?: number;
}

/** A group of co-located antenna transmitters (same physical site, multiple operators). */
export interface AntennaSiteGroup {
  /** 1-based display number, sorted by distance. */
  n: number;
  /** Average ITM easting of the group. */
  x: number;
  /** Average ITM northing of the group. */
  y: number;
  /** WGS84 latitude. */
  lat: number;
  /** WGS84 longitude. */
  lon: number;
  /** Distance in metres from the survey point. */
  dist: number;
  /** Primary address label. */
  address: string;
  city: string;
  /** Distinct operator names (cleaned). */
  operators: string[];
  /** Distinct cellular generations (sorted numbers). */
  generations: number[];
  /** Maximum % of health threshold across all transmitters in the group. */
  maxPct: number;
  /** Distinct site types. */
  types: string[];
  /** Individual antenna records in this group. */
  items: AntennaRecord[];
  /** "active" if any transmitter is active; "planned" if all are planned. */
  status: "active" | "planned";
}

export interface AntennaSearchResult {
  /** ITM coordinates of the survey point. */
  center: { x: number; y: number };
  /** WGS84 coordinates of the survey point. */
  centerWgs: { lat: number; lon: number };
  /** Search radius in metres. */
  radius: number;
  /** Grouped antenna sites, sorted by distance. */
  groups: AntennaSiteGroup[];
  /** Total individual transmitter records found. */
  totalRecords: number;
  /** Timestamp of the cached dataset. */
  dataFetchedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVE_RESOURCE_ID = "8935c8e5-ec77-421f-af86-d970583195f8";
const PLANNED_RESOURCE_ID = "ff398c7e-c522-4ee8-a53a-312b188a573d";
const DATA_GOV_BASE = "https://data.gov.il/api/3/action/datastore_search";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const GROUP_RADIUS_M = 40; // cluster antennas within this distance as one site

/** Initial coverage of the cellular-antenna appendix around the surveyed site. */
export const ANTENNA_REPORT_RADIUS_M = 500;
/** Used only when the initial search contains no active or planned sites. */
export const ANTENNA_REPORT_FALLBACK_RADIUS_M = 1000;

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let cachedRecords: AntennaRecord[] | null = null;
let cachedAt = 0;

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchAllRecords(resourceId: string, limit = 10_000): Promise<unknown[]> {
  const url = `${DATA_GOV_BASE}?resource_id=${resourceId}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "reporttt-antenna/1.0" },
  });
  if (!res.ok) throw new Error(`data.gov.il returned ${res.status}`);
  const body = await res.json() as { success: boolean; result: { records: unknown[] } };
  if (!body.success) throw new Error("data.gov.il returned success=false");
  return body.result.records;
}

function parseActive(raw: Record<string, unknown>): AntennaRecord {
  return {
    id: Number(raw["ID"]) || 0,
    company: String(raw["חברה"] ?? ""),
    siteNumber: String(raw["מס' אתר"] ?? ""),
    city: String(raw["עיר"] ?? ""),
    address: String(raw["כתובת האתר"] ?? ""),
    municipality: String(raw["רשות מקומית"] ?? ""),
    jurisdiction: String(raw["תחום שיפוט"] ?? ""),
    x: Number(raw["X_ITM"]) || 0,
    y: Number(raw["Y_ITM"]) || 0,
    siteType: String(raw["סוג אתר"] ?? ""),
    constructionPermitDate: String(raw["תאריך היתר הקמה"] ?? ""),
    operationPermitDate: String(raw["תאריך היתר הפעלה"] ?? ""),
    lastPeriodicInspection: String(raw["בדיקה תקופתית אחרונה"] ?? ""),
    radiationPermit: String(raw["היתר קרינה"] ?? ""),
    maxTheoreticalPower: Number(raw["עוצמה מרבית תיאורטית בµW לסמר"]) || 0,
    maxHealthThresholdPct: Number(raw["תוצאה מירבית ב% ביחס לסף הבריאות"]) || 0,
    maxMeasurementDescription: String(raw["תאור נקודה בה התקבלה תוצאה מירבית"] ?? ""),
    constructionPdfUrl: String(raw["קובץ הקמה"] ?? ""),
    operationPdfUrl: String(raw["קובץ הפעלה"] ?? ""),
    technology: String(raw["טכנולוגיית שידור"] ?? "").trim().replace(/\s+/g, " "),
    status: "active",
  };
}

function parsePlanned(raw: Record<string, unknown>): AntennaRecord {
  return {
    id: Number(raw["ID"]) || 0,
    company: String(raw["חברה"] ?? ""),
    siteNumber: String(raw["מספר האתר"] ?? ""),
    city: String(raw["ישוב"] ?? ""),
    address: String(raw["כתובת + תאור"] ?? ""),
    municipality: "",
    jurisdiction: String(raw["תחום שיפוט"] ?? ""),
    x: Number(raw["X_ITM"]) || 0,
    y: Number(raw["Y_ITM"]) || 0,
    siteType: String(raw["סוג המוקד"] ?? ""),
    constructionPermitDate: "",
    operationPermitDate: "",
    lastPeriodicInspection: "",
    radiationPermit: "",
    maxTheoreticalPower: 0,
    maxHealthThresholdPct: 0,
    maxMeasurementDescription: "",
    constructionPdfUrl: "",
    operationPdfUrl: "",
    technology: "",
    status: "planned",
    permitType: String(raw["סוג  היתר"] ?? ""),
    applicationDate: String(raw["תאריך הגשת הבקשה"] ?? "").slice(0, 10),
    referenceNumber: Number(raw["מס' סימוכין"]) || undefined,
  };
}

async function loadAllAntennas(): Promise<AntennaRecord[]> {
  if (cachedRecords && Date.now() - cachedAt < CACHE_TTL_MS) return cachedRecords;

  const [activeRaw, plannedRaw] = await Promise.all([
    fetchAllRecords(ACTIVE_RESOURCE_ID),
    fetchAllRecords(PLANNED_RESOURCE_ID),
  ]);

  const records = [
    ...activeRaw.map((r) => parseActive(r as Record<string, unknown>)),
    ...plannedRaw.map((r) => parsePlanned(r as Record<string, unknown>)),
  ].filter((r) => r.x > 0 && r.y > 0);

  cachedRecords = records;
  cachedAt = Date.now();
  console.log(`[antennas] loaded ${activeRaw.length} active + ${plannedRaw.length} planned = ${records.length} total`);
  return records;
}

// ---------------------------------------------------------------------------
// Clean operator name for display (remove parenthetical explanation)
// ---------------------------------------------------------------------------

function cleanOperator(name: string): string {
  return name.replace(/\s*\(.*\)/, "").trim();
}

// ---------------------------------------------------------------------------
// Main query
// ---------------------------------------------------------------------------

/**
 * Find all antenna sites within `radius` metres of the given ITM point,
 * group co-located transmitters, and return sorted by distance.
 */
export async function findNearbyAntennas(
  centerX: number,
  centerY: number,
  radius: number = ANTENNA_REPORT_RADIUS_M,
): Promise<AntennaSearchResult> {
  const all = await loadAllAntennas();

  // Filter by bounding box first (cheap), then exact distance.
  const near = all
    .map((r) => ({ ...r, _d: itmDistance(centerX, centerY, r.x, r.y) }))
    .filter((r) => r._d <= radius)
    .sort((a, b) => a._d - b._d);

  // Group co-located sites (within GROUP_RADIUS_M of each other).
  const groups: {
    x: number; y: number; d: number;
    address: string; city: string;
    items: (AntennaRecord & { _d: number })[];
  }[] = [];

  for (const rec of near) {
    let group = groups.find(
      (g) => itmDistance(g.x, g.y, rec.x, rec.y) <= GROUP_RADIUS_M,
    );
    if (!group) {
      group = { x: rec.x, y: rec.y, d: rec._d, address: rec.address, city: rec.city, items: [] };
      groups.push(group);
    }
    group.items.push(rec);
  }

  const centerWgs = itmToWgs84(centerX, centerY);

  const siteGroups: AntennaSiteGroup[] = groups.map((g, i) => {
    const wgs = itmToWgs84(g.x, g.y);
    const operators = [...new Set(g.items.map((it) => cleanOperator(it.company)))];
    const generations = [
      ...new Set(
        g.items.flatMap((it) =>
          it.technology
            .split(" ")
            .filter((t) => /^\d$/.test(t))
            .map(Number),
        ),
      ),
    ].sort();
    const maxPct = Math.max(...g.items.map((it) => it.maxHealthThresholdPct || 0));
    const hasActive = g.items.some((it) => it.status === "active");

    return {
      n: i + 1,
      x: g.x,
      y: g.y,
      lat: +wgs.lat.toFixed(6),
      lon: +wgs.lon.toFixed(6),
      dist: Math.round(g.d),
      address: g.address,
      city: g.city,
      operators,
      generations,
      maxPct: +maxPct.toFixed(2),
      types: [...new Set(g.items.map((it) => it.siteType))].filter(Boolean),
      items: g.items.map(({ _d, ...rest }) => rest),
      status: hasActive ? "active" as const : "planned" as const,
    };
  });

  return {
    center: { x: centerX, y: centerY },
    centerWgs: { lat: +centerWgs.lat.toFixed(6), lon: +centerWgs.lon.toFixed(6) },
    radius,
    groups: siteGroups,
    totalRecords: near.length,
    dataFetchedAt: new Date(cachedAt).toISOString(),
  };
}

/** Reports expand to 1 km only after a successful, empty 500 m search. */
export async function findReportAntennas(
  centerX: number,
  centerY: number,
): Promise<AntennaSearchResult> {
  const nearby = await findNearbyAntennas(centerX, centerY, ANTENNA_REPORT_RADIUS_M);
  if (nearby.groups.length > 0) return nearby;
  return findNearbyAntennas(centerX, centerY, ANTENNA_REPORT_FALLBACK_RADIUS_M);
}

// ---------------------------------------------------------------------------
// Geocode an address to ITM via Nominatim (OSM)
// ---------------------------------------------------------------------------

/**
 * Geocode a Hebrew address to ITM coordinates.
 * Tries the full address, then the address by itself, then the city by itself.
 * Callers must pass the surveyed property's city — never a recipient/billing city.
 */
export async function geocodeAddress(
  address: string,
  city: string,
): Promise<{ x: number; y: number; lat: number; lon: number; label: string } | null> {
  const { wgs84ToITM } = await import("./itm");

  const street = address.trim();
  const town = city.trim();
  const queries = [...new Set([
    street && town ? `${street}, ${town}` : '',
    street,
    town,
  ].filter(Boolean))];

  for (const q of queries) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "reporttt-antenna/1.0 (galitinc@gmail.com)" },
      });
      const results = await res.json() as { lat: string; lon: string; display_name: string }[];
      if (results.length > 0) {
        const lat = parseFloat(results[0].lat);
        const lon = parseFloat(results[0].lon);
        const itm = wgs84ToITM(lat, lon);
        return { x: itm.x, y: itm.y, lat, lon, label: results[0].display_name };
      }
    } catch {
      // try next query
    }
  }
  return null;
}
