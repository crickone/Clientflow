"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { OctagonX } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { stopBroadcastAction } from "@/app/campaigns/whatsapp/actions";

/** Stop a broadcast that's scheduled or sending: messages already sent stay sent. */
export function StopBroadcastButton({ id }: { id: number }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  async function stop() {
    if (!(await confirm({ title: "Stop this broadcast?", body: "Messages already sent stay sent. Nobody else gets it.", confirmLabel: "Stop", destructive: true }))) return;
    start(async () => {
      const r = await stopBroadcastAction(id);
      if (r.ok) toast.success("Stopped.");
      else toast.error(r.error);
      router.refresh();
    });
  }
  return (
    <Button size="sm" variant="outline" onClick={() => void stop()} disabled={pending}>
      <OctagonX size={14} /> Stop sending
    </Button>
  );
}
