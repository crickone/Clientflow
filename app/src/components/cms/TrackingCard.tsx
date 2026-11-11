"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Activity } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { saveConversionsApiAction, saveTrackingAction } from "@/app/cms/actions";
// Type-only: lib/facebook/capi.ts is server-only.
import type { CapiStatus } from "@/lib/facebook/capi";

/**
 * The client's analytics, advertising and search-console tags for this
 * website.
 *
 * One card, because they are one job done at one moment: before a client's
 * domain is pointed here. That day is the day their old site stops
 * reporting conversions, and nobody notices for weeks — it reads later as
 * ads quietly getting worse rather than as a launch mistake.
 *
 * It sits on the Domains screen for the same reason. An earlier version put
 * it on the site dashboard, which turned out to be a page nothing links to:
 * the Sites list goes straight into the visual editor, and the editor's
 * sidebar never goes back. The field existed, was deployed, and could not be
 * found by clicking.
 */
export function TrackingCard({
  siteSlug,
  initialPixelId,
  initialGoogleTagId,
  initialSiteVerification,
  capi,
}: {
  siteSlug: string;
  initialPixelId: string | null;
  initialGoogleTagId: string | null;
  initialSiteVerification: string | null;
  /** Meta Conversions API: whether a token is saved (never the token), the test code, and how sending is going. */
  capi?: { hasToken: boolean; testCode: string | null; status: CapiStatus | null };
}) {
  const [pixel, setPixel] = useState(initialPixelId ?? "");
  const [google, setGoogle] = useState(initialGoogleTagId ?? "");
  const [verify, setVerify] = useState(initialSiteVerification ?? "");
  const [saved, setSaved] = useState({
    pixel: initialPixelId ?? "",
    google: initialGoogleTagId ?? "",
    verify: initialSiteVerification ?? "",
  });
  const [pending, startTransition] = useTransition();

  const dirty =
    pixel.trim() !== saved.pixel.trim() ||
    google.trim() !== saved.google.trim() ||
    verify.trim() !== saved.verify.trim();

  function save() {
    startTransition(async () => {
      const res = await saveTrackingAction(siteSlug, pixel, google, verify);
      if (res.ok) {
        setSaved({ pixel: pixel.trim(), google: google.trim(), verify: verify.trim() });
        toast.success("Tracking saved.");
      } else {
        toast.error(res.error ?? "Could not save that.");
      }
    });
  }

  const field = (
    label: string,
    hint: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    live: boolean,
  ) => (
    <div style={{ minWidth: 260, flex: "1 1 280px" }}>
      <label
        style={{
          display: "block",
          fontSize: 12.5,
          color: "var(--text-secondary)",
          marginBottom: 6,
        }}
      >
        {label}
        {live && (
          <span style={{ color: "var(--text-tertiary)", marginLeft: 8 }}>· live on this site</span>
        )}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        style={{ width: "100%", fontVariantNumeric: "tabular-nums" }}
      />
      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-tertiary)" }}>{hint}</p>
    </div>
  );

  return (
    <Card style={{ padding: 20, marginTop: 20 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 4px" }}>
        <Activity size={16} strokeWidth={1.8} />
        Tracking
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)", maxWidth: "70ch" }}>
        These fire on every public page of this website, including the blog, and never inside the
        editor. Put them in place <strong>before</strong> you point the client&rsquo;s domain here —
        that is the day their old site stops reporting conversions. Leave either empty to run
        nothing.
      </p>

      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
        {field(
          "Meta Pixel",
          "From Meta Events Manager. Digits only.",
          pixel,
          setPixel,
          "1234567890123456",
          Boolean(saved.pixel) && pixel.trim() === saved.pixel.trim(),
        )}
        {field(
          "Google tag",
          "A GTM container (GTM-…), or a GA4 tag (G-…) or Ads id (AW-…) if there is no container. With GTM, put GA4 inside the container rather than here.",
          google,
          setGoogle,
          "GTM-XXXXXXX",
          Boolean(saved.google) && google.trim() === saved.google.trim(),
        )}
        {field(
          "Google site verification",
          "From Search Console's HTML-tag method. Paste the token or the whole meta tag. Not a cookie, so it is not held back by the consent notice.",
          verify,
          setVerify,
          "Xy3_aBcD…",
          Boolean(saved.verify) && verify.trim() === saved.verify.trim(),
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <Button onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save tracking"}
        </Button>
      </div>

      {capi && <ConversionsApi siteSlug={siteSlug} hasPixel={Boolean(saved.pixel)} {...capi} />}
    </Card>
  );
}

const when = (t: number) =>
  new Date(t).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });

/**
 * Server-side events (Meta Conversions API, lib/facebook/capi.ts): leads and
 * purchases sent from our server as well as the visitor's browser, for
 * visitors who accepted advertising cookies. The token is write-only.
 */
function ConversionsApi({
  siteSlug,
  hasPixel,
  hasToken,
  testCode,
  status,
}: {
  siteSlug: string;
  hasPixel: boolean;
  hasToken: boolean;
  testCode: string | null;
  status: CapiStatus | null;
}) {
  const [token, setToken] = useState("");
  const [test, setTest] = useState(testCode ?? "");
  const [savedTest, setSavedTest] = useState(testCode ?? "");
  const [tokenSaved, setTokenSaved] = useState(hasToken);
  const [pending, start] = useTransition();
  const dirty = token.trim() !== "" || test.trim() !== savedTest.trim();

  function save(removeToken = false) {
    start(async () => {
      const res = await saveConversionsApiAction(siteSlug, { token: removeToken ? null : token, testCode: test, removeToken });
      if (!res.ok) return void toast.error(res.error ?? "Could not save that.");
      if (removeToken) setTokenSaved(false);
      else if (token.trim()) setTokenSaved(true);
      setToken("");
      setSavedTest(test.trim().toUpperCase());
      toast.success(removeToken ? "Token removed." : "Server-side events saved.");
    });
  }

  const statusLine = !hasPixel
    ? "Add the Meta Pixel above first. Server-side events go to that Pixel."
    : status?.lastError && (!status.lastOkAt || (status.lastErrorAt ?? 0) > status.lastOkAt)
      ? `Meta refused the last events (${when(status.lastErrorAt!)}): ${status.lastError}`
      : status?.lastOkAt
        ? `Working. Meta last took events ${when(status.lastOkAt)}; ${status.sentLast7Days} sent in the last 7 days${status.waiting ? `, ${status.waiting} waiting` : ""}.`
        : "Nothing sent yet. Events go once a visitor who accepted cookies enquires, signs up or buys.";
  const statusBad = Boolean(hasPixel && status?.lastError && (!status.lastOkAt || (status.lastErrorAt ?? 0) > status.lastOkAt));

  return (
    <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--hairline)" }}>
      <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>Server-side events (Meta Conversions API)</h3>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-secondary)", maxWidth: "70ch" }}>
        Sends leads, sign-ups and purchases to Meta from our server as well as the browser, so ad blockers and phone
        privacy settings stop losing them. Only for visitors who accepted cookies. Facebook lead-ads leads that book or
        buy are reported too, so lead ads learn which leads become customers.
      </p>
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
        <div style={{ minWidth: 260, flex: "2 1 320px" }}>
          <label style={{ display: "block", fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 6 }}>
            Conversions API token
            {tokenSaved && <span style={{ color: "var(--text-tertiary)", marginLeft: 8 }}>· saved</span>}
          </label>
          <Input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={tokenSaved ? "Saved. Paste a new one to replace it." : "EAAB..."}
            aria-label="Conversions API token"
            style={{ width: "100%" }}
          />
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-tertiary)" }}>
            Meta Events Manager, the Pixel, Settings, Conversions API, Generate access token. Without one, the business&apos;s Facebook connection is used.
          </p>
        </div>
        <div style={{ minWidth: 180, flex: "1 1 200px" }}>
          <label style={{ display: "block", fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 6 }}>Test event code</label>
          <Input value={test} onChange={(e) => setTest(e.target.value)} placeholder="TEST12345" aria-label="Test event code" style={{ width: "100%" }} />
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-tertiary)" }}>
            From Events Manager&apos;s Test events tab. Remove it once events show there.
          </p>
        </div>
      </div>
      <p role="status" style={{ margin: "14px 0 0", fontSize: 13, color: statusBad ? "var(--warning)" : "var(--text-secondary)", lineHeight: 1.5 }}>
        {statusLine}
      </p>
      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button onClick={() => save(false)} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save server-side events"}
        </Button>
        {tokenSaved && (
          <Button variant="ghost" onClick={() => save(true)} disabled={pending}>
            Remove token
          </Button>
        )}
      </div>
    </div>
  );
}
