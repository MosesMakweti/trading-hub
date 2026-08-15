import { prisma } from "@/server/db";

/** The public catalog — active entries only, in curated order. Identity/
 *  branding data only; never read as "these are the firm's current rules". */
export function listActiveDirectoryEntries() {
  return prisma.propFirmDirectoryEntry.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
}
