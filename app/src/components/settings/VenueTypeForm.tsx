"use client";

import { useState } from "react";

import { updateVenueType } from "@/app/settings/venue/actions";
import type { VenueType } from "@/lib/vocabulary";
import { SaveStatus } from "./SaveStatus";
import { useAutosave } from "./useAutosave";

const OPTIONS: { value: VenueType; label: string; blurb: string }[] = [
  {
    value: "clinic",
    label: "Clinic",
    blurb: "Clients · Therapies · Appointments · Packages",
  },
  {
    value: "gym",
    label: "Gym",
    blurb: "Members · Classes · Bookings · Memberships",
  },
];

export function VenueTypeForm({ current }: { current: VenueType }) {
  const [selected, setSelected] = useState<VenueType>(current);

  const autosave = useAutosave({
    values: selected,
    save: async (value) => {
      const res = await updateVenueType(value);
      if (!res.ok) throw new Error("Couldn't save — please try again.");
      // The action revalidates the root layout, which is what re-reads the
      // vocabulary for the sidebar and the rest of the app.
    },
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
        }}
      >
        {OPTIONS.map((o) => {
          const active = selected === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setSelected(o.value)}
              style={{
                textAlign: "left",
                cursor: "pointer",
                background: active ? "var(--accent-soft)" : "var(--surface-1)",
                border: `1px solid ${active ? "var(--accent)" : "var(--grid)"}`,
                borderRadius: "var(--radius)",
                padding: 18,
                transition: "border-color 0.15s var(--ease), background 0.15s var(--ease)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-heading), sans-serif",
                  textTransform: "uppercase",
                  fontSize: 18,
                  color: active ? "var(--accent-ink)" : "var(--text-primary)",
                }}
              >
                {o.label}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono), ui-monospace, monospace",
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  marginTop: 8,
                  letterSpacing: "0.02em",
                }}
              >
                {o.blurb}
              </div>
            </button>
          );
        })}
      </div>
      <SaveStatus autosave={autosave} sticky={false} />
    </div>
  );
}
