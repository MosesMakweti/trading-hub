import { decodeBytes } from "./decode-bytes";
import { SOURCE_ERROR, SourceReadError, type ImportFileFormat } from "./types";

/**
 * Decides a file's real format from its **content signature first**, using the
 * filename extension and the browser MIME type only as tie-breakers. A file
 * uploaded as `application/octet-stream` (or with no type at all, which some
 * browsers do for `.csv`/`.xls`) is treated as "no MIME hint" rather than
 * rejected — the bytes decide.
 *
 * Never trusts the extension alone: an MT4 statement saved as `Statement.xls`
 * is HTML, a broker "CSV" is often `.txt`, etc.
 */

const GENERIC_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/download",
  "application/unknown",
]);

function ext(fileName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return m ? m[1].toLowerCase() : "";
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/** BOM/encoding-aware leading text (handles UTF-16LE/BE broker exports — a raw
 *  byte-by-byte read would stop at the first NUL of a UTF-16 file and see only
 *  "<"). Lower-cased, leading whitespace trimmed. */
function leadingText(decoded: string, limit = 2048): string {
  return decoded.slice(0, limit).replace(/^[\s﻿]+/, "").toLowerCase();
}

function sniffDelimiter(decoded: string): "," | "\t" | ";" | "|" {
  const firstLine = decoded.replace(/^[\s﻿]+/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<string, number> = {
    ",": (firstLine.match(/,/g) ?? []).length,
    "\t": (firstLine.match(/\t/g) ?? []).length,
    ";": (firstLine.match(/;/g) ?? []).length,
    "|": (firstLine.match(/\|/g) ?? []).length,
  };
  let best: "," | "\t" | ";" | "|" = ",";
  let bestCount = -1;
  for (const [d, c] of Object.entries(counts) as [",", number][]) {
    if (c > bestCount) {
      bestCount = c;
      best = d;
    }
  }
  return best;
}

export interface DetectedFormat {
  format: ImportFileFormat;
  delimiter?: string;
}

export function detectFileFormat(bytes: Uint8Array, fileName: string, mimeType: string | null): DetectedFormat {
  const e = ext(fileName);
  const mime = GENERIC_MIME_TYPES.has((mimeType ?? "").toLowerCase().trim()) ? "" : (mimeType ?? "").toLowerCase().trim();

  // --- Hard-reject signatures we can positively identify as not-a-statement ---
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) throw new SourceReadError(SOURCE_ERROR.UNSUPPORTED); // %PDF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) throw new SourceReadError(SOURCE_ERROR.UNSUPPORTED); // PNG
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) throw new SourceReadError(SOURCE_ERROR.UNSUPPORTED); // GIF8
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) throw new SourceReadError(SOURCE_ERROR.UNSUPPORTED); // JPEG
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21])) throw new SourceReadError(SOURCE_ERROR.UNSUPPORTED); // Rar!
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf])) throw new SourceReadError(SOURCE_ERROR.UNSUPPORTED); // 7z
  if (startsWith(bytes, [0x1f, 0x8b])) throw new SourceReadError(SOURCE_ERROR.UNSUPPORTED); // gzip
  if (startsWith(bytes, [0x4d, 0x5a])) throw new SourceReadError(SOURCE_ERROR.UNSUPPORTED); // MZ (exe/dll)

  // --- Binary spreadsheet signatures ---
  // XLSX / XLSM are ZIP containers.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return { format: "XLSX" };
  }
  // OLE2 compound file: legacy .xls, OR a password-encrypted .xlsx. The xlsx
  // reader disambiguates (and raises PASSWORD_PROTECTED where appropriate).
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return { format: "XLS" };
  }

  // Everything past here is text — decode BOM/encoding-aware (UTF-8, UTF-8 BOM,
  // UTF-16LE/BE with or without BOM) before sniffing.
  const decoded = decodeBytes(bytes).text;

  // --- Markup ---
  const head = leadingText(decoded);
  if (head.startsWith("<?xml")) {
    // An XHTML/HTML document can also open with an XML prolog — look a little
    // further for an <html>/<table> before committing to XML.
    if (/<html[\s>]/.test(head) || /<table[\s>]/.test(head) || /<!doctype html/.test(head)) {
      return { format: "HTML" };
    }
    return { format: "XML" };
  }
  if (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<head") ||
    head.startsWith("<table") ||
    head.startsWith("<meta") ||
    /^<[a-z!]/.test(head)
  ) {
    // Generic markup start. If the extension says XML and there's no HTML tag, honour it.
    if ((e === "xml" || mime.includes("xml")) && !/<html[\s>]/.test(head) && !/<table[\s>]/.test(head)) {
      return { format: "XML" };
    }
    return { format: "HTML" };
  }

  // --- Extension / MIME steer between the delimited-text flavours ---
  if (e === "xml" || mime === "text/xml" || mime === "application/xml") return { format: "XML" };
  if (e === "html" || e === "htm" || mime === "text/html") return { format: "HTML" };

  const delimiter = sniffDelimiter(decoded);
  if (e === "tsv" || mime === "text/tab-separated-values" || delimiter === "\t") {
    return { format: "TSV", delimiter: "\t" };
  }
  if (e === "csv" || mime === "text/csv" || mime === "application/vnd.ms-excel") {
    return { format: "CSV", delimiter };
  }
  if (e === "txt" || mime === "text/plain") {
    return { format: "TXT", delimiter };
  }

  // No extension, no MIME, not markup, not binary: assume delimited text and
  // let the reader/adapters decide if it's usable.
  return { format: "CSV", delimiter };
}
