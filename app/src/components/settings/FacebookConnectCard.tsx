"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Check, Megaphone, MessageCircle, Plug, Send, Target, Unplug, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { disconnectFacebookPageAction, refreshAdAccountsAction, setPostingPageAction } from "@/app/settings/integrations/facebook/actions";
// Type-only — lib/facebook/{pages,grants}.ts are `server-only`.
import type { FacebookPageRow } from "@/lib/facebook/pages";
import type { AdAccountRow, GrantInfo } from "@/lib/facebook/grants";

/**
 * Facebook & Instagram connection. Not connected: what connecting turns on,
 * and one button (the OAuth redirect, GET /api/facebook/connect). Connected:
 * the Page(s), their Instagram, the ad accounts, and a short readiness list.
 * Disconnect / choose-posting-Page are server actions. The Meta app's own
 * setup (redirect URI, webhook, verify token) is agency-side and lives in the
 * runbook, not in front of the business.
 */

const CAPABILITIES = [
  { icon: Send, title: "Posting", body: "Scheduled posts go out to your Page and Instagram." },
  { icon: MessageCircle, title: "Messages", body: "Messenger and Instagram DMs arrive in your inbox." },
  { icon: UserPlus, title: "Lead ads", body: "Form leads land in Leads the moment they submit." },
  { icon: Target, title: "Ads", body: "Run ads on your own ad account. Meta bills you directly." },
] as const;

const muted: React.CSSProperties = { fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.5 };
const sectionLabel: React.CSSProperties = { fontSize: 12, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em" };

export function FacebookConnectCard({
  configured,
  pages,
  postingPageId,
  adAccounts,
  grant,
}: {
  configured: boolean;
  pages: FacebookPageRow[];
  postingPageId: string | null;
  adAccounts: AdAccountRow[];
  grant: GrantInfo | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, start] = useTransition();

  if (!configured) {
    return (
      <Card style={{ padding: 24 }}>
        <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>Facebook is not available on this account yet. Contact AdonisAgent support.</div>
      </Card>
    );
  }

  async function disconnect(pageId: string) {
    const page = pages.find((p) => p.pageId === pageId);
    const ok = await confirm({
      title: `Disconnect ${page?.pageName ?? "this Page"}?`,
      body: "Posts stop going out to it, its messages and leads stop arriving, and ads run from it pause until you reconnect.",
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await disconnectFacebookPageAction(pageId);
      if (!res.ok) return void toast.error(res.error ?? "Couldn't disconnect.");
      toast.success("Page disconnected");
      router.refresh();
    });
  }

  function postFrom(pageId: string) {
    start(async () => {
      const res = await setPostingPageAction(pageId);
      if (!res.ok) return void toast.error(res.error ?? "Couldn't change the Page.");
      toast.success("Posts and ads will use this Page");
      router.refresh();
    });
  }

  function findAdAccounts() {
    start(async () => {
      const res = await refreshAdAccountsAction();
      if (!res.ok) return void toast.error(res.error ?? "Couldn't reach Facebook.");
      if (!res.found) return void toast.error("Facebook still lists no ad account. Reconnect and tick it on the ad accounts step.");
      toast.success(res.found === 1 ? "Ad account found" : `${res.found} ad accounts found`);
      router.refresh();
    });
  }

  // ── Not connected ────────────────────────────────────────────────────────
  if (pages.length === 0) {
    return (
      <Card style={{ padding: 24, display: "grid", gap: 22 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <div key={title} style={{ display: "flex", gap: 12, padding: 14, border: "1px solid var(--hairline)", borderRadius: "var(--radius)" }}>
              <Icon size={18} strokeWidth={1.75} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
                <div style={{ ...muted, marginTop: 2 }}>{body}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {/* OAuth redirect — a plain anchor, not a fetch. */}
          <a href="/api/facebook/connect">
            <Button>
              <Plug size={15} /> Connect Facebook
            </Button>
          </a>
          <span style={muted}>Facebook asks which Page, Instagram account and ad account to share.</span>
        </div>
      </Card>
    );
  }

  // ── Connected ────────────────────────────────────────────────────────────
  const posting = pages.find((p) => p.pageId === postingPageId) ?? pages[pages.length - 1];
  const ready: Array<{ ok: boolean; label: string; retry?: boolean }> = [
    { ok: true, label: "Posting to Facebook" },
    { ok: Boolean(posting.igUsername), label: posting.igUsername ? "Posting to Instagram" : "Instagram: link an Instagram account to your Page, then reconnect" },
    { ok: Boolean(posting.subscribedAt), label: posting.subscribedAt ? "Messages and lead ads" : "Messages and lead ads: reconnect to switch these on" },
    { ok: adAccounts.length > 0, label: adAccounts.length ? "Ads" : "Ads: no ad account found yet", retry: adAccounts.length === 0 },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card style={{ padding: 24, display: "grid", gap: 18 }}>
        <div style={sectionLabel}>{pages.length === 1 ? "Page" : "Pages"}</div>
        {pages.map((p) => (
          <div key={p.pageId} style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{p.pageName ?? p.pageId}</span>
                {p.pageId === posting.pageId && pages.length > 1 && <Badge tone="success">In use</Badge>}
              </div>
              <div style={{ ...muted, display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                <AtSign size={12} />
                {p.igUsername ?? "No Instagram linked"}
              </div>
            </div>
            {pages.length > 1 && p.pageId !== posting.pageId && (
              <Button variant="outline" size="sm" onClick={() => postFrom(p.pageId)} disabled={busy}>
                Use this Page
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => disconnect(p.pageId)} disabled={busy}>
              <Unplug size={14} /> Disconnect
            </Button>
          </div>
        ))}

        {adAccounts.length > 0 && (
          <>
            <div style={{ borderTop: "1px solid var(--hairline)" }} />
            <div style={sectionLabel}>{adAccounts.length === 1 ? "Ad account" : "Ad accounts"}</div>
            {adAccounts.map((a) => (
              <div key={a.adAccountId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Megaphone size={15} strokeWidth={1.75} style={{ color: "var(--text-tertiary)" }} />
                <span style={{ fontSize: 14, color: "var(--text-primary)" }}>{a.name ?? a.adAccountId}</span>
                {a.currency && <span style={muted}>{a.currency}</span>}
                {a.accountStatus !== null && a.accountStatus !== 1 && <Badge tone="warning">Check in Ads Manager</Badge>}
              </div>
            ))}
          </>
        )}
      </Card>

      <Card style={{ padding: 24, display: "grid", gap: 10 }}>
        {ready.map((r) => (
          <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: r.ok ? "var(--text-primary)" : "var(--text-tertiary)" }}>
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: r.ok ? "var(--accent)" : "transparent",
                border: r.ok ? "none" : "1px solid var(--hairline)",
                color: "var(--bg)",
                flexShrink: 0,
              }}
            >
              {r.ok && <Check size={12} strokeWidth={3} />}
            </span>
            {r.label}
            {r.retry && (
              <Button variant="ghost" size="sm" onClick={findAdAccounts} disabled={busy} style={{ marginLeft: "auto" }}>
                Check again
              </Button>
            )}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
          <a href="/api/facebook/connect">
            <Button variant="outline" size="sm">
              <Plug size={14} /> Reconnect
            </Button>
          </a>
          <span style={muted}>
            {grant?.kind === "system_user"
              ? "This connection does not expire. Reconnect to add another Page or ad account."
              : grant?.expiresAt
                ? `Facebook asks you to reconnect by ${new Date(grant.expiresAt).toLocaleDateString("en-IE", { day: "numeric", month: "long" })}.`
                : "Reconnect to add another Page or ad account."}
          </span>
        </div>
      </Card>
    </div>
  );
}
