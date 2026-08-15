import { FileWarning } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ImageAttachments } from "@/components/media/image-attachments";
import { formatDate } from "@/components/prop-firms/format";
import type { PropFirmAccountDTO } from "@/types/prop-firms";

export function DocumentsTab({ account }: { account: PropFirmAccountDTO }) {
  const milestoneOwners = account.milestones.map((m) => ({
    id: m.id,
    label: m.title ?? m.type.replace(/_/g, " "),
    date: m.achievedAt,
    documents: m.documents,
  }));
  const payoutOwners = account.payouts.map((p) => ({
    id: p.id,
    label: `Payout · ${p.status.replace(/_/g, " ").toLowerCase()}`,
    date: p.paidDate ?? p.requestedDate,
    documents: p.documents,
  }));

  const owners = [...milestoneOwners, ...payoutOwners];

  if (owners.length === 0) {
    return (
      <EmptyState
        icon={FileWarning}
        title="No documents yet"
        description="Certificates and confirmation emails uploaded when completing a stage or logging a payout will appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      {owners.map((owner) => (
        <div key={owner.id} className="glass rounded-xl p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">{owner.label}</span>
            {owner.date && <span className="text-xs text-muted-foreground">{formatDate(owner.date)}</span>}
          </div>
          <ImageAttachments
            ownerType="PROP_FIRM_MILESTONE"
            ownerId={owner.id}
            acceptDocuments
            initial={owner.documents}
          />
        </div>
      ))}
    </div>
  );
}
