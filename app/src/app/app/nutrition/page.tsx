import { Salad } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { assignedNutritionPlans } from "@/lib/clientApp";
import { Card, PageTitle } from "@/components/clientapp/ui";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { full: "Full plan", macro: "Macro plan", upload: "Document" };

export default async function ClientNutritionPage() {
  const { clientId } = requireClientPage();
  const plans = assignedNutritionPlans(clientId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub="Your nutrition plans">Nutrition</PageTitle>
      {plans.length === 0 ? (
        <Card><div style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center", padding: "16px 0" }}>No nutrition plan yet. Your coach will add one soon.</div></Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {plans.map((p) => (
            <Card key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
              <span style={iconBox}><Salad size={18} /></span>
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
