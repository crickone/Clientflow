"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { notify } from "@/lib/toast";
import { SETTINGS_CARDS, displayValue, type PlatformSettings, type SettingsCard } from "@/lib/settingsCards";
import { saveSettingsCard } from "@/app/(console)/settings/actions";

/** The platform price cards. Data only in, so a server page can render it; each card saves alone. */
export function SettingsCards({ settings }: { settings: PlatformSettings }) {
  return (
    <>
      {SETTINGS_CARDS.map((card) => (
        // Keyed on the saved values so a refresh after a save resets the inputs to what is stored.
        <SettingsCardForm key={`${card.id}:${card.fields.map((f) => settings[f.key]).join(",")}`} card={card} settings={settings} />
      ))}
    </>
  );
}

function SettingsCardForm({ card, settings }: { card: SettingsCard; settings: PlatformSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const values: Record<string, string> = {};
    for (const f of card.fields) values[f.name] = String(data.get(f.name) ?? "");
    setError(null);
    start(async () => {
      const res = await saveSettingsCard(card.id, values);
      if (res.ok) {
        notify.ok("Saved");
        router.refresh();
      } else {
        setError(res.error);
        notify.fail(res.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 className="card-title" style={{ margin: 0 }}>{card.title}</h2>
      {card.fields.map((f) => (
        <label key={f.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{f.label}</span>
          <input
            className="input"
            type="number"
            name={f.name}
            step={f.kind === "int" ? 1 : 0.01}
            min={0}
            max={f.max}
            defaultValue={displayValue(f, settings)}
            required
          />
          {f.hint && <p style={{ margin: 0, fontSize: 12, color: "var(--text-tertiary)" }}>{f.hint}</p>}
        </label>
      ))}
      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--red)", fontSize: 13 }}>{error}</p>
      )}
      <div style={{ marginTop: "auto" }}>
        <button className="btn btn--primary btn--md" type="submit" disabled={pending}>
          {pending ? "Saving..." : card.saveLabel}
        </button>
      </div>
    </form>
  );
}
