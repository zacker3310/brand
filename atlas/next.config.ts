import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate build dirs let parallel dev servers coexist (NEXT_DIST_DIR=.next-agent-x).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  serverExternalPackages: ["pg", "cheerio"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
