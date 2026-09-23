"use client";

import { useState } from "react";

/**
 * Sign out from a signed-out page.
 *
 * /api/auth/logout is POST-only (it clears a cookie, so it must not be
 * reachable by a GET a browser or a link-prefetcher can fire), which is why
 * this is a button rather than the anchor it looks like. Same call the
 * sidebar's sign-out makes.
 */
export function SignOutLink() {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="auth-linkish"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } finally {
          // A hard navigation, not router.push: the session cookie is gone and
          // every cached server component rendered for that user should be too.
          window.location.href = "/login";
        }
      }}
    >
      {busy ? "signing out…" : "sign out"}
    </button>
  );
}
