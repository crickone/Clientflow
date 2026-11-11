"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * A page that failed to render. Next catches the throw and shows this in
 * place of the page, with the shell still around it. The message is the
 * server's own (an ApiError carries the main app's reason), so "Request
 * failed (502)" reads as what it is.
 */
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[console]", error);
  }, [error]);
  return (
    <div className="fault" role="alert">
      <h1>This page could not load</h1>
      <p>{error.message || "Something went wrong talking to the platform."}</p>
      {error.digest && <code>ref {error.digest}</code>}
      <div className="fault-actions">
        <button type="button" className="btn btn--primary btn--md" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="btn btn--secondary btn--md">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
