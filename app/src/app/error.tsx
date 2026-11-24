"use client";

import { useEffect, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { ProblemScreen } from "@/components/system/ProblemScreen";
import { liveBuild } from "@/components/system/UpdateWatcher";
import { looksLikeStaleDeploy, shouldAutoReload } from "@/lib/staleBuildModel";

/**
 * Any page that throws while rendering lands here instead of Next's bare
 * default. Try again re-renders the page in place; the reference is Next's
 * error digest, which matches the server log line for the same failure.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    console.error(error);
    // A page left open across a deploy fails here on its next click. That is
    // not a fault: reload onto the new version (once per build, never a loop).
    let cancelled = false;
    void (async () => {
      const live = await liveBuild();
      let reloadedFor: string | null = null;
      try {
        reloadedFor = sessionStorage.getItem("adonis_reloaded_for");
      } catch {
        /* storage blocked */
      }
      const stale = shouldAutoReload({ pageBuild: window.__adonisBuild ?? null, liveBuild: live, reloadedFor });
      if (cancelled || !(stale || (looksLikeStaleDeploy(error.message) && live && reloadedFor !== live))) return;
      try {
        sessionStorage.setItem("adonis_reloaded_for", live ?? "");
      } catch {
        /* storage blocked */
      }
      setReloading(true);
      window.location.reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [error]);
  if (reloading) {
    return (
      <ProblemScreen
        code="Updating"
        title="Adonis was just updated"
        body="Loading the new version."
        icon={<RefreshCw size={22} />}
        reference={null}
        primary={null}
      />
    );
  }
  return (
    <ProblemScreen
      code="Something went wrong"
      title="This page didn't load"
      body="Nothing you entered has been lost. Try again, and if it keeps happening let us know."
      icon={<TriangleAlert size={22} />}
      reference={error.digest ?? null}
      primary={
        <button type="button" className="btn btn--primary btn--md" onClick={() => reset()}>
          <RefreshCw size={15} /> Try again
        </button>
      }
    />
  );
}
