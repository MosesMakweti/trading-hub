// Shared, framework/server-agnostic media constants — safe to import from
// BOTH server code (media.service.ts, the upload route) and client
// components (image-attachments.tsx), unlike media.service.ts itself, which
// pulls in Prisma and can't be imported as a value from client code (a
// `import type` from it is fine and erased at compile time; a real value
// import is not).

/** The browser-safe image formats we accept everywhere. */
export const ACCEPTED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
  "image/bmp",
] as const;

/** Prop Firm certificates/evidence accept PDFs too (spec: "Support images and
 *  PDFs"); every other owner type stays image-only via ACCEPTED_IMAGE_MIME. */
export const ACCEPTED_DOCUMENT_MIME = [...ACCEPTED_IMAGE_MIME, "application/pdf"] as const;

/** Max upload size (bytes) — validated server-side in the upload route. */
export const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB

/** Per-owner (and per-category) attachment cap, so no single record grows an
 * unbounded gallery. Mirrored in the client uploader. */
export const MAX_ATTACHMENTS_PER_OWNER = 12;
