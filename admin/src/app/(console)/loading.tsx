/**
 * Shown the instant a console page is requested, before its data has come
 * back from the main app. The shell (sidebar) is above this boundary, so it
 * stays put; only the page area swaps. Hovering a sidebar link prefetches
 * this, which is what makes navigation feel immediate.
 */
export default function ConsoleLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 26, borderBottom: "1px solid var(--grid)" }}>
        <div className="skel skel-line" style={{ width: 60 }} />
        <div className="skel skel-title" />
        <div className="skel skel-line" style={{ width: 320 }} />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="skel-card">
          <div className="skel skel-line" style={{ width: 160, height: 16 }} />
          <div className="skel-rows">
            <div className="skel skel-line" style={{ width: "90%" }} />
            <div className="skel skel-line" style={{ width: "70%" }} />
            <div className="skel skel-line" style={{ width: "80%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
