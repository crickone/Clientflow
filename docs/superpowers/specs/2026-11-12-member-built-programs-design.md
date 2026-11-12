# Member-built programs

Date: 2026-11-12
Status: approved in brainstorm, awaiting spec review
Builds on: docs/superpowers/specs/2026-11-12-diy-program-library-design.md (shipped 2026-11-12)

## Why

Elite athletes and serious bodybuilders want to run their own programs, not only the library's. The DIY library already has the parts they need: the program format, five tested progression engines, enrolments, the logger with planned weights, and the change log. This feature lets a DIY member build their own program in the member app and run it with the same machinery.

## Decisions

| Question | Decision |
|---|---|
| How weights work | Per exercise: each exercise picks an automatic rule or manual. |
| Structure | One week that repeats; more weeks can be added (copy a week and change it) for blocks and deloads. |
| Start from | A blank program, a copy of any library program the gym shows, or the member's current program. |
| Who sees it | Private to the member. Staff see it read-only on the client page. |
| Approach | A new "own rules" engine on the existing program format. No second builder or engine stack. |

## 1. Storage and running

- New tenant table `member_programs`: id, client_id (FK clients, ON DELETE CASCADE), name, template_json, based_on (platform key, copy id or null), created_at, updated_at. Rows are only readable and writable by their own member (and read-only by staff).
- A member program is a `ProgramTemplate` with `engine: { key: "own_rules" }`. Each exercise carries a `rule`:
  - `linear`: `incKg` (default 2.5; 5 for deadlift), `deloadAfter` (default 3), deload 10%.
  - `range`: `min`, `max` reps per set, `incKg` (default: the member's smallest jump).
  - `percent`: `lift` (squat, bench, deadlift, press, row) and a percentage per set per week. The max moves on a re-test or a member edit.
  - `rpe`: reps and RPE per set. The suggested weight comes from the member's best estimated max for that exercise.
  - `manual`: no change. The planned weight is last time's weight for that exercise.
- The `own_rules` engine dispatches each exercise to the existing per-exercise logic in `engines.ts`. Linear and double progression are reused, and percent and RPE use the existing planner set types. Every change returns a reason sentence, as now.
- Running uses everything that exists: enrolments, My program, today's session, the logger with the Plan column and RPE, finish and progression, skip, end, and the change log. The enrolment points at the member program (`program_key = "member:<id>"`).
- Maxes are asked for at start only for lifts that a `percent` exercise uses.

## 2. The builder (member app)

- The Programs tab gets "Build your own" at the top. A "My programs" list shows each built program with Edit, Start and Delete. Delete is refused while that program is running; the member ends it first.
- Starting points:
  - **Blank:** one week, one day, no exercises.
  - **A library program:** copies a program from `memberPrograms()` and converts each exercise to the nearest rule:
    - Linear engines become `linear`.
    - Double progression becomes `range`.
    - Fixed block and training-max percentages become `percent`.
    - RPE sets become `rpe`.
    - Anything else becomes `manual`.
  - **My current program:** the same conversion from the running enrolment's template, keeping its maxes, plus the current weights for the linear and range exercises.
- Screens: program (name, units); week tabs (week 1 repeats; "Add a week" copies the current week; remove; reorder); days (add, rename, reorder, remove); exercises. For each exercise:
  - Pick it from the gym's exercise library (`listExercises()`), or type a name.
  - Choose the rule and its fields: sets, reps, range or percentages, RPE, rest, notes.
  - Optionally join it to the exercise above as a superset.
- Save validates on the server and returns plain errors, e.g. "Week 2, Push A, exercise 3: add reps."
- Limits: 12 weeks, 7 days a week, 15 exercises a day, 10 sets per exercise, names up to 80 characters, notes up to 300.
- Phone-first: 44px touch targets, the member-app brand CSS variables, and usable at 320px.

## 3. Editing while running

- An edit to a running member program applies from the next session. Nothing already logged changes.
- Exercises match old to new by state key (name plus rule):
  - A kept exercise keeps its weight and miss count.
  - A new exercise starts from its rule.
  - A removed exercise drops out of future sessions; its history stays.
  - A changed rule restarts that exercise from the new rule, with a reason in the change log.
- If the current week is removed, the member moves to the nearest earlier week.
- An open session finishes on the old version.
- The change log gets a "You edited the program" entry listing what changed (days, exercises, rules).
- The edit, the enrolment template update, the state update and the change-log event are written in one transaction.

## 4. Staff, gating, testing

- **Client page panel:** shows "Built by the member" and the program read-only (week, day, exercise and rule), alongside the progress, maxes and change log already there. Coach max corrections and moving the member to another week work as now. There is no coach editing of member programs.
- **Gating:** the same Programs module and DIY mode. Every member page calls `requireProgramsPage()`; every member action checks `requireClient()` and `memberSeesPrograms()`, and the store checks ownership by client id.
- **Tests:**
  - **The rule mix:** one session containing all five rules gives the right weights and reasons.
  - **The three starting points:** conversion from each engine family, and maxes and weights kept from the current program.
  - **Edit-while-running:** kept, new, removed and changed-rule exercises; the current week removed; an open session.
  - **Builder validation:** errors read in plain words, and the limits are enforced.
  - **Ownership:** a member cannot read, start, edit or delete another member's program.
  - **Browser:** the builder at 320px and 390px.

## Out of scope

- Sharing programs with other members.
- Coaches editing a member's own program.
- Spreadsheet import.
- Progress charts beyond what exists.
