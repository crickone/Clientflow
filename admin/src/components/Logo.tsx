/**
 * ClientFlow brand lockup — the "ClientFlow" wordmark set in the Nebula display
 * face (var(--font-nebula)) with a "PLATFORM" label beneath in the mono face.
 * Mirrors the main app's null-src Logo lockup vibe (see app/src/components/ui/
 * Logo.tsx), re-skinned for the admin chrome. Pure presentational, no client
 * hooks — safe to render in either a server or client tree.
 */
export function Logo({
  size = 18,
  dot = true,
}: {
  /** Font-size (px) of the "ClientFlow" wordmark; the sub-label scales from it. */
  size?: number;
  /** Show the glowing accent dot before the wordmark. */
  dot?: boolean;
}) {
  const subSize = Math.max(9, Math.round(size * 0.5));
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 6,
        lineHeight: 1,
        minWidth: 0,
        maxWidth: "100%",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.5) }}>
        {dot && (
          <span
            aria-hidden
            style={{
              width: Math.max(8, Math.round(size * 0.5)),
              height: Math.max(8, Math.round(size * 0.5)),
              borderRadius: "50%",
              background: "var(--accent)",
              boxShadow: "var(--accent-glow)",
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            fontFamily: "var(--font-nebula), var(--font-heading), system-ui, sans-serif",
            textTransform: "uppercase",
            fontSize: size,
            letterSpacing: "0.02em",
            lineHeight: 1,
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
          }}
        >
          ClientFlow
        </span>
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: subSize,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          paddingLeft: dot ? Math.max(8, Math.round(size * 0.5)) + Math.round(size * 0.5) : 0,
        }}
      >
        Platform
      </span>
    </span>
  );
}
