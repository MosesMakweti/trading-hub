import { NextResponse } from "next/server";

import { requireApiUser } from "@/server/api-auth";
import { withCors, corsPreflight } from "@/server/api-cors";
import { ACCEPTED_IMAGE_MIME, MAX_FILE_SIZE } from "@/lib/media-constants";
import { saveMediaFile, deleteMediaFile } from "@/lib/media-storage";
import { prepareUpload, UploadRejectedError } from "@/lib/media-processing";
import { createStandaloneMediaAsset } from "@/server/services/media.service";

export const runtime = "nodejs";

/**
 * TradingView Extension — Step 8 (docs/extension-api.md's "Screenshot
 * handling" section). A THIN adapter — same shape as every other `/api/v1`
 * route — over `createStandaloneMediaAsset` (media.service.ts) and the
 * EXISTING `saveMediaFile` (lib/media-storage.ts, unchanged, same R2
 * bucket, same key format). It exists ONLY because the existing
 * `/api/media/upload` route requires an already-existing owner record
 * (`ownerType`/`ownerId`) at upload time, and the TradingView extension
 * needs to upload a chart capture BEFORE the Trade it will eventually
 * belong to exists (§15 — capture is deliberately decoupled from trade
 * creation). It does not duplicate MIME/size validation, storage-key
 * generation, or R2 upload logic — those are the exact same
 * constants/functions the web upload route already uses.
 *
 * Image-only (never the PDF-accepting set `/api/media/upload` allows for
 * Prop Firm evidence — a chart capture is always an image).
 *
 * The returned `mediaAssetId` is later passed straight into the EXISTING,
 * UNMODIFIED `POST /api/v1/trades`'s optional `mediaAssetId` field (Step
 * 3), which resolves it via `attachPlanScreenshot` — itself unmodified.
 */
export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.id;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return withCors(request, NextResponse.json({ error: "Malformed upload." }, { status: 400 }));
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return withCors(request, NextResponse.json({ error: "No file provided." }, { status: 400 }));
  }
  if (file.size === 0) {
    return withCors(request, NextResponse.json({ error: "The file is empty." }, { status: 400 }));
  }
  if (file.size > MAX_FILE_SIZE) {
    return withCors(request, NextResponse.json({ error: "Image is larger than the 8MB limit." }, { status: 413 }));
  }
  // Never trust a filename extension or the declared MIME type: the type is
  // sniffed from the file's bytes. Captures are stored as sent (no re-encode),
  // because the trade-plan screenshot flow reads their pixels and dimensions.
  let prepared;
  try {
    prepared = await prepareUpload(Buffer.from(await file.arrayBuffer()), file.name || "capture.png", new Set<string>(ACCEPTED_IMAGE_MIME), {
      optimize: false,
    });
  } catch (e) {
    if (e instanceof UploadRejectedError) {
      return withCors(request, NextResponse.json({ error: e.message }, { status: 415 }));
    }
    throw e;
  }
  const storageKey = await saveMediaFile(userId, prepared.bytes, prepared.mimeType);

  let asset;
  try {
    asset = await createStandaloneMediaAsset({
      userId,
      storageKey,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      fileSize: prepared.bytes.length,
    });
  } catch (e) {
    // Never leave the just-written R2 object orphaned if the DB write fails
    // (mirrors /api/media/upload's own cleanup-on-failure behavior).
    await deleteMediaFile(storageKey);
    throw e;
  }

  return withCors(
    request,
    NextResponse.json({ id: asset.id, url: asset.url, mimeType: asset.mimeType, fileSize: asset.fileSize }, { status: 201 }),
  );
}

export async function OPTIONS(request: Request) {
  return corsPreflight(request);
}
