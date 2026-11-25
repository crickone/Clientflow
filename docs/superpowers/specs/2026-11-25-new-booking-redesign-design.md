# New booking screen redesign: design

Date: 2026-11-25. Status: approved by the operator from the mockup
(`.superpowers/brainstorm/18469-1795619055/content/new-booking.html`).

## Goal

/appointments/new (components/appointments/BookingForm.tsx, 1085 lines) asks
staff to do the work: 17 equal tiles, 30-minute versions as separate tiles,
raw date/time inputs with no idea what is free, an overtypable price, and the
client's prepaid session buried at the bottom. Rebuild it as the mockup: a
form on the left, a live booking summary on the right with the Book button.

## Layout (from the mockup; match it)

Left column, cards in order:
1. **Client.** Existing client (search) or walk-in (name, phone, email),
   as today. When the client has a usable prepaid package (any treatment,
   usable on the chosen date, a session left once booked sessions are held:
   /api/packages with date), a green banner: "{first name} has {n} prepaid
   {package treatment}, {minutes} min, from {package name}. Use by {date}."
   with a "Use it" / "Using it" toggle. Using it selects that treatment and
   length and sets payment to the package. Several packages: one banner line
   each.
2. **Treatment.** Search box. Grouped: Recovery (HBOT, Infrared, HIFEM),
   Massage, Specialist (reflexology, Indian head, facial, lymphatic,
   oncology); groups come from a small mapping by name with an "Other" group
   for anything unmatched, so other businesses still work. Treatments whose
   names differ only by a "(30 min)" style suffix collapse into one tile
   ("Swedish", "from EUR 50") with a Length switch (30 min . EUR 50 / 60 min .
   EUR 80) shown under the list when such a tile is selected. A prepaid
   treatment tile shows "PREPAID". Multi-treatment bookings (the
   multi_therapy_concurrent setting) keep working: tiles then multi-select.
3. **When.** A strip of the next 14 days (closed days greyed, from opening
   hours and block-outs), then that day's start times as buttons, free ones
   selectable and taken ones struck through, for the selected treatment(s)
   and length. A line under: "Free times for a {n}-minute session. {Day}: open
   {open} to {close}." Plus "Other time" to type any time (for out-of-hours
   bookings staff are allowed to make today; the server's slot check still
   applies).
4. **Payment.** One row: Prepaid package (only when one applies), Card, Cash,
   Gift voucher, Bank transfer. Gift voucher shows the existing code field and
   split-payment behaviour. "Sign up for a new package" stays available
   (existing behaviour) behind a link in this card. Links: "Adjust price or
   length" (reveals duration and price fields, as today) and "Add a note".

Right column: sticky Booking summary: Client, Treatment (name, minutes),
When (day, date, start to end), Payment, Value (list price struck through and
the package value when paid by package, e.g. EUR 80 -> EUR 64), a line "Already
paid. Uses her 1 prepaid session." or "To pay on the day.", and the primary
"Book {first name} in" button (disabled until client, treatment and time are
set). At 390px it becomes a bottom bar (summary line + Book).

## Behaviour kept exactly

Everything BookingForm does today keeps working, through the same POST
/api/appointments contract: existing client / walk-in, query-param defaults
(client, date, time, voucher, therapy), voucher lookup and split payments,
package use (server checks: owner, use-by date vs booking date, sessions left
incl. booked ones; value = package price per session), new-package sign-up at
booking, notes, multi-treatment, the slot check and its error message.

## New server piece

GET /api/appointments/free-slots?date=YYYY-MM-DD&duration=N&therapyIds=1,2
(staff only): candidate starts every `slot_length_minutes` (setting, default
15) inside dayWindow(date), each marked free or taken using the same
checkBookingSlot rules (opening hours, block-outs, resource limits,
buffer). Also returns the day's open/close and whether the day is closed.
Pure candidate generation in a tested model file.

## Rules

No emojis. Plain copy. Lucide icons. Controls never cramped (12px+ side
padding, 36px chevron padding on selects). Dark and light from the app
tokens (no hardcoded palette). prefers-reduced-motion respected. Works at
390px. No new packages.

## Testing

- Pure: treatment grouping and 30/60 collapsing, free-slot candidate
  generation (opening window, slot length, closed days), summary value
  (package per-session value vs list price).
- Route: free-slots on a scratch tenant with an existing appointment marks
  the clashing start as taken.
- Browser: the screen at 1280 and 390, dark and light, with a client who has
  a prepaid package and one who doesn't; a booking made end to end on a
  throwaway route or dev tenant.
