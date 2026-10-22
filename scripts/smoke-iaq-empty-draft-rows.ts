import assert from 'node:assert/strict';

import {
  describeIaqFindings,
  withoutEmptyIaqDraftRows,
} from '../src/lib/iaq-draft';
import { compactIaqDraftRequest } from '../src/lib/iaq-rules';
import { blankIaqReport, MEASUREMENT_KEYS, type IaqReport } from '../src/lib/iaq-schema';

const emptyMeasurements = () =>
  Object.fromEntries(MEASUREMENT_KEYS.map((key) => [key, null])) as IaqReport['results'][string];

const report: IaqReport = {
  ...blankIaqReport('test-empty-draft-rows'),
  locations: [
    { id: 'empty-with-object', name: '   ' },
    { id: 'empty-without-object', name: '' },
    { id: 'name-only', name: 'חדר ישיבות' },
    { id: 'measurement-only', name: '' },
    { id: 'zero-measurement', name: '' },
  ],
  results: {
    'empty-with-object': emptyMeasurements(),
    'name-only': emptyMeasurements(),
    'measurement-only': { ...emptyMeasurements(), co2: 740 },
    'zero-measurement': { ...emptyMeasurements(), no2: 0 },
  },
};

const filtered = withoutEmptyIaqDraftRows(report);
assert.deepEqual(
  filtered.locations.map(({ id }) => id),
  ['measurement-only', 'zero-measurement'],
  'Rows without a measurement should be removed from AI drafting',
);
assert.deepEqual(
  Object.keys(filtered.results),
  ['measurement-only', 'zero-measurement'],
  'Only measured rows should reach drafting',
);
assert.deepEqual(
  Object.keys(filtered.results['measurement-only']),
  ['co2'],
  'Blank measurement cells should be omitted rather than sent as null',
);
assert.deepEqual(
  filtered.results['zero-measurement'],
  { no2: 0 },
  'A numeric zero is a real measurement and must be retained',
);
assert.equal(report.locations.length, 5, 'Filtering must not mutate the editor report');

const requestJson = JSON.stringify(compactIaqDraftRequest(report));
assert.doesNotMatch(requestJson, /null/, 'The browser drafting request must contain no null cells');
assert.doesNotMatch(requestJson, /name-only|empty-with-object|empty-without-object/);
assert.doesNotMatch(requestJson, /"name":""/, 'Empty location names must be omitted');
assert.match(requestJson, /"no2":0/, 'Zero must remain in the browser drafting request');

const facts = describeIaqFindings(report);
assert.match(facts, /נבדקו 2 נקודות דיגום:/);
assert.doesNotMatch(facts, /חדר ישיבות/);
assert.doesNotMatch(facts, /empty-with-object|empty-without-object|name-only/);
assert.match(facts, /פחמן דו-חמצני \(CO₂\).*1 מדידות/);
assert.match(facts, /חנקן דו-חמצני \(NO₂\).*1 מדידות/);

console.log('✓ IAQ AI draft omits blank rows/cells and keeps numeric zero values');
