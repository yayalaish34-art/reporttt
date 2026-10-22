/**
 * Verifies the defaults of a newly-created IAQ report without touching the
 * application database or the CRM. The action uses a temporary SQLite file.
 */
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { iaqCurrentDateTime } from '../src/lib/iaq-date-defaults';

const deterministicCases = [
  {
    // During Israeli daylight-saving time, this is still the previous local day.
    input: '2026-10-14T20:59:00.000Z',
    expected: { date: '14.10.2026', time: '23:59' },
  },
  {
    // Two minutes later Jerusalem has crossed midnight, while UTC has not.
    input: '2026-10-14T21:01:00.000Z',
    expected: { date: '15.10.2026', time: '00:01' },
  },
  {
    // The same guarantee also holds on Israel's winter UTC+2 offset.
    input: '2026-01-01T22:05:00.000Z',
    expected: { date: '02.01.2026', time: '00:05' },
  },
] as const;

for (const testCase of deterministicCases) {
  const actual = iaqCurrentDateTime(new Date(testCase.input));
  if (actual.date !== testCase.expected.date || actual.time !== testCase.expected.time) {
    throw new Error(
      `Jerusalem date/time for ${testCase.input} should be ${testCase.expected.date} ${testCase.expected.time}; ` +
        `received ${actual.date} ${actual.time}`,
    );
  }
}

process.env.REPORT_DB_PATH = join(mkdtempSync(join(tmpdir(), 'iaq-date-defaults-')), 'test.db');

const before = new Date();
const { createBlankIaqReportId } = await import('../src/app/iaq/actions');
const { loadIaqReport } = await import('../src/lib/iaq-service');
const id = await createBlankIaqReportId();
const after = new Date();
const report = loadIaqReport(id);

if (!report) throw new Error('The newly-created IAQ report could not be loaded');

function jerusalemDate(date: Date): string {
  return date
    .toLocaleDateString('he-IL', {
      timeZone: 'Asia/Jerusalem',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    .replace(/\//g, '.');
}

function jerusalemTime(date: Date): string {
  return date.toLocaleTimeString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const expectedDates = new Set([jerusalemDate(before), jerusalemDate(after)]);
const expectedTimes = new Set([jerusalemTime(before), jerusalemTime(after)]);

if (!expectedDates.has(report.reportDate)) {
  throw new Error(`reportDate should default to today's Jerusalem date; received "${report.reportDate}"`);
}
if (!expectedDates.has(report.surveyDate)) {
  throw new Error(`surveyDate should default to today's Jerusalem date; received "${report.surveyDate}"`);
}
if (!expectedTimes.has(report.surveyTime)) {
  throw new Error(`surveyTime should default to the current Jerusalem time; received "${report.surveyTime}"`);
}

console.log(
  `✓ IAQ date defaults smoke passes — report ${report.reportDate}, survey ${report.surveyDate} ${report.surveyTime}`,
);
