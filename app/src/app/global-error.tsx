"use client";

/**
 * Last resort: the root layout itself failed, so none of the app's styles or
 * components are available. Kept self-contained and plain on purpose.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b0b0c", color: "#f2f2f0", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <div style={{ maxWidth: 420, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: "0 0 10px" }}>AdonisAgent didn&rsquo;t load</h1>
          <p style={{ color: "#a1a1a6", lineHeight: 1.5, margin: "0 0 24px" }}>Something went wrong on our side. Try again in a moment.</p>
          <button type="button" onClick={() => reset()} style={{ height: 40, padding: "0 20px", borderRadius: 999, border: 0, background: "#f2f2f0", color: "#0b0b0c", font: "inherit", fontWeight: 600, cursor: "pointer" }}>
            Try again
          </button>
          {error.digest ? <p style={{ marginTop: 20, fontSize: 12, color: "#6e6e73" }}>Reference {error.digest}</p> : null}
        </div>
      </body>
    </html>
  );
}
