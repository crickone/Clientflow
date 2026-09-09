"use client";

import { useState } from "react";
import { CalendarDays, CalendarRange } from "lucide-react";

import { updateSchedulingMode } from "@/app/settings/venue/actions";
import type { SchedulingMode } from "@/lib/settings";
import { SaveStatus } from "./SaveStatus";
import { useAutosave } from "./useAutosave";

const OPTIONS: { value: SchedulingMode; title: string; desc: string; icon: typeof CalendarDays }[] = [
  {
    value: "appointments",
    title: "Appointments",
    desc: "One-to-one bookings on a diary (best for clinics, therapists, 1:1 coaching).",
    icon: CalendarDays,
  },
  {
    value: "timetable",
    title: "Timetable",
    desc: "Recurring group classes clients sign up to (best for gyms & studios).",
    icon: CalendarRange,
  },
];

export function SchedulingModeForm({ current }: { current: SchedulingMode }) {
  const [value, setValue] = useState<SchedulingMode>(current);

  const autosave = useAutosave({
    values: value,
    save: async (mode) => {
      const res = await updateSchedulingMode(mode);
      if (!res.ok) throw new Error("Couldn't save — please try again.");
      // The action revalidates the root layout, which rebuilds the sidebar nav.
    },
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        {OPTIONS.map((o) => {
          const selected = value === o.value;
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              onClick={() => setValue(o.value)}
              style={{
                textAlign: "left",
                padding: 16,
                borderRadius: "var(--radius)",
                border: `1px solid ${selected ? "var(--accent)" : "var(--hairline)"}`,
                background: selected ? "var(--surface-2)" : "transparent",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <Icon size={18} strokeWidth={1.75} style={{ color: selected ? "var(--accent)" : "var(--text-secondary)" }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{o.title}</span>
              <span style={{ fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>{o.desc}</span>
            </button>
          );
        })}
      </div>
      <div style={{ color: "var(--text-tertiary)", fontSize: 12, lineHeight: 1.5 }}>
        This only controls which one shows in your sidebar — your existing data in the other is kept, and you can switch back anytime.
      </div>
      <SaveStatus autosave={autosave} sticky={false} />
    </div>
  );
}
