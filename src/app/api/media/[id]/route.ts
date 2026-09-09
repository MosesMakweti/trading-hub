import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { readMediaFile } from "@/lib/media-storage";

export const runtime = "nodejs";

/**
 * Serves one stored image — but only to the user who owns it. There is no public
 * storage: objects live in a private R2 bucket and are streamed only after the
 * session is checked and the asset is scoped to `userId`. The sandbox CSP +
 * nosniff headers neutralize script execution for uploaded SVGs on direct
 * navigation.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const asset = await prisma.mediaAsset.findFirst({
    where: { id, userId: session.user.id },
    select: { storageKey: true, mimeType: true },
  });
  if (!asset) return new Response("Not found", { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readMediaFile(asset.storageKey);
  } catch (e) {
    // A missing object is a 404; anything else (R2 outage, bad credentials) is a
    // real error worth surfacing rather than masking as "not found".
    if (e instanceof Error && e.name === "MediaNotFoundError") {
      return new Response("Not found", { status: 404 });
    }
    console.error("Failed to read media object:", e);
    return new Response("Storage error", { status: 502 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
