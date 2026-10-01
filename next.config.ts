import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Next 16 requires opting every serve quality into an allowlist (default
    // is [75] only). (AppBackdrop doesn't go through the optimizer — it serves
    // its own lossless renditions from /backdrop/.)
    qualities: [75, 90],
  },
  // Extension private-beta ZIPs (public/downloads/, see
  // src/lib/extension-distribution.ts): always a file download, never
  // content-sniffed, kept out of search indexes.
  async headers() {
    return [
      {
        // AppBackdrop renditions (scripts/generate-backdrop.mjs): static, a
        // few hundred KB each — cache for a week, revalidate in the
        // background after that (names aren't content-hashed).
        source: "/backdrop/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
      {
        source: "/downloads/:file*.zip",
        headers: [
          { key: "Content-Type", value: "application/zip" },
          { key: "Content-Disposition", value: "attachment" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Prop Firm statement imports round-trip the raw upload (base64) through
      // inspect -> preview -> confirm Server Actions. A 5MB file is ~6.7MB
      // base64 + JSON overhead; the default 1MB limit would reject it.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
