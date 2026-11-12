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
import { fmtDate, fmtDay } from "@/lib/format";
import { notify } from "@/lib/toast";
import type { FleetTenantRow } from "@/lib/types";

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

  const columns: Column<FleetTenantRow>[] = [
    {
      key: "name", label: "Name", sortable: true, hideable: false,
      render: (t) => (
        <>
          <Link href={`/gyms/${t.id}`}>{t.name}</Link>
          <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), ui-monospace, monospace" }}>{t.slug}</div>
        </>
      ),
    },
    { key: "venueType", label: "Venue", sortable: true, value: (t) => t.venueType ?? "", render: (t) => <span style={{ textTransform: "capitalize", color: "var(--text-secondary)" }}>{t.venueType ?? <span style={{ color: "var(--text-tertiary)", textTransform: "none" }}>Not set</span>}</span> },
    {
      key: "status", label: "Status", sortable: true,
      value: (t) => (t.archivedAt ? "archived" : t.billingExempt ? "agency" : t.billingStatus ?? "none"),
      render: (t) => (t.archivedAt ? <span className="chip past_due">archived</span> : <StatusChip status={t.billingStatus} exempt={t.billingExempt} />),
    },
    { key: "users", label: "People", sortable: true, align: "right" },
    { key: "nextRenewalAt", label: "Next renewal", sortable: true, value: (t) => t.nextRenewalAt ?? "", render: (t) => (t.nextRenewalAt ? fmtDay(t.nextRenewalAt) : "—") },
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
