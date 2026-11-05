import type { NextConfig } from "next";

// Built to plain files the engine serves from its own address: one service, one origin.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  // This folder sits inside the reports repo locally; without this Next adopts the repo as its root.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
};

export default config;
