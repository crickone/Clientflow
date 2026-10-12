import type { ReactNode } from "react";
import { Lock } from "lucide-react";

/**
 * A feature this account can't use yet, said in the customer's terms: what it
 * is, why it isn't here, and the one thing to do about it. Replaces grey
 * one-line notes and server-setting names that meant nothing to a customer.
 */
export function Unavailable({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  body: string;
  icon?: ReactNode;
  action?: { label: string; href: string };
}) {
  return (
    <div className="unavail ui-card">
      <span className="unavail-icon" aria-hidden>
        {icon ?? <Lock size={18} />}
      </span>
      <div className="unavail-text">
        <div className="unavail-title">{title}</div>
        <p className="unavail-body">{body}</p>
      </div>
      {action ? (
        <a className="btn btn--secondary btn--md unavail-action" href={action.href}>
          {action.label}
        </a>
      ) : null}
    </div>
  );
}

export const SUPPORT_MAILTO = "mailto:hello@adonisagent.ie";
