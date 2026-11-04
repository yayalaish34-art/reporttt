import type { NextConfig } from "next";

// The screens live in the reports system now. This service only signs direct uploads.
const REPORTS_URL = "https://radiation-reports-production.up.railway.app";

const config: NextConfig = {
  poweredByHeader: false,
  // This folder sits inside the reports repo locally; without this Next adopts the repo as its root.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  async redirects() {
    return [{ source: "/:path((?!upload-url).*)", destination: `${REPORTS_URL}/prediction`, permanent: false }];
  },
};

export default config;
