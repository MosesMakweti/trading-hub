import { requireUser } from "@/server/guards";
import { getDataCounts } from "@/server/services/data-management.service";
import { DataManagementView } from "@/components/settings/data-management-view";
import { FadeIn } from "@/components/shared/motion";

export default async function DataManagementPage() {
  const user = await requireUser();
  const counts = await getDataCounts(user.id);

  return (
    <FadeIn className="mx-auto max-w-2xl">
      <DataManagementView counts={counts} />
    </FadeIn>
  );
}
