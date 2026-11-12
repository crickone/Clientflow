// app/src/components/clientapp/programs/kit.tsx
/**
 * The Programs kit: the shared pieces every Programs screen is built from.
 * Plain markup with no hooks, so server and client components can both use
 * it. Styles are the .pk- block in globals.css; colours come from the gym's
 * brand variables only.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { weeksText } from "@/lib/programs/content";
import type { Phase } from "@/lib/programs/types";

/** The page head: a small line above, the big uppercase title, a lead line and a byline. */
export function PkHeader({ crumb, title, lead, byline, children }: { crumb?: string; title: string; lead?: string; byline?: string; children?: ReactNode }) {
  return (
    <header className="pk-head">
      {crumb && <div className="pk-crumb">{crumb}</div>}
      <h1 className="pk-title">{title}</h1>
      {lead && <p className="pk-lead">{lead}</p>}
      {byline && <div className="pk-small">{byline}</div>}
      {children}
    </header>
  );
}

/** A small letter-spaced section label and what goes under it. */
export function PkSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="pk-section">
      <h2 className="pk-label">{label}</h2>
      {children}
    </section>
  );
}

/** A soft card; a link when it has an href. `accent` for the one card a screen leads with. */
export function PkCard({ href, accent, children, className }: { href?: string; accent?: boolean; children: ReactNode; className?: string }) {
  const cls = `pk-card${accent ? " pk-card--accent" : ""}${className ? ` ${className}` : ""}`;
  return href ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

/** A pill tag: days, weeks, level, length. */
export function Pill({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <span className={`pk-pill${accent ? " pk-pill--accent" : ""}`}>{children}</span>;
}

export function Pills({ items }: { items: string[] }) {
  return (
    <div className="pk-pills">
      {items.map((p) => (
        <Pill key={p}>{p}</Pill>
      ))}
    </div>
  );
}

/**
 * The phase bar: one segment per phase, sized by its weeks. The current phase
 * is the brightest and the ones before it are a step dimmer. `named` writes
 * each phase's name in its segment.
 */
export function PhaseBar({ phases, current = null, named = false }: { phases: Phase[]; current?: number | null; named?: boolean }) {
  const label = `Phases: ${phases.map((p) => `${p.name}, ${weeksText(p.fromWeek, p.toWeek).toLowerCase()}`).join("; ")}${current !== null && phases[current] ? `. Now: ${phases[current].name}` : ""}`;
  return (
    <div className={`pk-phases${named ? " pk-phases--named" : ""}`} role="img" aria-label={label}>
      {phases.map((p, i) => (
        <div
          key={`${p.fromWeek}-${p.name}`}
          className="pk-phase"
          data-state={current === null ? undefined : i < current ? "past" : i === current ? "current" : undefined}
          style={{ flexGrow: p.toWeek - p.fromWeek + 1 }}
          title={named ? p.name : undefined}
        >
          {named && <span className="pk-phase-name">{p.name}</span>}
        </div>
      ))}
    </div>
  );
}

/** Key numbers in tiles of two. */
export function StatTiles({ tiles }: { tiles: { label: string; value: string; sub?: string }[] }) {
  return (
    <div className="pk-stats">
      {tiles.map((t) => (
        <div key={t.label} className="pk-stat">
          <span className="pk-small">{t.label}</span>
          <b className="pk-stat-value">{t.value}</b>
          {t.sub && <span className="pk-small">{t.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** Changes in order, newest first, as a line of dots. */
export function Timeline({ items }: { items: { id: number; when: string; lines: string[] }[] }) {
  return (
    <ol className="pk-timeline">
      {items.map((e) => (
        <li key={e.id} className="pk-event">
          <span className="pk-small">{e.when}</span>
          {e.lines.map((line, i) => (
            <span key={i} className="pk-muted">
              {line}
            </span>
          ))}
        </li>
      ))}
    </ol>
  );
}

/** The one primary action, kept in view at the bottom while the screen scrolls. */
export function StickyBar({ children }: { children: ReactNode }) {
  return <div className="pk-sticky">{children}</div>;
}

/** A warning line, for demanding programs and test days. */
export function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="pk-warn">
      <AlertTriangle size={15} aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/** How far through a multi-step screen the member is. */
export function StepBar({ at, of, label }: { at: number; of: number; label: string }) {
  return (
    <div className="pk-steps" role="progressbar" aria-label={label} aria-valuemin={1} aria-valuemax={of} aria-valuenow={at + 1}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className="pk-step" data-on={i <= at ? "true" : undefined} />
      ))}
    </div>
  );
}
