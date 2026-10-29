/**
 * Renders the antenna-map HTML to a PNG image using a headless Chromium browser.
 *
 * In production (Railway, any Linux container) this uses `@sparticuz/chromium` — a
 * Chromium build packaged specifically for minimal containers. It ships its own binary
 * inside node_modules and extracts it to a temp directory at first use, so it needs no
 * system package install and no Dockerfile changes. The system paths this used to probe
 * (`/usr/bin/chromium-browser` etc.) are Debian/Ubuntu's snap wrapper, which refuses to
 * run inside a container (no snapd) — the binary exists so the path check passed, but
 * launching it always failed. `@sparticuz/chromium` replaces that failure mode entirely.
 *
 * Locally (developer machines), falls back to the system's installed Chrome/Chromium.
 *
 * If no browser is available at all, returns null — the caller decides whether that is
 * fatal (the antenna appendix is mandatory whenever antennas were part of the survey) or
 * can be skipped (purely optional request).
 */

import {
  ANTENNA_MAP_PIXEL_SIZE,
  generateAntennaMapHtml,
  type AntennaMapOptions,
} from "./antenna-map-html";
import type { AntennaSearchResult } from "./antennas";

// ---------------------------------------------------------------------------
// Browser detection
// ---------------------------------------------------------------------------

interface BrowserTarget {
  executablePath: string;
  args: string[];
}

const BASE_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--font-render-hinting=none",
];

export async function findBrowser(): Promise<BrowserTarget | null> {
  // 1. Explicit override — always wins.
  if (process.env.CHROMIUM_PATH) {
    return { executablePath: process.env.CHROMIUM_PATH, args: BASE_ARGS };
  }

  // 2. The bundled serverless-friendly Chromium. This is what production actually
  // runs on: it needs no OS package and works the same on every Linux container.
  if (process.platform === "linux") {
    try {
      const chromium = (await import("@sparticuz/chromium")).default;
      const executablePath = await chromium.executablePath();
      return { executablePath, args: [...chromium.args, ...BASE_ARGS] };
    } catch (err) {
      console.warn("[antenna-map] @sparticuz/chromium unavailable, falling back:", err);
    }
  }

  // 3. A developer's own machine: whatever desktop Chrome/Chromium is installed.
  const { existsSync } = await import("node:fs");
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return { executablePath: p, args: BASE_ARGS };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Screenshot via Puppeteer-core (lightweight, no bundled browser)
// ---------------------------------------------------------------------------

async function screenshotWithPuppeteer(
  html: string,
  browser: BrowserTarget,
): Promise<Buffer> {
  const puppeteer = await import("puppeteer-core");
  const launched = await puppeteer.default.launch({
    executablePath: browser.executablePath,
    headless: true,
    args: browser.args,
  });
  try {
    const page = await launched.newPage();
    // Keep the raster itself fixed. Previously the side panel enlarged the
    // screenshot when an urban location returned many antenna sites.
    await page.setViewport({
      width: ANTENNA_MAP_PIXEL_SIZE.width,
      height: ANTENNA_MAP_PIXEL_SIZE.height,
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: "networkidle0" as never, timeout: 30_000 });
    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);
    const el = await page.$(".figure");
    if (!el) throw new Error("Could not find .figure element");
    const png = await el.screenshot({ type: "png", captureBeyondViewport: false }) as Buffer;
    return Buffer.from(png);
  } finally {
    await launched.close();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the antenna map as a PNG image buffer.
 * Returns null if no headless browser is available.
 */
export async function renderAntennaMapPng(
  result: AntennaSearchResult,
  opts: AntennaMapOptions,
): Promise<Buffer | null> {
  const browser = await findBrowser();
  if (!browser) {
    console.warn("[antenna-map] No Chromium browser found — skipping map render");
    return null;
  }

  const html = await generateAntennaMapHtml(result, opts);
  return screenshotWithPuppeteer(html, browser);
}

/**
 * Generate the antenna map HTML (useful for preview or testing without a browser).
 */
export { generateAntennaMapHtml } from "./antenna-map-html";
