"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setTrainingModeAction } from "@/app/clients/[id]/programActions";

/** Coach guided or DIY, on the client page. DIY adds the program library to the member's app. */
export function TrainingModeSwitch({ clientId, mode }: { clientId: number; mode: "coach" | "diy" }) {
  const router = useRouter();
  const [value, setValue] = useState(mode);
  const [pending, start] = useTransition();

  function pick(next: "coach" | "diy") {
    if (next === value) return;
    start(async () => {
      const r = await setTrainingModeAction(clientId, next);
      if (!r.ok) return void toast.error(r.error);
      setValue(next);
      toast.success(next === "diy" ? "Switched to DIY. Programs now show in their app." : "Switched to coach guided. Any DIY program is paused.");
      router.refresh();
    });
  }

  return (
    <span className="tm-switch" role="group" aria-label="Training mode">
      <button type="button" aria-pressed={value === "coach"} disabled={pending} onClick={() => pick("coach")}>
        Coach guided
      </button>
      <button type="button" aria-pressed={value === "diy"} disabled={pending} onClick={() => pick("diy")}>
        DIY
      </button>
    </span>
  );
}
