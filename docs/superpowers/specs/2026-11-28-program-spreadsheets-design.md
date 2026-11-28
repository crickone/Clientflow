# Coach program spreadsheets: weeks, loads, reading files, import

Approved by the user 2026-11-28 ("looks good").

## Why
Coaches keep their training programs in spreadsheets. Adonis can take an attached
spreadsheet today but only sees its name. Workout programs have days only, no weeks,
and no target load, so a typical multi-week coach sheet cannot be copied faithfully.

## Decisions (user)
- Multi-week sheets: add a real Week level to Workout programs (not flattened days,
  not one week with notes).
- Entry points: the Adonis chat AND a "Build from this file" button on the Workout
  Upload program.
- Design approved as below, including the Load field and looping back to week 1
  after the last week.

## 1. Weeks in Workout programs
- `workout_days` gets `week INTEGER NOT NULL DEFAULT 1`. Existing programs are one
  week and behave exactly as today.
- Days stay one flat, ordered list: `position` is the running index across the whole
  program, ordered by week then day. `workout_sessions.day_position` keeps meaning
  "index into getProgram().days", so logging, history, progress and resume need no
  data change. "Next" stays (last + 1) modulo the day count: after the final week it
  goes back to week 1.
- Limits: weeks 1..16, at most 7 days in one week, at most 112 days, 200 exercises a
  day (unchanged).
- Labels: when a program has more than one week, a day reads
  "Week 2 · Day 1 – Push" (week prefix + the day's own name). One-week programs keep
  today's labels. One pure helper owns this (`dayLabel`). Session `day_name`
  snapshots use it, so history keeps the full name.
- Builder: week tabs above the day tabs; "Add week" offers "Empty week" or "Copy of
  week N" (copies the previous week's days and exercises); remove week (at least one
  stays); days are added inside the selected week.
- Member app: the program page shows a week picker above the day tabs when there is
  more than one week; "Next up", Home hero, planner and history show the full label.
  Subtitle "8 weeks, 4 days a week" (or "N days" for one week).

## 2. Target load on each exercise
- `workout_exercises.load TEXT` (free text: "70%", "RPE 8", "60 kg", "70% / RPE 7").
- Shown and editable in the builder, shown on the member program page, and copied into
  the session snapshot (`workout_session_exercises.load`) so the logger shows it as the
  target. No calculation from it.
- Adonis `create_workout_program` accepts `load` and `week`.

## 3. Adonis reads spreadsheets
- New read tool `read_attached_file(fileId)` for a library file (the chat paperclip
  stores attachments in the Content Studio library; the model sees the id).
- Reads .xlsx (every sheet, cell values, cached formula results), .csv, .txt, .md,
  .json. Refuses .xls ("Save it as .xlsx from Excel and attach it again."), PDF, Word
  and PowerPoint with a plain reason.
- Output is a grid as text, row numbers and column letters, capped (about 60,000
  characters) with a clear "cut off at row N" line. File content is fenced as
  untrusted data.
- Parser: our own small reader on jszip (already a dependency) + regex XML; no new
  dependency. Zip guards: total uncompressed size cap, cell count cap.

## 4. Sheet to program converter
- One server module (`lib/workoutImport`) shared by the chat and the button.
- Pass 1 (outline): the model reads the whole grid and returns the program title, the
  weeks, days per week, and for each week the rows that hold it, plus anything it
  cannot place.
- Pass 2 (per week, up to 4 at a time): the model gets the header rows plus that
  week's rows and returns that week's days and exercises. Keeps each reply small, so a
  12-week sheet never hits the reply-length limit.
- Copy exactly: names, sets, reps, load, rest, notes, supersets. Never add, drop or
  change anything. Things it cannot read go into an "unplaced" list shown to the coach.
- Exercise names that exactly match the exercise library (normalised) get the library
  id and muscle groups so demo videos show; otherwise the coach's own name is kept.
- Metered under agent key `workout-import` (Sonnet 5.5), cap-checked before the first
  call. Estimated 20 to 60 cents for a 12-week program.
- Chat: read tool `draft_program_from_file(fileId)` runs the converter and returns a
  short summary plus a pending `create_workout_program` write, so the operator sees
  the usual Approve card ("8 weeks, 4 days a week, 46 exercises"). Assign as today.
- Button: on the Upload program form, for .xlsx/.csv files, "Build from this file"
  runs the converter, writes the result into the builder's existing new-program draft
  and opens `/workout/new?type=detailed`, filled in but not saved; unplaced items are
  listed at the top. The coach checks and presses Save.

## Out of scope
- PDF and Word programs; .xls; Google Sheets links.
- Progression engines (the DIY Programs module is separate and unchanged).
- Re-pointing old sessions when days are reordered (existing behaviour, unchanged).
