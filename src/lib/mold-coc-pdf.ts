import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findBrowser } from './antenna-map-render';
import { COC_COMPANY, COC_ROWS_PER_PAGE, chainOfCustody, type ChainOfCustodyForm, type CocRow } from './mold-coc';
import type { MoldReport } from './mold-schema';

/**
 * Hayes' Chain of Custody as a PDF, laid out as the laboratory's own Form #20.
 *
 * Drawn as HTML and printed by the same headless Chromium that renders the antenna
 * map: the form is a set of ruled tables, which a browser lays out exactly, and Hebrew
 * room names a surveyor leaves untranslated still print rather than as empty boxes.
 */

/** The analysis table, exactly as the form prints it. */
const ANALYSES: Array<[string, string, string, string, string]> = [
  ['Spore Trap', 'S', 'Identification & Enumeration of Fungal Spores', '24 Hour', 'Air Cassettes, Impact Slides'],
  ['', 'S+', 'Spore Trap Analysis with Dander, Fiber, and Pollen counts', '24 Hour', 'Air Cassettes, Impact Slides'],
  ['Direct ID', 'D', 'ID & Semi-Quantative Enumeration of spores and mycelium', '24 Hour', 'Bio-Tape, Tape, Swab, Bulk, Agar Plate'],
  ['', 'D+', 'Direct Analysis with Fully Quantitative spore count', '24 Hour', 'Bio-Tape, Tape, Swab, Bulk, Agar Plate'],
  ['Culture', 'C1', 'Identification & Enumeration of Mold only', '7 Day', 'Air Plate, Agar Plate, Swab, Bulk'],
  ['', 'C2', 'Identification & Enumeration of Bacteria only', '4 Day', 'Air Plate, Agar Plate, Swab, Bulk'],
  ['', 'C3', 'Identification & Enumeration of Mold and Bacteria', '7 Day', 'Air Plate, Agar Plate, Swab, Bulk'],
  ['', 'C5', 'Coliform Screen for Sewage Bacteria', '2 Day', 'Agar Plate, Swab, Bulk'],
  ['Particle', 'TPA', 'Total Particulate Analysis, ID & Count (Does Not Include Mold)', '24 Hour', 'Air Cassettes, Impact Slides, Bio-Tape'],
];

const esc = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A filled-in value — larger than the form's own print, as on the signed original. */
const v = (value: string) => `<span class="v" dir="auto">${esc(value)}</span>`;

function logoDataUri(): string {
  try {
    const bytes = readFileSync(resolve(process.cwd(), 'templates/hayes-logo.png'));
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch {
    return '';
  }
}

function page(form: ChainOfCustodyForm, rows: CocRow[], first: number, logo: string): string {
  const sampleRows = Array.from({ length: COC_ROWS_PER_PAGE }, (_, i) => {
    const row = rows[i];
    return `<tr>
      <td class="c">${first + i}</td>
      <td>${row ? v(row.number) : ''}</td>
      <td>${row ? v(row.sample) : ''}</td>
      <td class="c">${row ? v(row.analysis) : ''}</td>
      <td>${row ? v(row.volume) : ''}</td>
      <td>${row ? v(row.notes) : ''}</td>
    </tr>`;
  }).join('');

  return `<section class="page">
  <div class="top">
    <div class="logo">${logo ? `<img src="${logo}" alt="Hayes Microbial Consulting">` : '<b>HAYES</b>'}</div>
    <div class="company">
      <div><span class="k">Company:</span><span class="line">${v(COC_COMPANY.name)}</span></div>
      <div><span class="k">Address:</span><span class="line">${v(COC_COMPANY.address[0])}</span></div>
      <div><span class="k"></span><span class="line">${v(COC_COMPANY.address[1])}</span></div>
    </div>
    <div class="lab">[&nbsp;&nbsp; Lab Use Only &nbsp;&nbsp;]</div>
  </div>

  <table class="head">
    <colgroup><col style="width:23.5%"><col style="width:32%"><col style="width:18.5%"><col></colgroup>
    <tr>
      <td>Job Number: ${v(form.jobNumber)}</td>
      <td rowspan="3" class="jobname">Job Name:<div>${v(form.jobName)}</div></td>
      <td colspan="2" class="open"></td>
    </tr>
    <tr>
      <td>Collector: ${v(form.collector)}</td>
      <td>Mobile: ${v(form.mobile)}</td>
      <td>Email: ${v(form.email)}</td>
    </tr>
    <tr>
      <td>Date Collected: ${v(form.dateCollected)}</td>
      <td colspan="2">Note: ${v(form.note)}</td>
    </tr>
  </table>

  <table class="analyses">
    <colgroup><col style="width:10.5%"><col style="width:6.5%"><col style="width:39.5%"><col style="width:9%"><col></colgroup>
    <tr class="th"><th colspan="2">Analysis Type</th><th>Analysis Description</th><th>Turnaround</th><th>Accepted Media Types</th></tr>
    ${ANALYSES.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}
  </table>

  <table class="samples">
    <colgroup><col style="width:3.5%"><col style="width:14.5%"><col style="width:32.5%"><col style="width:8.5%"><col style="width:8.5%"><col></colgroup>
    <tr class="th"><th>#</th><th>Number</th><th>Sample</th><th>Analysis</th><th>Volume</th><th>Notes</th></tr>
    ${sampleRows}
  </table>

  <table class="release">
    <colgroup><col style="width:30.5%"><col style="width:14%"><col style="width:34.5%"><col></colgroup>
    <tr>
      <td>Released by: ${v(form.releasedBy)}</td>
      <td>Date: ${v(form.releasedDate)}</td>
      <td>Received By:</td>
      <td>Date:</td>
    </tr>
  </table>

  <div class="foot">
    <span>Hayes Microbial Consulting, LLC.</span>
    <span>3005 East Boundary Terrace, Suite F. Midlothian, VA. 23112</span>
    <span>(804) 562-3435</span>
    <span>contact@hayesmicrobial.com</span>
    <span class="form">Form #20, Rev.3, March 23, 2019<br>Chain of Custody</span>
  </div>
</section>`;
}

export function chainOfCustodyHtml(report: MoldReport): string {
  const form = chainOfCustody(report);
  const logo = logoDataUri();
  const pages: string[] = [];
  for (let start = 0; start === 0 || start < form.rows.length; start += COC_ROWS_PER_PAGE) {
    pages.push(page(form, form.rows.slice(start, start + COC_ROWS_PER_PAGE), start + 1, logo));
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&family=Heebo:wght@400;700&display=swap');
@page { size: 11in 8.5in; margin: 0.32in 0.4in 0.25in; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Roboto', 'Heebo', Arial, sans-serif; color: #222; font-size: 8.6pt; }
.page { height: 7.9in; overflow: hidden; page-break-after: always; }
.page:last-child { page-break-after: auto; }
.v { font-size: 11pt; color: #000; unicode-bidi: plaintext; }
.top { display: flex; align-items: flex-start; height: 0.95in; }
.logo { width: 2.65in; padding-top: 0.08in; }
.logo img { width: 2.45in; }
.company { width: 4.25in; padding-top: 0.02in; }
.company > div { display: flex; align-items: flex-end; height: 0.24in; }
.company .k { width: 0.65in; font-weight: 700; font-size: 9pt; }
.company .line { flex: 0 0 2.9in; border-bottom: 1px solid #333; padding-inline-start: 0.05in; white-space: nowrap; overflow: hidden; }
.company .v { font-size: 10pt; }
.lab { flex: 1; margin-top: 0.02in; height: 0.82in; border: 1px solid #bbb; display: flex; align-items: center; justify-content: center; font-size: 19pt; color: #444; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
td, th { border: 1px solid #333; padding: 1px 6px; height: 0.215in; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: left; vertical-align: middle; }
th { font-weight: 700; font-size: 7.6pt; text-align: center; }
td.c { text-align: center; }
.head { margin-top: -0.12in; }
.head td.open { border-top: none; border-right: none; }
.head td.jobname { vertical-align: top; }
.head td.jobname div { padding: 3px 4px 0; }
.analyses td { height: 0.205in; }
.samples td { height: 0.216in; }
.samples, .analyses, .release { border-top: none; }
.release td { height: 0.3in; }
.foot { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 3px; font-size: 7.4pt; color: #444; }
.foot .form { text-align: right; font-size: 6.6pt; }
</style></head><body>${pages.join('')}</body></html>`;
}

/** The form as a PDF, or null when there is no browser on this machine to print it. */
export async function renderChainOfCustodyPdf(report: MoldReport): Promise<Buffer | null> {
  const browser = await findBrowser();
  if (!browser) return null;

  const puppeteer = await import('puppeteer-core');
  const launched = await puppeteer.default.launch({
    executablePath: browser.executablePath,
    headless: true,
    args: browser.args,
  });
  try {
    const tab = await launched.newPage();
    // The fonts are fetched, but a container offline must still produce the form —
    // so the wait is bounded and the fallback fonts take over.
    await tab.setContent(chainOfCustodyHtml(report), { waitUntil: 'networkidle0' as never, timeout: 15_000 }).catch(() => {});
    await tab.evaluate(() => document.fonts.ready);
    const pdf = await tab.pdf({ preferCSSPageSize: true, printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await launched.close();
  }
}

/** "Chain of Custody Hayes 511.pdf" — the name the laboratory's own form goes by. */
export function chainOfCustodyFileName(report: MoldReport): string {
  const job = chainOfCustody(report).jobNumber.replace(/[\\/:*?"<>|]/g, '').trim();
  return `Chain of Custody Hayes${job ? ` ${job}` : ''}.pdf`;
}
