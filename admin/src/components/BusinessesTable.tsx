"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { BulkBar } from "@/components/ui/BulkBar";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { StatusChip } from "@/components/StatusChip";
import { OpenBusinessButton } from "@/components/OpenBusinessButton";
import { bulkTenantAction, type BulkAction } from "@/app/(console)/gyms/bulk-actions";
import { fmtDate } from "@/lib/format";
import { billingLabel, relTime, riskShown, stageLabel } from "@/lib/labels";
import { notify } from "@/lib/toast";
import type { FleetTenantRow } from "@/lib/types";

function Dot({ colour }: { colour: string }) {
  return <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: colour, flex: "0 0 auto" }} />;
}

export function BusinessesTable({
  tenants,
  open,
}: {
  tenants: FleetTenantRow[];
  /** `openTenant` server action; bound per row here. */
  open: (id: number, reason: string) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}) {
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const router = useRouter();
  const ask = useConfirm();

  async function run(action: BulkAction, label: string, danger = false, amount = false) {
    try {
      const archived = new Set(tenants.filter((t) => t.archivedAt !== null).map((t) => t.id));
      const all = [...selected].map(Number);
      const picked = all.filter((id) => !archived.has(id));
      const skipped = all.length - picked.length;
      if (picked.length === 0) {
        notify.fail("Every selected business is archived.");
        return;
      }
      const skipNote = skipped > 0 ? `${skipped} archived ${skipped === 1 ? "business" : "businesses"} will be skipped.` : undefined;
      const r = await ask({
        title: `${label} for ${picked.length} ${picked.length === 1 ? "business" : "businesses"}`,
        body: skipNote,
        confirmLabel: label,
        danger,
        prompt: amount ? { label: "Amount in euro", placeholder: "50", minLength: 1 } : undefined,
      });
      if (!r.ok) return;
      // Validate before anything is sent: a bad amount never reaches the server.
      let body: Record<string, unknown> = {};
      if (amount) {
        const euros = Number(r.value);
        if (!Number.isFinite(euros) || euros <= 0) {
          notify.fail("Give an amount in euro.");
          return;
        }
        body = { cents: Math.round(euros * 100) };
      }
      const res = await bulkTenantAction(picked, action, body);
      if (res.refused) {
        notify.fail(res.refused);
        return;
      }
      const skippedText = skipped > 0 ? `, ${skipped} archived skipped` : "";
      if (res.failed.length === 0) {
        notify.ok(`${label}: done for ${res.done}${skippedText}`);
        setSelected(new Set());
      } else {
        const shown = res.failed.slice(0, 3).map((f) => `#${f.id} ${f.error}`).join("; ");
        const more = res.failed.length > 3 ? ` and ${res.failed.length - 3} more` : "";
        notify.fail(`${label}: ${res.done} done, ${res.failed.length} failed (${shown}${more})${skippedText}`);
        setSelected(new Set(res.failed.map((f) => f.id)));
      }
      router.refresh();
    } catch (e) {
      notify.fail("Bulk action failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  const mono = { fontFamily: "var(--font-mono), ui-monospace, monospace" } as const;
  const columns: Column<FleetTenantRow>[] = [
    {
      key: "name", label: "Business", sortable: true, hideable: false,
      render: (t) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span className="biz-mark" aria-hidden style={{ width: 28, height: 28, borderRadius: 8, fontSize: 13 }}>
            {t.name.trim().slice(0, 2).toUpperCase() || "?"}
          </span>
          <span>
            <Link href={`/gyms/${t.id}`} style={{ fontWeight: 600 }}>{t.name}</Link>
            {t.venueType && <span style={{ color: "var(--text-tertiary)" }}> · {t.venueType}</span>}
          </span>
        </span>
      ),
    },
    {
      key: "status", label: "Billing", sortable: true,
      value: (t) => (t.archivedAt ? "Archived" : billingLabel({ exempt: t.billingExempt, status: t.billingStatus, stage: t.stage })),
      render: (t) => (t.archivedAt ? <span className="chip past_due">archived</span> : <StatusChip status={t.billingStatus} exempt={t.billingExempt} stage={t.stage} />),
    },
    { key: "stage", label: "Stage", sortable: true, value: (t) => stageLabel(t.stage), render: (t) => stageLabel(t.stage) },
    {
      key: "risk", label: "Risk", sortable: true,
      value: (t) => (riskShown(t.stage) ? t.risk.score : -1),
      csv: (t) => (riskShown(t.stage) ? t.risk.level : "not tracked"),
      render: (t) => {
        if (!riskShown(t.stage)) {
          return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text-tertiary)" }}>
              <Dot colour="var(--text-tertiary)" />Not tracked
            </span>
          );
        }
        const colour = t.risk.level === "high" ? "var(--red)" : t.risk.level === "medium" ? "var(--amber)" : "var(--green)";
        const word = t.risk.level === "high" ? "High" : t.risk.level === "medium" ? "Medium" : "Low";
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Dot colour={colour} />
            {word}
            {t.riskReason && <span style={{ color: "var(--text-tertiary)" }}>· {t.riskReason}</span>}
          </span>
        );
      },
    },
    {
      key: "setup", label: "Setup", sortable: true,
      value: (t) => (t.setup.requiredTotal ? t.setup.requiredDone / t.setup.requiredTotal : 0),
      csv: (t) => `${t.setup.requiredDone}/${t.setup.requiredTotal}`,
      render: (t) => {
        const pct = t.setup.requiredTotal ? Math.round((t.setup.requiredDone / t.setup.requiredTotal) * 100) : 0;
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="bar" style={{ width: 70 }}><i style={{ width: `${pct}%` }} /></span>
            <span style={{ ...mono, fontSize: 12, color: "var(--text-tertiary)" }}>{t.setup.requiredDone}/{t.setup.requiredTotal}</span>
          </span>
        );
      },
    },
    {
      key: "lastLoginAt", label: "Last login", sortable: true, align: "right",
      value: (t) => t.lastLoginAt ?? 0,
      csv: (t) => (t.lastLoginAt ? new Date(t.lastLoginAt).toISOString() : ""),
      render: (t) => <span style={{ ...mono, fontSize: 12.5, color: "var(--text-secondary)" }}>{relTime(t.lastLoginAt)}</span>,
    },
    { key: "users", label: "Staff", sortable: true, align: "right" },
    { key: "members", label: "Members", sortable: true, align: "right", value: (t) => t.members ?? -1, render: (t) => (t.members === undefined ? "-" : t.members) },
    { key: "createdAt", label: "Joined", sortable: true, render: (t) => fmtDate(t.createdAt) },
    { key: "actions", label: "", hideable: false, width: 1, align: "right", value: () => "", render: (t) => (!t.archivedAt ? <OpenBusinessButton action={(reason) => open(t.id, reason)} /> : null) },
  ];
  return (
    <>
      <BulkBar count={selected.size} onClear={() => setSelected(new Set())}>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => run("grant-credits", "Grant email credits", false, true)}>Grant email credits</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => run("grant-ai-credits", "Grant AI credits", false, true)}>Grant AI credits</button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => run("resume-ai", "Resume AI")}>Resume AI</button>
        <button type="button" className="btn btn--destructive btn--sm" onClick={() => run("suspend-ai", "Suspend AI", true)}>Suspend AI</button>
        <button type="button" className="btn btn--destructive btn--sm" onClick={() => run("suspend-marketing", "Suspend marketing", true)}>Suspend marketing</button>
      </BulkBar>
      <DataTable
        rows={tenants}
        columns={columns}
        rowKey={(t) => t.id}
        defaultSort={{ key: "name", dir: "asc" }}
        csvName="businesses"
        empty="No businesses match."
        selectable
        selected={selected}
        onSelect={setSelected}
        rowStyle={(t) => (t.archivedAt ? { opacity: 0.6 } : undefined)}
      />
    </>
  );
}
