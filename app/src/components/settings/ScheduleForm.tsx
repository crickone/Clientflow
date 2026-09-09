"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import type { ClinicSettings } from "@/lib/settings";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { useVocab } from "@/components/providers/VocabProvider";
import { saveScheduleAction } from "@/app/settings/schedule/actions";
import { SaveStatus } from "./SaveStatus";
import { useAutosave } from "./useAutosave";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Props {
  settings: ClinicSettings;
}

export function ScheduleForm({ settings }: Props) {
  const vocab = useVocab();
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
  // Kept as the raw string so the field can be empty mid-edit without snapping
  // to 0 under the operator's cursor; coerced only on the way out.
  const [buffer, setBuffer] = useState(String(settings.bufferMinutes));

  const autosave = useAutosave({
    values: { hours, buffer },
    save: async ({ hours: h, buffer: b }) => {
      await saveScheduleAction({
        openingHours: h,
        bufferMinutes: b.trim() === "" ? 0 : Number(b),
      });
    },
  });

  /** Spreadsheet-style fill-down: copy this day's hours (incl. closed state) to
   *  every day below it, so a whole week can be set from one row. */
  function copyDown(fromDow: number) {
    setHours((prev) => {
      const src = prev.find((p) => p.dow === fromDow);
      if (!src) return prev;
      return prev.map((p) =>
        p.dow > fromDow ? { ...p, closed: src.closed, open: src.open, close: src.close } : p,
      );
    });
    toast.success(`Copied ${DAY_LABELS[fromDow]}'s hours to the days below.`);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <CardLabel>Opening hours</CardLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {hours.map((h) => (
            <div
              key={h.dow}
              className="schedule-row"
              style={{
                display: "grid",
                gridTemplateColumns: "120px auto 1fr 1fr 110px",
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
                aria-label={`${DAY_LABELS[h.dow]} opening time`}
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
                aria-label={`${DAY_LABELS[h.dow]} closing time`}
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
              {h.dow < 6 ? (
                <button
                  type="button"
                  className="schedule-copydown"
                  onClick={() => copyDown(h.dow)}
                  title={`Copy ${DAY_LABELS[h.dow]}'s hours to every day below`}
                  aria-label={`Copy ${DAY_LABELS[h.dow]}'s hours to every day below`}
                >
                  <ArrowDownToLine size={14} aria-hidden />
                  Copy down
                </button>
              ) : (
                <span aria-hidden />
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardLabel>Booking rules</CardLabel>
        <div style={{ maxWidth: 340 }}>
          <Label htmlFor="bufferMinutes">Buffer between bookings (minutes)</Label>
          <Input
            id="bufferMinutes"
            type="number"
            value={buffer}
            onChange={(e) => setBuffer(e.target.value)}
            min={0}
          />
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "var(--text-tertiary)",
            }}
          >
            Turnaround time held either side of a booking: the next booking of the
            same {vocab.service.toLowerCase()} cannot start until it has passed.
            How long a session runs for is set per {vocab.service.toLowerCase()}{" "}
            under{" "}
            <Link href="/settings/therapies" style={{ color: "var(--accent)" }}>
              {vocab.services}
            </Link>
            , not here.
          </p>
        </div>
      </Card>

      <SaveStatus autosave={autosave} />
    </div>
  );
}
