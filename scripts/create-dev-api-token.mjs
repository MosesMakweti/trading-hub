// TradingView Extension — Step 2 (docs/extension-api.md). Local/dev-only way
// to mint an ApiToken before a "Connected Apps" Settings UI exists (Step 3).
// Prints the raw token to stdout EXACTLY ONCE — it is not recoverable after
// this, by design (only its hash is ever stored). Never commit, log
// elsewhere, or paste this output anywhere but a local .env/secrets manager.
//
// Deliberately reimplements the same tiny token-generation primitives as
// src/server/services/api-tokens.service.ts, rather than importing that
// file, because this script runs under Node's native TS type-stripping
// (`--experimental-strip-types`), which does not resolve this project's
// `@/*` path alias — see scripts/purge-twelvedata-market-data-cache.mjs for
// the same reasoning. KEEP THE HASH/PREFIX LOGIC IN SYNC with that file if
// either ever changes.
//
// Run with:
//   node --experimental-strip-types scripts/create-dev-api-token.mjs --email=you@example.com --name="Dev testing" --confirm=CREATE-DEV-TOKEN
import "dotenv/config";
import { randomBytes, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const REQUIRED_CONFIRM = "CREATE-DEV-TOKEN";
const TOKEN_PREFIX = "td_live_";
const DISPLAY_PREFIX_LENGTH = 8;

function readArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

async function main() {
  const email = readArg("email");
  const name = readArg("name") ?? "Dev testing";
  const confirm = readArg("confirm");

  if (confirm !== REQUIRED_CONFIRM) {
    console.error(`Refusing to run: pass --confirm=${REQUIRED_CONFIRM} exactly.`);
    process.exitCode = 1;
    return;
  }
  if (!email) {
    console.error("Usage: --email=<existing user email> [--name=<label>] --confirm=" + REQUIRED_CONFIRM);
    process.exitCode = 1;
    return;
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (!user) {
      console.error(`No user found with email "${email}". This script never creates a user.`);
      process.exitCode = 1;
      return;
    }

    const secret = randomBytes(32).toString("base64url");
    const rawToken = `${TOKEN_PREFIX}${secret}`;
    const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
    const tokenPrefix = rawToken.slice(0, TOKEN_PREFIX.length + DISPLAY_PREFIX_LENGTH);

    const token = await prisma.apiToken.create({
      data: { userId: user.id, name, tokenHash, tokenPrefix },
      select: { id: true, name: true, createdAt: true },
    });

    console.log(`Created ApiToken "${token.name}" (id: ${token.id}) for ${user.email}.`);
    console.log("");
    console.log("Raw token (shown ONCE — store it securely now, it cannot be recovered):");
    console.log(rawToken);
    console.log("");
    console.log('Test it with:');
    console.log(`  curl -H "Authorization: Bearer ${rawToken}" http://localhost:3000/api/v1/me`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Token creation failed:", error);
  process.exitCode = 1;
});
