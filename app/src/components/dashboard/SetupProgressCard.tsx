"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { dismissSetupAction } from "@/app/setup/actions";

interface Props {
  requiredDone: number;
  requiredTotal: number;
  nextHref: string | null;
}

/**
 * Dashboard nudge for admins mid-onboarding — points at the `/setup` hub.
 * Visibility (admin-only, hidden once dismissed or fully resolved) is decided
 * by the caller (`src/app/dashboard/page.tsx`); this component just renders.
 */
export function SetupProgressCard({ requiredDone, requiredTotal, nextHref }: Props) {
  const router = useRouter();
  const [dismissing, startDismiss] = useTransition();
  const pct = requiredTotal > 0 ? Math.min(100, Math.round((requiredDone / requiredTotal) * 100)) : 0;

  function dismiss() {
    startDismiss(async () => {
      const res = await dismissSetupAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card style={{ marginBottom: 16, padding: 18, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
      <ListChecks size={20} color="var(--accent)" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: 15 }}>Finish setting up</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <div
            role="progressbar"
            aria-label="Setup progress"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ flex: 1, maxWidth: 260, height: 5, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}
          >
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
          </div>
          <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 11.5, color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
            {requiredDone}/{requiredTotal} done
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <Button variant="ghost" size="sm" onClick={dismiss} loading={dismissing}>
          Dismiss
        </Button>
        <Link href={nextHref ?? "/setup"}>
          <Button size="sm">Continue →</Button>
        </Link>
      </div>
    </Card>
  );
}
