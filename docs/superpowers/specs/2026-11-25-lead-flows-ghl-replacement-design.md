# Lead flows to replace GoHighLevel: design

Date: 2026-11-25. Status: agreed in conversation, flow by flow, with the
operator (Optimal Health, tenant 1028). Built for every business; Optimal
Health is the first to use it.

## Goal

Everything Optimal Health's GoHighLevel workflows did, done natively in
Adonis, better: the same follow-up timing on WhatsApp and email, the board
columns those flows move people between, alerts to the right person, and a
way to log calls. Then GoHighLevel can be switched off. The import of
GoHighLevel contacts and in-flight positions is a separate, later piece (see
"Later" at the end).

## What exists today (build on it)

- Automations at /automations: a fixed trigger catalog with message series
  (channel, template, delay) per trigger. Triggers `new_lead`, `lead_booked`,
  `lead_no_show` exist (lib/automationModel.ts, lib/automations/*,
  lib/automations/leadSequences.test.ts). WhatsApp via lib/whatsapp/send
  (Whapi), email via lib/email (sendEmailForTenant; branded shell).
- Stop rules STOP_ON_REPLY / BOOKED / NO_SHOW; a reply moves a lead to the
  engaged ("Hot lead") stage (lib/pipeline/stage.ts).
- Sending hours: fixed 09:00-21:00 Europe/Dublin (`inSendingHours`).
- Board: per-tenant editable stages on 9 fixed roles (lib/pipeline/roles.ts).
- Staff notifications (lib/notifications): bell, pop-up, Web Push.
- Inbox AI triage classifies every inbound message (lib/inbox/triagePipeline).

## Decisions

### 1. Sending hours (setting)
- A per-business setting: days of the week + start and end time. Optimal
  Health: Monday to Saturday, 09:00-18:00. Default for others: keep today's
  behaviour (every day 09:00-21:00).
- One window for every flow.
- A step due outside the window is sent at the start of the next sending
  window (never dropped). Fixes GoHighLevel's dead end where out-of-hours
  leads got nothing.

### 2. Assigning leads, and alerts
- New: a lead can be assigned to a staff member ("Assign leads to"), with a
  business default for new leads. Optimal Health staff: DJ and Sandra.
- New-lead and hot-lead alerts go to the assignee, plus a per-business
  "alert by WhatsApp to" number. Optimal Health: WhatsApp alerts to DJ's
  mobile (entered in the setting in the app, never in code or docs), sent
  from the business WhatsApp. Sandra uses the app (Sandra's phone IS the
  business WhatsApp number, so she cannot be alerted by WhatsApp from it).
- Alert text, plain: "New lead: {name}, {source}. {phone}. Open: {link}" and
  "Hot lead: {name} replied: "{first 120 chars}". Open: {link}".
- The existing bell/push notifications still fire as today.

### 3. Columns and column-started flows
- A flow can be started by a lead entering a chosen column (stage), not only
  by the fixed triggers. Re-entry allowed (entering again restarts it).
- Starting any flow stops every other flow the lead is in.
- A flow can end with "move to column X" when it finishes with no reply.
- New default columns where missing (names editable, roles chosen by the
  plan to fit the 9-role model): No answer, Call back later, Thinking about
  it, Long-term nurture, Message undelivered.
- Every flow stops on: a reply, a booking, a purchase, an unsubscribe, or the
  lead being moved to another column by a person.

### 4. Undelivered first WhatsApp
- If a flow's first WhatsApp can't be delivered (Whapi send error, or a
  failed delivery status from the webhook), the lead moves to Message
  undelivered and the flow's remaining steps go by email when the lead has
  an email address.

### 5. Positive-reply check (Thinking about it flow)
- In that flow only, a reply is read by the existing inbox triage: wants to
  book or asks to talk -> Hot lead + alert; anything else -> stays, and the
  lead moves to Long-term nurture 7 days later unless a person acts. The
  reply still shows in the Inbox and still notifies.

### 6. Schedule a call / Log a call (lead page and board card)
- "Schedule a call" asks When?
  - With a time: lead moves to the booked column ("Consultation booked"),
    flows stop, the call appears in the diary, the lead gets a WhatsApp
    confirmation at once and a reminder 1 hour before, and the assignee (in
    app) gets an alert 10 minutes before with name and number.
  - A day without a time (quick picks: Tomorrow, In 2 days, Next week, or a
    date): it is "Call back later": reminder to the assignee that morning
    (WhatsApp to DJ for Optimal Health); if the lead still hasn't been marked
    reached by the end of that day, the Call back later flow starts.
    No date given -> the flow starts after 2 days.
- "Log a call" outcomes: No answer, Call back later, Spoke to them, Thinking
  about it, Booked a treatment. Each moves the lead to the matching column
  (and starts that column's flow). They call from a mobile at first, so this
  is a manual log; when a call is made through Adonis, the same choice pops
  up after it.

### 7. The flows (copy agreed; signed "Optimal Health"; {first name})

New lead (trigger: new lead from website / Facebook lead form / form):
| When | Channel | Text |
|---|---|---|
| 0 (first sending time) | WhatsApp | Hi {first name}, thanks for getting in touch with Optimal Health. We offer hyperbaric oxygen (HBOT), infrared, PEMF and massage at Ard Gaoithe Business Park, Clonmel, with free parking. What would you like help with? Reply with a good time and we'll ring you, or call us on 083 867 2844. |
| 0 | Email | Subject: Thanks for getting in touch with Optimal Health. Body: Hi {first name}, thanks for your enquiry. We'll be in touch by WhatsApp or phone to talk about what you're looking for and which therapy suits. If you'd rather talk now, ring 083 867 2844. Optimal Health |
| +2 days | WhatsApp | Hi {first name}, just checking you saw our message. Is there a good time to give you a call? |
| +2 days | WhatsApp | If you have any questions about the therapies, how a session works or what to bring, ask here and we'll answer. |
| +1 day | WhatsApp | We have sessions free this week. Tell us a day that suits and we'll book you in. |
| +2 days | WhatsApp | We'll leave it there for now. If you'd like to book later, message here or ring 083 867 2844. Optimal Health |
| +7 days, no reply | - | Move to Long-term nurture |
Email-only leads (no phone) get the email and skip the WhatsApps.

No answer (column-started):
| 0 | WhatsApp | Hi {first name}, we tried to ring you about your enquiry with Optimal Health but couldn't get through. When's a good time to call you back? |
| +2 days | WhatsApp | Hi {first name}, happy to talk whenever suits you. Tell us a day and time and we'll ring you then. Optimal Health |
| +2 days, no reply | - | Move to Long-term nurture |

Call back later (column-started, or by Schedule a call with a day):
| +2 days (or the morning after the picked day) | WhatsApp | Hi {first name}, following up from our chat the other day. Would you be free for a call today? |
| +2 days | WhatsApp | Hi {first name}, happy to talk whenever suits you. Tell us a day and time and we'll ring you then. Optimal Health |
| +2 days, no reply | - | Move to Long-term nurture |

Consult booked (Schedule a call with a time):
| at booking | WhatsApp (email if no phone) | Hi {first name}, you're booked for a call with Optimal Health on {day} at {time}. We'll ring you on this number. If you need to change it, reply here. |
| 1 hour before | same | Hi {first name}, a reminder that we'll ring you at {time} today. Optimal Health |

Thinking about it (column-started):
| +5 days | WhatsApp | Hi {first name}, following up from our chat. No rush. Have you any questions, or would you like to book a session? |
| +5 days | WhatsApp | Hi {first name}, one last check: would you like to book in for a session? If now isn't the time, message us whenever suits. Optimal Health |
| +7 days, no reply | - | Move to Long-term nurture |

Long-term nurture (column-started): the 7 messages in
docs/optimal-health/long-term-nurture-drafts.md (weeks 1, 2, 3, 6, 8, 10, 12;
week 2 in versions by the treatment the lead asked about: HBOT, Infrared,
HIFEM, Massage, General). Only for leads with marketing consent; every email
carries the existing signed unsubscribe link (lib/marketing/unsubscribeToken)
and honours suppressions. After week 12 the flow ends (they stay in normal
campaigns).

- The default copy for each flow is stored as editable flow steps in
  /automations, prefilled for Optimal Health with the text above; other
  businesses get neutral defaults and the flows are off until switched on.
- Every flow is OFF until a person switches it on.

### 8. Rules that apply everywhere
- No emojis. Plain copy. Lucide icons. Controls never cramped.
- Nothing auto-sends during the build or tests; no paid AI in tests.
- Generated or stored copy: no money-back guarantees, no free consults.

## Later (separate piece, not in this build)
GoHighLevel import: contacts + opportunities export (stage + last stage
change date), dry run listing each person's column and next message, then
place each lead at the matching step of the matching flow (past-due steps
skipped, at most one message on day one; hot/booked/sold -> no flow; past
the end -> Long-term nurture start). Switch-over day: pause GoHighLevel
workflows, import, switch Adonis flows on.

## Testing
- Pure: sending-window maths (Mon-Sat 09-18, next window start, DST), step
  scheduling with column starts and "finish -> move", stop rules, undelivered
  handling, positive-reply routing, call scheduling reminders.
- Integration on a scratch tenant with fake WhatsApp/email senders: a lead
  runs through each flow end to end with a fake clock.
- Browser: Log a call / Schedule a call on the lead page and board card, the
  assignment control, the sending-hours setting, at 1280 and 390.
