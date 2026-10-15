import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import type { MealRow } from "@/lib/meals";
import { summarisePeriod, type MealTotals } from "@/lib/mealsModel";

/**
 * The coach's view of what a member logged in the app, one week at a time:
 * how many days they logged, their averages against their target, and each
 * day's meals down to the food and the weight. No hooks; the week moves by
 * links (?tab=nutrition&week=YYYY-MM-DD).
 */
export function ClientNutrition({
  clientId,
  week,
  today,
  meals,
  target,
  targetFrom,
  plans,
}: {
  clientId: number;
  week: string[];
  today: string;
  meals: MealRow[];
  target: MealTotals | null;
  targetFrom: string | null;
  plans: string[];
}) {
  const shown = week.filter((d) => d <= today);
  const s = summarisePeriod(shown, meals, target);
  const prev = shift(week[0], -7);
  const next = shift(week[0], 7);
  const isThisWeek = week.includes(today);
  const latestLogged = [...s.days].reverse().find((d) => d.meals > 0)?.day;
  const href = (w: string) => `/clients/${clientId}?tab=nutrition&week=${w}`;

  return (
    <div className="nt">
      <div className="nt-head">
        <div className="nt-nav">
          <Link href={href(prev)} className="nt-step" aria-label="Previous week">
            <ChevronLeft size={16} />
          </Link>
          <span className="nt-range">{range(week[0], week[6])}</span>
          {isThisWeek ? (
            <span className="nt-step" aria-disabled="true">
              <ChevronRight size={16} />
            </span>
          ) : (
            <Link href={href(next)} className="nt-step" aria-label="Next week">
              <ChevronRight size={16} />
            </Link>
          )}
          {!isThisWeek && (
            <Link href={`/clients/${clientId}?tab=nutrition`} className="nt-today">
              This week
            </Link>
          )}
        </div>
        <span className="nt-source">
          {target ? `Target ${Math.round(target.calories).toLocaleString("en-IE")} kcal, ${Math.round(target.protein)} g protein, from ${targetFrom}` : plans.length ? "Their plan has no daily numbers" : "No target set"}
        </span>
      </div>

      <div className="bs-tiles">
        <Tile label="Days logged" value={`${s.daysLogged} of ${shown.length}`} />
        <Tile
          label="Average calories"
          value={s.average ? `${s.average.calories.toLocaleString("en-IE")} kcal` : "-"}
          sub={target ? `Target ${Math.round(target.calories).toLocaleString("en-IE")}${s.onCalories !== null && s.daysLogged ? `, within 10% on ${s.onCalories} of ${s.daysLogged} day${s.daysLogged === 1 ? "" : "s"}` : ""}` : undefined}
        />
        <Tile
          label="Average protein"
          value={s.average ? `${s.average.protein} g` : "-"}
          sub={target ? `Target ${Math.round(target.protein)} g${s.onProtein !== null && s.daysLogged ? `, hit on ${s.onProtein} of ${s.daysLogged} day${s.daysLogged === 1 ? "" : "s"}` : ""}` : undefined}
        />
      </div>

      <div className="nt-days">
        {[...s.days].reverse().map((d) => {
          const dayMeals = meals.filter((m) => m.day === d.day);
          const pct = target && target.calories > 0 ? Math.min(100, (d.calories / target.calories) * 100) : null;
          if (d.meals === 0) {
            return (
              <div key={d.day} className="nt-day nt-day--empty">
                <b>{dayLabel(d.day, today)}</b>
                <span>Nothing logged</span>
              </div>
            );
          }
          return (
            <details key={d.day} className="nt-day" open={d.day === latestLogged}>
              <summary>
                <b>{dayLabel(d.day, today)}</b>
                <span className="nt-sum">
                  <span className="nt-kcal">{d.calories.toLocaleString("en-IE")} kcal</span>
                  <span>P {d.protein} g</span>
                  <span>C {d.carbs} g</span>
                  <span>F {d.fat} g</span>
                  <span>
                    {d.meals} meal{d.meals === 1 ? "" : "s"}
                  </span>
                </span>
                <ChevronDown size={16} className="nt-chev" aria-hidden />
                {pct !== null && (
                  <span className="nt-bar" aria-hidden>
                    <span style={{ width: `${pct}%` }} data-over={d.calories > (target?.calories ?? 0) * 1.1} />
                  </span>
                )}
              </summary>
              <div className="nt-meals">
                {dayMeals.map((m) => (
                  <div key={m.id} className="nt-meal">
                    {m.photo ? (
                      <a href={`/api/meals/photo?client=${clientId}&meal=${m.id}`} target="_blank" rel="noreferrer" className="nt-photo">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/meals/photo?client=${clientId}&meal=${m.id}`} alt={m.name} loading="lazy" />
                      </a>
                    ) : (
                      <span className="nt-photo nt-photo--none">{m.kind === "manual" ? "Typed in" : m.kind === "label" ? "Label" : "No photo"}</span>
                    )}
                    <div className="nt-meal-body">
                      <div className="nt-meal-top">
                        <b>{m.name}</b>
                        <span>{Math.round(m.calories).toLocaleString("en-IE")} kcal</span>
                      </div>
                      <div className="nt-meal-meta">
                        {time(m.loggedAt)} · P {Math.round(m.protein)} g · C {Math.round(m.carbs)} g · F {Math.round(m.fat)} g
                        {m.servings !== 1 ? ` · ${m.servings} servings` : ""}
                      </div>
                      {m.items.length > 0 && (
                        <ul className="nt-items">
                          {m.items.map((it, i) => (
                            <li key={i}>
                              <span>{it.name}</span>
                              <span>{it.grams ? `${it.grams} g` : it.portion ?? ""}</span>
                              <span>{Math.round(it.calories)} kcal</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bs-tile">
      <span className="bs-tile-label">{label}</span>
      <span className="bs-tile-value">{value}</span>
      {sub && <span className="nt-tile-sub">{sub}</span>}
    </div>
  );
}

function shift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function range(a: string, b: string): string {
  const f = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-IE", { ...o, timeZone: "UTC" });
  return a.slice(5, 7) === b.slice(5, 7) ? `${f(a, { day: "numeric" })} to ${f(b, { day: "numeric", month: "short" })}` : `${f(a, { day: "numeric", month: "short" })} to ${f(b, { day: "numeric", month: "short" })}`;
}

function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === shift(today, -1)) return "Yesterday";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
}
