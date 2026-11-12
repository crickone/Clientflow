"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setTrainingModeAction } from "@/app/clients/[id]/programActions";

/** Coach guided or DIY, on the client page. DIY adds the program library to the member's app. */
export function TrainingModeSwitch({ clientId, mode }: { clientId: number; mode: "coach" | "diy" }) {
  const router = useRouter();
  const [value, setValue] = useState(mode);
  const [pending, start] = useTransition();
  // The page can change the mode too (a refresh after another edit): follow it.
  useEffect(() => setValue(mode), [mode]);

  function pick(next: "coach" | "diy") {
    if (next === value) return;
    start(async () => {
      const r = await setTrainingModeAction(clientId, next);
      if (!r.ok) return void toast.error(r.error);
      setValue(next);
      if (next === "coach") toast.success(r.paused ? "Switched to coach guided. Their DIY program is paused." : "Switched to coach guided.");
      else toast.success(r.resumed ? "Switched to DIY. Their paused program is running again." : "Switched to DIY.");
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
