/** No-network check of report search, map coverage and DOCX captions at 500/1000 m. */
import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import sharp from 'sharp';
import { findReportAntennas } from '../src/lib/antennas';
import { generateAntennaMapHtml } from '../src/lib/antenna-map-html';
import { buildAntennaMapXml } from '../src/lib/docx/antenna-appendix';

const originalFetch = globalThis.fetch;
const active = [
  { ID: 1, X_ITM: 200500, Y_ITM: 700000 }, // Exactly 500 m: no expansion.
  { ID: 2, X_ITM: 200750, Y_ITM: 700000 }, // Excluded if anything is within 500 m.
  { ID: 3, X_ITM: 210501, Y_ITM: 700000 }, // Requires expansion.
  { ID: 4, X_ITM: 211000, Y_ITM: 700000 }, // Eastern edge of the expanded map.
  { ID: 5, X_ITM: 210000, Y_ITM: 701000 }, // Northern edge of the expanded map.
  { ID: 6, X_ITM: 211001, Y_ITM: 700000 }, // Outside 1 km.
  { ID: 7, X_ITM: 231001, Y_ITM: 700000 }, // Still empty after expansion.
];
const planned = [{ ID: 8, X_ITM: 220400, Y_ITM: 700000 }];
const tile = await sharp({
  create: { width: 256, height: 256, channels: 3, background: '#eef2f2' },
}).png().toBuffer();
let datasetFetches = 0;
let tileUrls: string[] = [];

try {
  globalThis.fetch = async () => { throw new Error('dataset unavailable'); };
  await assert.rejects(findReportAntennas(200000, 700000), /dataset unavailable/);

  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'data.gov.il') {
      datasetFetches++;
      const records = url.searchParams.get('resource_id') === '8935c8e5-ec77-421f-af86-d970583195f8'
        ? active : planned;
      return Response.json({ success: true, result: { records } });
    }
    if (url.hostname.endsWith('.tile.openstreetmap.org')) {
      tileUrls.push(url.href);
      return new Response(new Uint8Array(tile), { headers: { 'Content-Type': 'image/png' } });
    }
    throw new Error(`Unexpected network request: ${url.origin}`);
  };

  const nearby = await findReportAntennas(200000, 700000);
  assert.equal(nearby.radius, 500);
  assert.equal(nearby.totalRecords, 1);
  assert.equal(nearby.groups[0].dist, 500);

  const expanded = await findReportAntennas(210000, 700000);
  assert.equal(expanded.radius, 1000);
  assert.deepEqual(expanded.groups.map((g) => g.dist), [501, 1000, 1000]);
  assert.equal(expanded.totalRecords, 3);

  const plannedOnly = await findReportAntennas(220000, 700000);
  assert.equal(plannedOnly.radius, 500);
  assert.equal(plannedOnly.groups[0].status, 'planned');

  const empty = await findReportAntennas(230000, 700000);
  assert.equal(empty.radius, 1000);
  assert.equal(empty.groups.length, 0);
  assert.equal(empty.totalRecords, 0);
  assert.equal(datasetFetches, 2, 'Expanded searches reuse the active/planned datasets');
  console.log('PASS: 500 m preferred; empty searches expand to 1000 m; boundary, planned-only, empty and failure cases.');

  for (const result of [nearby, expanded, empty]) {
    tileUrls = [];
    const html = await generateAntennaMapHtml(result, {
      pointLabel: 'נקודת בדיקה',
      pointAddress: 'כתובת בדיקה',
    });
    const expectedZoom = result.radius === 500 ? 16 : 15;
    assert.ok(tileUrls.length > 0);
    assert.ok(tileUrls.every((url) => new URL(url).pathname.startsWith(`/${expectedZoom}/`)));
    assert.ok(html.includes(`>${result.radius} מ׳</text>`), 'Outer ring matches search radius');
    assert.ok(html.includes(`>${result.radius} מטר</text>`), 'Scale matches search radius');
    assert.ok(html.includes('.figure{width:1094px;height:819px'), 'Figure keeps its report dimensions');

    const outerRing = html.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="none"/);
    assert.ok(outerRing);
    const [, cx, cy, radius] = outerRing.map(Number);
    assert.ok(cx - radius > 0 && cx + radius < 800);
    assert.ok(cy - radius > 0 && cy + radius < 678, 'Entire search circle is inside the image');
    const endpoints = [...html.matchAll(/x2="(-?[\d.]+)" y2="(-?[\d.]+)" class="connector"/g)];
    assert.equal(endpoints.length, result.groups.length);
    for (const [, x, y] of endpoints) {
      assert.ok(Number(x) > 0 && Number(x) < 800 && Number(y) > 0 && Number(y) < 678,
        'Every antenna, including the 1000 m edge, stays visible');
    }

    const zip = new PizZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
    zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
    const xml = buildAntennaMapXml(zip, { mapPng: tile, searchResult: result });
    const radiusLabel = result.radius.toLocaleString('he-IL');
    assert.ok(xml.includes(`ברדיוס ${radiusLabel}`), 'DOCX caption matches the image');
    assert.ok(xml.includes(`מרחק עד ${radiusLabel}`), 'DOCX table matches the image');
    if (!result.groups.length) assert.ok(xml.includes('לא נמצאו אתרי אנטנות'));
  }
  console.log('PASS: 500/1000 m map tiles, visible edge markers, scale, rings and DOCX captions agree.');
} finally {
  globalThis.fetch = originalFetch;
}
