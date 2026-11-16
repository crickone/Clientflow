// app/src/components/clientapp/home/HomeHero.tsx
/**
 * The card Home leads with: today's session. A running program shows its ring
 * (sessions done of the round), the day and its sets; every other state is
 * the same card without the ring. Its accent button is the only filled
 * control on the screen. Plain markup (the start buttons are the client
 * parts), styled by .pk-hcard* and .pk-hring*.
 */
import Link from "next/link";

import type { WeightUnit } from "@/lib/programs/types";
import { StartProgramSessionButton } from "@/components/clientapp/StartProgramSessionButton";
import { StartWorkoutButton } from "@/components/clientapp/StartWorkoutButton";
import { heroSets, type Hero, type Ring } from "./homeModel";

const BTN = "pk-hcard-btn";
const R = 36;
const CIRC = 2 * Math.PI * R;

/** The ring: a track, the accent arc for how far through the round, the count in the middle. */
function ProgramRing({ ring }: { ring: Ring }) {
  const label = ring.total !== null ? `${ring.done} of ${ring.total} sessions done` : `${ring.done} sessions done`;
  return (
    <svg className="pk-hring" width="86" height="86" viewBox="0 0 86 86" role="img" aria-label={label}>
      <circle className="pk-hring-track" cx="43" cy="43" r={R} />
      {ring.pct > 0 && <circle className="pk-hring-fill" cx="43" cy="43" r={R} strokeDasharray={`${(ring.pct * CIRC).toFixed(1)} ${CIRC.toFixed(1)}`} transform="rotate(-90 43 43)" />}
      <text className="pk-hring-num" x="43" y="42" textAnchor="middle">
        {ring.done}
      </text>
      <text className="pk-hring-cap" x="43" y="55" textAnchor="middle">
        {ring.caption}
      </text>
    </svg>
  );
}

function Shell({ eyebrow, title, line, ring, sets, children }: { eyebrow: string; title: string; line?: string; ring?: Ring; sets?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="pk-hcard" aria-label="Your next session">
      <div className={`pk-hcard-top${ring ? "" : " pk-hcard-top--plain"}`}>
        {ring && <ProgramRing ring={ring} />}
        <div className="pk-hcard-main">
          <div className="pk-hcard-eyebrow">{eyebrow}</div>
          <h2 className="pk-hcard-title">{title}</h2>
          {line && <p className="pk-hcard-line">{line}</p>}
          {sets}
        </div>
      </div>
      {children}
    </section>
  );
}

export function HomeHero({ hero, unit, openDetail, blockLine }: { hero: Hero; unit: WeightUnit; openDetail?: string; blockLine?: string }) {
  switch (hero.kind) {
    case "program": {
      const sets = heroSets(hero.chips, unit);
      return (
        <Shell
          eyebrow={hero.eyebrow}
          title={hero.title}
          ring={hero.ring}
          sets={
            sets.length > 0 ? (
              <ul className="pk-hsets" aria-label="Main sets">
                {sets.map((s) => (
                  <li key={s.label} className="pk-hset" data-top={s.top ? "true" : undefined}>
                    <span>{s.label}</span>
                    <span className="pk-hset-value">{s.value}</span>
                  </li>
                ))}
              </ul>
            ) : undefined
          }
        >
          <StartProgramSessionButton label={hero.action === "continue" ? "Continue session" : "Start session"} tall className={BTN} />
        </Shell>
      );
    }
    case "block_done":
      return (
        <Shell eyebrow="Your program" title={hero.title} line={blockLine}>
          <Link href="/app/programs/mine" className={BTN}>
            See your program
          </Link>
        </Shell>
      );
    case "plan":
      return (
        <Shell eyebrow="Next up" title={hero.title}>
          <StartWorkoutButton programId={hero.programId} dayPosition={hero.dayPosition} label="Start workout" tall className={BTN} />
        </Shell>
      );
    case "open":
      return (
        <Shell eyebrow="In progress" title={`Continue ${hero.title}`} line={openDetail}>
          <Link href={`/app/workouts/log/${hero.sessionId}`} className={BTN}>
            Continue workout
          </Link>
        </Shell>
      );
    case "empty":
      return (
        <Shell eyebrow="Today" title="Start training" line={hero.programsVisible ? "Pick a program and the app plans each session for you." : "Log what you lift and the app keeps your history."}>
          {hero.programsVisible ? (
            <Link href="/app/programs" className={BTN}>
              Choose a program
            </Link>
          ) : (
            <StartWorkoutButton label="Log a workout" tall className={BTN} />
          )}
        </Shell>
      );
  }
}
