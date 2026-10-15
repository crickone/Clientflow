"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Loader2, Watch } from "lucide-react";

type Row = {
  id: string;
  name: string;
  gives: string;
  available: boolean;
  connected: boolean;
  syncedAgo: string | null;
  error: string | null;
};

/** Connect or disconnect each wearable. Connecting goes to the provider's own sign-in and comes back here. */
export function DevicesList({ rows, flash }: { rows: Row[]; flash: { name: string; status: string } | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function disconnect(id: string) {
    setBusy(id);
    await fetch("/api/app/wearables", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: id }) }).catch(() => undefined);
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="dv">
      {flash && (
        <div className="dv-flash" data-ok={flash.status === "connected"}>
          {flash.status === "connected"
            ? `${flash.name} is connected. Your last 30 days are coming in now.`
            : flash.status === "cancelled"
              ? `${flash.name} wasn't connected: you cancelled on their page.`
              : `${flash.name} couldn't be connected. Try again in a minute.`}
        </div>
      )}
      {rows.map((r) => (
        <div key={r.id} className="dv-row">
          <span className="dv-icon" aria-hidden>
            <Watch size={17} />
          </span>
          <div className="dv-text">
            <b>{r.name}</b>
            <span>
              {r.connected ? (
                r.error ? (
                  <>
                    <CircleAlert size={12} /> Needs reconnecting
                  </>
                ) : (
                  <>
                    <CircleCheck size={12} /> Connected{r.syncedAgo ? `, updated ${r.syncedAgo}` : ""}
                  </>
                )
              ) : (
                r.gives
              )}
            </span>
          </div>
          {!r.available ? (
            <span className="dv-soon">Coming soon</span>
          ) : r.connected ? (
            <div className="dv-actions">
              {r.error && (
                <a className="dv-btn" href={`/api/app/wearables?provider=${r.id}`}>
                  Reconnect
                </a>
              )}
              <button type="button" className="dv-link" onClick={() => void disconnect(r.id)} disabled={busy === r.id}>
                {busy === r.id ? <Loader2 size={14} className="spin" /> : "Disconnect"}
              </button>
            </div>
          ) : (
            <a className="dv-btn" href={`/api/app/wearables?provider=${r.id}`}>
              Connect
            </a>
          )}
        </div>
      ))}
      <p className="dv-note">Apple Watch and Samsung Galaxy Watch keep their data on your phone, so they need the gym&rsquo;s app from the App Store. That&rsquo;s coming.</p>
    </div>
  );
}
