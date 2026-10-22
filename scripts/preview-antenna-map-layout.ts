/** Local visual QA for the fixed antenna-map figure (no external map calls). */
import { readFile, writeFile } from 'node:fs/promises';
import PizZip from 'pizzip';
import puppeteer from 'puppeteer-core';
import {
  ANTENNA_MAP_PIXEL_SIZE,
  composeAntennaMapHtml,
  type AntennaBasemap,
} from '../src/lib/antenna-map-html.ts';
import type { AntennaSearchResult, AntennaSiteGroup } from '../src/lib/antennas.ts';

const ZOOM = 16;
function worldPx(lat: number, lon: number) {
  const n = 2 ** ZOOM * 256;
  const x = ((lon + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x, y };
}

const center = { lat: 32.807, lon: 34.987 };
const centerPx = worldPx(center.lat, center.lon);
const baseSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="678" viewBox="0 0 800 678">
  <rect width="800" height="678" fill="#edf0ec"/>
  <path d="M-40 575 L830 440" stroke="#f4d77d" stroke-width="24"/>
  <path d="M-20 130 L780 650 M100 -30 L700 700 M-30 350 L820 80 M260 -20 L330 700 M500 -20 L460 700" stroke="#fff" stroke-width="13" fill="none"/>
  <path d="M-20 130 L780 650 M100 -30 L700 700 M-30 350 L820 80 M260 -20 L330 700 M500 -20 L460 700" stroke="#d7ddd9" stroke-width="2" fill="none"/>
  <rect x="40" y="60" width="160" height="120" rx="18" fill="#cfe8c5"/><rect x="620" y="220" width="180" height="170" rx="18" fill="#cfe8c5"/>
  <g fill="#66746a" font-family="Arial" font-size="18"><text x="74" y="118">רמת אלון</text><text x="635" y="304">גן האם</text><text x="95" y="516">נווה שאנן</text><text x="560" y="120">רמת בגין</text></g>
</svg>`;
const basemap: AntennaBasemap = {
  dataUri: `data:image/svg+xml;base64,${Buffer.from(baseSvg).toString('base64')}`,
  ox: Math.round(centerPx.x - 400),
  oy: Math.round(centerPx.y - 339),
  mpp: (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / 2 ** ZOOM,
  zoom: ZOOM,
};

const sites = [
  { address: 'אבא חושי 99', operators: ['PHI', 'סלקום'], dist: 108, lat: 32.8063, lon: 34.9878 },
  { address: 'חנה חביבה 12', operators: ['סלקום'], dist: 136, lat: 32.8078, lon: 34.9881 },
  { address: 'אבא חושי 111', operators: ['פלאפון'], dist: 141, lat: 32.8058, lon: 34.9865 },
  { address: 'ליבריה 2', operators: ['פלאפון', 'PHI'], dist: 191, lat: 32.8084, lon: 34.9858 },
  { address: 'רח׳ מאיר יערי', operators: ['סלקום'], dist: 268, lat: 32.8075, lon: 34.9842 },
];
const groups: AntennaSiteGroup[] = sites.map((site, index) => ({
  n: index + 1,
  x: 0,
  y: 0,
  ...site,
  city: 'חיפה',
  generations: [4, 5],
  maxPct: 1,
  types: ['תורן'],
  items: [],
  status: 'active',
}));
const result: AntennaSearchResult = {
  center: { x: 0, y: 0 },
  centerWgs: center,
  radius: 500,
  groups,
  totalRecords: groups.length,
  dataFetchedAt: '2026-10-01T00:00:00.000Z',
};

const source = new PizZip(await readFile('templates/source/report-source.docx'));
const logoBytes = source.file('word/media/image42.png')?.asNodeBuffer();
const logo = logoBytes ? `data:image/png;base64,${logoBytes.toString('base64')}` : '';
const html = composeAntennaMapHtml(result, {
  pointLabel: 'בית ספר אליאנס',
  pointAddress: 'דרך בירם 37, חיפה',
  pointCity: 'חיפה',
}, basemap, logo);

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ ...ANTENNA_MAP_PIXEL_SIZE, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle0' as never, timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  const figure = await page.$('.figure');
  if (!figure) throw new Error('figure not found');
  const png = Buffer.from(await figure.screenshot({ type: 'png', captureBeyondViewport: false }));
  await writeFile('out/antenna-map-layout-preview.png', png);
  console.log(`out/antenna-map-layout-preview.png — ${png.length.toLocaleString('en-US')} bytes`);
} finally {
  await browser.close();
}
