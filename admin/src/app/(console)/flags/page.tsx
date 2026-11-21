import { api } from "@/lib/api";
import { requireAdminSession } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { FlagsTable } from "@/components/flags/FlagEditor";
import type { FleetResponse, FlagModule, PlatformFlag, TenantFeatures } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Staged rollout of each module across the fleet. A business's own switch (Features tab) still wins when it is off. */
export default async function FlagsPage() {
  const me = await requireAdminSession();
  // /fleet supplies the business names for the chips and the checklist (already fetched here, so no extra call).
  const [{ flags, tenantIds, modules }, fleet] = await Promise.all([
    api<{ flags: PlatformFlag[]; counts: Record<string, number>; tenantIds: number[]; modules?: FlagModule[] }>("/flags"),
    api<FleetResponse>("/fleet", { revalidate: 30, tags: ["fleet"] }),
  ]);
  // `modules` carries each label and one-line blurb. An older app deploy does not send it; then borrow labels from
  // any business's feature list (the catalog is the same for all) and show no blurbs.
  let labels: TenantFeatures["modules"] = [];
  if (!modules?.length) {
    const first = fleet.tenants[0];
    if (first) {
      try {
        labels = (await api<TenantFeatures>(`/tenants/${first.id}/features`)).modules;
      } catch (err) {
        console.error("[flags] module labels failed:", err);
      }
    }
  }
  const info = (key: string) => {
    const m = modules?.find((x) => x.key === key);
    return { label: m?.label ?? labels.find((x) => x.key === key)?.label ?? key, blurb: m?.blurb ?? "" };
  };
  const live = fleet.tenants.filter((t) => tenantIds.includes(t.id)).map((t) => ({ id: t.id, name: t.name }));
  // A named list can hold businesses that are no longer live; show them so they can be removed.
  const tenantsFor = (f: PlatformFlag) => [
    ...live,
    ...f.allow.filter((id) => !tenantIds.includes(id)).map((id) => ({ id, name: `${fleet.tenants.find((t) => t.id === id)?.name ?? `Business ${id}`} (not live)` })),
  ];
  const isOwner = me.role === "owner";
  const rows = flags.map((f) => ({ flag: f, ...info(f.key), tenants: tenantsFor(f) }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader eyebrow="Console" title="Feature flags" sub={isOwner ? "Who gets each module. A business that switched a module off on its own Features tab stays off." : "Only an owner can change these."} />
      <Card>
        <FlagsTable rows={rows} total={tenantIds.length} isOwner={isOwner} />
      </Card>
    </div>
  );
}
