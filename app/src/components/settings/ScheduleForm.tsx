"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { ClinicSettings } from "@/lib/settings";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { saveScheduleAction } from "@/app/settings/schedule/actions";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Props {
  settings: ClinicSettings;
}

export function ScheduleForm({ settings }: Props) {
  const [pending, start] = useTransition();
  const [hours, setHours] = useState(() =>
    DAY_LABELS.map((_, dow) => {
      const existing = settings.openingHours.find((o) => o.dow === dow);
      return {
        dow,
        closed: existing?.closed ?? false,
        open: existing?.open ?? "08:00",
        close: existing?.close ?? "20:00",
      };
    }),
  );

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      try {
        await saveScheduleAction(fd);
        toast.success("Schedule saved.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <CardLabel>Opening hours</CardLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {hours.map((h) => (
            <div
              key={h.dow}
              className="schedule-row"
              style={{
                display: "grid",
                gridTemplateColumns: "120px auto 1fr 1fr",
                gap: 12,
                alignItems: "center",
                padding: "10px 0",
                borderBottom: "1px solid var(--hairline)",
              }}
            >
              <span style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>
                {DAY_LABELS[h.dow]}
              </span>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: "var(--text-secondary)",
                }}
              >
                <input
                  type="checkbox"
                  name={`closed_${h.dow}`}
                  checked={h.closed}
                  onChange={(e) =>
                    setHours((prev) =>
                      prev.map((p) =>
                        p.dow === h.dow ? { ...p, closed: e.target.checked } : p,
                      ),
                    )
                  }
                />
                Closed
              </label>
              <Input
                type="time"
                name={`open_${h.dow}`}
                value={h.open}
                onChange={(e) =>
                  setHours((prev) =>
                    prev.map((p) =>
                      p.dow === h.dow ? { ...p, open: e.target.value } : p,
                    ),
                  )
                }
                disabled={h.closed}
                style={{ opacity: h.closed ? 0.4 : 1 }}
              />
              <Input
                type="time"
                name={`close_${h.dow}`}
                value={h.close}
                onChange={(e) =>
                  setHours((prev) =>
                    prev.map((p) =>
                      p.dow === h.dow ? { ...p, close: e.target.value } : p,
                    ),
                  )
                }
                disabled={h.closed}
                style={{ opacity: h.closed ? 0.4 : 1 }}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardLabel>Calendar grid</CardLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <Label htmlFor="slotLengthMinutes">Slot length (minutes)</Label>
            <select
              id="slotLengthMinutes"
              name="slotLengthMinutes"
              defaultValue={settings.slotLengthMinutes}
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: "10px 14px",
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "inherit",
              }}
            >
              <option value={15}>15</option>
              <option value={30}>30</option>
              <option value={45}>45</option>
              <option value={60}>60</option>
            </select>
          </div>
          <div>
            <Label htmlFor="bufferMinutes">Buffer between bookings (minutes)</Label>
            <Input
              id="bufferMinutes"
              name="bufferMinutes"
              type="number"
              defaultValue={settings.bufferMinutes}
              min={0}
            />
          </div>
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save schedule"}
        </Button>
      </div>
    </form>
  );
}
