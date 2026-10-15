"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, CircleCheck, Clock, Copy, Loader2, MailCheck, Plug, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  connectSendingDomainAction,
  disconnectSendingDomainAction,
  refreshSendingDomainAction,
} from "@/app/campaigns/domains/actions";
// Type-only: lib/marketing/domains.ts is `server-only`.
import type { SendingDomainRecord } from "@/lib/marketing/domains";
import { hostPart, recordFound, recordJob, rootOf } from "@/lib/marketing/domainRecordsModel";

/**
 * The business's own sending domain for email campaigns. Not connected: a
 * one-field form. Connected: where it stands in one line, a check per DNS
 * record, and the records themselves (open until everything is found, folded
 * away after), each value one click to copy.
 */
export function DomainConnectCard({ domain }: { domain: SendingDomainRecord | null }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, startConnect] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();
  const busy = connecting || refreshing || disconnecting;

  function connect() {
    const clean = value.trim();
    if (!clean) return;
    setError(null);
    startConnect(async () => {
      const res = await connectSendingDomainAction(clean);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(`Connected ${res.record.domain}. Add its DNS records next.`);
      setValue("");
      router.refresh();
    });
  }

  function refresh() {
    startRefresh(async () => {
      const res = await refreshSendingDomainAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.record.state === "verified") toast.success("Verified. Campaigns can send from this domain.");
      else toast("Not found yet. DNS changes usually show within an hour, and can take up to 48.");
      router.refresh();
    });
  }

  async function disconnect() {
    if (!domain) return;
    const ok = await confirm({
      title: `Disconnect ${domain.domain}?`,
      body: "Campaigns stop sending from this domain until you connect and verify it again.",
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!ok) return;
    startDisconnect(async () => {
      const res = await disconnectSendingDomainAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Sending domain disconnected");
      router.refresh();
    });
  }

  if (!domain) {
    return (
      <div className="sd">
        <Card className="sd-card">
          <div className="sd-hero">
            <span className="sd-badge" data-tone="neutral" aria-hidden>
              <MailCheck size={20} />
            </span>
            <div className="sd-hero-text">
              <h2>Send campaigns from your own domain</h2>
              <p>Emails from your own domain reach the inbox more often than ones from a shared address, and people recognise the sender.</p>
            </div>
          </div>
          <form
            className="sd-form"
            onSubmit={(e) => {
              e.preventDefault();
              connect();
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <Label htmlFor="sending-domain" srOnly>
                Domain
              </Label>
              <Input
                id="sending-domain"
                value={value}
                onChange={(e) => {
                  setError(null);
                  setValue(e.target.value);
                }}
                placeholder="Domain, for example mg.yourgym.ie"
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button type="submit" disabled={busy || !value.trim()}>
              {connecting ? <Loader2 size={14} className="spin" /> : <Plug size={14} />}
              {connecting ? "Connecting" : "Connect domain"}
            </Button>
          </form>
          {error && <p className="sd-error">{error}</p>}
          <p className="sd-note">Use a subdomain such as mg.yourgym.ie. Your normal email on the main domain stays exactly as it is.</p>
        </Card>
      </div>
    );
  }

  const verified = domain.state === "verified";
  const root = rootOf(domain.domain);
  const rows = domain.dnsRecords.map((r) => ({ r, job: recordJob(r), found: recordFound(r, verified) }));
  const foundCount = rows.filter((x) => x.found).length;
  const tone = verified ? "green" : domain.state === "failed" ? "red" : "amber";
  const since = domain.verifiedAt ? new Date(domain.verifiedAt).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" }) : null;

  return (
    <div className="sd">
      <div className="sd-main">
        <Card className="sd-card">
          <div className="sd-hero">
            <span className="sd-badge" data-tone={tone} aria-hidden>
              {verified ? <CircleCheck size={20} /> : domain.state === "failed" ? <AlertTriangle size={20} /> : <Clock size={20} />}
            </span>
            <div className="sd-hero-text">
              <span className="sd-eyebrow" data-tone={tone}>
                {verified ? "Verified" : domain.state === "failed" ? "Couldn't verify" : "Waiting for DNS"}
              </span>
              <h2>{domain.domain}</h2>
              <p>
                {verified
                  ? `Campaigns send from this domain${since ? `. Verified on ${since}` : ""}.`
                  : domain.state === "failed"
                    ? "Check each record below matches exactly, then check again."
                    : "Add the records below where you manage this domain, then check again. Changes usually show within an hour and can take up to 48."}
              </p>
            </div>
          </div>

          {rows.length > 0 && (
            <ul className="sd-checks">
              {rows.map(({ job, found }, i) => (
                <li key={i} data-found={found}>
                  <span className="sd-check-icon" aria-hidden>
                    {found ? <Check size={13} strokeWidth={2.5} /> : <Clock size={13} />}
                  </span>
                  <span className="sd-check-title">{job.title}</span>
                  <span className="sd-check-state">{found ? "Found" : "Not found yet"}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="sd-actions">
            <Button variant={verified ? "secondary" : "primary"} onClick={refresh} disabled={busy}>
              {refreshing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              {refreshing ? "Checking" : "Check again"}
            </Button>
            <Button variant="ghost" onClick={disconnect} disabled={busy}>
              {disconnecting ? <Loader2 size={14} className="spin" /> : <Unplug size={14} />}
              Disconnect
            </Button>
          </div>
        </Card>

        {rows.length > 0 && (
          <details className="sd-records" open={!verified}>
            <summary>
              <span>
                <b>DNS records</b>
                <span className="sd-records-sub">
                  {rows.length} record{rows.length === 1 ? "" : "s"}, {foundCount === rows.length ? "all found" : `${foundCount} of ${rows.length} found`}
                </span>
              </span>
              <ChevronDown size={16} className="sd-chev" aria-hidden />
            </summary>
            <div className="sd-record-list">
              {rows.map(({ r, job, found }, i) => {
                const host = hostPart(r.name, root);
                return (
                  <div key={i} className="sd-record">
                    <div className="sd-record-head">
                      <span className="sd-type">{r.type.toUpperCase()}</span>
                      <div className="sd-record-title">
                        <b>{job.title}</b>
                        <span>{job.what}</span>
                      </div>
                      <span className="sd-pill" data-found={found}>
                        {found ? "Found" : "Not found yet"}
                      </span>
                    </div>
                    <Field label="Host" text={host} />
                    {host !== r.name && <p className="sd-full">Full name, if your provider asks for it: {r.name}</p>}
                    <Field label="Value" text={r.value} wrap />
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>

      <aside className="sd-aside">
        <Card className="sd-card sd-side">
          {verified ? (
            <>
              <h3>Sending from it</h3>
              <p>Campaigns can send from any address at {domain.domain}, such as hello@{domain.domain}.</p>
              <h3>Keep the records</h3>
              <p>Leave the DNS records in place. If one is removed, campaigns stop sending from this domain until it&rsquo;s added back.</p>
            </>
          ) : (
            <>
              <h3>Where to add the records</h3>
              <p>
                Wherever you manage {root}: often the company you bought it from (Blacknight, GoDaddy, Namecheap) or Cloudflare. Look for DNS settings, add each record as a new one, and leave
                the existing ones alone.
              </p>
              <h3>Once it&rsquo;s verified</h3>
              <p>Campaigns can send from any address at {domain.domain}, such as hello@{domain.domain}.</p>
            </>
          )}
          <Link href="/campaigns" className="sd-link">
            Go to email campaigns
          </Link>
        </Card>
      </aside>
    </div>
  );
}

/** One DNS value with a copy button; the green tick shows for a moment after copying. */
function Field({ label, text, wrap }: { label: string; text: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      },
      () => toast.error("Couldn't copy. Select the text and copy it by hand."),
    );
  }
  return (
    <div className="sd-field">
      <span className="sd-field-label">{label}</span>
      <code className="sd-field-value" data-wrap={wrap ? "true" : undefined}>
        {text}
      </code>
      <button type="button" className="sd-copy" onClick={copy} aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`} data-copied={copied}>
        {copied ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
