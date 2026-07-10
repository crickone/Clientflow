"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { updateVenueType } from "@/app/settings/venue/actions";
import type { VenueType } from "@/lib/vocabulary";

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
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const dirty = selected !== current;

  function save() {
    startTransition(async () => {
      const res = await updateVenueType(selected);
      if (res.ok) {
        toast.success(`Venue type set to ${res.venueType}.`);
        router.refresh();
      }
    });
  }

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
      <div>
        <Button onClick={save} disabled={!dirty || isPending}>
          {isPending ? "Saving…" : "Save venue type"}
        </Button>
      </div>
    </div>
  );
}
