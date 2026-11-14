// app/src/components/clientapp/MyProgramControls.tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card } from "@/components/clientapp/ui";
import { endProgramAction, setProgramDaysAction, skipProgramSessionAction } from "@/app/app/programs/actions";
import { WEEKDAY_SHORT } from "@/lib/trainingProgress";

export function MyProgramControls({ canSkip, weekdays, canEnd = true }: { canSkip: boolean; weekdays: number[]; canEnd?: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [days, setDays] = useState<number[]>(weekdays);
  const [pending, start] = useTransition();
  // One confirm at a time: a double tap on Skip or End must not open two.
  const askingRef = useRef(false);
  const [asking, setAsking] = useState(false);
  const changed = days.join(",") !== weekdays.join(",");

  function toggle(d: number) {
    setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d].sort((a, b) => a - b)));
  }

  async function ask(opts: Parameters<typeof confirm>[0]): Promise<boolean> {
    if (askingRef.current) return false;
    askingRef.current = true;
    setAsking(true);
    try {
      return await confirm(opts);
    } finally {
      askingRef.current = false;
      setAsking(false);
    }
  }

  function saveDays() {
    start(async () => {
      const r = await setProgramDaysAction(days);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Training days saved");
      router.refresh();
    });
  }

  async function skip() {
    const ok = await ask({ title: "Skip this session?", body: "Your program moves on to the next session. The skip is recorded.", confirmLabel: "Skip it" });
    if (!ok) return;
    start(async () => {
      const r = await skipProgramSessionAction();
      if (!r.ok) return void toast.error(r.error);
      toast.success("Session skipped");
      router.refresh();
    });
  }

  async function end() {
    const ok = await ask({
      title: "End this program?",
      body: "Your sessions and the change log are kept. You can then start another program.",
      confirmLabel: "End program",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await endProgramAction();
      if (!r.ok) return void toast.error(r.error);
      toast.success("Program ended");
      router.push("/app/programs");
      router.refresh();
    });
  }

  return (
    <Card style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div className="td-label">Days you train</div>
        <div className="td-days">
          {WEEKDAY_SHORT.map((label, i) => (
            <button key={label} type="button" className="td-day" aria-pressed={days.includes(i + 1)} onClick={() => toggle(i + 1)}>
              {label}
            </button>
          ))}
        </div>
        {changed && (
          <Button variant="secondary" onClick={saveDays} loading={pending}>
            Save training days
          </Button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: canSkip && canEnd ? "1fr 1fr" : "1fr", gap: 8 }}>
        {canSkip && (
          <Button variant="secondary" onClick={skip} disabled={pending || asking}>
            Skip next session
          </Button>
        )}
        {canEnd && (
          <Button variant="secondary" onClick={end} disabled={pending || asking}>
            End program
          </Button>
        )}
      </div>
    </Card>
  );
}
