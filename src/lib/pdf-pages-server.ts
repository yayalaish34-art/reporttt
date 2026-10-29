import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findBrowser } from './antenna-map-render';

/**
 * A PDF's pages as PNG images, on the server.
 *
 * The editor does this in the surveyor's browser (see `pdf-pages.ts`); a laboratory
 * report that arrives by e-mail has no browser to do it in, so the same pdf.js runs in
 * the headless Chromium already used for the antenna map. The pages come out at the
 * same scale the editor renders them at, so the scan reads them identically.
 *
 * pdf.js is served to the page from node_modules through request interception — the
 * page has no origin of its own to load a module and its worker from otherwise.
 */

const ORIGIN = 'http://pdf.local';
/** Matches `pdf-pages.ts`: small digits must survive, and 2× is what was tested there. */
const SCALE = 2;
const MAX_PAGES = 20;

export async function renderPdfPages(pdf: Buffer): Promise<Buffer[]> {
  const browser = await findBrowser();
  if (!browser) throw new Error('לא נמצא דפדפן בשרת להמרת ה-PDF');

  const dist = resolve(process.cwd(), 'node_modules/pdfjs-dist/build');
  const files: Record<string, { body: Buffer | string; type: string }> = {
    '/': { body: '<!doctype html><html><body></body></html>', type: 'text/html' },
    '/pdf.mjs': { body: readFileSync(resolve(dist, 'pdf.min.mjs')), type: 'text/javascript' },
    '/pdf.worker.mjs': { body: readFileSync(resolve(dist, 'pdf.worker.min.mjs')), type: 'text/javascript' },
  };

  const puppeteer = await import('puppeteer-core');
  const launched = await puppeteer.default.launch({
    executablePath: browser.executablePath,
    headless: true,
    args: browser.args,
  });
  try {
    const page = await launched.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      const file = url.origin === ORIGIN ? files[url.pathname] : undefined;
      if (file) void request.respond({ status: 200, contentType: file.type, body: file.body });
      else void request.abort();
    });
    await page.goto(`${ORIGIN}/`);

    const dataUrls = (await page.evaluate(
      async (base64: string, scale: number, maxPages: number, origin: string) => {
        const pdfjs = await import(/* webpackIgnore: true */ `${origin}/pdf.mjs`);
        pdfjs.GlobalWorkerOptions.workerSrc = `${origin}/pdf.worker.mjs`;
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        const out: string[] = [];
        for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
          const pdfPage = await doc.getPage(n);
          const viewport = pdfPage.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d', { alpha: false })!;
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
          out.push(canvas.toDataURL('image/png'));
          pdfPage.cleanup();
        }
        await doc.destroy();
        return out;
      },
      pdf.toString('base64'),
      SCALE,
      MAX_PAGES,
      ORIGIN,
    )) as string[];

    return dataUrls.map((url) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  } finally {
    await launched.close();
  }
}
