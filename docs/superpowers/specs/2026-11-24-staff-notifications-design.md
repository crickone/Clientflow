# Staff notifications: design

Date: 2026-11-24. Status: approved in conversation ("Build all those for notifications").

## Goal

Staff find out when something happens without watching each page: a bell with
an unread count, a pop-up while they are in the app, desktop and phone alerts
when they are not, and per-person settings for which alerts they get.

## What notifies (the four kinds)

| Kind | When | Title / body | Opens |
|---|---|---|---|
| `message` | An inbound WhatsApp, Messenger or Instagram message; an inbound email from a known client or lead | "WhatsApp from Chris Walshe" / first 140 chars of the text | the Inbox thread (`/communication?open=conv:<kind>-<id>`, email `open=email:<thread>`) |
| `lead` | A new lead is created (`upsertLead` returns `created: true`), except leads created by an inbound WhatsApp/Messenger/Instagram message (the message notification already covers them) | "New lead: Caroline Burke" / "From Facebook lead form" | `/leads/<id>` |
| `sale` | An offer or a gift voucher is paid (after the fulfil claim succeeds, once) | "Sale: Black Friday massage, EUR 64" / buyer name | the client (`/clients/<id>`) or the voucher (`/vouchers/<code>`) |
| `booking` | A member books a class in the client app | "Class booked: Annie McCarra" / class name and time | `/timetable` |

Left out on purpose: cancellations, AI notices, staff's own actions.
Email only notifies when the sender is a known client or lead, the message is
unread and less than 2 hours old (so a first Gmail sync of old mail is silent).

## Who gets them

Every active staff member of the business (control `memberships` for the
tenant). `sale` goes to admins only. Each person can turn each kind off, for
the bell (in app) and for phone/desktop separately. Defaults: everything on.

## Pieces

1. **Bell** in the sidebar header (beside the collapse button, also on the
   collapsed rail) and in the mobile top bar: unread count badge (99+ cap);
   opens a panel with the latest 30 (icon per kind, title, body, time, unread
   dot), "Mark all as read", and a link to the settings. Clicking an item marks
   it read and opens it.
2. **Pop-up**: the app polls every 20 seconds (and on window focus) while the
   tab is visible; anything new since the last poll shows as a sonner toast
   with an Open action. The first load never toasts.
3. **Desktop and phone alerts**: standard Web Push with the existing VAPID keys
   (already set in production). A staff service worker served at
   `/notifications-sw.js` with `Service-Worker-Allowed: /`, scope `/`. It skips
   showing an alert when an app window is visible (the pop-up covers it), and a
   click focuses or opens the app at the item's link. iPhone needs the app on
   the Home Screen (iOS 16.4+); the settings page says so.
4. **Settings** at `/settings/notifications` for every staff member (not
   admin-only): the four kinds (sale only shown to admins) with "In the app" and
   "Phone and desktop" switches; "Turn on alerts on this device" / "Turn off on
   this device", and how many devices are on.

## Data (tenant DB)

- `notifications`: id, kind, title, body, href, dedupe_key (unique),
  admin_only, created_at.
- `notification_reads`: user_id, notification_id (primary key both).
- `notification_state`: user_id (pk), read_all_before (ms).
- `notification_prefs`: user_id, kind, in_app, push (pk user_id+kind).
- `staff_push_subscriptions`: id, user_id, endpoint (unique), p256dh, auth,
  user_agent, created_at.

Unread for a user = notifications they may see (admin_only respected, in_app
pref on) created after read_all_before and not in notification_reads.

## Architecture

`app/src/lib/notifications/`:
- `model.ts` (pure): kinds, labels, default prefs, who may see what, snippet.
- `store.ts`: create (dedupe on key, INSERT OR IGNORE), list/unread for a user,
  mark one / all read, prefs, push subscriptions.
- `push.ts`: send to the recipients' devices (fire-and-forget, removes dead
  subscriptions, no-op without VAPID).
- `notify.ts`: the one entry point, `notify({ kind, title, body, href, key })`,
  for the CURRENT tenant. Never throws into the caller: a notification failure
  must not break a webhook, a sale or a booking.

APIs: `GET /api/notifications` (unread count + latest 30),
`POST /api/notifications/read` ({id} or {all:true}),
`POST`/`DELETE /api/notifications/push` (subscribe/unsubscribe this device).
Prefs save through a server action.

## Out of scope

Email or SMS notifications to staff, sounds, per-thread muting, a full-page
notification history.
