"use client";

import { useEffect } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { ProblemScreen } from "@/components/system/ProblemScreen";

/**
 * Any page that throws while rendering lands here instead of Next's bare
 * default. Try again re-renders the page in place; the reference is Next's
 * error digest, which matches the server log line for the same failure.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
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
