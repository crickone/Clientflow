"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import {
  TENANT_MISMATCH_CODE,
  TENANT_STAMP_HEADER,
  isOwnApiUrl,
} from "@/lib/api/tenantStampRules";

/**
 * Keeps a browser tab honest about which clinic it is in.
 *
 * The active clinic is a property of the SESSION, not of the tab (see
 * @/lib/api/tenantStamp for the full account), so switching clinic in one tab
 * silently repoints every other open tab. The screen still shows Inspire; the
 * next request resolves Optimal Health. An operator met this as "Design not
 * found." on a design that was sitting right in front of them.
 *
 * Two halves, and both live here so a call site never has to remember either:
 *
 * 1. STAMP EVERY REQUEST. `window.fetch` is wrapped once to send the tenant
 *    this page was RENDERED for on same-origin /api calls. Patching fetch is a
 *    blunt instrument and deliberately chosen: the alternative is editing a
 *    hundred-odd call sites and hoping the hundred-and-first remembers. The
 *    wrapper adds one header and changes nothing else — same arguments, same
 *    promise, same errors — and leaves every other request untouched.
 *
 * 2. SAY SO, ONCE. A 409 carrying TENANT_MISMATCH means this tab is stale. The
 *    tab is then wrong about EVERYTHING on screen, not just the request that
 *    failed, so it takes the screen rather than letting each caller render its
 *    own copy of a confusing message.
 *
 * `tenantId` null (login, select-account, the bare pages) stamps nothing: there
 * is no clinic to be wrong about yet.
 */
export function TenantTabGuard({ tenantId }: { tenantId: number | null }) {
  const [stale, setStale] = useState<string | null>(null);

  useEffect(() => {
    if (tenantId == null) return;
    const original = window.fetch;
    // A double-mount (React strict mode, a fast remount) must not wrap the
    // wrapper: the header would be set twice, harmlessly, but the unwrap on
    // teardown would restore a patched fetch and leak one layer per mount.
    if ((original as { __tenantStamped?: boolean }).__tenantStamped) return;

    const patched: typeof window.fetch = async (input, init) => {
      const raw =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // Same origin and our own API only. A third-party request must never be
      // told which clinic this operator is in.
      if (!isOwnApiUrl(raw, window.location.origin)) return original(input, init);

      const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      h.set(TENANT_STAMP_HEADER, String(tenantId));
      const res = await original(input, { ...init, headers: h });

      if (res.status === 409) {
        // Read a CLONE: the caller still gets an unconsumed body, whatever it
        // decides to do with the 409 it is about to see.
        try {
          const body = (await res.clone().json()) as { code?: string; error?: string };
          if (body?.code === TENANT_MISMATCH_CODE) setStale(body.error ?? null);
        } catch {
          // Not our 409 — leave it entirely alone.
        }
      }
      return res;
    };
    (patched as { __tenantStamped?: boolean }).__tenantStamped = true;

    window.fetch = patched;
    return () => {
      // Only unwrap if nothing else has patched fetch since, or we would
      // silently remove theirs.
      if (window.fetch === patched) window.fetch = original;
    };
  }, [tenantId]);

  if (!stale) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="tenant-stale-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius-lg, 14px)",
          padding: 24,
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AlertTriangle size={18} style={{ color: "var(--warning)", flexShrink: 0 }} />
          <h2 id="tenant-stale-title" style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
            This tab is on a different account
          </h2>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          {stale}
        </p>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "var(--text-tertiary)" }}>
          Nothing was changed. Your work is safe in the account it belongs to.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <Button onClick={() => window.location.reload()}>Reload this tab</Button>
        </div>
      </div>
    </div>
  );
}
