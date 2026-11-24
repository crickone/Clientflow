"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff, BellRing, Info, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { setNotificationPrefAction } from "@/app/settings/notifications/actions";
import { KIND_COPY, type NotificationKind, type Prefs } from "@/lib/notifications/model";

type DeviceState = "checking" | "unsupported" | "ios-install" | "blocked" | "off" | "on";

const SW_URL = "/notifications-sw.js";

function urlBase64ToBytes(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SW_URL, { scope: "/" });
}

/**
 * On/off switch. The knob takes the accent's contrast colour when on: the
 * admin accent is white in dark mode, where a white knob would vanish.
 */
function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={`nt-switch${on ? " is-on" : ""}`}>
      <span className="nt-switch-knob" aria-hidden />
    </button>
  );
}

function devicesText(n: number): string {
  if (n === 0) return "Alerts are off on all your devices.";
  return n === 1 ? "Alerts are on for 1 device." : `Alerts are on for ${n} devices.`;
}

export function NotificationSettings({
  kinds,
  prefs: initialPrefs,
  vapidKey,
  devices: initialDevices,
  /** Preview page only: skip the browser checks and show this state. */
  previewState,
}: {
  kinds: NotificationKind[];
  prefs: Prefs;
  vapidKey: string | null;
  devices: number;
  previewState?: DeviceState;
}) {
  const [prefs, setPrefs] = useState(initialPrefs);
  const [devices, setDevices] = useState(initialDevices);
  const [state, setState] = useState<DeviceState>(previewState ?? "checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  useEffect(() => {
    if (previewState) return;
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("blocked");
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = reg?.active?.scriptURL.endsWith(SW_URL) ? await reg.pushManager.getSubscription() : null;
        setState(sub && Notification.permission === "granted" ? "on" : "off");
      } catch {
        setState("off");
      }
    })();
  }, [previewState]);

  function flip(kind: NotificationKind, field: "inApp" | "push") {
    const before = prefs[kind];
    const next = { ...before, [field]: !before[field] };
    setPrefs((p) => ({ ...p, [kind]: next }));
    start(async () => {
      const res = await setNotificationPrefAction(kind, next).catch(() => ({ ok: false, error: "Could not save. Try again." }));
      if (!res.ok) {
        setPrefs((p) => ({ ...p, [kind]: before }));
        toast.error(res.error ?? "Could not save. Try again.");
      }
    });
  }

  async function turnOn() {
    if (!vapidKey) return;
    setBusy(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(vapidKey) as unknown as BufferSource }));
      const res = await fetch("/api/notifications/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; devices?: number };
      if (!j.ok) throw new Error(j.error || "Could not turn alerts on.");
      if (typeof j.devices === "number") setDevices(j.devices);
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not turn alerts on.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        const res = await fetch("/api/notifications/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        const j = (await res.json().catch(() => ({}))) as { devices?: number };
        if (typeof j.devices === "number") setDevices(j.devices);
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Could not turn alerts off. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nt-set">
      <Card className="nt-card">
        <h2 className="nt-card-title">What you get</h2>
        <p className="nt-card-sub">In the app means the bell and the pop-up. Phone and desktop alerts come even when the app is closed.</p>
        <div className="nt-grid" role="table" aria-label="Notification settings">
          <div role="row" style={{ display: "contents" }}>
            <span role="columnheader" className="nt-grid-head" style={{ textAlign: "left" }}>
              <span className="sr-only">Kind</span>
            </span>
            <span role="columnheader" className="nt-grid-head">In the app</span>
            <span role="columnheader" className="nt-grid-head">Phone and desktop</span>
          </div>
          {kinds.map((k) => (
            <div key={k} role="row" className="nt-grid-row">
              <span role="cell" className="nt-kind">
                <b>{KIND_COPY[k].label}</b>
                <span>{KIND_COPY[k].desc}</span>
              </span>
              <span role="cell" className="nt-grid-cell">
                <Switch on={prefs[k].inApp} onClick={() => flip(k, "inApp")} label={`${KIND_COPY[k].label} in the app`} />
              </span>
              <span role="cell" className="nt-grid-cell">
                <Switch on={prefs[k].push} onClick={() => flip(k, "push")} label={`${KIND_COPY[k].label} on phone and desktop`} />
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="nt-card">
        <h2 className="nt-card-title">This device</h2>
        <p className="nt-card-sub">{devicesText(devices)} Turn alerts on for each phone or computer you use.</p>
        <DeviceRow state={state} vapidKey={vapidKey} busy={busy} onOn={() => void turnOn()} onOff={() => void turnOff()} />
        {error && <p className="nt-err">{error}</p>}
        <div className="nt-note">
          <Info size={15} aria-hidden />
          <span>
            On iPhone, alerts need iOS 16.4 or later and the app on your Home Screen. In Safari tap Share, then Add to Home Screen, open the
            app from there and turn alerts on here.
          </span>
        </div>
      </Card>
    </div>
  );
}

function DeviceRow({
  state,
  vapidKey,
  busy,
  onOn,
  onOff,
}: {
  state: DeviceState;
  vapidKey: string | null;
  busy: boolean;
  onOn: () => void;
  onOff: () => void;
}) {
  if (state === "checking") return <div className="nt-device" style={{ minHeight: 38 }} />;
  if (!vapidKey) {
    return (
      <div className="nt-device">
        <span className="nt-device-state">
          <BellOff size={17} aria-hidden /> Alerts are not set up on this server yet.
        </span>
      </div>
    );
  }
  if (state === "unsupported") {
    return (
      <div className="nt-device">
        <span className="nt-device-state">
          <BellOff size={17} aria-hidden /> This browser cannot show alerts. Try Chrome, Edge, Firefox or Safari.
        </span>
      </div>
    );
  }
  if (state === "ios-install") {
    return (
      <div className="nt-device">
        <span className="nt-device-state">
          <Smartphone size={17} aria-hidden /> Add the app to your Home Screen first, then open it from there.
        </span>
      </div>
    );
  }
  if (state === "blocked") {
    return (
      <div className="nt-device">
        <span className="nt-device-state">
          <BellOff size={17} aria-hidden /> Alerts are blocked for this site. Allow them in your browser settings, then reload.
        </span>
      </div>
    );
  }
  if (state === "on") {
    return (
      <div className="nt-device">
        <span className="nt-device-state">
          <BellRing size={17} aria-hidden /> This device gets alerts.
        </span>
        <Button variant="secondary" onClick={onOff} loading={busy}>
          {!busy && <BellOff size={15} aria-hidden />} Turn off on this device
        </Button>
      </div>
    );
  }
  return (
    <div className="nt-device">
      <span className="nt-device-state">
        <Bell size={17} aria-hidden /> This device does not get alerts.
      </span>
      <Button onClick={onOn} loading={busy}>
        {!busy && <BellRing size={15} aria-hidden />} Turn on alerts on this device
      </Button>
    </div>
  );
}
