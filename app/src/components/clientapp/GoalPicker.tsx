"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { ACTIVITIES, GOALS, describeDelta, recommendAll, type ActivityKey, type Body, type GoalKey } from "@/lib/goalsModel";
import { clearGoalAction, setGoalAction } from "@/app/app/actions";

/**
 * Pick a goal from the latest InBody scan. The three options are priced on
 * the client from the scan's numbers (goalsModel, pure) so changing the
 * training days updates every card at once; choosing a card saves it.
 */
export function GoalPicker({ metrics, current }: { metrics: Body; current: { goal: GoalKey; activity: ActivityKey } | null }) {
  const router = useRouter();
  const [activity, setActivity] = useState<ActivityKey>(current?.activity ?? "moderate");
  const [saving, setSaving] = useState<GoalKey | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const targets = recommendAll(metrics, activity);

  function choose(goal: GoalKey) {
    setSaving(goal);
    setError(null);
    start(async () => {
      const r = await setGoalAction(goal, activity);
      if (!r.ok) setError(r.error);
      setSaving(null);
      router.refresh();
    });
  }

  function clear() {
    setSaving("clear");
    start(async () => {
      await clearGoalAction();
      setSaving(null);
      router.refresh();
    });
  }

  if (!targets) return null;
  const chosen = current && current.activity === activity ? current.goal : null;

  return (
    <div className="gl">
      <div className="gl-activity" role="radiogroup" aria-label="How often you train">
        {ACTIVITIES.map((a) => (
          <button key={a.key} type="button" role="radio" aria-checked={activity === a.key} className="gl-act" onClick={() => setActivity(a.key)}>
            <b>{a.label}</b>
            <span>{a.sub}</span>
          </button>
        ))}
      </div>

      <div className="gl-cards">
        {GOALS.map((g) => {
          const t = targets[g.key];
          const on = chosen === g.key;
          const busy = saving === g.key;
          return (
            <button key={g.key} type="button" className="gl-card" data-on={on} onClick={() => choose(g.key)} disabled={saving !== null} aria-pressed={on}>
              <div className="gl-card-head">
                <div>
                  <div className="gl-card-title">{g.label}</div>
                  <div className="gl-card-line">{g.line}</div>
                </div>
                <span className="gl-tick" aria-hidden>
                  {busy ? <Loader2 size={16} className="spin" /> : on ? <Check size={16} /> : null}
                </span>
              </div>
              <div className="gl-kcal">
                {t.calories.toLocaleString("en-IE")}
                <small>kcal a day</small>
              </div>
              <div className="gl-macros">
                <span>
                  <b>{t.protein} g</b> protein
                </span>
                <span>
                  <b>{t.carbs} g</b> carbs
                </span>
                <span>
                  <b>{t.fat} g</b> fat
                </span>
              </div>
              <div className="gl-delta">{t.delta === 0 ? "Your maintenance" : `${describeDelta(t.delta)} from your maintenance of ${t.maintenance.toLocaleString("en-IE")}`}</div>
              {on && <div className="gl-current">Your target in Nutrition</div>}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="gl-error" role="alert">
          {error}
        </div>
      )}

      {current && (
        <button type="button" className="gl-clear" onClick={clear} disabled={saving !== null}>
          Remove my goal
        </button>
      )}
    </div>
  );
}
