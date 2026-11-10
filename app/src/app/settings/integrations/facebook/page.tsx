import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";

import { Card } from "@/components/ui/Card";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { facebookConfigured } from "@/lib/facebook/oauth";
import { listFacebookPages } from "@/lib/facebook/pages";
import { getMetaConnectionForTenant } from "@/lib/social/publisher";
import { listAdAccounts, getGrantInfo } from "@/lib/facebook/grants";
import { FacebookConnectCard } from "@/components/settings/FacebookConnectCard";

export const dynamic = "force-dynamic";

/** What the connect step reports back, in words. */
const ERRORS: Record<string, string> = {
  no_pages: "Facebook shared no Page. Reconnect and tick this business's Page.",
  pages_elsewhere: "Every Page Facebook shared is already connected to another business here, so nothing was connected.",
};

export default async function FacebookSettingsPage(props: { searchParams?: Promise<{ error?: string; left?: string }> }) {
  const searchParams = await props.searchParams;
  await requireAdminPage();
  const left = (searchParams?.left ?? "").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  const error = searchParams?.error ? ERRORS[searchParams.error] ?? searchParams.error : null;
  const tenantId = getCurrentMembership()!.tenant.id;

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Integrations"
        title="Facebook & Instagram"
        subtitle="Post, answer messages, collect leads and run ads, all from AdonisAgent."
      />
      {(error || left.length > 0) && (
        <Card style={{ marginBottom: 16, padding: "16px 18px" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <Info size={16} aria-hidden style={{ flexShrink: 0, marginTop: 2, color: "var(--warning)" }} />
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              {error && <p style={{ margin: 0 }}>{error}</p>}
              {left.length > 0 && (
                <p style={{ margin: error ? "8px 0 0" : 0 }}>
                  Facebook also shared {left.join(", ")}. {left.length === 1 ? "It is" : "They are"} connected to another
                  business here, so {left.length === 1 ? "it was" : "they were"} left there. To move a Page to this business,
                  disconnect it in the other business first, then reconnect here.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}
      <FacebookConnectCard
        configured={facebookConfigured()}
        pages={listFacebookPages(tenantId)}
        postingPageId={getMetaConnectionForTenant(tenantId)?.pageId ?? null}
        adAccounts={listAdAccounts(tenantId, { granted: true })}
        grant={getGrantInfo(tenantId)}
      />
    </div>
  );
}
