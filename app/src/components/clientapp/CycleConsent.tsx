"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Share2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/clientapp/ui";
import { setCycleConsentAction } from "@/app/app/actions";

/** What cycle tracking stores and who sees it, and the one button that turns it on. */
export function CycleConsent({ business }: { business: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Card style={{ display: "grid", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: "var(--text-primary)" }}>
        Log your periods and how you feel each day. The app works out where you are in your cycle, predicts your next period from your own history, and tells you what to expect for training.
      </p>
      <ul className="cy-terms">
        <li>
          <Lock size={16} />
          <span>
            <strong>Private to you.</strong> {business} can&apos;t see any of it unless you choose to share it with your coach. You can stop sharing at any time.
          </span>
        </li>
        <li>
          <Share2 size={16} />
          <span>
            <strong>What&apos;s stored:</strong> the days you log a period, and your daily check-ins (energy, mood, sleep, cramps, cravings, a note if you add one).
          </span>
        </li>
        <li>
          <Trash2 size={16} />
          <span>
            <strong>Delete it any time.</strong> One tap wipes everything.
          </span>
        </li>
      </ul>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-tertiary)" }}>
        This is not a fertility or contraception tool and doesn&apos;t predict fertile days. Predictions are estimates from what you log.
      </p>
      <Button
        size="lg"
        loading={pending}
        style={{ width: "100%" }}
        onClick={() =>
          start(async () => {
            await setCycleConsentAction();
            router.refresh();
          })
        }
      >
        Turn on cycle tracking
      </Button>
    </Card>
  );
}
