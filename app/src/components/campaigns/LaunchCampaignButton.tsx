"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Rocket } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";

/**
 * Launches a "ready" campaign from the hub detail page — fires launch_campaign
 * through the exact SAME write-approval-gated path the agent chat's Approve
 * card uses: POST /api/assistant/execute (@/app/api/assistant/execute/route.ts),
 * which re-derives the tenant from the signed-in session/membership
 * server-side (never trusts a client-supplied tenantId) and only accepts
 * tool names already in WRITE_TOOLS. There is no separate "hub" write path —
 * this button is just a second front door onto the identical
 * executeTool("launch_campaign", ...) call the chat's Approve button makes,
 * gated the same way an operator action is gated everywhere else in this
 * app: an explicit confirm (mirrors CampaignEditor's send() — the closest
 * analogous irreversible, real-world-effecting action in this codebase —
 * which also uses a plain window.confirm rather than the fancier
 * useConfirm() dialog).
 *
 * Only ever rendered by the detail page when campaign.status === "ready"
 * (every asset approved) — launchCampaignTool itself re-checks that
 * server-side regardless, so this is a UI nicety, not the enforcement point.
 */
export function LaunchCampaignButton({
  campaignId,
  campaignName,
}: {
  campaignId: number;
  campaignName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function launch() {
    if (
      !window.confirm(
        `Launch "${campaignName}" now? This publishes the blog post live and queues the email/social assets for you to send or post manually. This can't be undone.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/assistant/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actions: [{ name: "launch_campaign", input: { campaignId } }] }),
        });
        const data = await res.json().catch(() => null);
        const result = data?.results?.[0];
        if (!res.ok || !data?.ok || !result?.ok) {
          toast.error(result?.text || data?.error || "Failed to launch campaign.");
          return;
        }

        // result.text is launchCampaignTool's own JSON string (@/lib/agents/
        // tools.campaign.ts) — the same shape the chat bubble renders after
        // an Approve click. Parse it for the human `result` summary; fall
        // back to a generic message rather than let an unexpected shape
        // throw and hide a launch that actually succeeded.
        let message = "Campaign launched.";
        try {
          const parsed = JSON.parse(result.text);
          if (typeof parsed?.result === "string") message = parsed.result;
        } catch {
          // Keep the fallback message.
        }
        toast.success(message);
        router.refresh();
      } catch {
        toast.error("Failed to launch campaign — please try again.");
      }
    });
  }

  return (
    <Button onClick={launch} disabled={pending} loading={pending}>
      <Rocket size={14} />
      {pending ? "Launching…" : "Launch campaign"}
    </Button>
  );
}
