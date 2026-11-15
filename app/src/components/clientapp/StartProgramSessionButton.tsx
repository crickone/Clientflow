// app/src/components/clientapp/StartProgramSessionButton.tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { startProgramSessionAction } from "@/app/app/programs/actions";

/** Opens the member's next program session in the logger (or the one already open). */
export function StartProgramSessionButton({ label, compact }: { label: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function go() {
    start(async () => {
      const r = await startProgramSessionAction();
      if (r.ok) return router.push(`/app/workouts/log/${r.sessionId}`);
      const openId = "inProgressId" in r ? r.inProgressId : undefined;
      toast.error(r.error, openId ? { action: { label: "Open it", onClick: () => router.push(`/app/workouts/log/${openId}`) } } : undefined);
    });
  }

  return (
    <Button onClick={go} loading={pending} style={compact ? { width: "auto", height: 44, flexShrink: 0 } : { width: "100%" }}>
      <Play size={16} /> {label}
    </Button>
  );
}
