/**
 * AdonisAgent brand lockup for the platform console.
 *
 * Matches the marketing site (sites/adonisagent) rather than inventing a
 * third look: the square-spiral mark, then "Adonis" + a muted "Agent" + the
 * full stop, set in Space Grotesk. The console previously used the Nebula
 * display face with a glowing orange dot, which is the old identity — the app
 * chrome and the website both moved on and this had not.
 *
 * Pure presentational, no client hooks — safe in a server or client tree.
 */
export function Logo({
  size = 18,
  sub = "Platform",
}: {
  /** Font-size (px) of the wordmark; the mark and sub-label scale from it. */
  size?: number;
  /** Small label under the wordmark. Pass null for the mark and wordmark alone. */
  sub?: string | null;
}) {
  const markSize = Math.round(size * 1.15);
  const subSize = Math.max(9, Math.round(size * 0.42));
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6, lineHeight: 1, minWidth: 0, maxWidth: "100%" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.45) }}>
        <svg
          aria-hidden
          viewBox="0 0 120 120"
          style={{ width: markSize, height: markSize, flexShrink: 0, color: "var(--text-primary)" }}
        >
          <path
            d="M20 20H100V100H20V40H80V80H40V60H60"
            fill="none"
            stroke="currentColor"
            strokeWidth={9}
            strokeLinecap="square"
          />
        </svg>
        <span
          style={{
            fontFamily: "var(--font-heading), system-ui, sans-serif",
            fontSize: size,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            lineHeight: 1,
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
          }}
        >
          Adonis<span style={{ color: "var(--text-secondary)" }}>Agent</span>
          <span style={{ color: "var(--text-tertiary)" }}>.</span>
        </span>
      </span>
      {sub && (
        <span
          style={{
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: subSize,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
            paddingLeft: markSize + Math.round(size * 0.45),
          }}
        >
          {sub}
        </span>
      )}
    </span>
  );
}
