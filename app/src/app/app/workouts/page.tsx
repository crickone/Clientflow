import { Dumbbell } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { assignedWorkoutPrograms } from "@/lib/clientApp";
import { Card, PageTitle } from "@/components/clientapp/ui";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { simple: "Simple", detailed: "Detailed", upload: "Document" };

export default async function ClientWorkoutsPage() {
  const { clientId } = requireClientPage();
  const programs = assignedWorkoutPrograms(clientId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub="Your training programs">Workouts</PageTitle>
      {programs.length === 0 ? (
        <Card><div style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center", padding: "16px 0" }}>No workout program yet. Your coach will add one soon.</div></Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {programs.map((p) => (
            <Card key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
              <span style={iconBox}><Dumbbell size={18} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>{p.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{TYPE_LABEL[p.type] ?? p.type}</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const iconBox: React.CSSProperties = { width: 38, height: 38, borderRadius: 10, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-ink)", flexShrink: 0 };
