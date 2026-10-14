"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { deleteCampaignAction } from "@/app/marketing/campaigns/actions";

/** Delete a campaign with no sales; its leads move to the main pipeline. */
export function DeleteCampaignButton({ campaignId, campaignName }: { campaignId: number; campaignName: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();

  async function run() {
    const ok = await confirm({
      title: `Delete ${campaignName}?`,
      body: "This removes the campaign, its landing page, offers and pipeline. Its leads move to your main pipeline. Drafts it already made (blog post, emails, post designs) stay where they are. A campaign with sales can't be deleted.",
      confirmLabel: "Delete campaign",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await deleteCampaignAction(campaignId);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.leadsMoved ? `Campaign deleted. ${r.leadsMoved} ${r.leadsMoved === 1 ? "lead" : "leads"} moved to the main pipeline.` : "Campaign deleted");
      router.push("/marketing/campaigns");
      router.refresh();
    });
  }

  return (
    <Button variant="ghost" size="sm" onClick={() => void run()} loading={pending} style={{ justifySelf: "start", color: "var(--danger)" }}>
      <Trash2 size={14} /> Delete campaign
    </Button>
  );
}
