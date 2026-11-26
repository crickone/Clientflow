# Staff rota and staff-aware booking: design

Date: 2026-11-26. Status: agreed with the operator in conversation, mockup
approved (`.superpowers/brainstorm/39327-1795697818/content/rota.html`).
First user: Optimal Health (tenant 1028). Built for every business, off until
a business uses it.

## Problem

Appointments only check machines and rooms (`resources`, each concurrency 1
at Optimal Health: HBOT, Infrared Therapy, HIFEM Therapy, Massage room). Staff
are not modelled (see the header of `src/lib/scheduling/resourceDemand.ts`).
So with one therapist in, the diary still allows a massage at the same time as
HBOT, which she cannot do. With two in, it should.

Staffing changes week to week, so someone fills the rota in each week.

## What gets built

### 1. The rota (Appointments > Rota, `/appointments/rota`)

- A week grid: people down the side (rows from the existing `staff` table,
  active ones), days Mon-Sun across. Each day header shows the opening hours
  from settings (`opening_hours`); closed days are hatched and take no shifts.
- A cell holds zero or more shifts (start and end, "HH:mm", local Dublin time,
  inside opening hours, end after start, shifts for one person on one day may
  not overlap). Click a shift to edit or remove it; "+ Add" to add one.
- Week navigation (previous/next arrows, the range as "Mon 30 Nov - Sun 6
  Dec"), any week past or future.
- "Copy last week": copies every shift from the previous week into this one
  (replacing this week's shifts after a confirm if it already has any).
- "Add a person": a name (required) creates a `staff` row; Optimal Health has
  none today, so the page must work from an empty staff list (empty state:
  "Add the people who work in the clinic").
- An "On shift" row: per day, a bar across opening hours coloured by how many
  are on (none, one, two or more) and a short text ("1 on 9-13, 2 on 13-17").
  Each person's hours this week appear under their name.
- "Bookings to look at this week": every scheduled or confirmed appointment in
  the shown week that breaks the staff rule (section 3), with the reason and
  an Open link to the appointment. Nothing is cancelled or moved for the user.
- "Treatments: who they need": every active therapy with a two-way choice,
  "Whole time" or "Sets it up" (section 2). Also editable where a therapy is
  edited.
- Responsive by its own width (container queries, as the lead page `lv-`
  styles do): the grid at desktop width, one card per day on a phone. No
  horizontal page scroll at 390px.
- Any signed-in staff member can edit the rota; treatment staffing is
  admin-only.

### 2. Treatment staffing

New column on `therapies`: `staffing` text, "whole" (a therapist is with the
client the whole time) or "setup" (a therapist sets it up and can look after
several at once). Default "whole". A create-only boot migration sets
"setup" for therapies mapped to a resource whose name matches HBOT, infrared,
HIFEM, red light, PEMF or sauna (case-insensitive) and leaves the rest
"whole". (At Optimal Health that gives HBOT, Infrared Therapy and HIFEM
Therapy "setup", the 14 massage-room treatments "whole".)

### 3. The staff rule

People needed at a moment = one for each appointment in progress that
includes a "whole" therapy, plus one if any appointment in progress has only
"setup" therapies. One appointment that carries several therapies is one
client doing them one after another, so it needs at most one person (it
counts as "whole" if any of its therapies is "whole"). Needed may not exceed
the people on shift at any moment of the proposed booking.

People on shift at a moment = the number of shifts covering it. If the
business uses the rota (below) but the week has no shifts at all, it counts as
one person during opening hours (a banner says so). A day with no shifts in a
week that has some has nobody on: no bookings that day.

The rule applies only when the business uses the rota: a setting
(`staff_rota_on`, default off) switched on automatically when the first shift
is saved, and switchable off on the rota page ("Stop using the rota for
bookings"). Off = today's behaviour exactly, so every other business is
unchanged.

The arithmetic is pure and lives beside `resourceDemand.ts` (for example
`staffDemand.ts`), tested on its own. It reports the first moment that fails
and why, in words: "Only one therapist on at 14:00 and a massage is booked
then." / "Nobody is on the rota then."

### 4. Where it applies

Everywhere a booking is checked or a free time is offered, through the same
two seams so they never disagree:
- `checkBookingSlot` in `src/lib/schedule.ts` (creating and moving
  appointments, `src/app/api/appointments/route.ts`, and anything else that
  calls it);
- the free-slot search (`src/lib/scheduling/freeSlots.ts`,
  `availability.ts`, `/api/appointments/free-slots`,
  `src/lib/booking/slotModel.ts`, `bookConsultation.ts`), which feeds the new
  booking screen, the lead engine and Adonis.
The reason text shows where the booking screen shows a refused time today.

### 5. Diary reminder

When the rota is on and the shown week has no shifts: a banner on the
appointments diary and the booking screen, "This week's rota is not filled
in, so bookings assume one person on. Fill in the rota", linking to the rota
week.

## Data

- `staff_shifts`: id, staff_id (FK staff, cascade), date ("YYYY-MM-DD"),
  start ("HH:mm"), end ("HH:mm"), created_at, updated_at; index on date.
- `therapies.staffing` as above.
- Setting `staff_rota_on` (boolean).
Additive, create-only migrations in the existing boot migration style.

## Out of scope

Booking a named therapist, pay from shifts, staff seeing their own shifts in
an app, shift reminders.

## Testing

- Pure rule: one on (massage blocks machines and the reverse; two machines
  together allowed), two on (massage plus machines allowed; three needs
  refused), a combined massage-plus-infrared appointment needs one, partial
  overlaps at shift edges, nobody on, unfilled week counts as one, rota off
  changes nothing.
- Repo and migration on a scratch tenant (shifts CRUD, copy last week,
  staffing seed, the setting switching on with the first shift).
- `checkBookingSlot` and free slots agree on the same diary.
- Browser check of the rota page at 1440 (with a 260px sidebar), 1180, 820
  and 390 wide: no horizontal scroll, the grid and the phone cards, editing a
  shift, copy last week, the bookings-to-look-at list.
- No real personal data in fixtures. No emojis. Plain copy.
