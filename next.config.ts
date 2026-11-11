import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": ["./venv/**/*", "./data/**/*", "./scratch/**/*"],
  },
  serverExternalPackages: [
    "puppeteer-core",
    "@remotion/bundler",
    "@remotion/renderer",
    "@remotion/cli",
    "remotion",
  ],
};

export default nextConfig;
