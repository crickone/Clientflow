import Link from "next/link";
import { ArrowRight, Inbox, type LucideIcon } from "lucide-react";

/**
 * The empty state inside a dashboard tile: a quiet line-art mark (the icon on
 * a tile with two faint rings behind it), one sentence, and at most one
 * action. Replaces the bare grey sentence, which read as a broken widget.
 */
export function WidgetEmpty({
  text,
  icon: Icon = Inbox,
  action,
}: {
  text: string;
  icon?: LucideIcon;
  action?: { href: string; label: string };
}) {
  return (
    <div className="wempty">
      <div className="wempty-art" aria-hidden>
        <span className="wempty-ring wempty-ring--2" />
        <span className="wempty-ring" />
        <span className="wempty-mark">
          <Icon size={17} strokeWidth={1.6} />
        </span>
      </div>
      <div className="wempty-text">{text}</div>
      {action && (
        <Link href={action.href} className="wempty-action">
          {action.label} <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}
