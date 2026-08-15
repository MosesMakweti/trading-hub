import type { MarketCategory } from "@prisma/client";

/**
 * Prop Firm Directory seed data — identity/branding only (see
 * `PropFirmDirectoryEntry` in schema.prisma). Deliberately separate from the
 * seeding mechanism (`prisma/seed-prop-firms.ts`) so entries can be edited
 * here without touching the seed logic.
 *
 * No logos are hotlinked or scraped — `logoUrl` is left `null` for every
 * entry; the UI falls back to a generated initials placeholder
 * (`prop-firm-logo.tsx`). Swap in a licensed/official asset URL here once one
 * is available and it'll be picked up automatically. `accentColor` and
 * `lastVerifiedAt` are left unset for the same reason: we haven't verified
 * either, and this directory must never assert something we don't actually
 * know (see the model's doc comment — identity only, never "current rules").
 */
export interface PropFirmDirectorySeedEntry {
  companyName: string;
  slug: string;
  markets: MarketCategory[];
  website: string;
  sortOrder: number;
}

export const PROP_FIRM_DIRECTORY_SEED: PropFirmDirectorySeedEntry[] = [
  // ── CFD / Forex ──────────────────────────────────────────────────────────
  { companyName: "FTMO", slug: "ftmo", markets: ["CFD"], website: "https://ftmo.com", sortOrder: 0 },
  { companyName: "The5%ers", slug: "the5ers", markets: ["CFD"], website: "https://the5ers.com", sortOrder: 1 },
  { companyName: "FundedNext", slug: "fundednext", markets: ["CFD"], website: "https://fundednext.com", sortOrder: 2 },
  { companyName: "E8 Markets", slug: "e8-markets", markets: ["CFD"], website: "https://e8markets.com", sortOrder: 3 },
  { companyName: "FundingPips", slug: "fundingpips", markets: ["CFD"], website: "https://fundingpips.com", sortOrder: 4 },

  // ── Futures ──────────────────────────────────────────────────────────────
  { companyName: "Topstep", slug: "topstep", markets: ["FUTURES"], website: "https://topstep.com", sortOrder: 5 },
  { companyName: "Apex Trader Funding", slug: "apex-trader-funding", markets: ["FUTURES"], website: "https://apextraderfunding.com", sortOrder: 6 },
  { companyName: "Take Profit Trader", slug: "take-profit-trader", markets: ["FUTURES"], website: "https://takeprofittrader.com", sortOrder: 7 },
  { companyName: "Earn2Trade", slug: "earn2trade", markets: ["FUTURES"], website: "https://earn2trade.com", sortOrder: 8 },
  { companyName: "Bulenox", slug: "bulenox", markets: ["FUTURES"], website: "https://bulenox.com", sortOrder: 9 },
];

/** The name used for the auto-created bucket that legacy accounts land in
 *  until the trader assigns the real company (see prop-firms-migration.service.ts). */
export const MIGRATED_ACCOUNTS_FIRM_NAME = "Migrated Accounts";
