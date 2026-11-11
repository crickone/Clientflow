import type { ReactNode } from "react";

/**
 * The one page header every console screen uses: a mono eyebrow saying where
 * you are, the title, one line of what is on the page, and the page's actions
 * on the right. Styles are .page-head* in globals.css.
 */
export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
