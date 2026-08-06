"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";

import type { MembershipOption } from "@/lib/auth";
import { chooseAccount } from "./actions";

export function AccountSelector({
  memberships,
}: {
  memberships: MembershipOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selecting, setSelecting] = useState<number | null>(null);

  function pick(tenantId: number) {
    setSelecting(tenantId);
    start(async () => {
      const res = await chooseAccount(tenantId);
      if (!res.ok) {
        toast.error(res.error);
        setSelecting(null);
        return;
      }
      // Full reload so the root layout renders the chosen tenant's theme/chrome.
      window.location.assign("/dashboard");
    });
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {memberships.map((m) => {
        const busy = pending && selecting === m.tenantId;
        return (
          <button
            key={m.tenantId}
            onClick={() => pick(m.tenantId)}
            disabled={pending}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              width: "100%",
              textAlign: "left",
              background: "var(--surface-2)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              padding: "14px 16px",
              cursor: pending ? "default" : "pointer",
              opacity: pending && !busy ? 0.5 : 1,
              transition: "border-color 120ms, background 120ms",
            }}
          >
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: "var(--radius)",
                background: "var(--bg)",
                border: "1px solid var(--hairline)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-primary)",
                fontSize: 15,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {m.name[0]?.toUpperCase() ?? "?"}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  color: "var(--text-primary)",
                  fontWeight: 500,
                  fontSize: 15,
                }}
              >
                {m.name}
              </span>
              <span
                style={{
                  display: "block",
                  color: "var(--text-tertiary)",
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginTop: 2,
                }}
              >
                {m.role}
              </span>
            </span>
            <ArrowRight
              size={16}
              strokeWidth={1.75}
              style={{ color: "var(--text-secondary)", flexShrink: 0 }}
            />
            {busy && (
              <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
                Opening…
              </span>
            )}
          </button>
        );
      })}

      <button
        onClick={signOut}
        disabled={pending}
        style={{
          alignSelf: "center",
          marginTop: 8,
          background: "none",
          border: "none",
          color: "var(--text-tertiary)",
          fontSize: 13,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Sign out
      </button>
    </div>
  );
}
