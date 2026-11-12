import { api } from "@/lib/api";
import { requireAdminSession } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { FlagEditor } from "@/components/flags/FlagEditor";
import type { FleetResponse, PlatformFlag, TenantFeatures } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Staged rollout of each module across the fleet. A business's own switch (Features tab) still wins when it is off. */
export default async function FlagsPage() {
  const me = await requireAdminSession();
  const [{ flags, counts, tenantIds }, fleet] = await Promise.all([
    api<{ flags: PlatformFlag[]; counts: Record<string, number>; tenantIds: number[] }>("/flags"),
    api<FleetResponse>("/fleet", { revalidate: 30, tags: ["fleet"] }),
  ]);
  // Labels come from any business's feature list; the catalog is the same for all.
  const first = fleet.tenants[0];
  const labels = first ? (await api<TenantFeatures>(`/tenants/${first.id}/features`)).modules : [];
  const label = (key: string) => labels.find((m) => m.key === key)?.label ?? key;
  const live = fleet.tenants.filter((t) => tenantIds.includes(t.id)).map((t) => ({ id: t.id, name: t.name }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader eyebrow="Console" title="Feature flags" sub={me.role === "owner" ? "Roll a module out to everyone, a percentage, a named few, or nobody. A business switched off on its own Features tab stays off." : "Only an owner can change these."} />
      <Card style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {flags.map((f) => (
          <FlagEditor key={f.key} flag={f} label={label(f.key)} count={counts[f.key] ?? 0} total={tenantIds.length} tenants={live} isOwner={me.role === "owner"} />
        ))}
      </Card>
    </div>
  );
}
