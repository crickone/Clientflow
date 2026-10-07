"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Check, MapPin, MessageSquareText, Search, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  disconnectGoogleAction,
  loadGoogleChoicesAction,
  saveGoogleChoicesAction,
} from "@/app/settings/integrations/google/actions";
import type { GoogleBusinessConnection, ListingChoice } from "@/lib/google/business";

type Choices = Awaited<ReturnType<typeof loadGoogleChoicesAction>>;

const ERRORS: Record<string, string> = {
  google_not_configured: "Google sign-in is not set up on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
  no_refresh_token: "Google did not hand back a lasting sign-in. Remove AdonisAgent from your Google account's third-party access, then connect again.",
  access_denied: "The Google sign-in was cancelled.",
  state_mismatch: "The sign-in expired or came from another tab. Try again.",
};

/**
 * Connect a Google account, then pick the three things it is used for: the
 * Business Profile listing (posts, reviews, profile numbers), the Search
 * Console site and the Analytics property. Each list loads and fails on its
 * own, because Google approves the Business Profile API separately and the
 * other two can work while it waits.
 */
export function GoogleConnectCard({
  configured,
  connection,
  error,
  justConnected,
}: {
  configured: boolean;
  connection: GoogleBusinessConnection | null;
  error: string | null;
  justConnected: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [choices, setChoices] = useState<Choices | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (error) toast.error(ERRORS[error] ?? decodeURIComponent(error));
    else if (justConnected) toast.success("Google connected. Now pick what to use it for.");
  }, [error, justConnected]);

  useEffect(() => {
    if (!connection) return;
    loadGoogleChoicesAction().then(setChoices);
  }, [connection]);

  function save(patch: Parameters<typeof saveGoogleChoicesAction>[0], done: string) {
    start(async () => {
      const res = await saveGoogleChoicesAction(patch);
      if (!res.ok) return void toast.error(res.error);
      toast.success(done);
      router.refresh();
    });
  }

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect Google?",
      body: "Posting to Google, review replies and Google numbers stop until it is connected again. Reviews already pulled in stay.",
      destructive: true,
      confirmLabel: "Disconnect",
    });
    if (!ok) return;
    start(async () => {
      await disconnectGoogleAction();
      router.refresh();
    });
  }

  if (!connection) {
    return (
      <Card style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <Feature icon={<MapPin size={16} />} text="Post updates and offers to your Google Business Profile from Content Studio." />
          <Feature icon={<MessageSquareText size={16} />} text="See every Google review in your inbox and reply, with Adonis drafting the reply." />
          <Feature icon={<BarChart3 size={16} />} text="How often you appear in Search and Maps, and the calls, website clicks and directions that follow." />
          <Feature icon={<Search size={16} />} text="Search Console and Analytics for your website, on the dashboard." />
        </div>
        <div>
          <a href="/api/google/business/connect" aria-disabled={!configured} onClick={(e) => !configured && e.preventDefault()}>
            <Button disabled={!configured}>Connect Google</Button>
          </a>
          {!configured && <p style={{ marginTop: 10, fontSize: 13, color: "var(--text-tertiary)" }}>{ERRORS.google_not_configured}</p>}
          <p style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
            Sign in with the Google account that owns or manages your business listing.
          </p>
        </div>
      </Card>
    );
  }

  const listingValue = connection.locationName ?? "";
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span className="inbox-pill inbox-pill--lead">Connected</span>
        <span style={{ fontSize: 14, color: "var(--text-primary)", flex: 1, minWidth: 0 }}>{connection.email}</span>
        <a href="/api/google/business/connect">
          <Button variant="outline" size="sm">Reconnect</Button>
        </a>
        <Button variant="ghost" size="sm" onClick={disconnect} disabled={pending}>
          <Unplug size={14} /> Disconnect
        </Button>
      </Card>

      <Picker
        icon={<MapPin size={16} />}
        title="Business Profile listing"
        hint="Posts, reviews and profile numbers come from this listing."
        current={connection.locationTitle}
        result={choices?.listings}
        render={(items: ListingChoice[]) => (
          <select
            value={listingValue}
            disabled={pending}
            onChange={(e) => {
              const l = items.find((x) => x.locationName === e.target.value);
              save({ listing: l ? { accountName: l.accountName, locationName: l.locationName, title: l.title } : null }, l ? `Using ${l.title}` : "Listing cleared");
            }}
            style={selectStyle}
          >
            <option value="">Choose a listing</option>
            {items.map((l) => (
              <option key={l.locationName} value={l.locationName}>
                {l.title}
                {l.address ? ` (${l.address})` : ""}
              </option>
            ))}
          </select>
        )}
      />

      <Picker
        icon={<Search size={16} />}
        title="Search Console site"
        hint="What people search on Google before they click through to your website."
        current={connection.searchConsoleSite}
        result={choices?.sites}
        render={(items: string[]) => (
          <select value={connection.searchConsoleSite ?? ""} disabled={pending} onChange={(e) => save({ site: e.target.value || null }, "Search Console saved")} style={selectStyle}>
            <option value="">Not used</option>
            {items.map((s) => (
              <option key={s} value={s}>
                {s.replace(/^sc-domain:/, "")}
              </option>
            ))}
          </select>
        )}
      />

      <Picker
        icon={<BarChart3 size={16} />}
        title="Google Analytics property"
        hint="Visits to your website, and where they came from."
        current={connection.ga4PropertyName}
        result={choices?.properties}
        render={(items: { property: string; name: string }[]) => (
          <select
            value={connection.ga4Property ?? ""}
            disabled={pending}
            onChange={(e) => {
              const p = items.find((x) => x.property === e.target.value) ?? null;
              save({ property: p }, "Analytics saved");
            }}
            style={selectStyle}
          >
            <option value="">Not used</option>
            {items.map((p) => (
              <option key={p.property} value={p.property}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      />
    </div>
  );
}

const selectStyle: React.CSSProperties = { width: "100%", height: 40, padding: "0 12px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)", fontSize: 14 };

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>
      <span style={{ color: "var(--text-tertiary)", marginTop: 2 }}>{icon}</span>
      {text}
    </div>
  );
}

function Picker<T>({
  icon,
  title,
  hint,
  current,
  result,
  render,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  current: string | null;
  result: { ok: true; items: T[] } | { ok: false; error: string } | undefined;
  render: (items: T[]) => React.ReactNode;
}) {
  return (
    <Card style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--text-tertiary)", display: "flex" }}>{icon}</span>
        <strong style={{ fontSize: 15, color: "var(--text-primary)" }}>{title}</strong>
        {current && (
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--success)" }}>
            <Check size={13} /> {current.replace(/^sc-domain:/, "")}
          </span>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-tertiary)" }}>{hint}</p>
      {!result ? (
        <div className="skeleton" style={{ height: 40, borderRadius: "var(--radius)" }} />
      ) : !result.ok ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--warning)", lineHeight: 1.5 }}>{result.error}</p>
      ) : result.items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-tertiary)" }}>Nothing found on this Google account.</p>
      ) : (
        render(result.items)
      )}
    </Card>
  );
}
