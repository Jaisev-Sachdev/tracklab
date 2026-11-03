import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The agent's prompt and tools and the samples' saved SAM output are read from content/ at runtime by path, which
  // Next's file tracing cannot see. Sample videos under public/ are read too, for local development.
  outputFileTracingIncludes: {
    "/api/**": ["./content/**/*", "./public/samples/**/*"],
  },
};

export default nextConfig;
