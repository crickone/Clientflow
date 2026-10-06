/**
 * The ADONIS wordmark (brand/logo) for the platform console, in the theme's
 * text colour, with an optional small label under it.
 *
 * Pure presentational, no client hooks — safe in a server or client tree.
 */
import { ADONIS_LOGO_ASPECT, ADONIS_LOGO_PATH, ADONIS_LOGO_VIEWBOX } from "./adonisLogoPath";

export function Logo({
  size = 18,
  sub = "Platform",
}: {
  /** Font-size (px) of the wordmark; the mark and sub-label scale from it. */
  size?: number;
  /** Small label under the wordmark. Pass null for the mark and wordmark alone. */
  sub?: string | null;
}) {
  const subSize = Math.max(9, Math.round(size * 0.42));
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6, lineHeight: 1, minWidth: 0, maxWidth: "100%" }}>
      <svg
        role="img"
        aria-label="Adonis"
        viewBox={ADONIS_LOGO_VIEWBOX}
        style={{ height: Math.round(size * 0.82), width: Math.round(size * 0.82 * ADONIS_LOGO_ASPECT), color: "var(--text-primary)", display: "block" }}
      >
        <path d={ADONIS_LOGO_PATH} fill="currentColor" />
      </svg>
      {sub && (
        <span
          style={{
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: subSize,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          {sub}
        </span>
      )}
    </span>
  );
}
