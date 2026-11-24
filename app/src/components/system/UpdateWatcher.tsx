"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

declare global {
  interface Window {
    __adonisBuild?: string;
  }
}

/** Ask the server which build is live. Null when it can't be reached. */
export async function liveBuild(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as { build?: string };
    return typeof j.build === "string" ? j.build : null;
  } catch {
    return null;
  }
}

/**
 * Notices a deploy under an open page and offers a reload. Without it the
 * next click on the old page failed with "This page didn't load" (its server
 * actions no longer exist). Checks on focus and every five minutes; never
 * reloads by itself, so nothing typed is lost.
 */
export function UpdateWatcher({ build }: { build: string }) {
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    window.__adonisBuild = build;
    let stopped = false;
    const check = async () => {
      const live = await liveBuild();
      if (!stopped && live && live !== build) setUpdated(true);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const timer = setInterval(() => void check(), 5 * 60 * 1000);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [build]);

  if (!updated) return null;
  return (
    <div role="status" className="update-bar">
      <span>Adonis has been updated.</span>
      <button type="button" className="btn btn--primary btn--sm" onClick={() => window.location.reload()}>
        <RefreshCw size={14} /> Reload
      </button>
      <style>{`
.update-bar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:90;display:flex;align-items:center;gap:14px;padding:10px 12px 10px 18px;border-radius:999px;background:var(--surface-2,var(--bg));border:1px solid var(--hairline-strong);box-shadow:0 12px 40px rgba(0,0,0,.35);font-size:14px;color:var(--text-primary);max-width:calc(100vw - 32px)}
      `}</style>
    </div>
  );
}
