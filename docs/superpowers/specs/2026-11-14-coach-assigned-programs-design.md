# Coach-assigned programs

Date: 2026-11-14
Status: approved in brainstorm, awaiting spec review
Builds on: the DIY program library (28 programs), gym copies ("our version") and member-built programs, all behind the Programs module.

## Why

Coaches can already browse the library, hide programs and make gym-wide versions. They cannot:

- start a program for a member;
- change one person's program, before it starts or while it runs.

This feature lets a coach assign any library program or gym version to a member, edit it for that person, and keep editing it during the run. The program keeps its own progression rules.

## Decisions (from the brainstorm)

| Question | Decision |
|---|---|
| How an edited copy progresses | It keeps the program's own engine (5/3/1 cycles, Juggernaut + sets, GZCLP stages and so on). It is not converted to per-exercise rules. |
| What the member can do | Follow it. They log sessions and can skip one. They cannot edit it, change a max, end it, restart it or swap to another program. |

## 1. Assigning a program

- **Where:** an "Assign a program" button in the program panel on the client page (`components/clients/ClientProgramPanel.tsx`). Staff only.
- **Pick:** any program the gym's members could pick: platform programs it has not hidden, plus its own versions. The coach sees the same summary, phases and "how your weights move" that members see.
- **Set up** (same fields as the member start flow):
  - kg or lb, and the smallest jump;
  - a max for each lift, pre-filled from the member's best logged set in the last 90 days where there is one;
  - training weekdays and a start date.

  A first-week preview shows the real weights.
- **Edit before saving (optional):** the coach can edit the program for this person before saving, with the editor used for gym versions (`components/workout/ProgramCopyEditor.tsx`): exercises, sets, reps, percentages, notes and weeks.
- **Saving:**
  - It starts the program the same way a member starting it does.
  - If the member already has a live program, the coach is warned first. On confirm that program ends, and both the end and the assignment go in the log.
  - The member's training mode does not block it: a coach-set program runs whether the member is coach-guided or DIY.
- **Notification:** a push to the member when the push service is set up and they have a device ("Your coach set you a program: <name>").

## 2. The private copy

- A running program already stores its own snapshot of the template (`program_enrolments.template_json`). A coach's edits change that snapshot only, so the library program and the gym versions are never touched.
- **New columns on `program_enrolments`:**
  - `assigned_by` (staff user id, nullable). Set means "set by your coach" and locks the member out.
  - `assigned_at` (nullable).
- Every save runs the same check as a gym version: the template check (`validateTemplate`) plus `copyErrors` against the program it came from, so no lift the engine needs goes missing.

## 3. Editing while it runs

- From the client page, the coach opens "Edit program" on a running coach-set program. It uses the same editor, which now records where each week came from (week origins, as the member builder already does).
- **Carry-over.** The running state moves onto the new version. `rebaseEdit` (`lib/programs/memberEdit.ts`) is extended from member-built programs to every engine:
  - Exercises match old to new by state key (name, tier, rep range).
  - A kept exercise keeps its working weight, misses and GZCLP stage, and its T2 base.
  - A new exercise starts as the engine would start it (`initState` for that exercise, from the member's maxes).
  - A removed exercise drops out.
  - Training maxes, maxes, test maxes and the 5/3/1 "short" holds carry over by lift.
  - The member stays on the same day by name. If their week is removed, they move to the nearest earlier week, or the first. The week number they see stays the same when the number of weeks changes.
- **Change log:** each edit writes plain lines under the coach's name, e.g. "Coach changed Bench press to 4 x 6 from week 3". An edit that changes nothing writes no event. The member sees these lines under Recent changes.
- The existing coach controls (change a max, move to a week) keep working. The coach can also end the program.

## 4. The member app

- A coach-set program shows in My program with a "Set by your coach" line, in coach-guided or DIY mode. The Programs tab is reachable for it even when the member is coach-guided.
- **Hidden for a coach-set program:** edit, change a max, end, restart from a test, and starting any other program.
- **Refused on the server too**, with a plain message: "Your coach set this program. Ask them to change it."
- **Kept:** logging sessions, skipping a session, and changing training days.

## 5. Safety

- Only signed-in staff of the business can assign, edit or end a member's program. Every action checks that the member belongs to the current business (the ambient tenant DB), as the existing coach actions do.
- The template check runs on every save of a person's copy.
- The Programs module switch still gates everything: with it off, nothing new appears for staff or members.

## 6. Testing and rollout

- **Tests:**
  - Carry-over for each engine: linear, training-max cycles (cycle, drive set, reps over, GZCLP), fixed block, double progression and fixed volume. A kept exercise keeps its weight, an added one starts as the engine would, a removed week moves the member back sensibly, and training maxes and 5/3/1 holds survive.
  - An edit that changes nothing writes no log line.
  - Assigning ends the member's own live program cleanly, with both events logged.
  - The member's edit, change-max, end, restart and start actions are refused on a coach-set program; skip and training days still work.
  - A staff action naming a member of another business is refused.
  - A person's copy that drops a lift its engine needs is refused.
- **Browser checks:** the coach's assign and edit screens at desktop and phone widths, and the member's "Set by your coach" view at 320px and 390px, in Inspire's and Optimal Health's colours.
- **Rollout:** behind the Programs module, still off for every business.

## Out of scope

- Assigning one program to many members at once.
- Templates a coach saves for reuse across members (gym versions already cover this).
- Coach edits to member-built programs (the member owns those).
- Changes to the logging screen or the progression logic itself.
