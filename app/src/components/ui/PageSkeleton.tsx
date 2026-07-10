import { Skeleton } from "./Skeleton";

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="app-page">
      <div style={{ marginBottom: 32 }}>
        <Skeleton width={80} height={12} style={{ marginBottom: 12 }} />
        <Skeleton width={320} height={36} />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              padding: 24,
              background: "var(--bg)",
            }}
          >
            <Skeleton width={80} height={11} style={{ marginBottom: 12 }} />
            <Skeleton width="60%" height={28} />
            <Skeleton width="40%" height={11} style={{ marginTop: 12 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
