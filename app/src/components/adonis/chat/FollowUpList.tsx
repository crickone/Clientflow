"use client";

import "./chat.css";
import { Plus } from "lucide-react";

/** Up to three next questions Adonis suggested; a click asks it. */
export function FollowUps({ items, disabled, onPick }: { items: string[]; disabled: boolean; onPick: (text: string) => void }) {
  if (items.length === 0) return null;
  return (
    <nav className="ax-rel" aria-label="Follow up">
      <div className="ax-rel-h">Follow up</div>
      {items.map((t) => (
        <button key={t} type="button" className="ax-rel-i" disabled={disabled} onClick={() => onPick(t)}>
          <span>{t}</span>
          <Plus size={15} strokeWidth={1.75} aria-hidden />
        </button>
      ))}
    </nav>
  );
}
