import type { ReactNode } from "react";

interface Props {
  title: string;
  message?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

/**
 * An empty list or section. The icon sits on a soft tile with a faint ring,
 * the title is a sentence rather than shouted display caps, and the action
 * is the obvious next step. Shared by every list in the app, so one change
 * here restyles all of them.
 */
export function EmptyState({ title, message, icon, action }: Props) {
  return (
    <div className="empty-state">
      {icon ? (
        <span className="empty-state-icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="empty-state-title">{title}</div>
      {message ? <p className="empty-state-body">{message}</p> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
