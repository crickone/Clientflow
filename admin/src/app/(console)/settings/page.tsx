import { api } from "@/lib/api";
import { saveSettings } from "./actions";

interface Settings {
  monthlyPriceCents: number;
  vatRateBp: number;
  provider: string;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { saved?: string; error?: string };
}) {
  const s = await api<Settings>("/settings");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Settings</h1>

      <form
        action={saveSettings}
        className="glass"
        style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Monthly price (EUR)</span>
          <input
            className="input"
            type="number"
            step="0.01"
            min="0"
            name="monthlyPrice"
            defaultValue={(s.monthlyPriceCents / 100).toFixed(2)}
            required
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>VAT rate (%)</span>
          <input
            className="input"
            type="number"
            step="0.01"
            min="0"
            max="100"
            name="vatRate"
            defaultValue={(s.vatRateBp / 100).toFixed(2)}
            required
          />
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Payment provider</span>
          <div style={{ fontSize: 13.5 }}>{s.provider}</div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-tertiary)" }}>
            CreatePay/Cardstream lands here when credentials arrive.
          </p>
        </div>

        {searchParams.error && (
          <p role="alert" style={{ margin: 0, color: "var(--red)", fontSize: 13 }}>
            {searchParams.error}
          </p>
        )}
        {searchParams.saved && !searchParams.error && (
          <p style={{ margin: 0, color: "var(--green)", fontSize: 13 }}>Settings saved.</p>
        )}

        <div>
          <button className="btn btn--primary btn--md" type="submit">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
