import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card, CardLabel } from "@/components/ui/Card";
import type { ImportedPersonView } from "@/lib/ghlImport/types";

import { AllowContactButton } from "./AllowContactButton";

const DAY = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric" });

/**
 * What the GoHighLevel import brought in for this person. Staff only: the
 * medical note is shown here and nowhere else (never to the AI, never in a
 * message or an export).
 */
export function GhlImportCard({ person, leadId }: { person: ImportedPersonView; leadId?: number }) {
  const facts: [string, string | null][] = [
    ["Stage there", person.ghlStage ? `${person.ghlStage}${person.daysInStage != null ? `, ${person.daysInStage} days` : ""}` : null],
    ["Source", person.ghlSource],
    ["Treatment interested in", person.treatment],
    ["Used treatments before", person.usedBefore],
    ["Town", person.town],
    ["Imported", DAY.format(new Date(person.importedAt))],
  ];
  return (
    <Card style={{ padding: 18, display: "grid", gap: 12 }}>
      <CardLabel>From GoHighLevel</CardLabel>
      {person.doNotContact && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <Badge tone="danger">Do not contact</Badge>
          {leadId != null && <AllowContactButton leadId={leadId} />}
        </div>
      )}
      <dl style={{ margin: 0, display: "grid", gap: 8 }}>
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} style={{ display: "grid", gap: 2 }}>
              <dt style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{k}</dt>
              <dd style={{ margin: 0, fontSize: 13.5, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{v}</dd>
            </div>
          ))}
      </dl>
      {person.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {person.tags.map((t) => (
            <Badge key={t} tone="neutral">
              {t}
            </Badge>
          ))}
        </div>
      )}
      {person.staffMedicalNote && (
        <div style={{ display: "grid", gap: 4, padding: "10px 12px", borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--hairline)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
            <ShieldAlert size={14} aria-hidden /> Medical note, staff only
          </span>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-primary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{person.staffMedicalNote}</p>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Never sent to the AI or in any message.</span>
        </div>
      )}
    </Card>
  );
}
