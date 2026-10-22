import assert from 'node:assert/strict';
import { describeMeasurementProfile, newRfRow, newRfRows, withSlowScan } from '../src/lib/measurement-rules';

const original = newRfRows();
original[2].measured = '0.5';
original[3].distance = '10';
const description = withSlowScan('ליד ארון התקשורת');
const filled = describeMeasurementProfile(original, 0, description);
assert.equal(filled.length, 5);
assert.ok(filled.every(row => row.description === description));
assert.equal(filled[2].measured, '0.5');
assert.equal(filled[3].distance, '10');
assert.ok(original.every(row => row.description === ''), 'Do not mutate the saved input');

const renamed = describeMeasurementProfile(filled, 2, 'נקודה חדשה');
assert.ok(renamed.every(row => row.description === 'נקודה חדשה'));

const extra = [...filled, newRfRow('')];
const single = describeMeasurementProfile(extra, 5, 'שורה בודדת');
assert.deepEqual(single.slice(0, 5), filled, 'An extra single row must not rename the profile');
assert.equal(single[5].description, 'שורה בודדת');

const mixed = newRfRows().map((row, i) => ({ ...row, description: 'נקודה ' + i, measured: String(i) }));
const edited = describeMeasurementProfile(mixed, 1, 'תיקון');
assert.equal(edited[1].description, 'תיקון');
for (const i of [0, 2, 3, 4]) assert.deepEqual(edited[i], mixed[i], 'Keep distinct existing points');

const second = describeMeasurementProfile([...filled, ...newRfRows()], 5, 'מקור נוסף');
assert.deepEqual(second.slice(0, 5), filled);
assert.ok(second.slice(5).every(row => row.description === 'מקור נוסף'));
console.log('Measurement profile regression checks passed.');
