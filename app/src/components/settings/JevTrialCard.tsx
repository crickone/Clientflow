import { AlertTriangle, FlaskConical } from "lucide-react";

import { Card } from "@/components/ui/Card";
import type { TrialView } from "@/lib/inbox/jevTrial";

const LABEL: Record<string, string> = {
  new_lead: "New lead",
  booking: "Booking",
  existing_client: "Existing client",
  faq: "Question",
  sensitive: "Sensitive",
  spam: "Spam",
  other: "Other",
};

/**
 * The Jev trial, side by side with Claude: how often they agree on each
 * inbound message's category, priority and sensitivity, how fast Jev answered,
 * and the messages they disagreed on. Read-only; the inbox still uses Claude.
 */
export function JevTrialCard({ view }: { view: TrialView }) {
  const s = view.stats;
  return (
    <Card className="jt">
      <div className="jt-head">
        <span className="jt-icon" aria-hidden>
          <FlaskConical size={18} />
        </span>
        <div>
          <h2>Jev trial</h2>
          <p>Jev labels each new message alongside Claude. Only Claude&rsquo;s labels are used in the inbox. Last 30 days.</p>
        </div>
      </div>

      {view.lastError && (
        <p className="jt-error">
          <AlertTriangle size={14} aria-hidden /> Latest call failed: {view.lastError}
        </p>
      )}

      {s.compared === 0 ? (
        <p className="jt-empty">{view.on ? "No messages compared yet. The next inbound message will be the first." : "Switched off: AI_GATEWAY_API_KEY isn't set."}</p>
      ) : (
        <>
          <div className="bs-tiles">
            <Tile label="Messages compared" value={String(s.compared)} sub={s.failed ? `${s.failed} failed` : undefined} />
            <Tile label="Same category" value={`${s.category}%`} />
            <Tile label="Same priority" value={`${s.priority}%`} />
            <Tile label="Same call on holding" value={`${s.sensitive}%`} sub={s.missedSensitive ? `Jev didn't hold ${s.missedSensitive} that Claude held` : "None missed"} warn={s.missedSensitive > 0} />
            <Tile label="Jev's typical answer time" value={s.medianMs !== null ? `${(s.medianMs / 1000).toFixed(2)} s` : "-"} />
          </div>

          {view.disagreements.length > 0 && (
            <div className="jt-list">
              <span className="jt-list-title">Where they disagreed</span>
              {view.disagreements.map((d) => (
                <div key={d.id} className="jt-row">
                  <p className="jt-text">{d.text}</p>
                  <div className="jt-cmp">
                    <Side who="Claude" category={d.claude.category} priority={d.claude.priority} sensitive={d.claude.sensitive} other={d.jev} />
                    <Side who="Jev" category={d.jev.category} priority={d.jev.priority} sensitive={d.jev.sensitive} other={d.claude} confidence={d.jev.confidence} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Side({
  who,
  category,
  priority,
  sensitive,
  other,
  confidence,
}: {
  who: string;
  category: string;
  priority: string;
  sensitive: boolean;
  other: { category: string; priority: string; sensitive: boolean };
  confidence?: number | null;
}) {
  return (
    <div className="jt-side">
      <span className="jt-who">
        {who}
        {typeof confidence === "number" ? ` (${Math.round(confidence * 100)}% sure)` : ""}
      </span>
      <span className="jt-tags">
        <span data-diff={category !== other.category}>{LABEL[category] ?? category}</span>
        <span data-diff={priority !== other.priority}>{priority[0].toUpperCase() + priority.slice(1)} priority</span>
        {(sensitive || other.sensitive) && <span data-diff={sensitive !== other.sensitive}>{sensitive ? "Held for a person" : "Not held"}</span>}
      </span>
    </div>
  );
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="bs-tile">
      <span className="bs-tile-label">{label}</span>
      <span className="bs-tile-value">{value}</span>
      {sub && <span className="jt-sub" data-warn={warn ? "true" : undefined}>{sub}</span>}
    </div>
  );
}
