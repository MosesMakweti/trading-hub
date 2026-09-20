import { randomBytes, createHash } from "node:crypto";

import { prisma } from "@/server/db";

/**
 * TradingView Extension — Step 2 (docs/extension-api.md). Issuance/verification
 * for long-lived bearer tokens external clients (the future browser extension)
 * use instead of NextAuth's session cookie. Entirely separate credential space
 * — revoking every ApiToken a user has never touches their web session, and
 * vice versa.
 *
 * Hashing choice: SHA-256, not bcrypt. bcrypt exists to slow down brute-forcing
 * a LOW-ENTROPY human password; a generated token already carries 256 bits of
 * cryptographic randomness (`randomBytes(32)`), so it is not brute-forceable
 * regardless of hash speed — a fast, collision-resistant hash is the correct,
 * standard choice for this class of secret (the same reasoning GitHub/Stripe/
 * AWS-style API tokens use), and lets `verifyApiToken` do an indexed equality
 * lookup instead of iterating every stored hash.
 */

const TOKEN_PREFIX = "td_live_";
/** Shown back to the trader for display only ("...a1b2c3d4"), never enough
 *  on its own to authenticate. */
const DISPLAY_PREFIX_LENGTH = 8;

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Generates a new raw token. Returned ONCE to the caller — nothing in this
 *  module ever logs it, and only its hash is persisted. */
function generateRawToken(): { rawToken: string; tokenHash: string; tokenPrefix: string } {
  const secret = randomBytes(32).toString("base64url"); // 256 bits, URL-safe
  const rawToken = `${TOKEN_PREFIX}${secret}`;
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    tokenPrefix: rawToken.slice(0, TOKEN_PREFIX.length + DISPLAY_PREFIX_LENGTH),
  };
}

export interface ApiTokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

/** Creates a token for `userId` and returns it alongside the raw value — the
 *  ONLY time the raw value is ever available. Callers must show it to the
 *  trader immediately and never persist it themselves. */
export async function createApiToken(
  userId: string,
  name: string,
  expiresAt?: Date | null,
): Promise<{ rawToken: string; token: ApiTokenSummary }> {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) throw new Error("Token name is required.");
  if (trimmedName.length > 100) throw new Error("Token name is too long.");

  const { rawToken, tokenHash, tokenPrefix } = generateRawToken();
  const token = await prisma.apiToken.create({
    data: { userId, name: trimmedName, tokenHash, tokenPrefix, expiresAt: expiresAt ?? null },
    select: { id: true, name: true, tokenPrefix: true, createdAt: true, lastUsedAt: true, revokedAt: true, expiresAt: true },
  });
  return { rawToken, token };
}

/** Metadata only — never the hash, never anything that could reconstruct the
 *  raw token. Safe to render directly in a future "Connected Apps" UI. */
export async function listApiTokens(userId: string): Promise<ApiTokenSummary[]> {
  return prisma.apiToken.findMany({
    where: { userId },
    select: { id: true, name: true, tokenPrefix: true, createdAt: true, lastUsedAt: true, revokedAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Idempotent — revoking an already-revoked or missing token is a no-op
 *  success, never an error a caller needs to special-case. Ownership-scoped:
 *  a userId mismatch behaves exactly like "not found." */
export async function revokeApiToken(userId: string, tokenId: string): Promise<void> {
  await prisma.apiToken.updateMany({
    where: { id: tokenId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * The ONE place a raw bearer token is turned into an authenticated userId.
 * Returns null for every failure mode (unknown hash, revoked, expired) —
 * deliberately undifferentiated so `api-auth.ts` can return the same generic
 * 401 regardless of *why* a token didn't work, never confirming to a caller
 * that a given token string used to exist.
 */
export async function verifyApiToken(rawToken: string): Promise<{ userId: string } | null> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) return null;

  const tokenHash = hashToken(rawToken);
  const token = await prisma.apiToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true },
  });
  if (!token) return null;
  if (token.revokedAt != null) return null;
  if (token.expiresAt != null && token.expiresAt.getTime() <= Date.now()) return null;

  // Best-effort — a failed write here must never fail authentication itself.
  prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return { userId: token.userId };
}
