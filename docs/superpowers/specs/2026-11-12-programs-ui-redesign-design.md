# Programs UI redesign and program explanations

Date: 2026-11-12
Status: approved in brainstorm, awaiting spec review
Builds on: the DIY program library and member-built programs (both shipped 2026-11-12, behind the Programs module).

## Why

The Programs screens work but look plain. They don't explain a program well enough for a member to understand the whole of it before starting. This redesign:

- gives every Programs screen a stronger, consistent look;
- gives every program a clear explanation: what it is, how it's shaped, what each phase feels like, why it works, how the weights move, and every session in full.

## Decisions (chosen from mockups in the visual companion)

| Screen | Direction |
|---|---|
| Program page | B: story and phases |
| Programs tab | A: big story cards grouped by goal |
| My program | A: today first |
| Start a program | A: one question per screen, ending in a review with the first week |
| Builder | A: day cards with an edit sheet |
| Content on every program page | What to expect by phase, Why it works, How your weights move, The whole program |

## 1. Visual kit

- **A shared Programs kit used by every Programs screen.** It is made up of:
  - large uppercase titles;
  - small letter-spaced section labels;
  - soft cards with a light gradient and a hairline border;
  - pill tags for days, weeks, level and length;
  - the phase bar (segments sized by weeks, the current phase brighter);
  - one primary action button per screen, sticky at the bottom where the screen scrolls.
- **Colours come from the gym's brand CSS variables only** (`--accent`, `--accent-soft`, `--accent-ink`, `--text-*`, `--hairline`, `--surface-*`). No hard-coded colours, so Optimal Health and Inspire each look like themselves.
- **The kit lives in a dedicated CSS block with its own unique prefix** (`.pk-`). It must not reuse any existing prefix: the `.mb-` collision with the meal breakdown is the lesson.
- **Layout rules:** touch targets of 44px or more, usable at 320px wide, no horizontal page scroll, lucide icons only, and no emojis.

## 2. Program content

### New fields on every platform program template (in code, next to its sets)

- `summary`: one plain line, shown on the card and at the top of the program page.
- `phases`: an ordered list of `{ name, fromWeek, toWeek, note }`. For a repeating program, the phases describe one cycle and a flag says it repeats.
- `whyItWorks`: two or three short sentences on the method, with no jargon and no claims of results.

### Generated, never hand-written

- **"How your weights move".** A pure function builds this from the template's engine and its exercise rules, so it always matches what the app does. For example:
  - "All 5 sets of 5 done means 2.5 kg more next time. Miss three times in a row and that lift drops 10%."
  - For member-built programs it produces one line per distinct rule: "Bench press goes up 2.5 kg once all 4 sets reach 5 reps".
- **Session length.** It is estimated from each day's sets × (an assumed 40 s per set plus the rest), averaged over the program's days and rounded to the nearest 5 minutes. It is shown as "About 60 min".
- **"A typical week".** It is drawn from week 1 (or the first week of the cycle) using the planner's summaries.

### Member-built programs get the same page, filled in automatically

- summary: "4 days a week, one week that repeats", or "for 8 weeks";
- phases: from the week labels the athlete typed, merging consecutive weeks that share a label; a single phase when there are none;
- why it works: omitted;
- how your weights move: from the rules.

### Gym copies

- They keep the original's summary, phases and why it works, with an added line "Our version, based on X".
- If the copy's weeks no longer match the phases, phases that fall outside the copy's weeks are dropped. A phase that only partly fits is clipped to the copy's length.

### Writing rules

- Plain sentence case, short factual sentences, in our own words.
- "-style" programs keep saying the numbers are ours.
- Nothing claims an outcome ("you will add 20 kg").
- The content for all 19 programs is written once, reviewed against the program data, and stored in each template file.

## 3. Screens

- **Programs tab.**
  - The page title and one line.
  - A compact filter row (goal, days, length) that keeps the current filters.
  - A "Build your own" card.
  - My programs: running first with a "Continue" state, then saved ones with Edit, Start and Delete.
  - Big story cards grouped under goal headings (Get strong, Peak your total, Start lifting, Build size). Each card shows the level pill, name, summary, phase bar and pill tags (days, length, main lift or focus).
- **Program page.**
  - Breadcrumb line (goal, length), title, summary and byline.
  - Sections in order:
    1. The phase bar with phase names.
    2. "A typical week": day rows with the session summary.
    3. "What to expect": one note per phase.
    4. "Why it works".
    5. "How your weights move".
    6. "The whole program": each week folded, opening to its days and exercises with sets, reps and percentages.
  - The warning line where the program has one.
  - A sticky "Start this program" button, or "Continue" when it is the running program.
- **Start a program** (four screens, with a step bar):
  1. **Weights:** kg or lb, and the smallest jump.
  2. **Maxes:** one lift per screen-section, with a big number entry, three ways in (1-rep max, recent set, from my log), and a live preview under each, e.g. "Your first sets: 4 x 9 at 97.5 kg".
  3. **Days:** training weekdays and start date.
  4. **Review:** the choices, plus the whole first week with real weights.

  Back keeps everything entered. Server validation and errors are unchanged, and are shown on the step they belong to.
- **My program.**
  - Title, "Week 2 of 4 · Base phase", and the phase bar.
  - A "Next session" hero card with the day, each exercise with its weight, a plain line on why it's that weight (e.g. "75% of your max, plus 10 kg for week 2"), and "Start session".
  - Key numbers (maxes, sessions done and skipped).
  - "Recent changes" as a timeline.
  - "See the whole program", which links to the program page.
  - The existing controls (training days, skip, end, change a max, edit for member programs) move below, unchanged in behaviour.
- **Builder.**
  - Week tabs, then day cards holding exercise rows (name, sets x reps, rule badge).
  - Tapping an exercise opens a bottom sheet with:
    - the rule picker as four or five tiles;
    - sets, reps and rest;
    - the rule's fields;
    - notes;
    - superset;
    - one generated sentence on how it will progress;
    - Done.
  - Add, move and remove behave as today. Save stays sticky. The save lock and origins logic are unchanged.

## 4. Testing and rollout

- **Tests:**
  - A content check that every platform program has a summary, phases covering every week (or one cycle when it repeats) and a "why it works".
  - The generated "how your weights move" for all 19 programs and every rule kind: plain sentences with real numbers and no undefined values.
  - Session-length estimates against two or three hand-worked programs.
  - Member-built and gym-copy content: phases from labels; clipping when weeks change.
  - Start flow: going back keeps entries, and the review shows the right first week.
  - Builder sheet: saves the right fields.
- **Browser checks:**
  - Every redesigned screen at 320px and 390px, in Inspire's and Optimal Health's brand colours.
  - Workouts and Nutrition look unchanged.
- **Rollout:** behind the same Programs module, which is still off for every business.

## Out of scope

- Program images or photography.
- Charts beyond the phase bar.
- Changes to the logging screen.
- Changes to the progression logic.
