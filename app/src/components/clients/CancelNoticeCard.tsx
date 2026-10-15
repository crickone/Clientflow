"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { handleCancelAction } from "@/app/clients/memberActions";

/** A member's open notice to cancel, sent from the app: end the membership or keep it. */
export function CancelNoticeCard({ clientId, requestId, membershipName, when, reason }: { clientId: number; requestId: number; membershipName: string; when: string; reason: string | null }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();

  async function act(outcome: "ended" | "kept") {
    // Ask before the transition starts: a confirm awaited inside it never renders.
    if (outcome === "ended" && !(await confirm({ title: `End ${membershipName} now?`, body: "The membership is marked cancelled today.", confirmLabel: "End membership", destructive: true }))) return;
    start(async () => {
      const r = await handleCancelAction(clientId, requestId, outcome);
      if (!r.ok) toast.error(r.error);
      else toast.success(outcome === "ended" ? "Membership ended." : "Notice closed. Membership kept.");
      router.refresh();
    });
  }

  return (
    <Card className="cp-card cp-notice">
      <CardLabel>Asked to cancel</CardLabel>
      <p className="cp-notes" style={{ margin: "4px 0 6px" }}>
        Gave notice for {membershipName} in the app on {when}.{reason ? ` "${reason}"` : ""}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="outline" onClick={() => void act("ended")} disabled={pending}>
          End membership
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void act("kept")} disabled={pending}>
          Keep membership
        </Button>
      </div>
    </Card>
  );
}
