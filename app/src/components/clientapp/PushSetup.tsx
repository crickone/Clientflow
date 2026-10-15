"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff, Loader2, Share } from "lucide-react";

import { Switch } from "@/components/forms/FormsListView";
import { setPushPrefsAction } from "@/app/app/actions";

type State = "checking" | "unsupported" | "ios-install" | "blocked" | "off" | "on";

function urlBase64ToBytes(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/app/pwa/sw", { scope: "/app" });
}

/**
 * Turn notifications on for this phone, and choose which reminders come.
 * On iPhone, Safari only allows them once the app is on the Home Screen, so
 * that's explained instead of a button that can't work.
 */
export function PushSetup({ vapidKey, prefs, compact = false }: { vapidKey: string; prefs: { classes: boolean; checkins: boolean; habits: boolean }; compact?: boolean }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [p, setP] = useState(prefs);
  const [, start] = useTransition();

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("blocked");
      try {
        const reg = await registration();
        const sub = await reg.pushManager.getSubscription();
        setState(sub && Notification.permission === "granted" ? "on" : "off");
      } catch {
        setState("off");
      }
    })();
  }, []);

  async function turnOn() {
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
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(vapidKey) as unknown as BufferSource }));
      const res = await fetch("/api/app/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), test: true }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!j.ok) throw new Error(j.error || "Couldn't turn them on.");
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn them on.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/app/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  function flip(k: keyof typeof p) {
    const next = { ...p, [k]: !p[k] };
    setP(next);
    start(async () => {
      await setPushPrefsAction(next);
    });
  }

  if (state === "checking") return null;

  if (state === "ios-install") {
    return (
      <div className={`ps ps--note${compact ? " ps--card" : ""}`}>
        <Share size={18} aria-hidden />
        <div>
          <b>Get reminders on your iPhone</b>
          <span>
            Tap <b>Share</b> at the bottom of Safari, then <b>Add to Home Screen</b>. Open the app from your Home Screen and turn notifications on here.
          </span>
        </div>
      </div>
    );
  }
  if (state === "unsupported") {
    return compact ? null : <p className="ps-hint">This browser can&rsquo;t show notifications. Open the app in Chrome or Safari on your phone.</p>;
  }
  if (state === "blocked") {
    return compact ? null : (
      <div className="ps ps--note">
        <BellOff size={18} aria-hidden />
        <div>
          <b>Notifications are blocked</b>
          <span>Allow them for this site in your phone&rsquo;s settings, then come back here.</span>
        </div>
      </div>
    );
  }
  if (state === "off") {
    return (
      <div className={`ps${compact ? " ps--card" : ""}`}>
        <div className="ps-row">
          <Bell size={18} aria-hidden />
          <div className="ps-text">
            <b>Turn on reminders</b>
            <span>Before your classes, when your check-in is due, and for your daily habits.</span>
          </div>
        </div>
        <button type="button" className="ps-btn" onClick={() => void turnOn()} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <Bell size={16} />} Turn on notifications
        </button>
        {error && <span className="ps-err">{error}</span>}
      </div>
    );
  }
  if (compact) return null;
  return (
    <div className="ps">
      {(
        [
          ["classes", "Class reminders", "Up to 2 hours before a class you're booked into"],
          ["checkins", "Check-in reminders", "On check-in day, and once more if it's late"],
          ["habits", "Habit reminders", "At 7pm if today's habits aren't all ticked"],
        ] as const
      ).map(([k, label, sub]) => (
        <div key={k} className="mp-row">
          <div className="mp-text">
            <b>{label}</b>
            <span>{sub}</span>
          </div>
          <Switch on={p[k]} onClick={() => flip(k)} />
        </div>
      ))}
      <button type="button" className="ps-off" onClick={() => void turnOff()} disabled={busy}>
        Turn off notifications on this phone
      </button>
    </div>
  );
}
