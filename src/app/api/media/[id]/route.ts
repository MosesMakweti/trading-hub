import { auth } from "@/server/auth";
import { prisma } from "@/server/db";
import { readMediaFile } from "@/lib/media-storage";

export const runtime = "nodejs";

/**
 * Serves one stored image — but only to the user who owns it. There is no public
 * storage: files live in a private dir and are streamed only after the session is
 * checked and the asset is scoped to `userId`. The sandbox CSP + nosniff headers
 * neutralize script execution for uploaded SVGs on direct navigation.
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
  } catch {
    return new Response("Not found", { status: 404 });
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
