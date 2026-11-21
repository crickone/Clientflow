import { api } from "@/lib/api";
import { saveNotifyPrefs } from "./actions";
import { PageHeader } from "@/components/ui/PageHeader";
import { SettingsCards } from "@/components/SettingsCards";
import type { PlatformSettings } from "@/lib/settingsCards";
import type { StaffResponse } from "@/lib/types";

export default async function SettingsPage(
  props: {
    searchParams: Promise<{ saved?: string; error?: string; notifyError?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const s = await api<PlatformSettings>("/settings");
  const staff = await api<StaffResponse>("/staff");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader eyebrow="Console" title="Settings" sub="Platform prices and allowances. Changes apply to every business. Each card saves on its own." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 20, alignItems: "stretch" }}>
        <SettingsCards settings={s} />

        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 className="card-title" style={{ margin: 0 }}>Other</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Payment provider</span>
            <div style={{ fontSize: 13.5 }}>{s.provider}</div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-tertiary)" }}>
              CreatePay/Cardstream lands here when credentials arrive.
            </p>
          </div>
        </div>

        <form action={saveNotifyPrefs} className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 className="card-title" style={{ margin: 0 }}>Alert emails to you</h2>
          <label className="check"><input type="checkbox" name="instant" defaultChecked={staff.you.notify.instant} /> The moment a serious alert opens</label>
          <label className="check"><input type="checkbox" name="digest" defaultChecked={staff.you.notify.digest} /> A morning digest at 8am of everything still open</label>
          {searchParams.notifyError && (
            <p role="alert" style={{ margin: 0, color: "var(--red)", fontSize: 13 }}>{searchParams.notifyError}</p>
          )}
          {searchParams.saved === "notify" && !searchParams.notifyError && (
            <p style={{ margin: 0, color: "var(--green)", fontSize: 13 }}>Alert emails saved.</p>
          )}
          <div><button className="btn btn--primary btn--md" type="submit">Save</button></div>
        </form>
      </div>
    </div>
  );
}
