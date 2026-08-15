// Idempotent seed for the Prop Firm Directory (identity/branding catalog —
// see `PropFirmDirectoryEntry` in schema.prisma). The actual entries live in
// `src/data/prop-firm-directory.ts`, kept separate on purpose so the list can
// be edited without touching this script.
//
// Run with: node --experimental-strip-types prisma/seed-prop-firms.mjs
// (Node 22's native TS type-stripping — no build step, no extra dependency —
// lets this import the .ts data file directly.)
// Safe to re-run — upserts by slug, never touches trader-facing
// UserPropFirm/PropFirmAccount data.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { PROP_FIRM_DIRECTORY_SEED } from "../src/data/prop-firm-directory.ts";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const entry of PROP_FIRM_DIRECTORY_SEED) {
    await prisma.propFirmDirectoryEntry.upsert({
      where: { slug: entry.slug },
      update: {
        companyName: entry.companyName,
        markets: entry.markets,
        website: entry.website,
        logoUrl: entry.logoUrl,
        sortOrder: entry.sortOrder,
      },
      create: {
        companyName: entry.companyName,
        slug: entry.slug,
        markets: entry.markets,
        website: entry.website,
        logoUrl: entry.logoUrl,
        sortOrder: entry.sortOrder,
      },
    });
  }

  console.log(`Seeded ${PROP_FIRM_DIRECTORY_SEED.length} prop firm directory entries.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
