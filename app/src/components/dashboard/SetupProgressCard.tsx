"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";

import { dismissSetupAction } from "@/app/setup/actions";

interface Props {
  /** Null when setup is finished or dismissed; the line can still show for a missing brief. */
  setup: { requiredDone: number; requiredTotal: number; nextHref: string | null; nextTitle: string | null } | null;
  /** The business brief is empty: it becomes the "next" item, since replies and content depend on it. */
  briefMissing: boolean;
}

/**
 * One slim line at the top of the dashboard for everything still to set up:
 * the onboarding checklist and the business brief, which used to be two
 * separate banners. Visibility is decided by the caller.
 */
export function SetupProgressCard({ setup, briefMissing }: Props) {
  const router = useRouter();
  const [dismissing, startDismiss] = useTransition();
  const pct = setup && setup.requiredTotal > 0 ? Math.min(100, Math.round((setup.requiredDone / setup.requiredTotal) * 100)) : 0;
  const next = briefMissing
    ? { text: "Add your business brief so Adonis can answer questions about your business", href: "/settings/business" }
    : setup?.nextTitle
      ? { text: setup.nextTitle, href: setup.nextHref ?? "/setup" }
      : { text: "Finish setting up", href: "/setup" };

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
    <div className="dash-setup">
      {setup && (
        <>
          <div
            role="progressbar"
            aria-label="Setup progress"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="dash-setup-bar"
          >
            <div style={{ width: `${Math.max(pct, 4)}%` }} />
          </div>
          <span className="dash-setup-count">
            Setup {setup.requiredDone} of {setup.requiredTotal}
          </span>
        </>
      )}
      <span className="dash-setup-next">Next: {next.text}</span>
      <Link href={next.href} className="dash-setup-go">
        Continue
      </Link>
      {setup && (
        <button type="button" className="dash-setup-x" onClick={dismiss} disabled={dismissing} aria-label="Dismiss setup">
          <X size={16} />
        </button>
      )}
    </div>
  );
}
