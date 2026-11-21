import { api } from "@/lib/api";
import { requireAdminSession } from "@/lib/session";
import { KillSwitches } from "@/components/fleet/KillSwitches";
import { PageHeader } from "@/components/ui/PageHeader";
import type { FleetResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SwitchesPage() {
  const me = await requireAdminSession();
  const { killSwitches } = await api<FleetResponse>("/fleet", { revalidate: 15, tags: ["fleet"] });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader
        eyebrow="Console"
        title="Platform switches"
        sub="Emergency stops for every business at once. Nothing is lost while one is stopped; work waits and resumes."
      />
      <KillSwitches switches={killSwitches ?? []} isOwner={me.role === "owner"} />
    </div>
  );
}
