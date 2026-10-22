import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PizZip from 'pizzip';
import { ReportSchema, StoredReportSchema } from '../src/lib/report-schema';
import { buildMergeData } from '../src/lib/report-mapper';
import { computeFindings } from '../src/lib/report-findings';
import {
  ELF_DISTANCE_OPTIONS, POWER_LINE_DISTANCE_OPTIONS, POWER_LINE_SOURCES,
  measuredProtocols, measurementDistanceOptions, newElfRow, newRfRows, withReferencePrefix,
} from '../src/lib/measurement-rules';

const output = resolve('out/report-flexible-test');
mkdirSync(output, { recursive: true });
process.env.REPORT_DB_PATH = resolve(output, 'reports.db');
process.env.OPENAI_API_KEY = '';
process.env.CRM_API_URL = '';
process.env.CRM_API_TOKEN = '';
const { createReport, generateReport, loadReport } = await import('../src/lib/report-service');

// Neither omitted fields nor blank strings block saving or generation.
const empty = ReportSchema.parse({});
assert.equal(empty.reportDate, '');
assert.deepEqual(empty.elfProtocols, []);
assert.ok(ReportSchema.safeParse({
  ...empty, inspectors: [{ name: '' }], authors: [{ name: '' }],
  elfProtocols: [{ title: '', rows: [] }],
}).success);
assert.ok(!ReportSchema.safeParse({ ...empty, elfProtocols: 'broken' }).success);

const report = ReportSchema.parse({
  ...empty,
  elfProtocols: [
    { title: 'ELF_EMPTY_TABLE_SENTINEL', rows: [{ ...newElfRow('0.3'), normalized: '999' }] },
    { title: '', normalizationFactor: '1', rows: [
      { ...newElfRow('0.3'), description: '', measured: '0' },
      { ...newElfRow('0.5'), description: 'ELF_EMPTY_ROW_SENTINEL', measured: '  ' },
      { ...newElfRow('1'), description: 'ELF_MEASURED_SENTINEL', measured: '0.5' },
    ] },
    { title: 'ELF_NO_ROWS_SENTINEL', rows: [] },
  ],
  rfProtocols: [
    { title: 'RF_EMPTY_TABLE_SENTINEL', rows: newRfRows().map(r => ({ ...r, measured: '  ' })) },
    { title: 'RF_MEASURED_TABLE_SENTINEL', rows: newRfRows().map((r, i) => ({
      ...r, description: i === 0 ? '' : 'RF_EMPTY_ROW_SENTINEL', measured: i === 0 ? '10' : '',
    })) },
  ],
});
const snapshot = JSON.stringify(report);
const merged = buildMergeData(report) as {
  elfProtocols: { rows: { measured: string; pointNumber: string }[] }[];
  rfProtocols: { rows: { measured: string; pointNumber: string }[] }[];
};
assert.equal(merged.elfProtocols.length, 1);
assert.equal(merged.rfProtocols.length, 1);
assert.deepEqual(merged.elfProtocols[0].rows.map(r => [r.measured, r.pointNumber]), [['0', '1'], ['0.5', '2']]);
assert.equal(merged.rfProtocols[0].rows[0].measured, '10');
assert.deepEqual(measuredProtocols([{ rows: [{ measured: '0' }] }]), [{ rows: [{ measured: '0' }] }]);
assert.equal(JSON.stringify(report), snapshot);
const findings = computeFindings(report);
assert.equal(findings.elf.protocolCount, 1);
assert.equal(findings.elf.pointCount, 2);
assert.equal(findings.elf.highest?.value, 0.5);
assert.equal(findings.rf.protocolCount, 1);
assert.equal(findings.rf.pointCount, 1);

const integers = Array.from({ length: 26 }, (_, i) => String(i));
assert.deepEqual(POWER_LINE_DISTANCE_OPTIONS, integers);
for (const source of POWER_LINE_SOURCES) {
  assert.deepEqual(measurementDistanceOptions(source), integers);
  assert.deepEqual(measurementDistanceOptions('', withReferencePrefix(source)), integers);
  assert.deepEqual(measurementDistanceOptions('', `בדיקה ביחס ${withReferencePrefix(source)} צפוני`), integers);
}
for (const source of ['UPS', 'ups', 'ל-UPS', 'ל־UPS', 'לUPS', 'לוח חשמל', 'ללוח חשמל ראשי']) {
  assert.deepEqual(measurementDistanceOptions('', source), ELF_DISTANCE_OPTIONS);
  assert.deepEqual(measurementDistanceOptions('קו מתח על, UPS', source), ELF_DISTANCE_OPTIONS);
}
assert.deepEqual(measurementDistanceOptions('UPS'), ELF_DISTANCE_OPTIONS);
assert.deepEqual(measurementDistanceOptions('', 'קו מתח עליון'), integers);
assert.deepEqual(measurementDistanceOptions('', 'קו מתח עליונות'), ELF_DISTANCE_OPTIONS);

const ids = {
  blank: createReport(empty),
  mixed: createReport(report),
  elf: createReport(ReportSchema.parse({
    ...empty, surveyScope: 'elf',
    elfProtocols: [{ rows: ['0.3', '0.5', '1', '1.5', '2'].map(newElfRow) }],
  })),
  rf: createReport(ReportSchema.parse({
    ...empty, surveyScope: 'rf', rfProtocols: [{ referenceLabel: 'ארון תקשורת', rows: newRfRows() }],
  })),
};
for (const [name, input] of Object.entries({
  empty, mixed: report, antennaWithoutAddress: { ...empty, fieldSource: 'אנטנות' },
})) {
  const generated = await generateReport(input);
  const zip = new PizZip(generated.bytes);
  const xml = zip.file('word/document.xml')!.asText();
  assert.ok(xml.includes('<w:document'));
  assert.ok(!/EMPTY_TABLE_SENTINEL|EMPTY_ROW_SENTINEL|NO_ROWS_SENTINEL/.test(xml));
  if (name === 'mixed') {
    assert.ok(xml.includes('ELF_MEASURED_SENTINEL'));
    assert.ok(xml.includes('RF_MEASURED_TABLE_SENTINEL'));
  }
  if (name === 'antennaWithoutAddress') assert.ok(xml.includes('נספח מפת האנטנות לא נכלל'));
  writeFileSync(resolve(output, `${name}.docx`), generated.bytes);
}
assert.equal(JSON.stringify(report), snapshot);
assert.equal(loadReport(ids.mixed)?.elfProtocols.length, 3);
assert.equal(StoredReportSchema.parse(loadReport(ids.mixed)).rfProtocols.length, 2);
writeFileSync(resolve(output, 'ids.json'), JSON.stringify(ids));
console.log('PASS: partial reports, omitted empty tables/rows, zero readings, Word generation, draft retention, source distances and UPS.');
