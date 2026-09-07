/**
 * Rendered INSTEAD of StudioCanvas when studioEditability() (lib/cms/pageBody)
 * refuses a page's stored body. Renders inside the Studio's iframe, on the
 * iframe's default white background, so it must be self-contained and
 * legible with no external stylesheet — the page's own <head> is deliberately
 * NOT rendered here (this is not an edit surface).
 */
export function StudioUneditablePanel({ reason }: { reason: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui, -apple-system, sans-serif",
        background: "#ffffff",
        color: "#1a1a1a",
        padding: 40,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 480 }}>
        <p
          style={{
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontSize: 12,
            fontWeight: 600,
            color: "#b45309",
            margin: "0 0 12px",
          }}
        >
          Cannot edit this page here
        </p>
        <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0, color: "#3f3f3f" }}>{reason}</p>
      </div>
    </div>
  );
}
