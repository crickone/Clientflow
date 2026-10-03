"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Plug, Unplug, CheckCircle2, Camera, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { disconnectFacebookPageAction, setPostingPageAction } from "@/app/settings/integrations/facebook/actions";
// Type-only — lib/facebook/pages.ts is `server-only`; importing just the type
// keeps it out of this client bundle (mirrors ImapConnectCard / DomainConnectCard).
import type { FacebookPageRow } from "@/lib/facebook/pages";

/**
 * "Connect Facebook" — the client OAuth-connects their Page(s) so scheduled
 * posts go out to the Page (and its linked Instagram) and Lead Ads flow
 * straight into Leads. One connected Page is the posting Page. Connect is a redirect (GET /api/facebook/connect), so
 * it's a plain link; disconnect is a server action (useTransition + toast +
 * refresh), same shape as the other connector cards. Fail-closed: when the Meta
 * app isn't configured the card just explains what to set.
 */
export function FacebookConnectCard({
  configured,
  pages,
  postingPageId,
  redirectUri,
  webhookUrl,
}: {
  configured: boolean;
  pages: FacebookPageRow[];
  postingPageId: string | null;
  redirectUri: string;
  webhookUrl: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [disconnecting, startDisconnect] = useTransition();
  const [choosing, startChoose] = useTransition();

  function postFrom(pageId: string) {
    startChoose(async () => {
      const res = await setPostingPageAction(pageId);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't change the posting Page.");
        return;
      }
      toast.success("Scheduled posts will go out from this Page");
      router.refresh();
    });
  }

  async function disconnect(pageId: string) {
    const page = pages.find((p) => p.pageId === pageId);
    if (
      !(await confirm({
        title: "Disconnect this Page?",
        body: `${page?.pageName ?? "This Page"} will stop receiving scheduled posts and its leads will stop flowing into Leads until you reconnect it.`,
        confirmLabel: "Disconnect",
        destructive: true,
      }))
    ) {
      return;
    }
    startDisconnect(async () => {
      const res = await disconnectFacebookPageAction(pageId);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't disconnect.");
        return;
      }
      toast.success("Page disconnected");
      router.refresh();
    });
  }

  return (
    <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Megaphone size={16} strokeWidth={1.75} />
        <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>Facebook and Instagram</strong>
        <span style={{ marginLeft: "auto" }}>
          <Badge tone={pages.length ? "green" : configured ? "neutral" : "amber"}>
            {pages.length ? `${pages.length} connected` : configured ? "Not connected" : "Not configured"}
          </Badge>
        </span>
      </div>

      {!configured ? (
        <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55 }}>
          Set <code>FACEBOOK_APP_ID</code>, <code>FACEBOOK_APP_SECRET</code> and{" "}
          <code>FACEBOOK_WEBHOOK_VERIFY_TOKEN</code> on the deploy to enable this integration, then reload.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55 }}>
            {pages.length
              ? "Scheduled posts go out from the posting Page and its linked Instagram account. Leads from every connected Page flow straight into Leads."
              : "Connect your Facebook account and choose your business's Page. Link your Instagram professional account to that Page first if you want posts to go to Instagram too."}
          </div>

          {pages.length > 0 && (
            <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
              {pages.map((p) => (
                <div
                  key={p.pageId}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--hairline)" }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>
                      {p.pageName ?? p.pageId}
                    </span>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        color: p.subscribedAt ? "var(--text-tertiary)" : "#b45309",
                        fontSize: 12,
                        marginTop: 2,
                      }}
                    >
                      {p.subscribedAt ? (
                        <>
                          <CheckCircle2 size={12} /> Subscribed to leads
                        </>
                      ) : (
                        "Not subscribed — reconnect to fix"
                      )}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-tertiary)", fontSize: 12, marginTop: 2 }}>
                      <Camera size={12} />
                      {p.igUsername ? `@${p.igUsername}` : "No Instagram account linked to this Page"}
                    </span>
                  </span>
                  {p.pageId === postingPageId ? (
                    <Badge tone="green">Posting</Badge>
                  ) : (
                    <Button variant="outline" onClick={() => postFrom(p.pageId)} disabled={choosing}>
                      <Send size={14} /> Post from here
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => disconnect(p.pageId)} disabled={disconnecting}>
                    <Unplug size={14} /> Disconnect
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div>
            {/* OAuth redirect — a plain anchor, not a fetch. */}
            <a href="/api/facebook/connect">
              <Button>
                <Plug size={14} /> {pages.length ? "Connect another Page" : "Connect Facebook"}
              </Button>
            </a>
          </div>
        </>
      )}

      <div
        style={{
          marginTop: 4,
          paddingTop: 12,
          borderTop: "1px solid var(--hairline)",
          fontSize: 12.5,
          color: "var(--text-tertiary)",
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: "var(--text-secondary)" }}>Meta app config</strong> (one-time, agency side):
        <div style={{ marginTop: 6 }}>OAuth redirect URI:</div>
        <code style={{ wordBreak: "break-all" }}>{redirectUri}</code>
        <div style={{ marginTop: 6 }}>Leadgen webhook URL:</div>
        <code style={{ wordBreak: "break-all" }}>{webhookUrl}</code>
        <div style={{ marginTop: 6 }}>
          Verify token: the <code>FACEBOOK_WEBHOOK_VERIFY_TOKEN</code> you set on the deploy.
        </div>
      </div>
    </Card>
  );
}
