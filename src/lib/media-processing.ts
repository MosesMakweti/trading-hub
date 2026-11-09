import sharp from "sharp";

/**
 * Server-side image handling for every upload.
 *
 * 1. SNIFF — the real type is read from the file's leading bytes. The
 *    browser's declared type (and the file name) is never trusted: a file
 *    whose bytes aren't an accepted format is rejected.
 * 2. OPTIMIZE — raster screenshots (PNG, JPEG, WebP) are re-encoded to
 *    WebP: EXIF orientation applied, metadata (EXIF/GPS/ICC) stripped, the
 *    long edge capped. Screenshots with text stay sharp (near-lossless for
 *    PNG sources). GIF, AVIF, BMP, SVG and PDF are stored as uploaded.
 *    A re-encode that would come out LARGER than a WebP original keeps the
 *    original bytes (still sniffed and validated).
 */

export type SniffedType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"
  | "image/avif"
  | "image/bmp"
  | "image/svg+xml"
  | "application/pdf";

const startsWith = (b: Buffer, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

/** The file's real type from its contents, or null when it isn't a format we know. */
export function sniffMediaType(bytes: Buffer): SniffedType | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x42, 0x4d])) return "image/bmp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  // ISO-BMFF: "ftyp" at 4, brand avif/avis
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = bytes.subarray(8, 12).toString("ascii");
    if (brand === "avif" || brand === "avis") return "image/avif";
    return null;
  }
  // SVG is text: allow a BOM, whitespace, an XML prolog and comments before <svg.
  const head = bytes.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

/** Long-edge cap for stored screenshots: enough for a 1440p chart at full size. */
export const MAX_IMAGE_EDGE = 2560;
/** Decompression-bomb guard: refuse images over this many pixels before decoding them fully. */
const MAX_INPUT_PIXELS = 60_000_000;

const OPTIMIZABLE = new Set<SniffedType>(["image/png", "image/jpeg", "image/webp"]);

export interface PreparedUpload {
  bytes: Buffer;
  mimeType: SniffedType;
  fileName: string;
  width: number | null;
  height: number | null;
}

export class UploadRejectedError extends Error {}

function renamed(fileName: string, ext: string): string {
  const base = (fileName || "image").replace(/\.[A-Za-z0-9]{1,5}$/, "");
  return `${base || "image"}.${ext}`;
}

/**
 * Validates a file against the accepted types by its CONTENT and returns the
 * bytes to store (optimized where that applies).
 */
export async function prepareUpload(
  input: Buffer,
  fileName: string,
  accepted: ReadonlySet<string>,
  options: { optimize?: boolean } = {},
): Promise<PreparedUpload> {
  const sniffed = sniffMediaType(input);
  if (!sniffed || !accepted.has(sniffed)) {
    throw new UploadRejectedError(sniffed ? `Unsupported file type: ${sniffed}.` : "That file isn't a supported image.");
  }
  if (options.optimize === false || !OPTIMIZABLE.has(sniffed)) {
    return { bytes: input, mimeType: sniffed, fileName: fileName || "file", width: null, height: null };
  }

  let pipeline: sharp.Sharp;
  let meta: sharp.Metadata;
  try {
    pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    meta = await pipeline.metadata();
  } catch {
    throw new UploadRejectedError("That image couldn't be read — it may be corrupted or too large.");
  }

  let out: { data: Buffer; info: sharp.OutputInfo };
  try {
    out = await pipeline
      .rotate() // apply EXIF orientation, then the metadata is dropped below
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
      .webp(sniffed === "image/png" ? { nearLossless: true, quality: 80, effort: 4 } : { quality: 88, effort: 4 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    // Corruption often only shows once the pixels are decoded.
    throw new UploadRejectedError("That image couldn't be read — it may be corrupted or too large.");
  }

  // An already-compact WebP with nothing to strip or shrink: keep the original bytes.
  const resized = (meta.width ?? 0) > MAX_IMAGE_EDGE || (meta.height ?? 0) > MAX_IMAGE_EDGE;
  if (sniffed === "image/webp" && !resized && !meta.exif && out.data.length >= input.length) {
    return { bytes: input, mimeType: "image/webp", fileName: fileName || "image.webp", width: meta.width ?? null, height: meta.height ?? null };
  }
  return {
    bytes: out.data,
    mimeType: "image/webp",
    fileName: renamed(fileName, "webp"),
    width: out.info.width,
    height: out.info.height,
  };
}
