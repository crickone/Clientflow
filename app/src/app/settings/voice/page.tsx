import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { getTenantAddon } from "@/lib/billing/addons";
import { buildFirstMessage, defaultPersona, getVoiceAgentConfig } from "@/lib/voice/config";
import { voiceConfigured } from "@/lib/voice/elevenlabs";
import {
  getMonthUsage,
  getVoiceCapCents,
  includedMinutesRemaining,
  trialSecondsRemaining,
} from "@/lib/voice/usage";
import { getVoicePricePerMinuteCents } from "@/lib/voice/pricing";
import { getVoiceBalanceCents } from "@/lib/voice/credits";
import { listRecentCalls } from "@/lib/voice/calls";
import { VoiceSettingsView } from "@/components/settings/VoiceSettingsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Voice agent — AdonisAgent" };

export default async function VoiceSettingsPage() {
  await requireAdminPage();
  const tenant = getCurrentTenant();
  const addon = getTenantAddon(tenant.id, "voice");
  const config = getVoiceAgentConfig();

  return (
    <div className="app-page" style={{ maxWidth: 860 }}>
      <PageHeader
        eyebrow="Settings"
        title="Voice agent"
        subtitle="The AI that phones your leads — what it says, which number it calls from, and what it has cost this month."
        actions={
          <Link href="/settings">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All settings
            </Button>
          </Link>
        }
      />
      <VoiceSettingsView
        config={config}
        defaultPersona={defaultPersona()}
        firstMessage={buildFirstMessage()}
        providerConfigured={voiceConfigured()}
        addonStatus={addon?.status ?? null}
        money={{
          balanceCents: getVoiceBalanceCents(tenant.id),
          capCents: getVoiceCapCents(tenant.id),
          pricePerMinuteCents: getVoicePricePerMinuteCents(),
          includedMinutesRemaining: includedMinutesRemaining(tenant.id),
          trialMinutesRemaining: Math.floor(trialSecondsRemaining(tenant.id) / 60),
          month: getMonthUsage(tenant.id),
        }}
        recentCalls={listRecentCalls(20).map((c) => ({
          id: c.id,
          status: c.status,
          toNumber: c.toNumber,
          durationSeconds: c.durationSeconds,
          costCents: c.costCents,
          outcome: c.outcome,
          createdAt: c.createdAt,
          leadId: c.leadId,
        }))}
      />
    </div>
  );
}
