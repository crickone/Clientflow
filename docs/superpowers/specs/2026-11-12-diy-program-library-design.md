# DIY training and the program library

Date: 2026-11-12
Status: approved in brainstorm, awaiting spec review

## Why

Some members know how to train and want a well-known program, not a coach's plan. Offering the programs serious lifters already trust (GVT, Smolov, 5/3/1 and the rest), with the weights worked out and progression handled for them, makes the member app appeal to a higher gym-IQ customer. It also gives a gym something to sell to members who would never pay for coaching.

## Decisions

| Question | Decision |
|---|---|
| What DIY means | The member picks and runs a program on their own. |
| Weights | The app calculates every working weight from the member's maxes. |
| Program families at launch | Powerlifting peaking, strength cycles, beginner linear, bodybuilding/hypertrophy. |
| Progression | Automatic, after each finished session. |
| Coach guided vs DIY | DIY adds the library; a DIY member can still be given coach programs. |
| Who owns the library | The platform. Gyms can make their own version of a program, or hide one. |
| Price | Included for every gym. No add-on. |
| Approach | Programs are data (templates); a small set of progression engines runs them; the existing workout logger records the sessions. |

## 1. Coach guided or DIY

- Every member has a training mode: `coach` (default) or `diy`. Staff set it on the client page and on the add-member form.
- Switching mode never deletes anything. A member switched back to coach guided keeps their DIY history; an active DIY program is paused, not ended.
- In the member app, DIY adds a **Programs** tab (the library) and a **My program** card on Home. Coach-assigned programs keep working exactly as they do today, for both modes.
- The mode only shows where the new **Programs** module is switched on for that business (see section 6).

## 2. The library and gym copies

### Platform library

Programs live in code as template files (one per program), read from a registry in code. They are not copied into any database, so a platform update reaches every gym on the next deploy. Each template carries:

- Metadata: name, author credit, family, level, days per week, length in weeks, the lifts it needs a max for, a plain description in our own words, and a warning line for the demanding ones.
- The template itself: weeks, then days, then exercises, then set prescriptions.
- The progression engine it uses and that engine's settings (increments, deload size, test week).

A set prescription is one of:

- `pct`: a percentage of the training max (e.g. 70%).
- `amrap`: a percentage, with the last set as many reps as possible.
- `rpe`: a target effort (e.g. RPE 8) with a suggested weight from the member's last log of that lift.
- `fixed`: a weight decided by the engine's state (linear and rep-range programs).
- `same_as_last`: repeat the previous set's weight.

Each set also carries its reps (a number, or a range for rep-range programs) and rest.

Exercises in a template use canonical names from a platform exercise list in code (e.g. "Back squat", "Bench press"). When a session is built, a name is matched to the gym's own exercise library if the gym has that exercise, so the video and instructions show up. Otherwise the session uses the canonical name. This follows the logger's existing `exercise_key` rule: `lib:<id>` or `name:<lower>`.

### Launch programs (about 20)

- **Powerlifting peaking:** Smolov, Smolov Jr, Russian Squat Routine, Candito 6-Week, Sheiko-style.
- **Strength cycles:** 5/3/1 (Boring But Big and First Set Last), nSuns, Texas Method, GZCLP.
- **Beginner linear:** Starting Strength, StrongLifts 5x5, Greyskull LP.
- **Bodybuilding / hypertrophy:** German Volume Training, PHUL, PHAT, Arnold split, push/pull/legs, HIT.

Each program names its author ("5/3/1 by Jim Wendler"). Descriptions are our own words; nothing is copied from the books.

### Gym copies

- "Make our version" copies a platform program into the business's own tenant DB. The gym can rename it, swap exercises, change sets, reps, percentages, RPE, rest and notes, and add or remove days and weeks.
- The gym cannot change which engine runs the program. A copy must keep every lift the engine needs. The editor refuses to save a copy that drops one, and says which lift is missing.
- A copy is labelled "Our version, based on Smolov". Platform updates to the original never touch a copy.
- Any platform program can be hidden from the gym's members with a Hide switch. Members see the gym's copies plus the platform programs that are not hidden.

## 3. Starting a program

- **Browsing:** the Programs tab filters by goal (strength, powerlifting peak, beginner, size), days per week and length. Each card shows who it is for, the days and weeks, and the warning line where there is one. For example: "Smolov squats 4 days a week for 13 weeks. Only for lifters with a year or more of squatting."
- **Maxes:** for each lift the program needs, the member gives one of:
  - A 1-rep max.
  - A recent set (weight x reps). The app estimates the max with the Epley formula, capped at 10 reps.
  - Their best logged set of that lift in the last 90 days. When one exists it is filled in already.

  The engine then sets the training max from it using the program's own rule (5/3/1 uses 90%, for example).
- **Units:** the member chooses kg or lb for display. Everything is stored in kg, as the logger does today.
- **Rounding:** weights round to the member's smallest jump. That is 2.5 kg by default, 1.25 kg for members with small plates, or 5 lb when they use pounds.
- **Days:** the member picks a start date and training weekdays. This reuses the existing weekday planner (`training_plans`).
- **One at a time:** a member runs one DIY program at a time. Starting another asks them to end the current one first. An ended program keeps its whole history.

## 4. The session screen and progression

- **Today's session:** the My program card and the session screen show every weight already worked out, e.g. "Squat 4 x 9 at 102.5 kg". AMRAP sets say "As many as you can". RPE sets show the target effort and a suggested weight.
- **Logging:** the existing logger records the session, using the same screen, rest timer and history. Two additions:
  - A planned weight on each set.
  - An optional RPE field.

  The session is linked to the member's enrolment.
- **Moving on:** the program advances when the member finishes a session, not by the calendar, matching the logger's rule of keying the day by position. Missing a week means picking up where they left off. A Skip button moves past a session, and skips are recorded.
- **Engines.** All five run when a session is finished, and use what the member actually lifted, including any weight they changed on the day:
  1. **Linear with deloads** (Starting Strength, StrongLifts, Greyskull): all reps hit means +2.5 kg next time (+5 kg on deadlift). Three misses in a row on a lift means a 10% deload on that lift.
  2. **Training-max cycles** (5/3/1, nSuns, Texas Method, GZCLP): the training max rises each cycle by the program's increment. nSuns raises it by the reps hit on the AMRAP set. GZCLP moves a lift to its next rep scheme when it fails.
  3. **Fixed block with re-test** (Smolov, Smolov Jr, Russian Squat Routine, Candito, Sheiko-style): no changes inside the block. The last week ends in a test. The member enters the new max and can start the program again from it.
  4. **Double progression** (PHUL, PHAT, PPL, Arnold, HIT): all sets at the top of the rep range means the weight goes up by the smallest jump and the reps drop back to the bottom of the range.
  5. **Fixed volume** (GVT): 10 x 10 at 60%. Once all 100 reps are done, +2.5 kg next time.
- **Every change says why.** Each engine returns its reasons with the new numbers, e.g. "Next squat 105 kg. You did all 5 sets of 5." The member sees the reason and it is stored in the enrolment's change log.

## 5. What coaches see

- **Client page:**
  - A Coach guided / DIY chip that staff can switch.
  - On the Workout tab, the DIY program: name, week (e.g. week 3 of 13), current maxes and training maxes, the next session, the change log with reasons, and skipped sessions.
- **Coach changes:** a coach can correct a member's max or move them to another week. Each change is logged with who made it and shows in the member's change log.
- **Workout module, Program library tab:**
  - Every platform program, with a preview: a week-by-week table of percentages and example weights for a 100 kg lifter.
  - "Make our version" opens an editor in the style of the Detailed builder: weeks, then days, then exercises, then set rows.
  - A Hide switch on each platform program.

## 6. Data, testing and rollout

### Data (tenant DB, additive migrations)

- `clients.training_mode` TEXT NOT NULL DEFAULT 'coach'.
- `clients.weight_unit` TEXT NOT NULL DEFAULT 'kg' ('kg' or 'lb') and `clients.plate_step_kg` REAL NOT NULL DEFAULT 2.5 (stored in kg; 5 lb is kept as 2.26796).
- `program_templates`: the gym's copies (based-on platform key, engine key, template JSON, metadata).
- `program_library_hidden`: one row per platform program key the gym has hidden.
- `program_enrolments`: client, program key or copy id, the template snapshot taken at start, maxes, training maxes, position (week/day), engine state JSON, status (active, paused, ended), start date.
- `program_enrolment_events`: change log rows (time, actor: engine / member / staff id, kind, reason text, before/after JSON).
- `workout_sessions.enrolment_id` (nullable). `workout_set_logs.target_weight_kg` and `workout_set_logs.rpe` (both nullable).

An enrolment stores a snapshot of the template it started from, so a later edit to a gym copy never changes a program a member is halfway through.

### Testing

- Each engine is a pure function: (state, template, session results) returns (new state, reasons). It has unit tests for: all reps hit, a missed set, three misses in a row, AMRAP scoring, the end of a cycle, and test day.
- Each launch program has an end-to-end test. It runs for its full length with two simulated members, one who always hits every rep and one with scripted misses. It checks the weights against the published program, e.g. Smolov base week 1 day 1 is 4 x 9 at 70%.
- A template check runs over every seeded program. It must parse, every exercise must be in the canonical list, every percentage must sit between 30% and 110%, and every lift the engine needs must have a max.
- Rounding and unit conversion get their own tests (kg and lb, 2.5 / 1.25 / 5 lb jumps).

### Rollout

- A new module, **Programs** (`programs`), joins the catalog in `src/lib/features.ts`. Its rollout is set to Nobody until it is ready.
- It is switched on from the console Feature flags page: named businesses first (Inspire, the gym with lifters), then everyone.
- Demanding programs carry their warning line. The health consent members already agree to in the client app applies.

## Out of scope (later)

- Adonis reading or explaining a member's program progress.
- Coaches building brand-new programs from scratch with the progression engines (they can edit copies of library programs).
- Video demonstrations beyond what the gym's exercise library already has.
- Plate calculators and warm-up set generators.
