// app/src/components/clientapp/home/HomeHero.tsx
/**
 * The block Home leads with: today's session on a gradient of the gym's
 * accent. Its button is the only filled accent control on the screen. Plain
 * markup (the start buttons are the client parts), styled by .pk-hero*.
 */
import Link from "next/link";

import type { WeightUnit } from "@/lib/programs/types";
import { StartProgramSessionButton } from "@/components/clientapp/StartProgramSessionButton";
import { StartWorkoutButton } from "@/components/clientapp/StartWorkoutButton";
import type { Hero } from "./homeModel";

const BTN = "pk-hero-btn";

function Shell({ eyebrow, title, line, children }: { eyebrow: string; title: string; line?: string; children?: React.ReactNode }) {
  return (
    <section className="pk-hero" aria-label="Your next session">
      <div className="pk-hero-eyebrow">{eyebrow}</div>
      <h2 className="pk-hero-title">{title}</h2>
      {line && <p className="pk-hero-line">{line}</p>}
      {children}
    </section>
  );
}

export function HomeHero({ hero, unit, openDetail, blockLine }: { hero: Hero; unit: WeightUnit; openDetail?: string; blockLine?: string }) {
  switch (hero.kind) {
    case "program":
      return (
        <Shell eyebrow={hero.eyebrow} title={hero.title}>
          {hero.chips.length > 0 && (
            <ul className="pk-hero-chips" aria-label="Main sets">
              {hero.chips.map((c, i) => (
                <li key={i} className="pk-hero-chip" data-plus={c.plus ? "true" : undefined}>
                  <b className="pk-hero-chip-kg">{c.kg}</b>
                  <span className="pk-hero-chip-reps">{`${unit} x ${c.reps}`}</span>
                </li>
              ))}
            </ul>
          )}
          <StartProgramSessionButton label={hero.action === "continue" ? "Continue session" : "Start session"} tall className={BTN} />
        </Shell>
      );
    case "block_done":
      return (
        <Shell eyebrow="Your program" title={hero.title} line={blockLine}>
          <Link href="/app/programs/mine" className={`${BTN}`}>
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
          <Link href={`/app/workouts/log/${hero.sessionId}`} className={`${BTN}`}>
            Continue workout
          </Link>
        </Shell>
      );
    case "empty":
      return (
        <Shell eyebrow="Today" title="Start training" line={hero.programsVisible ? "Pick a program and the app plans each session for you." : "Log what you lift and the app keeps your history."}>
          {hero.programsVisible ? (
            <Link href="/app/programs" className={`${BTN}`}>
              Choose a program
            </Link>
          ) : (
            <StartWorkoutButton label="Log a workout" tall className={BTN} />
          )}
        </Shell>
      );
  }
}
