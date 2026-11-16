# Home: the today hero

Date: 2026-11-16
Status: approved in brainstorm (direction A, "Bold today hero")
Builds on: the training screens redesign (2026-11-15). Home was too plain after it.

## What changes

Home (`app/src/app/app/page.tsx`) gets three parts.

### 1. Greeting

The date line ("Monday 16 November"), then "Morning, Chris", "Afternoon, Chris" or "Evening, Chris", by Europe/Dublin time.

### 2. Hero card

The one bold block on the screen, filled with a gradient of the gym's brand accent:
`linear-gradient(150deg, var(--accent), color-mix(in srgb, var(--accent) 72%, black))`. The text is light on the accent, and the button is inverted (light fill, accent-ink text).

Its content depends on the member:

- **Program running (active, with a next session):** an eyebrow "Today · Week N of M" on a training day, or "Next up · Week N of M" otherwise. Then the day name, large. Then the main lift's top three working sets as chips with the weight large and "x reps" small. The main lift is the first exercise with a lift; its last three sets are shown, and the + set is marked. Then Start session, or Continue session when that session is open.
- **Program block finished:** "Block done", with "See your program" leading to My program.
- **Coach plan, no program:** "Next up", the workout name and Start.
- **Open non-program workout:** "Continue <day name>".
- **Nothing:** "Start training", with a line and a button. The button leads to Programs when Programs is visible, otherwise to Log a workout.

### 3. Tiles

A row of small tiles, each with a label, a number, and a thin progress bar where a target exists. Only tiles with real data appear:

- **Protein today:** "92 / 160 g". Shown when the daily target has protein, with the bar at protein divided by target.
- **Habits:** "2 of 3" today, with a bar. Shown when habits are on.
- **This week:** sessions done / planned, with a bar. Shown when there is a plan or program.
- **Streak:** "3 weeks". Shown only when above 0.
- **Next class:** "Wed 6:30pm". Shown when one is booked.

With three or more tiles the row scrolls sideways (scroll-snap, no visible scrollbar, never a page scroll). With one or two they share the row. With none the row is left out.

### Below

- **Coming up rows:** the next class or "Browse the timetable"; check-in due (as a row with a "Due" value, not a second accent card); the last + set ("Last + set: Bench 81 x 10", with "Best yet" when it is the lift's best estimated max).
- **The existing rows, unchanged in behaviour:** habit ticks card (stays the one white card), meals, goal, membership, body scans, cycle, notifications.

## Rules

- **One filled accent button:** the hero's own button.
- **No zero tiles.**
- **Colours:** brand variables only. The gradient comes from `--accent` via color-mix. No hard-coded colours.
- **Brand themes:** works in light and dark brands, and at 320px with no horizontal page scroll.
- **Controls:** 44px.
- **Copy:** no emojis, "program".
- **Data:** every existing Home data source, gate and link is kept.

## Testing

- **Pure tests (no data reads), in a model file:**
  - greeting by hour;
  - the hero state chosen for each member case;
  - the main-lift chips from a planned session;
  - which tiles show for given data (no zeros, order).
- **Browser check:**
  - Optimal Health (light) and Inspire (dark) at 320px and 390px;
  - three members: a new member, day 1 of a program, and logged sessions;
  - dev data only, restored afterwards.
