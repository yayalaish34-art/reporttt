/**
 * Builds the fixed-size antenna figure embedded in radiation reports.
 *
 * The visual is intentionally a locked template: the basemap, surveyed-place
 * label and antenna names/numbers are the only report-specific content. Keeping
 * the outer canvas at exactly 1094x819 prevents a dense urban antenna list from
 * making the PNG several pages tall and then being shrunk to illegibility by Word.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import PizZip from "pizzip";
import sharp from "sharp";
import {
  ANTENNA_REPORT_RADIUS_M,
  type AntennaSearchResult,
  type AntennaSiteGroup,
} from "./antennas";

// ---------------------------------------------------------------------------
// Locked figure geometry — matches the supplied 1094x819 reference image.
// ---------------------------------------------------------------------------

export const ANTENNA_MAP_PIXEL_SIZE = { width: 1094, height: 819 } as const;

const MAP_WIDTH = 800;
const MAP_HEIGHT = 678;
// At Israeli latitudes zoom 16 shows roughly 1.6x1.35 km in this canvas,
// leaving the complete 500 m search radius inside the map with a clear margin.
const DEFAULT_ZOOM = 16;
const DATASET_UPDATE_LABEL = "01.10.2026";
const PANEL_FULL_DETAIL_LIMIT = 5;
const PANEL_COMPACT_LIMIT = 8;

// ---------------------------------------------------------------------------
// Tile math (Web Mercator EPSG:3857 -> pixel)
// ---------------------------------------------------------------------------

function worldPx(lat: number, lon: number, zoom: number) {
  const n = 2 ** zoom * 256;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x, y };
}

export interface AntennaBasemap {
  dataUri: string;
  ox: number;
  oy: number;
  mpp: number;
  zoom: number;
}

async function buildBasemapDataUri(
  centerLat: number,
  centerLon: number,
  mapW: number,
  mapH: number,
  radius: number,
): Promise<AntennaBasemap> {
  // Doubling the search radius zooms out one level while keeping the PNG size.
  const zoom = DEFAULT_ZOOM - Math.ceil(Math.log2(Math.max(1, radius / ANTENNA_REPORT_RADIUS_M)));
  const c = worldPx(centerLat, centerLon, zoom);
  const ox = Math.round(c.x - mapW / 2);
  const oy = Math.round(c.y - mapH / 2);

  const minTx = Math.floor(ox / 256);
  const maxTx = Math.floor((ox + mapW) / 256);
  const minTy = Math.floor(oy / 256);
  const maxTy = Math.floor((oy + mapH) / 256);

  const subs = ["a", "b", "c"];
  type Tile = { tx: number; ty: number; buf: Buffer };
  const tiles: Tile[] = [];

  let i = 0;
  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let ty = minTy; ty <= maxTy; ty++) {
      const url = `https://${subs[i % 3]}.tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
      const res = await fetch(url, {
        headers: { "User-Agent": "reporttt-antenna/1.0 (galitinc@gmail.com)" },
      });
      if (!res.ok) throw new Error(`Tile fetch failed: ${res.status} for ${tx}/${ty}`);
      tiles.push({ tx, ty, buf: Buffer.from(await res.arrayBuffer()) });
      i++;
    }
  }

  const canvasW = (maxTx - minTx + 1) * 256;
  const canvasH = (maxTy - minTy + 1) * 256;
  const base = sharp({
    create: { width: canvasW, height: canvasH, channels: 3, background: "#e8e8e8" },
  });
  const composites = tiles.map((tile) => ({
    input: tile.buf,
    left: (tile.tx - minTx) * 256,
    top: (tile.ty - minTy) * 256,
  }));

  const stitched = await base.composite(composites).png().toBuffer();
  const cropped = await sharp(stitched)
    .extract({
      left: ox - minTx * 256,
      top: oy - minTy * 256,
      width: mapW,
      height: mapH,
    })
    .modulate({ brightness: 1.06, saturation: 0.72 })
    .png()
    .toBuffer();

  return {
    dataUri: `data:image/png;base64,${cropped.toString("base64")}`,
    ox,
    oy,
    mpp: (156543.03392 * Math.cos((centerLat * Math.PI) / 180)) / 2 ** zoom,
    zoom,
  };
}

// ---------------------------------------------------------------------------
// Shared visual primitives
// ---------------------------------------------------------------------------

const ACTIVE_COLORS = [
  "#2f9139",
  "#e00000",
  "#f06400",
  "#8014a7",
  "#0873dd",
  "#089b98",
  "#d63384",
  "#6f42c1",
];
const PLANNED_COLOR = "#8e99a4";
const RING_DEFS = [
  { m: ANTENNA_REPORT_RADIUS_M, color: "#087cf0" },
  { m: 200, color: "#00a23c" },
  { m: 100, color: "#e00000" },
];

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function oneLine(value: string, max = 24): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

function siteColor(group: AntennaSiteGroup, activeIndex: number): string {
  return group.status === "planned"
    ? PLANNED_COLOR
    : ACTIVE_COLORS[activeIndex % ACTIVE_COLORS.length];
}

function antennaTowerSvg(x: number, y: number, color: string, number: number, dense: boolean): string {
  const scale = dense ? 0.78 : 1;
  const labelY = dense ? 24 : 31;
  const badgeY = dense ? -24 : -31;
  const badgeR = dense ? 10.5 : 13;
  return `
  <g transform="translate(${x} ${y}) scale(${scale})">
    <circle cx="0" cy="${badgeY}" r="${badgeR}" fill="${color}" stroke="#fff" stroke-width="2"/>
    <text x="0" y="${badgeY + 4.5}" class="marker-number" text-anchor="middle">${number}</text>
    <g class="tower-glyph" transform="translate(0 2)">
      <path d="M0,-15 L-10,20 M0,-15 L10,20 M-7,12 H7 M-4,3 H4 M-10,20 H10"/>
      <path d="M-7,-11 C-13,-6 -13,1 -8,6 M7,-11 C13,-6 13,1 8,6"/>
      <path d="M-11,-16 C-21,-8 -21,4 -13,12 M11,-16 C21,-8 21,4 13,12"/>
    </g>
    <text x="0" y="${labelY + 17}" class="marker-label" text-anchor="middle">${number}</text>
  </g>`;
}

function panelTowerSvg(): string {
  return `<svg class="panel-tower" viewBox="0 0 42 58" aria-hidden="true">
    <g fill="none" stroke="#111827" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 14 L10 51 M21 14 L32 51 M13 41 H29 M16 31 H26 M10 51 H32"/>
      <path d="M14 14 C8 19 8 28 14 33 M28 14 C34 19 34 28 28 33"/>
      <path d="M10 8 C0 17 0 30 9 38 M32 8 C42 17 42 30 33 38"/>
    </g>
  </svg>`;
}

function buildMapSvg(
  result: AntennaSearchResult,
  basemap: AntennaBasemap,
  centerLabel: string,
): string {
  const { dataUri, ox, oy, mpp, zoom } = basemap;
  const c = worldPx(result.centerWgs.lat, result.centerWgs.lon, zoom);
  const cx = +(c.x - ox).toFixed(1);
  const cy = +(c.y - oy).toFixed(1);
  const localPx = (lat: number, lon: number) => {
    const point = worldPx(lat, lon, zoom);
    return { x: +(point.x - ox).toFixed(1), y: +(point.y - oy).toFixed(1) };
  };

  let svg = `<svg class="map" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <image href="${dataUri}" x="0" y="0" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" preserveAspectRatio="none"/>
  <rect x="0" y="0" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" fill="#fff" opacity=".16"/>`;

  const rings = [
    { m: result.radius, color: "#087cf0" },
    ...RING_DEFS.filter((ring) => ring.m < result.radius),
  ];
  for (const ring of rings) {
    const r = +(ring.m / mpp).toFixed(1);
    svg += `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="4" opacity=".78"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ring.color}" stroke-width="2.2" stroke-dasharray="7 5"/>`;
  }
  for (const ring of rings) {
    const r = ring.m / mpp;
    svg += `
  <text x="${cx}" y="${+(cy - r + 16).toFixed(1)}" class="ring-label" fill="${ring.color}" text-anchor="middle">${ring.m} מ׳</text>`;
  }

  const dense = result.groups.length > 8;
  for (const group of result.groups) {
    const point = localPx(group.lat, group.lon);
    const mx = +(cx + (point.x - cx) * 0.55).toFixed(1);
    const my = +(cy + (point.y - cy) * 0.55).toFixed(1);
    svg += `
  <line x1="${cx}" y1="${cy}" x2="${point.x}" y2="${point.y}" class="connector"/>`;
    if (!dense || group.n <= PANEL_COMPACT_LIMIT - 1) {
      svg += `
  <text x="${mx}" y="${my}" class="distance-label" text-anchor="middle">כ-${group.dist} מ׳</text>`;
    }
  }

  let activeIndex = 0;
  for (const group of result.groups) {
    const point = localPx(group.lat, group.lon);
    const color = siteColor(group, activeIndex);
    if (group.status === "active") activeIndex++;
    const tower = antennaTowerSvg(point.x, point.y, color, group.n, dense);
    svg += tower.replace(
      `>${group.n}</text>\n  </g>`,
      `>${dense ? '' : esc(oneLine(group.address, 22))}</text>\n  </g>`,
    );
  }

  const labelWidth = Math.min(Math.max(centerLabel.length * 8.3 + 26, 106), 210);
  svg += `
  <g class="survey-marker" transform="translate(${cx} ${cy})">
    <circle r="25" fill="#fff" stroke="#0a4a89" stroke-width="3"/>
    <path d="M-15 17 V-6 H-7 V17 M-7 17 V-13 H7 V17 M7 17 V-3 H15 V17 M-18 17 H18 M-12 1 H-9 M-12 7 H-9 M-3-7 H1 M-3 0 H1 M-3 7 H1 M10 3 H13 M10 9 H13" fill="none" stroke="#0a4a89" stroke-width="3" stroke-linejoin="round"/>
    <g transform="translate(0 43)">
      <rect x="${-labelWidth / 2}" y="-15" width="${labelWidth}" height="29" rx="6" fill="#fff" stroke="#0a4a89" stroke-width="1.5"/>
      <text x="0" y="5" class="center-label" text-anchor="middle">${esc(oneLine(centerLabel, 29))}</text>
    </g>
  </g>`;

  svg += `
  <g class="north" transform="translate(31 43)">
    <path d="M0,-24 L9,6 L0,-1 L-9,6 Z" fill="#111" stroke="#fff" stroke-width="1"/>
    <path d="M0,-1 L0,20" stroke="#111" stroke-width="2"/>
    <text x="0" y="37" text-anchor="middle">N</text>
  </g>`;

  const scaleM = result.radius;
  const scalePx = +(scaleM / mpp).toFixed(0);
  const quarter = scalePx / 4;
  const quarterM = Math.round(scaleM / 4);
  svg += `
  <g class="scale" transform="translate(20 ${MAP_HEIGHT - 22})">
    <rect x="-8" y="-26" width="${scalePx + 16}" height="31" rx="3" fill="#fff" opacity=".9"/>
    <rect x="0" y="-2" width="${scalePx}" height="7" fill="#fff" stroke="#111" stroke-width="1"/>
    <rect x="0" y="-2" width="${quarter}" height="7" fill="#111"/>
    <rect x="${quarter * 2}" y="-2" width="${quarter}" height="7" fill="#111"/>
    <text x="0" y="-8" text-anchor="start">0</text>
    <text x="${quarter}" y="-8" text-anchor="middle">${quarterM}</text>
    <text x="${quarter * 2}" y="-8" text-anchor="middle">${quarterM * 2}</text>
    <text x="${scalePx}" y="-8" text-anchor="end">${scaleM} מטר</text>
  </g>`;

  return `${svg}\n</svg>`;
}

// ---------------------------------------------------------------------------
// Fixed-height antenna details panel
// ---------------------------------------------------------------------------

function buildPanel(groups: AntennaSiteGroup[]): { html: string; className: string } {
  const compact = groups.length > PANEL_FULL_DETAIL_LIMIT;
  const shown = groups.length <= PANEL_COMPACT_LIMIT
    ? groups
    : groups.slice(0, PANEL_COMPACT_LIMIT - 1);
  const omitted = groups.length - shown.length;

  let activeIndex = 0;
  let html = "";
  for (const group of shown) {
    const color = siteColor(group, activeIndex);
    if (group.status === "active") activeIndex++;
    const operators = group.operators.length > 0 ? group.operators.join(" + ") : "אתר סלולרי";
    const name = `${group.address}${group.status === "planned" ? " (בהקמה)" : ""}`;

    html += `
      <li class="site">
        <span class="badge" style="background:${color}">${group.n}</span>
        ${panelTowerSvg()}
        <div class="site-body">
          <div class="site-name">${esc(oneLine(name, compact ? 25 : 31))}</div>
          <div class="site-operator">${esc(oneLine(operators, compact ? 24 : 30))}</div>
          <div class="site-distance">כ-${group.dist} מ׳</div>
        </div>
      </li>`;
  }

  if (omitted > 0) {
    html += `
      <li class="site site-more">
        <span class="badge more-badge">+</span>
        <div class="site-body">
          <div class="site-name">${omitted} אתרים נוספים</div>
          <div class="site-operator">ממוספרים במפה</div>
          <div class="site-distance">פירוט מלא בטבלה הבאה</div>
        </div>
      </li>`;
  }

  const rows = shown.length + (omitted > 0 ? 1 : 0);
  return {
    html,
    className: `${compact ? "compact" : "full"} rows-${Math.max(1, rows)}`,
  };
}

// ---------------------------------------------------------------------------
// Galit environmental logo from the signed source report
// ---------------------------------------------------------------------------

let logoCache: string | null | undefined;

async function galitLogoDataUri(): Promise<string> {
  if (logoCache !== undefined) return logoCache ?? "";

  const candidates = [
    { path: resolve("templates/source/report-source.docx"), media: "word/media/image42.png" },
    { path: resolve("templates/report-template.docx"), media: "word/media/image11.png" },
  ];
  for (const candidate of candidates) {
    try {
      const zip = new PizZip(await readFile(candidate.path));
      const file = zip.file(candidate.media);
      if (file) {
        logoCache = `data:image/png;base64,${file.asNodeBuffer().toString("base64")}`;
        return logoCache;
      }
    } catch {
      // The visual remains valid without the optional corner logo.
    }
  }

  logoCache = null;
  return "";
}

// ---------------------------------------------------------------------------
// Full fixed-size HTML document
// ---------------------------------------------------------------------------

export interface AntennaMapOptions {
  /** Name shown in the title and on the surveyed-point marker. */
  pointLabel: string;
  /** Full surveyed-site address. */
  pointAddress: string;
  /** Surveyed-site city; falls back to the nearest antenna's city. */
  pointCity?: string;
  /** Kept for backward compatibility; the locked reference does not print it. */
  pointClassification?: string;
}

function subtitle(label: string, address: string): string {
  const cleanLabel = label.trim();
  const cleanAddress = address.trim();
  if (!cleanAddress || cleanAddress === cleanLabel) return cleanLabel;
  if (cleanAddress.startsWith(`${cleanLabel},`) || cleanAddress.startsWith(`${cleanLabel} –`)) {
    return cleanAddress;
  }
  return `${cleanLabel}, ${cleanAddress}`;
}

/** Pure composer used by the renderer and by the no-network layout smoke test. */
export function composeAntennaMapHtml(
  result: AntennaSearchResult,
  opts: AntennaMapOptions,
  basemap: AntennaBasemap,
  logoDataUri = "",
): string {
  const city = (opts.pointCity || result.groups.find((group) => group.city)?.city || "").trim();
  const titlePlace = city && !opts.pointLabel.includes(city)
    ? `${opts.pointLabel} – ${city}`
    : opts.pointLabel;
  const mapSvg = buildMapSvg(result, basemap, opts.pointLabel);
  const panel = buildPanel(result.groups);
  const logo = logoDataUri
    ? `<img class="galit-logo" src="${logoDataUri}" alt="גלית — החברה לאיכות הסביבה"/>`
    : "";

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>מפת אנטנות — ${esc(opts.pointLabel)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800&family=Assistant:wght@400;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${ANTENNA_MAP_PIXEL_SIZE.width}px;height:${ANTENNA_MAP_PIXEL_SIZE.height}px;overflow:hidden;background:#fff}
body{font-family:'Assistant','Arial Hebrew','Segoe UI',Arial,sans-serif;color:#142332;direction:rtl}
.figure{width:${ANTENNA_MAP_PIXEL_SIZE.width}px;height:${ANTENNA_MAP_PIXEL_SIZE.height}px;padding:3px 4px 6px;display:grid;grid-template-rows:80px 678px 34px;gap:9px;background:#fff;overflow:hidden}
.fig-head{height:80px;border-radius:14px;background:linear-gradient(120deg,#0b2f4e 0%,#154f78 100%);color:#fff;text-align:center;padding:8px 22px 7px;overflow:hidden}
.fig-head h2{font-family:'Heebo',sans-serif;font-size:30px;line-height:39px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fig-head .sub{font-family:'Heebo',sans-serif;font-size:18px;line-height:25px;font-weight:400;opacity:.95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fig-body{direction:ltr;display:grid;grid-template-columns:800px 276px;gap:10px;width:1086px;height:678px}
.map-shell{width:800px;height:678px;border:1.5px solid #3d91c7;border-radius:12px;overflow:hidden;background:#eef2f2}
.map{display:block;width:800px;height:678px}
.ring-label{font:800 18px 'Assistant',sans-serif;paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}
.connector{stroke:#202933;stroke-width:1.25;stroke-dasharray:4 4;opacity:.75}
.distance-label{font:700 15px 'Assistant',sans-serif;fill:#17222d;paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}
.marker-number{font:800 16px 'Assistant',sans-serif;fill:#fff}
.tower-glyph{fill:none;stroke:#111827;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke;filter:drop-shadow(0 1px 0 #fff)}
.marker-label{font:700 14px 'Assistant',sans-serif;fill:#24313d;paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}
.center-label{font:800 15px 'Heebo',sans-serif;fill:#0a4a89}
.north text{font:800 17px 'Assistant',sans-serif;fill:#111}
.scale text{font:700 13px 'Assistant',sans-serif;fill:#111}
.panel{direction:rtl;width:276px;height:678px;border:1.5px solid #3d91c7;border-radius:12px;overflow:hidden;background:#fff;position:relative}
.panel-head{height:52px;display:grid;place-items:center;background:linear-gradient(120deg,#174f78,#0c3557);color:#fff;font:800 22px/1 'Heebo',sans-serif}
.sites{direction:ltr;list-style:none;height:623px;display:grid;position:relative}
.sites.rows-1{grid-template-rows:1fr}.sites.rows-2{grid-template-rows:repeat(2,1fr)}.sites.rows-3{grid-template-rows:repeat(3,1fr)}.sites.rows-4{grid-template-rows:repeat(4,1fr)}.sites.rows-5{grid-template-rows:repeat(5,1fr)}.sites.rows-6{grid-template-rows:repeat(6,1fr)}.sites.rows-7{grid-template-rows:repeat(7,1fr)}.sites.rows-8{grid-template-rows:repeat(8,1fr)}
.site{min-height:0;display:grid;grid-template-columns:38px 43px minmax(0,1fr);gap:5px;align-items:start;padding:11px 8px 7px;border-bottom:1px solid #cfe0eb;overflow:hidden;background:#fff}
.site:last-child{border-bottom:0}
.badge{width:35px;height:35px;margin-top:1px;border-radius:50%;display:grid;place-items:center;color:#fff;font:800 21px/1 'Assistant',sans-serif;border:2px solid #fff;box-shadow:0 0 0 1px rgba(16,74,116,.08)}
.panel-tower{width:41px;height:55px}
.site-body{direction:rtl;min-width:0;text-align:right;padding-top:1px;overflow:hidden}
.site-name{font:800 16px/1.34 'Heebo',sans-serif;color:#142332;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.site-operator{font:600 14px/1.35 'Assistant',sans-serif;color:#344b60;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.site-distance{font:600 14px/1.35 'Assistant',sans-serif;color:#344b60;white-space:nowrap}
.sites.compact .site{grid-template-columns:30px 32px minmax(0,1fr);gap:3px;padding:5px 6px 3px}
.sites.compact .badge{width:28px;height:28px;font-size:16px}
.sites.compact .panel-tower{width:30px;height:40px}
.sites.compact .site-name{font-size:13px;line-height:1.24}
.sites.compact .site-operator,.sites.compact .site-distance{font-size:11.5px;line-height:1.2}
.site-more{grid-template-columns:38px minmax(0,1fr);align-items:center;padding-inline:12px}
.more-badge{background:#164c72!important}
.galit-logo{position:absolute;z-index:3;right:8px;bottom:4px;width:82px;height:79px;object-fit:contain;background:#fff;border-radius:50%;mix-blend-mode:multiply}
.sites.compact~.galit-logo{width:64px;height:62px;right:4px;bottom:2px;opacity:.92}
.fig-foot{height:34px;border-radius:10px;background:#e3ecf8;color:#526579;display:grid;place-items:center;padding:0 15px;text-align:center;font:600 13px/1.2 'Assistant',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fig-foot strong{color:#243d58;font-weight:800}
</style>
</head>
<body>
<div class="figure">
  <header class="fig-head">
    <h2>מפת אנטנות סלולריות ליד ${esc(titlePlace)}</h2>
    <div class="sub">${esc(subtitle(opts.pointLabel, opts.pointAddress))}</div>
  </header>
  <main class="fig-body">
    <div class="map-shell">${mapSvg}</div>
    <aside class="panel">
      <div class="panel-head">פירוט אתרי האנטנות</div>
      <ul class="sites ${panel.className}">${panel.html}</ul>
      ${logo}
    </aside>
  </main>
  <footer class="fig-foot"><span><strong>מקור:</strong> מאגר האנטנות הסלולריות הפעילות של המשרד להגנת הסביבה, עדכון ${DATASET_UPDATE_LABEL}. המרחקים מוצגים בקירוב ובקו אווירי.</span></footer>
</div>
</body>
</html>`;
}

export async function generateAntennaMapHtml(
  result: AntennaSearchResult,
  opts: AntennaMapOptions,
): Promise<string> {
  const [basemap, logo] = await Promise.all([
    buildBasemapDataUri(result.centerWgs.lat, result.centerWgs.lon, MAP_WIDTH, MAP_HEIGHT, result.radius),
    galitLogoDataUri(),
  ]);
  return composeAntennaMapHtml(result, opts, basemap, logo);
}
