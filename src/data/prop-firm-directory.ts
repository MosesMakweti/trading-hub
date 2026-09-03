import type { MarketCategory } from "@prisma/client";

/**
 * Prop Firm Directory seed data — identity/branding only (see
 * `PropFirmDirectoryEntry` in schema.prisma). Deliberately separate from the
 * seeding mechanism (`prisma/seed-prop-firms.ts`) so entries can be edited
 * here without touching the seed logic.
 *
 * `logoUrl` points at a locally-hosted copy of each firm's own official mark
 * (downloaded from the firm's own site/CDN — never a third-party hotlink),
 * under `public/prop-firm-logos/<slug>.<ext>`. Each is that firm's real,
 * currently-published brand asset, used here purely for account
 * identification in this trader's own private journal (nominative use — not
 * an endorsement or affiliation claim). Re-verify/re-download if a firm
 * rebrands; `accentColor` and `lastVerifiedAt` stay unset until someone
 * actually checks them, for the same "never assert what we haven't verified"
 * reason as the rest of this directory (see the schema model's doc comment).
 */
export interface PropFirmDirectorySeedEntry {
  companyName: string;
  slug: string;
  markets: MarketCategory[];
  website: string;
  logoUrl: string | null;
  sortOrder: number;
}

export const PROP_FIRM_DIRECTORY_SEED: PropFirmDirectorySeedEntry[] = [
  // ── CFD / Forex ──────────────────────────────────────────────────────────
  { companyName: "FTMO", slug: "ftmo", markets: ["CFD"], website: "https://ftmo.com", logoUrl: "/prop-firm-logos/ftmo.png", sortOrder: 0 },
  { companyName: "The5%ers", slug: "the5ers", markets: ["CFD"], website: "https://the5ers.com", logoUrl: "/prop-firm-logos/the5ers.svg", sortOrder: 1 },
  { companyName: "FundedNext", slug: "fundednext", markets: ["CFD"], website: "https://fundednext.com", logoUrl: "/prop-firm-logos/fundednext.png", sortOrder: 2 },
  { companyName: "E8 Markets", slug: "e8-markets", markets: ["CFD"], website: "https://e8markets.com", logoUrl: "/prop-firm-logos/e8-markets.png", sortOrder: 3 },
  { companyName: "FundingPips", slug: "fundingpips", markets: ["CFD"], website: "https://fundingpips.com", logoUrl: "/prop-firm-logos/fundingpips.png", sortOrder: 4 },

  // ── Futures ──────────────────────────────────────────────────────────────
  { companyName: "Topstep", slug: "topstep", markets: ["FUTURES"], website: "https://topstep.com", logoUrl: "/prop-firm-logos/topstep.png", sortOrder: 5 },
  { companyName: "Apex Trader Funding", slug: "apex-trader-funding", markets: ["FUTURES"], website: "https://apextraderfunding.com", logoUrl: "/prop-firm-logos/apex-trader-funding.jpg", sortOrder: 6 },
  { companyName: "Take Profit Trader", slug: "take-profit-trader", markets: ["FUTURES"], website: "https://takeprofittrader.com", logoUrl: "/prop-firm-logos/take-profit-trader.svg", sortOrder: 7 },
  { companyName: "Earn2Trade", slug: "earn2trade", markets: ["FUTURES"], website: "https://earn2trade.com", logoUrl: "/prop-firm-logos/earn2trade.svg", sortOrder: 8 },
  { companyName: "Bulenox", slug: "bulenox", markets: ["FUTURES"], website: "https://bulenox.com", logoUrl: "/prop-firm-logos/bulenox.png", sortOrder: 9 },

  // ── CFD / Forex (additional) ────────────────────────────────────────────
  { companyName: "FXIFY", slug: "fxify", markets: ["CFD"], website: "https://fxify.com", logoUrl: "/prop-firm-logos/fxify.png", sortOrder: 10 },
  { companyName: "ThinkCapital", slug: "thinkcapital", markets: ["CFD"], website: "https://www.thinkcapital.com", logoUrl: "/prop-firm-logos/thinkcapital.png", sortOrder: 11 },
  { companyName: "DNA Funded", slug: "dna-funded", markets: ["CFD"], website: "https://dnafunded.com", logoUrl: "/prop-firm-logos/dna-funded.png", sortOrder: 12 },
  { companyName: "Maven Trading", slug: "maven-trading", markets: ["CFD"], website: "https://maventrading.com", logoUrl: "/prop-firm-logos/maven-trading.png", sortOrder: 13 },
  { companyName: "For Traders", slug: "for-traders", markets: ["CFD"], website: "https://fortraders.com", logoUrl: "/prop-firm-logos/for-traders.png", sortOrder: 14 },
  { companyName: "Alpha Capital Group", slug: "alpha-capital-group", markets: ["CFD"], website: "https://alphacapitalgroup.uk", logoUrl: "/prop-firm-logos/alpha-capital-group.png", sortOrder: 15 },
  { companyName: "City Traders Imperium", slug: "city-traders-imperium", markets: ["CFD"], website: "https://citytradersimperium.com", logoUrl: "/prop-firm-logos/city-traders-imperium.png", sortOrder: 16 },
  { companyName: "Blue Guardian", slug: "blue-guardian", markets: ["CFD"], website: "https://blueguardian.com", logoUrl: "/prop-firm-logos/blue-guardian.png", sortOrder: 17 },
  { companyName: "Instant Funding", slug: "instant-funding", markets: ["CFD"], website: "https://instantfunding.com", logoUrl: "/prop-firm-logos/instant-funding.png", sortOrder: 18 },
  { companyName: "SurgeTrader", slug: "surgetrader", markets: ["CFD"], website: "https://surgetrader.com", logoUrl: "/prop-firm-logos/surgetrader.png", sortOrder: 19 },
  { companyName: "AquaFunded", slug: "aquafunded", markets: ["CFD"], website: "https://aquafunded.com", logoUrl: "/prop-firm-logos/aquafunded.png", sortOrder: 20 },
  { companyName: "Smart Prop Trader", slug: "smart-prop-trader", markets: ["CFD"], website: "https://smartproptrader.com", logoUrl: "/prop-firm-logos/smart-prop-trader.png", sortOrder: 21 },
  { companyName: "Lark Funding", slug: "lark-funding", markets: ["CFD"], website: "https://larkfunding.com", logoUrl: "/prop-firm-logos/lark-funding.png", sortOrder: 22 },
  { companyName: "Finotive Funding", slug: "finotive-funding", markets: ["CFD"], website: "https://finotivefunding.com", logoUrl: "/prop-firm-logos/finotive-funding.png", sortOrder: 23 },
  { companyName: "Trade The Pool", slug: "trade-the-pool", markets: ["CFD"], website: "https://tradethepool.com", logoUrl: "/prop-firm-logos/trade-the-pool.png", sortOrder: 24 },

  // ── Futures (additional) ────────────────────────────────────────────────
  { companyName: "MyFundedFutures", slug: "myfundedfutures", markets: ["FUTURES"], website: "https://myfundedfutures.com", logoUrl: "/prop-firm-logos/myfundedfutures.png", sortOrder: 25 },
  { companyName: "Tradeify", slug: "tradeify", markets: ["FUTURES"], website: "https://tradeify.co", logoUrl: "/prop-firm-logos/tradeify.png", sortOrder: 26 },
  { companyName: "Legends Trading", slug: "legends-trading", markets: ["FUTURES"], website: "https://legendstrading.com", logoUrl: "/prop-firm-logos/legends-trading.png", sortOrder: 27 },
  { companyName: "Elite Trader Funding", slug: "elite-trader-funding", markets: ["FUTURES"], website: "https://elitetraderfunding.app", logoUrl: "/prop-firm-logos/elite-trader-funding.svg", sortOrder: 28 },
  { companyName: "Alpha Futures", slug: "alpha-futures", markets: ["FUTURES"], website: "https://alpha-futures.com", logoUrl: "/prop-firm-logos/alpha-futures.jpg", sortOrder: 29 },
  { companyName: "OneUp Trader", slug: "oneup-trader", markets: ["FUTURES"], website: "https://oneuptrader.com", logoUrl: "/prop-firm-logos/oneup-trader.png", sortOrder: 30 },
  { companyName: "Top One Trader", slug: "top-one-trader", markets: ["FUTURES"], website: "https://toponetrader.com", logoUrl: "/prop-firm-logos/top-one-trader.png", sortOrder: 31 },
  { companyName: "Blue Guardian Futures", slug: "blue-guardian-futures", markets: ["FUTURES"], website: "https://blueguardianfutures.com", logoUrl: "/prop-firm-logos/blue-guardian-futures.jpg", sortOrder: 32 },
  { companyName: "UProfit Trader", slug: "uprofit-trader", markets: ["FUTURES"], website: "https://uprofittrader.com", logoUrl: "/prop-firm-logos/uprofit-trader.png", sortOrder: 33 },
  { companyName: "TradeDay", slug: "tradeday", markets: ["FUTURES"], website: "https://tradeday.com", logoUrl: "/prop-firm-logos/tradeday.png", sortOrder: 34 },
  { companyName: "DayTraders", slug: "daytraders", markets: ["FUTURES"], website: "https://daytraders.com", logoUrl: "/prop-firm-logos/daytraders.png", sortOrder: 35 },
  { companyName: "Leeloo Trading", slug: "leeloo-trading", markets: ["FUTURES"], website: "https://leelootrading.com", logoUrl: "/prop-firm-logos/leeloo-trading.svg", sortOrder: 36 },
  { companyName: "FunderPro Futures", slug: "funderpro-futures", markets: ["FUTURES"], website: "https://funderprofutures.com", logoUrl: "/prop-firm-logos/funderpro-futures.png", sortOrder: 37 },
  { companyName: "Lucid Trading", slug: "lucid-trading", markets: ["FUTURES"], website: "https://lucidtrading.com", logoUrl: null, sortOrder: 38 },

  // ── Both CFD and Futures ─────────────────────────────────────────────────
  { companyName: "Goat Funded Trader", slug: "goat-funded-trader", markets: ["CFD", "FUTURES"], website: "https://goatfundedtrader.com", logoUrl: "/prop-firm-logos/goat-funded-trader.png", sortOrder: 39 },
  { companyName: "The Trading Pit", slug: "the-trading-pit", markets: ["CFD", "FUTURES"], website: "https://thetradingpit.com", logoUrl: "/prop-firm-logos/the-trading-pit.png", sortOrder: 40 },
  { companyName: "Blueberry Funded", slug: "blueberry-funded", markets: ["CFD", "FUTURES"], website: "https://blueberryfunded.com", logoUrl: "/prop-firm-logos/blueberry-funded.png", sortOrder: 41 },
];

/** The name used for the auto-created bucket that legacy accounts land in
 *  until the trader assigns the real company (see prop-firms-migration.service.ts). */
export const MIGRATED_ACCOUNTS_FIRM_NAME = "Migrated Accounts";
