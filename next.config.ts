import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker builds set NEXT_OUTPUT=standalone for a minimal runtime image; `next start` uses the regular output.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  poweredByHeader: false,
  env: { NEXT_PUBLIC_UPLOAD_BASE: (process.env.BACKEND_URL || "").replace(/\/+$/, "") },
  reactStrictMode: true,
  outputFileTracingExcludes: { "*": ["./data/**", "./fixtures/**", "./scripts/**", "./tests/**"] },
  // Frontend-only hosts (e.g. Netlify) cannot run FFmpeg. Set BACKEND_URL to a server running this same
  // app (Docker) and every /api request is proxied there; cookies stay first-party on the frontend domain.
  async rewrites() {
    const backend = process.env.BACKEND_URL?.replace(/\/+$/, "");
    return backend ? { beforeFiles: [{ source: "/api/:path*", destination: `${backend}/api/:path*` }], afterFiles: [], fallback: [] } : [];
  },
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
