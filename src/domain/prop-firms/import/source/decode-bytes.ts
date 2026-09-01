/**
 * Turns the raw bytes of a text-based upload into a normalized Unicode string,
 * BEFORE any HTML / XML / delimited parsing runs.
 *
 * Broker and prop-firm exports are frequently NOT UTF-8: MetaTrader's HTML
 * "Trade History Report" is UTF-16 little-endian with a BOM, some brokers emit
 * UTF-16BE or a UTF-8 BOM, and older tools emit Latin-1. Decoding any of those
 * with `buffer.toString("utf8")` yields a string riddled with U+0000 (for the
 * UTF-16 cases) or U+FFFD, which then defeats format detection and table
 * extraction ("no recognizable trade table").
 */

export interface DecodeResult {
  text: string;
  encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "latin1";
}

function hasBom(bytes: Uint8Array, sig: number[]): boolean {
  return bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
}

/** Heuristic for a BOM-less UTF-16 file: in ASCII-heavy content every other
 *  byte is 0x00. Odd-index NULs dominate → little-endian; even-index → big. */
function sniffBomlessUtf16(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  if (sample.length < 16) return null;
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0x00) {
      if (i % 2 === 0) evenNul += 1;
      else oddNul += 1;
    }
  }
  const ratio = (evenNul + oddNul) / sample.length;
  if (ratio < 0.15) return null; // not enough NULs to be UTF-16 text
  return oddNul >= evenNul ? "utf-16le" : "utf-16be";
}

function decodeWith(bytes: Uint8Array, label: string): string {
  return new TextDecoder(label, { fatal: false }).decode(bytes);
}

/**
 * Detects UTF-8, UTF-8+BOM, UTF-16LE+BOM, UTF-16BE+BOM, a BOM-less UTF-16, and
 * falls back to Latin-1 for byte streams that aren't valid UTF-8. The returned
 * string has its BOM stripped but newlines are left as-is (call
 * `normalizeNewlines` after).
 */
export function decodeBytes(bytes: Uint8Array): DecodeResult {
  if (hasBom(bytes, [0xff, 0xfe])) {
    return { text: stripBom(decodeWith(bytes, "utf-16le")), encoding: "utf-16le" };
  }
  if (hasBom(bytes, [0xfe, 0xff])) {
    return { text: stripBom(decodeWith(bytes, "utf-16be")), encoding: "utf-16be" };
  }
  if (hasBom(bytes, [0xef, 0xbb, 0xbf])) {
    return { text: decodeWith(bytes.subarray(3), "utf-8"), encoding: "utf-8-bom" };
  }

  const bomless = sniffBomlessUtf16(bytes);
  if (bomless) {
    return { text: stripBom(decodeWith(bytes, bomless)), encoding: bomless };
  }

  // Try strict UTF-8; if the bytes aren't valid UTF-8, fall back to Latin-1
  // (never throws, every byte maps to a code point) rather than littering the
  // string with replacement characters.
  try {
    return { text: decodeWith2(bytes, "utf-8", true), encoding: "utf-8" };
  } catch {
    return { text: decodeWith(bytes, "latin1"), encoding: "latin1" };
  }
}

function decodeWith2(bytes: Uint8Array, label: string, fatal: boolean): string {
  return new TextDecoder(label, { fatal }).decode(bytes);
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** CRLF / lone-CR → LF. Run after `decodeBytes`. */
export function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

/** decode + newline-normalize in one step — the usual entry point for readers. */
export function decodeText(bytes: Uint8Array): string {
  return normalizeNewlines(decodeBytes(bytes).text);
}
