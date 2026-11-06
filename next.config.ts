import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker builds set NEXT_OUTPUT=standalone for a minimal runtime image; `next start` uses the regular output.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingExcludes: { "*": ["./data/**", "./fixtures/**", "./scripts/**", "./tests/**"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
