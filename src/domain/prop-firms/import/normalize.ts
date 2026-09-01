import { createHash } from "node:crypto";

import { Decimal } from "decimal.js";

import type { ImportSide } from "./types";

/**
 * Parses a locale-ambiguous numeric string into a canonical decimal string
 * (dot separator, optional leading minus). Handles thousands separators,
 * comma-decimal locales, parenthesized negatives, and a trailing minus some
 * brokers use instead of a leading one (e.g. "1,234.56-").
 *
 * A bare single separator with no other clue (e.g. "1,234" — could be
 * thousands-grouped 1234 or comma-decimal 1.234) is inherently ambiguous
 * without knowing the export locale; this treats a lone separator as
 * decimal, which matches MT4/MT5/most broker exports (no thousands
 * grouping in raw statement exports).
 */
export function parseLocaleNumber(raw: string): string {
  let s = raw.trim();
  if (s === "") throw new Error("Cannot parse empty numeric value.");

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  }
  if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  s = s.replace(/\s/g, "").replace(/[^\d.,]/g, "");
  if (s === "") throw new Error(`Cannot parse numeric value: "${raw}"`);

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  let normalized: string;
  if (lastDot === -1 && lastComma === -1) {
    normalized = s;
  } else {
    const decimalChar = lastDot > lastComma ? "." : ",";
    const thousandsChar = decimalChar === "." ? "," : ".";
    const idx = s.lastIndexOf(decimalChar);
    const integerPart = s.slice(0, idx).split(thousandsChar).join("");
    const fractionPart = s.slice(idx + 1).split(thousandsChar).join("");
    normalized = fractionPart.length > 0 ? `${integerPart}.${fractionPart}` : integerPart;
  }

  if (normalized === "" || normalized === ".") throw new Error(`Cannot parse numeric value: "${raw}"`);
  const value = new Decimal(normalized);
  return (negative ? value.negated() : value).toString();
}

const SIDE_ALIASES: Record<string, ImportSide> = {
  buy: "LONG",
  "buy limit": "LONG",
  "buy stop": "LONG",
  "buy stop limit": "LONG",
  b: "LONG",
  long: "LONG",
  l: "LONG",
  bought: "LONG",
  sell: "SHORT",
  "sell limit": "SHORT",
  "sell stop": "SHORT",
  "sell stop limit": "SHORT",
  s: "SHORT",
  short: "SHORT",
  sold: "SHORT",
};

export function normalizeSide(raw: string): ImportSide | null {
  return SIDE_ALIASES[raw.trim().toLowerCase()] ?? null;
}

const KNOWN_BROKER_SYMBOL_SUFFIXES = [".a", ".i", ".pro", ".ecn", ".raw", ".m", ".c", "_i", "_m", "-ecn", "+"];

/** Uppercases and strips a small, known list of broker/feed suffixes
 *  (".a", "_i", etc). Deliberately conservative — never touches futures
 *  contract codes (e.g. "ESZ25", "MESH24") since none of them match this
 *  fixed suffix list. `instrumentRaw` is always preserved separately for
 *  audit regardless of what this produces. */
export function normalizeSymbol(raw: string): string {
  let s = raw.trim().toUpperCase();
  for (const suffix of KNOWN_BROKER_SYMBOL_SUFFIXES) {
    const upper = suffix.toUpperCase();
    if (s.length > upper.length && s.endsWith(upper)) {
      s = s.slice(0, -upper.length);
      break;
    }
  }
  return s;
}

function getTimezoneOffsetMs(timeZone: string, atUtc: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(atUtc)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - atUtc.getTime();
}

/** Converts wall-clock components in `timeZone` (an IANA zone, e.g.
 *  "America/New_York", "Etc/GMT-2") to the correct UTC instant, including
 *  DST — via the standard two-pass Intl.DateTimeFormat round-trip (native,
 *  no timezone-database dependency). The rare DST-transition-hour ambiguity
 *  (at most once a year, for one hour) is an acceptable edge case for a
 *  broker-statement importer. */
export function localWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = getTimezoneOffsetMs(timeZone, new Date(naiveUtcMs));
  const candidateMs = naiveUtcMs - offset1;
  const offset2 = getTimezoneOffsetMs(timeZone, new Date(candidateMs));
  return new Date(naiveUtcMs - offset2);
}

const MT_DATETIME_PATTERN = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const MT_DATE_ONLY_PATTERN = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/;
const ISO_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;
const US_DATETIME_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i;

/** Parses MT4/MT5-style "YYYY.MM.DD HH:mm[:ss]" (also tolerating "-"/"/" and
 *  a "T" separator) and interprets it in `timeZone`. */
export function parseMtDateTime(raw: string, timeZone: string): Date {
  const trimmed = raw.trim();
  let match = MT_DATETIME_PATTERN.exec(trimmed);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    return localWallClockToUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? "0"), timeZone);
  }
  match = MT_DATE_ONLY_PATTERN.exec(trimmed);
  if (match) {
    const [, y, mo, d] = match;
    return localWallClockToUtc(Number(y), Number(mo), Number(d), 0, 0, 0, timeZone);
  }
  throw new Error(`Unrecognized MT-style date/time: "${raw}"`);
}

/** Best-effort parser for Generic CSV: tries ISO ("YYYY-MM-DD HH:mm[:ss]")
 *  then US-style ("MM/DD/YYYY HH:mm[:ss] [AM/PM]") then falls back to the
 *  MT pattern. True DD/MM-vs-MM/DD locale ambiguity for slash-dates has no
 *  general solution without an explicit user hint — documented limitation,
 *  not attempted here. */
export function parseGenericDateTime(raw: string, timeZone: string): Date {
  const trimmed = raw.trim();

  let match = ISO_DATETIME_PATTERN.exec(trimmed);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    return localWallClockToUtc(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? "0"), timeZone);
  }

  match = US_DATETIME_PATTERN.exec(trimmed);
  if (match) {
    const [, mo, d, y, hRaw, mi, s, meridiem] = match;
    let h = Number(hRaw);
    if (meridiem) {
      const upper = meridiem.toUpperCase();
      if (upper === "PM" && h < 12) h += 12;
      if (upper === "AM" && h === 12) h = 0;
    }
    return localWallClockToUtc(Number(y), Number(mo), Number(d), h, Number(mi), Number(s ?? "0"), timeZone);
  }

  return parseMtDateTime(trimmed, timeZone);
}

/** A stable dedupe fingerprint for an execution with no reliable platform
 *  id — normalized account+instrument+direction+quantity+price+timestamp
 *  (to the second)+currency, hashed. Two genuinely simultaneous, otherwise
 *  identical fills are NOT deduped by timestamp alone elsewhere in this
 *  pipeline — this fingerprint is only ever a fallback when no platform id
 *  exists, and callers accept that two truly identical rows (same
 *  instrument/side/qty/price/second/currency) collapse to one, which is the
 *  documented, intentional behavior for headerless/generic exports. */
export function computeExecutionFingerprint(input: {
  accountId: string;
  instrumentNormalized: string;
  direction: ImportSide;
  quantity: string;
  price: string;
  executedAt: Date;
  currency: string | null;
}): string {
  const key = [
    input.accountId,
    input.instrumentNormalized,
    input.direction,
    new Decimal(input.quantity).toString(),
    new Decimal(input.price).toString(),
    Math.floor(input.executedAt.getTime() / 1000),
    input.currency ?? "",
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export function computeTransactionFingerprint(input: {
  accountId: string;
  rawType: string;
  amount: string;
  currency: string | null;
  occurredAt: Date;
}): string {
  const key = [
    input.accountId,
    input.rawType.trim().toLowerCase(),
    new Decimal(input.amount).toString(),
    input.currency ?? "",
    Math.floor(input.occurredAt.getTime() / 1000),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

/** The stable per-row dedupe key: a platform id when one exists (scoped by
 *  kind so an execution id and a transaction id never collide), else the
 *  fingerprint. Always non-null — the single value the DB unique index
 *  enforces on. */
export function dedupeKeyForExecution(
  platformIds: { executionId: string | null; orderId: string | null; dealId: string | null },
  fingerprint: string,
): string {
  const id = platformIds.executionId ?? platformIds.dealId ?? platformIds.orderId;
  return id ? `exec:id:${id}` : `exec:fp:${fingerprint}`;
}

export function dedupeKeyForTransaction(platformTransactionId: string | null, fingerprint: string): string {
  return platformTransactionId ? `txn:id:${platformTransactionId}` : `txn:fp:${fingerprint}`;
}
