import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

import { prisma } from "@/server/db";

/**
 * MT5 Connector — credentials.
 *
 * Two secrets, both stored only as hashes:
 *
 *  1. PAIRING CODE — short, human-typed ("ABCD-EFGH", ~40 bits), lives 10
 *     minutes, single use. Stored as an HMAC keyed with the server secret,
 *     so a database dump alone cannot be used to brute-force live codes.
 *     Guessing online is rate-limited per client IP (Mt5PairingAttempt).
 *
 *  2. DEVICE TOKEN — `td_mt5_` + 256 random bits, issued once in exchange
 *     for a pairing code, stored as sha256 (same reasoning as ApiToken:
 *     high-entropy secrets need a fast collision-resistant hash, not
 *     bcrypt). Bound to exactly one Mt5Connection, and through it to one
 *     MT5 login + server and one TradingAccount. Ingest-only.
 *
 * Isolation from the ordinary API: `verifyApiToken` (api-tokens.service.ts)
 * accepts only the `td_live_` prefix, so an MT5 device token can never
 * authenticate /api/v1/trades, /strategies, /media or /me; and the MT5
 * routes accept only `td_mt5_`, so an ordinary API token can never ingest.
 */

export const MT5_TOKEN_PREFIX = "td_mt5_";
const DISPLAY_PREFIX_LENGTH = 8;

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
/** Crockford-style alphabet: no 0/O, 1/I/L, U — unambiguous when typed. */
const PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const PAIRING_CODE_LENGTH = 8;

export class Mt5ConnectorError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "Mt5ConnectorError";
  }
}

function pairingSecret(): string {
  const secret = process.env.MT5_PAIRING_SECRET ?? process.env.AUTH_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET (or MT5_PAIRING_SECRET) must be set to issue MT5 pairing codes.");
  }
  return "traditorium-dev-only-mt5-pairing-secret";
}

/** Uppercases and strips separators/whitespace so "abcd efgh" == "ABCD-EFGH". */
export function normalizePairingCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashPairingCode(code: string): string {
  return createHmac("sha256", pairingSecret()).update(`mt5-pairing:${normalizePairingCode(code)}`, "utf8").digest("hex");
}

export function generatePairingCode(): { code: string; codeHash: string } {
  let raw = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) raw += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return { code, codeHash: hashPairingCode(code) };
}

export function hashMt5Token(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Returned ONCE to the pairing caller; only the hash is persisted. */
export function generateMt5DeviceToken(): { rawToken: string; tokenHash: string; tokenPrefix: string } {
  const rawToken = `${MT5_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    rawToken,
    tokenHash: hashMt5Token(rawToken),
    tokenPrefix: rawToken.slice(0, MT5_TOKEN_PREFIX.length + DISPLAY_PREFIX_LENGTH),
  };
}

export function hashClientIp(ip: string): string {
  return createHmac("sha256", pairingSecret()).update(`mt5-ip:${ip}`, "utf8").digest("hex");
}

/** First hop of x-forwarded-for (set by Vercel), else x-real-ip, else "unknown". */
export function clientIpFrom(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export interface AuthenticatedMt5Connection {
  id: string;
  userId: string;
  tradingAccountId: string;
  status: "ACTIVE" | "PAUSED";
  login: string;
  server: string;
}

const UNAUTHORIZED = () => new Mt5ConnectorError("UNAUTHORIZED", 401, "Unauthorized");

/**
 * Resolves the bearer device token to its connection. Every failure — no
 * header, wrong prefix, unknown/revoked token, connection not paired, its
 * account deleted — is the SAME generic 401 (no oracle for which tokens
 * once existed). Binding to the MT5 identity is checked by `assertIdentity`.
 */
export async function authenticateMt5Request(request: Request): Promise<AuthenticatedMt5Connection> {
  const header = request.headers.get("authorization");
  if (!header) throw UNAUTHORIZED();
  const [scheme, raw] = header.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !raw) throw UNAUTHORIZED();
  const rawToken = raw.trim();
  if (!rawToken.startsWith(MT5_TOKEN_PREFIX)) throw UNAUTHORIZED();

  const connection = await prisma.mt5Connection.findUnique({
    where: { tokenHash: hashMt5Token(rawToken) },
    select: {
      id: true,
      userId: true,
      tradingAccountId: true,
      status: true,
      login: true,
      server: true,
      revokedAt: true,
      tradingAccount: { select: { deletedAt: true } },
    },
  });
  if (!connection) throw UNAUTHORIZED();
  if (connection.revokedAt != null) throw UNAUTHORIZED();
  if (connection.status !== "ACTIVE" && connection.status !== "PAUSED") throw UNAUTHORIZED();
  if (connection.tradingAccount.deletedAt != null) throw UNAUTHORIZED();
  if (!connection.login || !connection.server) throw UNAUTHORIZED();

  return {
    id: connection.id,
    userId: connection.userId,
    tradingAccountId: connection.tradingAccountId,
    status: connection.status,
    login: connection.login,
    server: connection.server,
  };
}

/** The terminal must still be logged into the MT5 account the token was
 *  issued for — a token copied to another account/terminal is refused. */
export function assertIdentity(connection: { login: string; server: string }, account: { login: string; server: string }): void {
  if (connection.login !== account.login || connection.server !== account.server.trim()) {
    throw new Mt5ConnectorError(
      "ACCOUNT_MISMATCH",
      403,
      "This connector token belongs to a different MT5 account. Re-pair the Expert Advisor on the account it should sync.",
    );
  }
}
