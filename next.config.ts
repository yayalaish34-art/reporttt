import type { NextConfig } from 'next';

const config: NextConfig = {
  // These reach into Node built-ins and read files at runtime, so they must run
  // as real Node modules rather than being traced into the bundle.
  // `sharp` is here for the same reason as the other two: it is a native module,
  // and tracing it into the bundle breaks the binary it loads at runtime. It
  // decodes the HEIC photographs iPhones upload — see `acceptPhoto`. `pg` (the CRM
  // customer sync) and `puppeteer-core` (the antenna map, the Hayes forms) load Node's
  // own `net`/`fs` and a browser binary at runtime, which bundling breaks the same way.
  serverExternalPackages: ['pizzip', 'docxtemplater', 'sharp', 'pg', 'puppeteer-core', '@sparticuz/chromium'],
  experimental: {
    // A merged report is several megabytes; the default 1 MB action limit would
    // reject a report carrying more than a handful of protocols.
    serverActions: { bodySizeLimit: '25mb' },
  },
};

export default config;
