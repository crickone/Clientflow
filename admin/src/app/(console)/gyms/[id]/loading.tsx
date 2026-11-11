/** Under the business header: the tab content while it loads. */
export default function TenantTabLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {[0, 1].map((i) => (
        <div key={i} className="skel-card">
          <div className="skel skel-line" style={{ width: 140, height: 16 }} />
          <div className="skel-rows">
            <div className="skel skel-line" style={{ width: "85%" }} />
            <div className="skel skel-line" style={{ width: "60%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
