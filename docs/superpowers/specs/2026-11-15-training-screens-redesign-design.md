# Training screens redesign and program progress

Date: 2026-11-15
Status: approved in brainstorm, awaiting spec review
Builds on: the Programs UI redesign (2026-11-12, the `.pk-` kit) and coach-assigned programs (2026-11-14).

## Why

The member app's training screens look flat. Every block is the same beige card, so the one thing a member came to do (start today's session) competes with "Log a meal", "No active membership" and "No upcoming classes". Sets read as sentences ("1 x 5 at 65 kg, then 1 x 5 at 75 kg..."). Empty states take up whole cards. The Workouts tab repeats the Home card and then says "No programme yet. Your coach will add one" under a running program. A running program shows no progress until sessions are logged, and the Progress page opens on zero tiles and a flat line.

This round:

- fixes the visual hierarchy on four screens: Home, Workouts, My program and Progress;
- adds program progress data that is useful from the first day.

Classes, Nutrition and Profile adopt the look in a later round.

## Decisions (chosen from mockups in the visual companion)

| Question | Decision |
|---|---|
| Direction for the training screens | B: dashboard first. Numbers and the week lead, then today's session as a clean table. |
| How program progress reads | A: the training max path. Per lift, the line so far against the planned path, plus the + sets. |
| Home vs Workouts | Home is a summary with a one-line next session. Workouts holds the full session table. |
| The Progress page | With a program running, it opens with the program's path and + sets, then lifts and body. Empty sections collapse to one line. |

## 1. The kit

These shared pieces extend the existing `.pk-` kit (`components/clientapp/programs/kit.tsx`, the `.pk-` CSS block in `globals.css`). They use the gym's brand CSS variables only, so Optimal Health and Inspire each look like themselves. No new CSS prefix.

- **StatStrip:** three numbers in a row, each with a small label above and an optional small line below. The numbers are large, bold and tabular.
- **WeekStrip:** Monday to Sunday as circles: done (filled accent), today (accent ring), missed, planned or rest. It replaces the current week dots wherever they appear on these screens.
- **SessionTable:** one row per exercise. The exercise name is on the left; each set is "weight x reps" on its own line at the right, with tabular numbers. A + set is in the accent colour. Bodyweight sets show reps only. It replaces the sentence-style set lines on these screens.
- **QuietRow:** one line with a label, an optional value on the right, and a chevron or plus. It is used for links and for empty states ("No class booked. Browse the timetable").
- **TmPathChart:** see section 3.

### Hierarchy rules, on all four screens

- At most one filled accent button per screen: the primary action.
- One white card holds the main content of the screen. Everything secondary is a QuietRow or sits in the plain page background.
- A number is always larger and heavier than its label.
- An empty state is one QuietRow with a next step, never a full card or a zero tile.
- The words say "program" everywhere ("programme" goes).
- Controls are 44px or more, the layout works at 320px with no horizontal scroll, there are no emojis, and icons are lucide.

## 2. The screens

- **Home** (`app/app/page.tsx`):
  - "Welcome back" and the member's first name.
  - A StatStrip: sessions this week (done/planned), week streak, and the next class (day and time, or "None").
  - With a program running: a one-line next session ("Press day · Week 1 of 12") with a Start button. The full table is not shown on Home.
  - QuietRows for log a meal, the next class or browse the timetable, and membership.
- **Workouts** (`app/app/workouts/page.tsx`):
  - The title, then a StatStrip with sessions this week, one headline number and the streak. With a training-max program, the headline number is its first lift's training max; otherwise it is workouts in the last 30 days.
  - The WeekStrip.
  - Today's session in the one white card: day name, estimated length, the SessionTable, and Start session.
  - QuietRows: log your own workout, history, progress.
  - Remove the "No programme yet" card whenever a program or coach plan is running.
  - Members without a program see the coach's plan or the log-your-own row, as today, in the new style.
- **My program** (`app/app/programs/mine/page.tsx`):
  - The title, the week and phase, and the phase bar, as now.
  - A StatStrip: sessions done/total, skipped, and the current phase.
  - The next session in the one white card, with the SessionTable and Start session.
  - The progress section (section 3).
  - Recent changes, "See the whole program", and the existing controls.
  - Behaviour is unchanged, including the coach-set rules.
- **Progress** (`app/app/progress/page.tsx`, and the Workouts progress route if it is separate):
  - With a program running, it opens with the same progress section as My program, then lifts, workouts per week and body scans.
  - Every empty section collapses to one QuietRow with its first step ("Log a lift twice to see your strength trend"). There are no zero tiles and no flat charts.

## 3. Program progress data

### The chart: TmPathChart

One chart per lift, with a segmented control to switch lifts. It shows:

- a solid accent line for the value so far;
- a dashed line for the planned path from now to the end of the program's length;
- the current value labelled on the solid line, and the planned end value at the end of the dashed line;
- week numbers on the x axis.

The chart is plain SVG drawn in the brand colours, like the existing sparklines. No chart library. It must read at 320px.

### What it plots, by engine

- **Training-max programs** (`tm_cycle` except GZCLP; e.g. 5/3/1, Juggernaut, Texas): the training max per lift.
- **Add-weight programs** (`linear`, GZCLP, `double_progression`, `fixed_volume`, and member-built `own_rules` with linear or range rules): the working weight of the lift's main exercise.
- **Fixed blocks** (`fixed_block`; e.g. Smolov, Candito, Calgary): the planned top set each week, plus the test result when the test day is done.

The label above the chart names what it plots: "Training max", "Working weight" or "Top set".

### Where the data comes from

- **So far:** the program's own change log. Each `progress` and `skip` event already stores the state after the session (`program_enrolment_events.after_json`: week, cycle, training maxes, weights). The "so far" line is those snapshots in order, mapped to program weeks. No new tables.
- **Planned:** run the engine forward from the current state to the end of the program's length, with every planned rep hit (the simulator's perfect performer, in kg or lb at the member's step).
  - The chart says "Dashed: if each + set hits its reps" (or "if you get every rep" for programs without + sets).
  - It is a plan, never a promise. No claim of results anywhere.
- **+ sets:**
  - From the member's logged sessions on this enrolment (`workout_sessions.enrolment_id`), take each planned + set (an AMRAP or `drives` set in the session exercise's `rx_json`) and the reps and weight logged for it, newest first, as "Week 3 · 95% x 1+ — 155 x 4".
  - For programs without + sets, list the top set of each session's main lift instead, titled "Top sets".

### Before the first session

- The planned path shows from the start, and the solid line is a single point at the starting value.
- The + set list shows one QuietRow: "Your + sets show here after your first session."

### Coach view

- The coach's program panel on the client page gets the same chart, read-only, above the change log.

## 4. Testing and rollout

- **Tests (pure, where the logic lives):**
  - The "so far" series built from a list of events, for training-max, add-weight and fixed-block programs. Skips are included, and a restart begins a new round.
  - The planned series: ends at the program's length, follows the engine (5/3/1 rises each cycle; StrongLifts rises each session), and is in the member's unit.
  - + set extraction: picks only + sets, newest first; non-AMRAP programs give top sets.
  - Empty and first-day states: one point plus the planned line.
  - The Workouts screen never shows "No programme yet" alongside a running program.
- **Browser checks:**
  - Home, Workouts, My program and Progress at 320px and 390px, in Inspire's and Optimal Health's colours.
  - Each check covers a member with no program, a member on day 1 of 5/3/1, and a member with logged sessions (seeded in the dev copy only, restored after).
  - No horizontal scroll, and no console errors.
- **Rollout:** the Programs parts stay behind the Programs module. The Home and Workouts restyle reaches every business on deploy, because those screens are not behind a switch.

## Out of scope

- Classes, Nutrition and Profile (a later round).
- New tables or stored history beyond the existing change log.
- Changes to the logger screen.
- Changes to the progression rules.
