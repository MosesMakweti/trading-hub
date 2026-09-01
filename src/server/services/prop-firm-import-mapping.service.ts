import { prisma } from "@/server/db";
import type { ColumnMapping, ImportPlatform } from "@/domain/prop-firms/import/types";

export function listMappingTemplates(userId: string, platform?: ImportPlatform) {
  return prisma.propFirmImportMappingTemplate.findMany({
    where: { userId, ...(platform ? { platform } : {}) },
    orderBy: { updatedAt: "desc" },
  });
}

export async function saveMappingTemplate(
  userId: string,
  input: { name: string; platform: ImportPlatform; mapping: ColumnMapping },
) {
  return prisma.propFirmImportMappingTemplate.upsert({
    where: { userId_name: { userId, name: input.name } },
    create: { userId, name: input.name, platform: input.platform, columnMapping: input.mapping },
    update: { platform: input.platform, columnMapping: input.mapping },
  });
}

export async function deleteMappingTemplate(userId: string, id: string) {
  const owned = await prisma.propFirmImportMappingTemplate.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new Error("Mapping template not found.");
  await prisma.propFirmImportMappingTemplate.delete({ where: { id } });
}
