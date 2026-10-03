import Link from "next/link";
import { Megaphone } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

/** What is missing before ads can run, with the one place to fix it. */
export function AdsNotConnected({ hasPage, hasAdAccount }: { hasPage: boolean; hasAdAccount: boolean }) {
  const message = !hasPage
    ? "Ads run from your Facebook Page and are paid from your own ad account. Connect Facebook and tick both your Page and your ad account."
    : !hasAdAccount
      ? "Your Page is connected but no ad account is chosen. In Facebook settings, choose the ad account this business advertises from."
      : "Reconnect Facebook so AdonisAgent can manage ads on your ad account.";
  return (
    <EmptyState
      icon={<Megaphone size={22} strokeWidth={1.75} />}
      title="Connect your ad account"
      message={message}
      action={
        <Link href="/settings/integrations/facebook">
          <Button>Open Facebook settings</Button>
        </Link>
      }
    />
  );
}
