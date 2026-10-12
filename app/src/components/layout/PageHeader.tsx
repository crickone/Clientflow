import type { ReactNode } from "react";

import { SettingsBack } from "@/components/settings/SettingsBack";

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /**
   * Drop the 32px gap this header normally leaves under itself. For a header
   * rendered INSIDE a container that owns its own padding — the agent detail
   * page's hologram hero is the one caller today — where that gap lands as
   * dead space inside the box rather than as separation from what follows.
   */
  flush?: boolean;
}

export function PageHeader({ eyebrow, title, subtitle, actions, flush }: Props) {
  // Vercel-style: a plain sentence-case title, a quiet line under it, and a
  // hairline dividing the header from the page. (Was big uppercase display
  // type with a "// EYEBROW" mono label.)
  return (
    <div className={`page-head${flush ? " is-flush" : ""}`}>
      <div className="page-head-text">
        <SettingsBack />
        {eyebrow && <div className="page-head-eyebrow">{eyebrow}</div>}
        <h1 className="page-head-title">{title}</h1>
        {subtitle && <p className="page-head-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  );
}
