import { requireUser } from "@/server/guards";
import { listUserPropFirms } from "@/server/services/prop-firms.service";
import { toUserPropFirmDTO } from "@/server/services/prop-firms.mapper";
import { FadeIn } from "@/components/shared/motion";
import { AddAccountWizard } from "@/components/prop-firms/add-account-wizard/wizard";

export default async function AddAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ firmId?: string }>;
}) {
  const user = await requireUser();
  const { firmId } = await searchParams;

  const firmsRaw = await listUserPropFirms(user.id);
  const firms = firmsRaw.map((f) => toUserPropFirmDTO(f));

  return (
    <FadeIn className="mx-auto max-w-2xl">
      <AddAccountWizard firms={firms} preselectFirmId={firmId} />
    </FadeIn>
  );
}
