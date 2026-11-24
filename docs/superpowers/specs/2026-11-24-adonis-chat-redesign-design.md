# Adonis chat redesign: design

Date: 2026-11-24. Status: approved in conversation (approach B, direction A,
the three detail screens). Mockups:
`.superpowers/brainstorm/26028-1795550248/content/chat-directions.html` (option A)
and `chat-a-details.html`.

## Goal

The /adonis chat should feel like a top-tier AI product: replies flow in word
by word, the view never jerks, waiting is visibly alive, and the page looks
clean and premium. The model is Perplexity: each question becomes a headline
over a document-style answer.

## What the operator said was wrong

All four: replies appear in jumps, scrolling jumps around, waiting feels dead,
and it looks dated and cluttered.

Root cause of the jumps: the server saves the reply every 500 ms
(`SAVE_EVERY_MS`, lib/agents/conversation.ts) and the client polls every 700 ms
(AssistantChat), so text lands in lumps and each lump moves the scroll.

## Decisions

- **Approach B: true live streaming.** Words are pushed to the browser as the
  model writes them, over Server-Sent Events, and revealed at an even pace.
  Polling stays as the fallback and for reconnecting, so a run still survives
  a closed tab (durable runs are unchanged).
- **Direction A: the answer page.** Each exchange is the question as a
  headline, tabs Answer / Steps / Results, a live steps panel that folds away
  when done, the answer as a document (no bubble), result cards, follow-ups.
- **Opening screen:** Adonis mark, greeting with the user's first name, the big
  composer, four suggestion tiles, and a "Needs you today" panel (leads waiting
  for a reply, AI drafts to approve, offer and voucher sales this week), read
  live.
- **Follow-ups that change data:** earlier exchanges fold to a one-line summary;
  the approval card shows each change with old value struck through and new
  value highlighted, Approve and "Change it". The write-approval gate is
  unchanged: nothing runs before Approve.
- **History:** a drawer from the right with search, New chat, grouping by
  Today / Yesterday / Earlier, and a live "Working" tag on chats still running.

## Streaming (server)

- `lib/agents/liveBus.ts`: an in-process event bus keyed by conversation id
  (Node EventEmitter on globalThis so dev reloads share it). Events:
  `text` (delta, message index), `tool` (name, message index), `state`
  (a full ConversationView after any save), `end`.
- `lib/agents/conversation.ts` publishes: every `onText` delta, every
  `onTool`, and a `state` after each `save()` and at the end of a run. Saving
  to the database keeps its current throttle; the bus is not throttled.
- `GET /api/agents/[key]/conversations/[id]/stream`: SSE, same auth and
  ownership checks as the conversation GET route. Sends the full snapshot
  first, then events, a comment heartbeat every 15 s, and closes after `end`
  (or after 10 minutes, the client reconnects). `X-Accel-Buffering: no`,
  `Cache-Control: no-cache`.
- Railway runs one persistent instance, so an in-process bus reaches every
  listener. If the app is ever scaled out, the client's polling fallback keeps
  it working (just less smooth); noted, not solved now.

## Streaming (client)

- `useConversationLive(base, id)`: opens the EventSource while a run is going
  (or right after send), applies deltas to local state, replaces state on
  `state`, and falls back to the existing polling loop on error or when
  EventSource is missing. Idle conversations are not held open.
- `useSmoothText(target, streaming)`: reveals text at an adaptive pace
  (catches up faster when far behind, about 1.5 seconds of backlog at most),
  driven by requestAnimationFrame, word by word with a short fade. Off when
  not streaming (finished text shows at once) and under prefers-reduced-motion.

## Layout and behaviour

- Exchange: question headline (Space Grotesk), tabs Answer / Steps (count) /
  Results (count, only when there are any).
- Steps panel: each tool as a plain label (existing TOOL_LABEL map) with a
  spinner, then a tick; a running timer; folds to "Done in 6.2s, N steps"
  when the answer is complete. Before the first tool or word: "Thinking" with
  the timer, never a blank pause.
- Answer: the existing RichText renderer restyled as a document (headings,
  lists, tables, bold, code), 15.5 px / 1.7 line height, max width 680 px.
- Results: artifacts (files), ad previews, campaign checklist and pending
  approvals as cards under the answer.
- Follow-ups: up to three suggested next questions per answer. Adonis writes
  them at the end of its reply in a `<followups>` block (one per line); the
  client strips the block from the answer and shows the lines as buttons.
  Older replies without the block show none. Costs a few output tokens per
  reply.
- Scroll: on send, the new question scrolls to the top of the view and the
  answer grows beneath; the view never auto-follows while the user has
  scrolled up; a "Jump to latest" pill appears when new content is below.
- Earlier exchanges in a long chat fold to a one-line summary (question +
  first sentence), expandable.
- Composer: one rounded box pinned at the bottom: text, attach, voice, model
  chip, send/stop. Enter sends, Shift+Enter is a new line. Attachments show as
  chips above the text.
- Everything already in the chat keeps working: attachments, voice input,
  model picker, regenerate / go again, campaign progress and checklist, ad
  approval preview, artifacts, hidden messages, delete chat, legacy chat
  import.

## Structure

`components/adonis/chat/`, one job per file: `AdonisChat.tsx` (state +
layout), `Exchange.tsx`, `StepsPanel.tsx`, `AnswerDocument.tsx` (RichText),
`ResultCards.tsx`, `ApprovalCard.tsx`, `FollowUps.tsx`, `Composer.tsx`,
`HistoryDrawer.tsx`, `EmptyState.tsx`, `useConversationLive.ts`,
`useSmoothText.ts`, `followups.ts` (pure parser). AssistantChat.tsx is
replaced on /adonis and deleted once nothing imports it.
`GET /api/adonis/today` returns the three "Needs you today" counts.

## Rules

No emojis. Lucide icons only. Plain copy. Controls never cramped. Dark and
light themes from the existing tokens. prefers-reduced-motion respected.
Mobile at 390 px works (composer above the keyboard, drawer full width).

## Testing

- Pure: followups parser, smooth-text pacing, exchange grouping, history
  grouping by day.
- Bus + SSE route: a scratch conversation receives text deltas and the final
  state in order; unauthorised and other-user requests are refused.
- Browser: screenshots at 1280 and 390, dark and light, of the opening screen,
  a streaming answer, a folded thread with an approval, and the drawer.
- Live: one real question on Optimal Health after deploy, watched streaming.

## Out of scope

Sources/citations panel, sharing a chat, voice replies, multi-instance
streaming.
