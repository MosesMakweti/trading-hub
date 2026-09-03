import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Next 16 requires opting every serve quality into an allowlist (default
    // is [75] only) — 90 lets the full-viewport backdrop photos (AppBackdrop)
    // serve near-source fidelity instead of being clamped to 75.
    qualities: [75, 90],
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
