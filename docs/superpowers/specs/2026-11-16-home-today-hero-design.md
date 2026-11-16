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

## Revision, 2026-11-16 (after the first version went live)

The user asked for a cleaner Home. These decisions are from the visual companion: mockups `home-v2.html` and `hero-options.html`, option 2.

- **Hero: the "program ring" card.**
  - A white card (`--surface-1` or the kit's card surface, not the brand gradient).
  - Left: a ring showing how far through the program the member is. The centre number is sessions done; the line below says "of N done". N is the round total My program already uses; past the total, the ring is full and shows "N done".
  - Right: the eyebrow "Today · Week N" (or "Next up · Week N"), the day name in large type, and the main lift's sets as a tidy list: "Set 1 / 112.5 x 5", "Set 2 / 127.5 x 3", then the top or + set labelled "Top set" in the accent colour.
  - A full-width filled accent "Start session" (or "Continue session") button.
  - The other states (coach plan, open workout, block done, empty) use the same white card without the ring. Paused members still get no empty hero.
- **Tiles:** kept, with the same no-zero rules.
- **Feature buttons:** a 2 x 2 grid of plain buttons with no icons and no letters. Each has a bold label and a small line under it, and shows only when that feature is on.
  - Log a meal: protein today, when logged.
  - Book a class: the next booked class in 12-hour time, else "See the timetable".
  - Check-in: a "Due" badge when due, else the next date.
  - Habits: "N of M today".
- **Overall strength chart:** under the buttons. The big % change, the line from `trainingOverview(...).strength` (the series the Progress page uses, via its `TrendChart` or the kit's plain SVG), and the caption "Average estimated max across your main lifts". With fewer than two points it is one QuietRow: "Log a lift twice to see your strength trend". It links to `/app/progress`.
- **Removed from Home:** the Coming up section, the habit-ticks card (now the Habits button), and the rows for membership, goal, body scans, cycle tracking and notifications. These move to Profile (`/app/profile`) as QuietRows with their existing gates and copy, and PushSetup moves too. Nothing is lost; it is only moved.
- **Rules unchanged:**
  - one filled accent button (the hero's);
  - no zero tiles;
  - brand variables only;
  - 44px, 320px;
  - no emojis.
