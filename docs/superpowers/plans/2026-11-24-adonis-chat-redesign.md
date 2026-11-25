# Adonis Chat Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the /adonis chat as a Perplexity-style answer page whose replies stream in word by word over Server-Sent Events, with a live steps panel, document-style answers, result cards, follow-ups, an opening screen with "Needs you today", and a history drawer.

**Architecture:** The server run loop (`lib/agents/conversation.ts`) publishes every text delta, tool start, saved state and run end to an in-process event bus (`lib/agents/liveBus.ts`). A new SSE route subscribes to that bus, sends a snapshot of the in-memory conversation first and the events after it. On the page, `useConversationLive` opens the stream while a run is going and falls back to the existing polling loop; `useSmoothText` reveals the words at an even pace. The UI is split into small components under `components/adonis/chat/`, built on pure, tested helpers (markdown, follow-ups, exchanges, history, pacing, scroll). `AssistantChat.tsx` is deleted at the end.

**Tech Stack:** Next.js 15.5 App Router (route handlers, `next start` on Railway), React 19, TypeScript strict, drizzle-orm + better-sqlite3, motion 12 (`motion/react`), lucide-react, sonner, Node `node:events`, playwright-core for screenshots. Tests are plain `node:assert/strict` scripts run with `npm test -- <path>` from `app/`.

## Global Constraints

- No emojis anywhere: UI, code, comments, copy, log lines, commit messages, docs.
- Icons: `lucide-react` only.
- Plain copy: short factual sentences. No "X rather than Y", no "not just X", no poetic headlines, no warm filler, no ellipsis in labels.
- Controls never cramped: buttons and icon buttons at least 36px tall, pills at least 32px, list rows at least 40px, follow-up rows at least 44px.
- Colours only from the app tokens (`--bg`, `--surface-1`, `--surface-2`, `--surface-3`, `--text-primary`, `--text-secondary`, `--text-tertiary`, `--hairline`, `--hairline-strong`, `--accent`, `--accent-contrast`, `--success`, `--warning`, `--danger`); the only literal colours allowed are `rgba(0,0,0,..)` / `rgba(16,24,40,..)` shadows.
- Fonts: `var(--font-heading)` (Space Grotesk) for the question headline, greeting and section heads; `var(--font-body)` for text; `var(--font-mono)` for timers, counts and small uppercase labels.
- Dark and light themes from the existing tokens (`:root[data-theme="light"]`); `prefers-reduced-motion` respected (no word fade, no slide, no spinner animation).
- Mobile at 390px: no horizontal page scroll, composer above the keyboard, history drawer full width.
- The write-approval gate is unchanged: nothing runs before Approve; approvals stay admin-only (the route already returns 403).
- Durable runs are unchanged: a run keeps going with the tab closed; polling stays as the fallback and for reconnecting.
- SSE: snapshot first, a comment heartbeat every 15 s, close after `end` or after 10 minutes, headers `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`.
- Smooth text: adaptive pace, about 1.5 seconds of backlog at most, word by word with a short fade; off for finished text and under reduced motion.
- Answer document: 15.5px, line height 1.7, max width 680px.
- Follow-ups: up to three per answer, from a `<followups>` block Adonis writes at the end of its reply; older replies show none.
- History groups: Today / Yesterday / Earlier, by Irish calendar day (Europe/Dublin).
- Pure helper files (`*.ts` with tests) must not import React or anything server-only: the test runner loads with `--conditions=react-server`, where React's entry throws.
- Tests: `cd app && npm test -- <path>`. Typecheck: `cd app && npm run typecheck`. Build: `cd app && npx next build`.
- Commits: stage named paths only (`git add <paths>`), never `git add -A` or `git add .`. Every message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Decisions this plan makes where the spec left room

1. **Tenant stamp on the stream.** EventSource cannot set headers, so the page appends `?stamp=<tenantId>` and the route refuses (409) when it disagrees with the session's tenant, using the same `parseStamp` the header check uses. The conversation GET route it mirrors does not run `guard()` at all, so this is stricter than the route it copies, not looser.
2. **In-memory snapshot.** The database is saved every 500 ms, so a snapshot read from the database can be missing words that were already sent as deltas. `conversation.ts` keeps the object each running turn writes to in a `memory` map, and `getConversation` returns that while a run is live. The stream's snapshot and the polling GET both read it, so deltas always apply to the right text.
3. **Stop in the composer stops now.** The composer's Stop sends `{ type: "stop", now: true }`, which aborts the model call through an `AbortController` per run and adds "_Stopped._" to the reply. The autopilot banner's "Stop after this one" keeps today's step-boundary behaviour. Known gap: `runAgentTurn` meters a model call after it returns, so a call aborted mid-stream is not metered. It is staff-only and rare; left as is.
4. **Reply timing.** `ConvMessage` gains optional `startedAt` and `durationMs` (set by the server), so the timer and "Done in 6.2s, 4 steps" survive a reload. Older replies show "Done, 4 steps".
5. **Stop-request fix.** A running turn's `save()` used to write `stopRequested: false` back over the operator's Stop click. `act()` now sets it on the in-memory conversation too.
6. **Follow-ups.** The instruction goes at the end of `basePlaybook` in `specialists/orchestrator.ts`. The block is stripped from what Adonis is given as history (`modelHistory`), so old suggestions are not fed back. Text after the block (the "_Approved automatically._" lines the server appends to a card later) is kept in the answer.
7. **Needs you today.** Leads waiting for a reply = lead conversations (WhatsApp, Messenger, Instagram) whose latest message is inbound. AI drafts to approve = conversations whose latest inbound message is `drafted` or `held` (the inbox's `needsAttention`). Sales = paid offer orders plus paid voucher orders since Monday 00:00 Irish time, on the business's connected Stripe account (so old test-mode sales do not count). Sales are only returned to admins; staff see the first two rows.
8. **Folding.** Every exchange except the latest folds to a one-line summary by default, unless it holds an Approve card that is still waiting.
9. **"Change it".** On a campaign plan or asset card it is the existing "Go again" with a tweak. On any other card it cancels the card (nothing changed) and sends the operator's words as the next message: "Change that before I approve it: <their words>".
10. **Old values in the approval card.** Only website text edits carry both the old and the new text in the pending write (`find` / `replace`), so only those get struck-through old and highlighted new lines. See "Spec items not planned".
11. **Opening screen mark.** The ADONIS wordmark hero is replaced by the "A" mark tile from the mockup, drawn from tokens so it works in both themes.
12. **Styles.** The chat's CSS lives in one file, `components/adonis/chat/chat.css`, imported by each component (precedent: `components/ads/AudienceMap.tsx` imports `leaflet/dist/leaflet.css`). This keeps about 300 lines out of `globals.css`.
13. **Tool labels.** The `TOOL_LABEL` map moves to its own file, loses its ellipses, gains labels for the newer tools, and any unknown snake_case name is shown humanised ("list_social_posts" becomes "List social posts").
14. **Results tab count** = files + open approval cards + the campaign checklist (when shown).
15. **The end of a streamed answer.** "Off when not streaming" is read as: an answer that is already finished when it mounts shows at once; an answer that was streaming on this page drains its last ~1.5 s of backlog quickly (350 ms lag) when the run ends, instead of jumping, since a jump at the end is the complaint this fixes. While streaming, a word still being written waits until it is complete.
16. **Extra pure files.** Besides the spec's `followups.ts`, the plan adds `markdown.ts`, `smoothText.ts`, `exchanges.ts`, `toolLabels.ts`, `approvalModel.ts`, `history.ts`, `scrollModel.ts`, `CampaignChecklist.tsx`, `lib/agents/liveEvents.ts`, `lib/agents/liveStream.ts` and `lib/adonis/{todayModel,today}.ts`, so every rule has a test that does not need React or a request.

## Spec items not planned

- **Old value struck through for every change.** Pending writes carry the new value only (for example `set_ad_budget` has `dailyBudget` but not the current budget). Showing the old value would need every write tool to read the current state when it proposes a change. The card shows each change's summary; website text edits (`edit_website_text`, `create_website_page`) show old and new.
- **Route-level tests for "no session" and "another user's chat".** Faking the session cookie and membership in a route test is not set up in this repo. The SSE route copies the conversation GET route's checks line for line (session, membership, agent, id length, owner lookup via `getConversation`), and the bridge it hands off to is tested as a pure function.

## Feature inventory (everything AssistantChat does, and where it lands)

| AssistantChat feature | Lands in |
|---|---|
| Server-held chats, open the one this device had open, else the newest | Task 20 (AdonisChat) |
| Legacy localStorage chat import (once) | Task 20 |
| Polling: fast while running, slow idle, slower in a hidden tab | Task 9 (useConversationLive) |
| `initialInput` seed: fills an empty box once, starts a fresh chat, never auto-sends | Task 20 |
| TOOL_LABEL steps | Task 7 (toolLabels) + Task 12 (StepsPanel) |
| Opening a chat lands on the latest reply once; sending brings the question to the top | Task 10 (useChatScroll) + Task 20 |
| Optimistic post, error toasts, list refresh | Task 20 |
| Attachments: upload to the library on pick, chips, attachment line in the message | Task 16 (Composer) + Task 20 |
| Approve, Approve and build everything, Cancel, Go again with tweak, Build the rest, Stop | Task 13 (ApprovalCard), Task 14 (CampaignChecklist), Task 20 |
| New chat, open chat, delete chat with confirm | Task 17 (HistoryDrawer) + Task 20 |
| History with "Working" on running chats | Task 17 |
| Autopilot banner with "Stop after this one" | Task 20 |
| Hidden hand-back messages never shown | Task 7 (groupExchanges) |
| Campaign checklist under the latest reply | Task 14 + Task 15 (Exchange) |
| User attachment chips (splitAttachments) | Task 7 + Task 15 |
| Thinking indicator, live step chips | Task 12 |
| Pending card: actions list, ad previews (AdApprovalPreview), loading Approve | Task 13 |
| Artifact downloads | Task 14 (ResultCards) |
| RichText (headings, bullets, numbers, rules, bold, italic at word edges, code, links; no raw HTML) | Task 5 (markdown) + Task 11 (AnswerDocument), plus tables and fenced code |
| Voice: mic, recording timer, Soundwave, transcribing spinner, caret after transcript, Enter blocked while recording | Task 16 |
| Model picker chip | Task 16 + Task 21 |
| Enter sends, Shift+Enter new line | Task 16 |
| Suggestions | Task 19 (EmptyState) |
| Settings gear for admins | Task 21 |
| Mobile full height (`.adonis-shell`) | Task 21 (kept) |

## File Structure

Create (pure, tested):
- `app/src/lib/agents/liveEvents.ts` — the `LiveEvent` type, SSE frame formatting/parsing, `applyLiveEvent` reducer. Shared by server and browser.
- `app/src/lib/agents/liveStream.ts` — turns a bus subscription plus a snapshot into an SSE `ReadableStream` (heartbeat, 10-minute cap, close on end/abort).
- `app/src/lib/adonis/todayModel.ts` — `TodayCounts`, Monday-start week in Irish time, inbox counting, euro formatting.
- `app/src/components/adonis/chat/followups.ts` — `<followups>` block parser.
- `app/src/components/adonis/chat/markdown.ts` — block and inline markdown parser.
- `app/src/components/adonis/chat/smoothText.ts` — reveal pacing.
- `app/src/components/adonis/chat/toolLabels.ts` — tool name to plain label.
- `app/src/components/adonis/chat/exchanges.ts` — messages to exchanges, step rows, summaries, durations.
- `app/src/components/adonis/chat/approvalModel.ts` — campaign-card detection, old/new pairs.
- `app/src/components/adonis/chat/history.ts` — history grouping by Irish day, time labels, search, greeting.
- `app/src/components/adonis/chat/scrollModel.ts` — scroll and keyboard-inset arithmetic.

Create (server):
- `app/src/lib/agents/liveBus.ts` — in-process EventEmitter on `globalThis`.
- `app/src/lib/adonis/today.ts` — the three counts from the tenant DB.
- `app/src/app/api/agents/[key]/conversations/[id]/stream/route.ts` — SSE route.
- `app/src/app/api/adonis/today/route.ts` — counts route.

Create (client):
- `app/src/components/adonis/chat/useConversationLive.ts`, `useSmoothText.ts`, `useChatScroll.ts` — hooks.
- `app/src/components/adonis/chat/chat.css` — all chat styles.
- `app/src/components/adonis/chat/AnswerDocument.tsx`, `StepsPanel.tsx`, `ApprovalCard.tsx`, `ResultCards.tsx`, `CampaignChecklist.tsx`, `FollowUps.tsx`, `Exchange.tsx`, `Composer.tsx`, `HistoryDrawer.tsx`, `EmptyState.tsx`, `AdonisChat.tsx`.

Tests (create):
- `app/src/lib/agents/liveEvents.test.ts`, `liveBus.test.ts`, `liveStream.test.ts`, `conversation.live.test.ts`
- `app/src/lib/agents/specialists/orchestratorFollowups.test.ts`
- `app/src/lib/adonis/todayModel.test.ts`
- `app/src/components/adonis/chat/followups.test.ts`, `markdown.test.ts`, `smoothText.test.ts`, `exchanges.test.ts`, `approvalModel.test.ts`, `history.test.ts`, `scrollModel.test.ts`

Modify:
- `app/src/lib/agents/conversation.ts` — publish to the bus, memory snapshot, timing, stop-now abort, test seam.
- `app/src/lib/agents/conversationModel.ts` — `startedAt` / `durationMs` on `ConvMessage`; `modelHistory` strips follow-ups.
- `app/src/lib/agents/conversationModel.test.ts` — two more checks.
- `app/src/app/api/agents/[key]/conversations/[id]/route.ts` — pass `now` on stop.
- `app/src/lib/agents/specialists/orchestrator.ts` — follow-ups instruction.
- `app/src/components/adonis/AdonisView.tsx`, `app/src/app/adonis/page.tsx`, `app/src/components/adonis/ModelPicker.tsx`.

Delete:
- `app/src/components/messaging/AssistantChat.tsx` (Task 22).

Temporary (Task 23, never committed): `app/src/app/f/zz-adonis-chat/page.tsx`, `app/src/app/f/zz-adonis-chat/ChatPreview.tsx`, `app/scripts/shoot-adonis-chat.mjs`.

---

### Task 1: Live events and the in-process bus

**Files:**
- Create: `app/src/lib/agents/liveEvents.ts`
- Create: `app/src/lib/agents/liveBus.ts`
- Test: `app/src/lib/agents/liveEvents.test.ts`
- Test: `app/src/lib/agents/liveBus.test.ts`

**Interfaces:**
- Consumes: `ConversationView` from `@/lib/agents/conversationModel` (existing).
- Produces:
  - `type LiveEvent = { type: "text"; index: number; delta: string } | { type: "tool"; index: number; name: string } | { type: "state"; conversation: ConversationView } | { type: "end" }`
  - `type LivePhase = "tool" | "writing"`
  - `formatSse(event: LiveEvent): string`, `parseLiveEvent(data: string): LiveEvent | null`, `applyLiveEvent(conv: ConversationView | null, e: LiveEvent): ConversationView | null`, `SSE_HEARTBEAT: string`, `SSE_RETRY: string`
  - `liveKey(tenantId: number, convId: string): string` (returns `"<tenantId>:<convId>"`), `publish(key: string, event: LiveEvent): void`, `subscribe(key: string, listener: (event: LiveEvent) => void): () => void`, `listenerCount(key: string): number`

- [ ] **Step 1: Write the failing tests**

`app/src/lib/agents/liveEvents.test.ts`:

```ts
// Run: npm test -- src/lib/agents/liveEvents.test.ts
//
// The events the /adonis chat is sent while Adonis works: how they are framed
// for Server-Sent Events, read back, and applied to the conversation the page
// holds.
import assert from "node:assert/strict";

import type { ConversationView } from "./conversationModel";
import { applyLiveEvent, formatSse, parseLiveEvent, SSE_HEARTBEAT, SSE_RETRY } from "./liveEvents";

const base: ConversationView = {
  id: "c1",
  title: "Hi",
  updatedAt: 1,
  running: true,
  building: false,
  stopRequested: false,
  campaignEvents: [],
  messages: [
    { role: "user", content: "Hi", tools: [], artifacts: [] },
    { role: "assistant", content: "", tools: [], artifacts: [] },
  ],
};

let c = applyLiveEvent(base, { type: "tool", index: 1, name: "list_leads" });
assert.deepEqual(c?.messages[1].tools, ["list_leads"], "a tool event adds the tool to that reply");
c = applyLiveEvent(c, { type: "text", index: 1, delta: "Hel" });
c = applyLiveEvent(c, { type: "text", index: 1, delta: "lo" });
assert.equal(c?.messages[1].content, "Hello", "text deltas append in order");
assert.equal(base.messages[1].content, "", "the view passed in is never mutated");
assert.equal(applyLiveEvent(c, { type: "text", index: 0, delta: "x" }), c, "a delta aimed at a user message is ignored");
assert.equal(applyLiveEvent(c, { type: "text", index: 9, delta: "x" }), c, "a delta past the end waits for the next state");
assert.equal(applyLiveEvent(null, { type: "text", index: 1, delta: "x" }), null, "nothing to apply to stays nothing");
const replaced: ConversationView = { ...base, running: false };
assert.equal(applyLiveEvent(c, { type: "state", conversation: replaced }), replaced, "a state replaces everything");
assert.equal(applyLiveEvent(c, { type: "end" }), c, "end changes nothing by itself");

const frame = formatSse({ type: "text", index: 1, delta: "a\nb" });
assert.ok(frame.startsWith("data: ") && frame.endsWith("\n\n"), "one data frame");
assert.equal(frame.split("\n").length, 3, "a newline inside the text stays inside one data line");
assert.deepEqual(parseLiveEvent(frame.slice(6).trim()), { type: "text", index: 1, delta: "a\nb" }, "a frame reads back");
assert.ok(SSE_HEARTBEAT.startsWith(":") && SSE_HEARTBEAT.endsWith("\n\n"), "the heartbeat is a comment frame");
assert.ok(SSE_RETRY.startsWith("retry: "), "the retry hint is an SSE retry field");
assert.equal(parseLiveEvent("not json"), null, "junk is ignored");
assert.equal(parseLiveEvent(JSON.stringify({ type: "text", index: "1", delta: "x" })), null, "a wrong field type is ignored");
assert.equal(parseLiveEvent(JSON.stringify({ type: "nope" })), null, "an unknown type is ignored");
assert.equal(parseLiveEvent(JSON.stringify({ type: "state", conversation: { id: "x" } })), null, "a state without messages is ignored");
assert.deepEqual(parseLiveEvent(JSON.stringify({ type: "end" })), { type: "end" });

console.log("liveEvents: all checks passed");
```

`app/src/lib/agents/liveBus.test.ts`:

```ts
// Run: npm test -- src/lib/agents/liveBus.test.ts
//
// The in-process bus the run loop publishes to and the SSE route listens on.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import type { LiveEvent } from "./liveEvents";
import { listenerCount, liveKey, publish, subscribe } from "./liveBus";

const key = liveKey(7, "conv-a");
assert.equal(key, "7:conv-a", "the key is tenant then conversation");

const got: LiveEvent[] = [];
const after: LiveEvent[] = [];
const other: LiveEvent[] = [];
const offGot = subscribe(key, (e) => got.push(e));
const offThrow = subscribe(key, () => {
  throw new Error("listener broke");
});
const offAfter = subscribe(key, (e) => after.push(e));
const offOther = subscribe(liveKey(7, "conv-b"), (e) => other.push(e));

const realError = console.error;
console.error = () => {};
publish(key, { type: "text", index: 1, delta: "Hel" });
publish(key, { type: "tool", index: 1, name: "list_leads" });
publish(key, { type: "text", index: 1, delta: "lo" });
publish(key, {
  type: "state",
  conversation: { id: "conv-a", title: "t", updatedAt: 1, running: false, building: false, stopRequested: false, campaignEvents: [], messages: [] },
});
publish(key, { type: "end" });
console.error = realError;

const order = ["text", "tool", "text", "state", "end"];
assert.deepEqual(got.map((e) => e.type), order, "a subscriber gets every event in the order published");
assert.deepEqual(after.map((e) => e.type), order, "a listener that throws does not stop the ones after it");
assert.equal(other.length, 0, "another conversation hears nothing");

offGot();
offThrow();
offAfter();
assert.equal(listenerCount(key), 0, "unsubscribing removes the listener");
publish(key, { type: "end" });
assert.equal(got.length, 5, "nothing arrives after unsubscribing");
offOther();

const g = globalThis as unknown as Record<symbol, unknown>;
assert.ok(g[Symbol.for("adonis.liveBus")] instanceof EventEmitter, "the bus lives on globalThis so dev reloads share it");

console.log("liveBus: all checks passed");
```

- [ ] **Step 2: Run the tests to make sure they fail**

Run: `cd app && npm test -- src/lib/agents/liveEvents.test.ts && npm test -- src/lib/agents/liveBus.test.ts`
Expected: FAIL with `Cannot find module './liveEvents'` (and `./liveBus`).

- [ ] **Step 3: Write `liveEvents.ts`**

```ts
/**
 * What the /adonis chat is told while Adonis works, and how the page applies
 * it. Pure (no "server-only", no React) so the server bus, the SSE route and
 * the browser hook share one definition, and the tests can reach it.
 *
 *   text   words Adonis just wrote, for the reply at `index`
 *   tool   a tool Adonis just started, for the reply at `index`
 *   state  the whole conversation after a save; it wins over any delta
 *   end    the run is over; the stream closes
 *
 * Order matters and the server keeps it: a delta is always published BEFORE
 * the save that includes it, so a state never arrives ahead of a delta it
 * already contains (which would print those words twice).
 */

import type { ConversationView } from "@/lib/agents/conversationModel";

export type LiveEvent =
  | { type: "text"; index: number; delta: string }
  | { type: "tool"; index: number; name: string }
  | { type: "state"; conversation: ConversationView }
  | { type: "end" };

/** What the reply being written is doing now, as far as the stream has said. */
export type LivePhase = "tool" | "writing";

/** One SSE frame. Unnamed, so the page needs one onmessage handler; JSON keeps any newline inside one data line. */
export function formatSse(event: LiveEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** A comment frame: proxies see traffic on a quiet stream, EventSource ignores it. */
export const SSE_HEARTBEAT = ": hb\n\n";

/** How long the browser waits before reconnecting a dropped stream. */
export const SSE_RETRY = "retry: 1500\n\n";

/** One message's data read back into an event, or null for anything unexpected. */
export function parseLiveEvent(data: string): LiveEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  switch (e.type) {
    case "text":
      return typeof e.index === "number" && typeof e.delta === "string" ? { type: "text", index: e.index, delta: e.delta } : null;
    case "tool":
      return typeof e.index === "number" && typeof e.name === "string" ? { type: "tool", index: e.index, name: e.name } : null;
    case "state": {
      const c = e.conversation as Record<string, unknown> | null | undefined;
      return c && typeof c === "object" && Array.isArray(c.messages)
        ? { type: "state", conversation: c as unknown as ConversationView }
        : null;
    }
    case "end":
      return { type: "end" };
    default:
      return null;
  }
}

/** The conversation after one event. Never mutates `conv`. */
export function applyLiveEvent(conv: ConversationView | null, e: LiveEvent): ConversationView | null {
  if (e.type === "state") return e.conversation;
  if (!conv || e.type === "end") return conv;
  const m = conv.messages[e.index];
  if (!m || m.role !== "assistant") return conv;
  const next = e.type === "text" ? { ...m, content: m.content + e.delta } : { ...m, tools: [...m.tools, e.name] };
  const messages = conv.messages.slice();
  messages[e.index] = next;
  return { ...conv, messages };
}
```

- [ ] **Step 4: Write `liveBus.ts`**

```ts
import "server-only";

import { EventEmitter } from "node:events";

import type { LiveEvent } from "@/lib/agents/liveEvents";

/**
 * The run loop's live events, in this process.
 *
 * lib/agents/conversation.ts publishes every text delta, tool start, save and
 * run end here, keyed by tenant and conversation; the SSE route
 * (/api/agents/[key]/conversations/[id]/stream) subscribes. Railway runs one
 * persistent `next start` instance, so every listener is in this process. If
 * the app is ever scaled out, a page on another instance hears nothing and
 * its polling fallback carries on (less smooth, still correct).
 *
 * The emitter lives on globalThis so dev reloads and separately bundled route
 * modules share one bus. Listeners run synchronously inside publish(): they
 * must not hold on to an event's objects (a state carries the live
 * conversation the run is still writing to), so serialise straight away.
 */

const BUS = Symbol.for("adonis.liveBus");

function bus(): EventEmitter {
  const g = globalThis as unknown as Record<symbol, EventEmitter | undefined>;
  let b = g[BUS];
  if (!b) {
    b = new EventEmitter();
    b.setMaxListeners(0); // one per open chat tab; no fixed ceiling
    g[BUS] = b;
  }
  return b;
}

export function liveKey(tenantId: number, convId: string): string {
  return `${tenantId}:${convId}`;
}

export function publish(key: string, event: LiveEvent): void {
  bus().emit(key, event);
}

/** Listen to one conversation. A listener that throws is logged and never breaks the run or the other listeners. */
export function subscribe(key: string, listener: (event: LiveEvent) => void): () => void {
  const safe = (event: LiveEvent) => {
    try {
      listener(event);
    } catch (err) {
      console.error("[liveBus] listener failed", err);
    }
  };
  bus().on(key, safe);
  return () => {
    bus().off(key, safe);
  };
}

export function listenerCount(key: string): number {
  return bus().listenerCount(key);
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd app && npm test -- src/lib/agents/liveEvents.test.ts && npm test -- src/lib/agents/liveBus.test.ts`
Expected: PASS, printing `liveEvents: all checks passed` and `liveBus: all checks passed`.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/agents/liveEvents.ts app/src/lib/agents/liveBus.ts app/src/lib/agents/liveEvents.test.ts app/src/lib/agents/liveBus.test.ts
git commit -m "feat(adonis): live events and an in-process bus for streaming replies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Publish from the run loop (memory snapshot, timing, stop now)

**Files:**
- Modify: `app/src/lib/agents/conversationModel.ts:12-21` (ConvMessage)
- Modify: `app/src/lib/agents/conversation.ts` (imports, module state, `write`, `listConversations`, `getConversation`, `ConversationAction`, `act` stop branch, `drive`)
- Modify: `app/src/app/api/agents/[key]/conversations/[id]/route.ts:89-91` (stop case)
- Test: `app/src/lib/agents/conversation.live.test.ts`

**Interfaces:**
- Consumes: `liveKey`, `publish` from `@/lib/agents/liveBus` (Task 1); `LiveEvent` from `@/lib/agents/liveEvents` (Task 1).
- Produces:
  - `ConvMessage` gains `startedAt?: number; durationMs?: number`.
  - `ConversationAction` stop variant becomes `{ type: "stop"; now?: boolean }`.
  - `getConversation(c)` returns the in-memory conversation while a run is live.
  - `setTurnRunnerForTests(fn: typeof runAgentTurn | undefined): void` (tests only).
  - Bus events per run, in order: `state` (empty reply pushed), then per model output `text` / `tool` events each followed by throttled `state`s, then a final `state` with `running: false`, then `end`. `text` and `tool` carry the reply's message index.
  - The reply that was stopped ends with `\n\n_Stopped._`.

- [ ] **Step 1: Add the timing fields to `ConvMessage`**

In `app/src/lib/agents/conversationModel.ts`, replace:

```ts
  artifacts: ConvArtifact[];
  pending?: { actions: ConvAction[]; status: "awaiting" | "approving" | "approved" | "cancelled" } | null;
};
```

with:

```ts
  artifacts: ConvArtifact[];
  pending?: { actions: ConvAction[]; status: "awaiting" | "approving" | "approved" | "cancelled" } | null;
  /** When the server started writing this reply (ms since epoch). Absent on replies saved before 2026-11-24. */
  startedAt?: number;
  /** How long the turn took, once it finished. */
  durationMs?: number;
};
```

- [ ] **Step 2: Write the failing integration test**

`app/src/lib/agents/conversation.live.test.ts`:

```ts
// Run: npm test -- src/lib/agents/conversation.live.test.ts
//
// The run loop publishes what Adonis writes as it writes it. On a scratch
// tenant, with the model replaced by a fake turn (setTurnRunnerForTests), a
// subscriber must get the first state, the tool, the text deltas, then the
// final state and `end`, in that order; a mid-run read must see words not
// yet saved; and "stop now" must abort the turn and say so.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { createRequire } from "node:module";

import type { LiveEvent } from "./liveEvents";
import type { RunAgentTurnArgs } from "./runAgentTurn";

// Same shims as specialistToolSlice.test.ts: conversation.ts pulls in the
// tool registry, which loads @/lib/db/tenant (React's `cache`) and
// next/navigation at module scope. If another module fails to load under
// tsx, stub that one request here the same way.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called in conversation.live.test.ts");
      },
      notFound: () => {
        throw new Error("next/navigation.notFound() stub called in conversation.live.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

type TurnResult = { text: string; pendingWrites: never[]; artifacts: never[] };

function waitFor(events: LiveEvent[], pred: (e: LiveEvent) => boolean, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (events.some(pred)) return resolve();
      if (Date.now() - started > ms) return reject(new Error("timed out waiting for a live event"));
      setTimeout(poll, 10);
    };
    poll();
  });
}

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("@/lib/db/control");
  const convo = requireLocal("./conversation") as typeof import("./conversation");
  const bus = requireLocal("./liveBus") as typeof import("./liveBus");

  const slug = "adonis-live-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Adonis Live Test", `tenants/${slug}/${slug}.db`) as { id: number };

  try {
    // 1. A normal turn: tool, then two deltas.
    const ctx = { tenantId: tid, userId: 1, agentKey: "orchestrator", convId: crypto.randomUUID() };
    const events: LiveEvent[] = [];
    const off = bus.subscribe(bus.liveKey(tid, ctx.convId), (e) => events.push(JSON.parse(JSON.stringify(e)) as LiveEvent));
    let midRead = "";
    convo.setTurnRunnerForTests((async (args: RunAgentTurnArgs): Promise<TurnResult> => {
      args.onTool?.("list_leads");
      args.onText?.("Hello ");
      midRead = convo.getConversation(ctx)?.messages[1]?.content ?? "";
      args.onText?.("world");
      return { text: "Hello world", pendingWrites: [], artifacts: [] };
    }) as unknown as Parameters<typeof convo.setTurnRunnerForTests>[0]);

    convo.act(ctx, { type: "message", text: "Hi" });
    await waitFor(events, (e) => e.type === "end");
    off();

    const types = events.map((e) => e.type);
    const first = events[0];
    assert.equal(first.type, "state", "the first event is a state");
    assert.ok(first.type === "state" && first.conversation.running && first.conversation.messages[1]?.content === "", "it shows the empty reply, running");
    assert.ok(types.indexOf("tool") < types.indexOf("text"), "the tool arrives before the words");
    const texts = events.filter((e): e is Extract<LiveEvent, { type: "text" }> => e.type === "text");
    assert.equal(texts.map((e) => e.delta).join(""), "Hello world", "every delta arrives, in order");
    assert.ok(texts.every((e) => e.index === 1), "deltas name the reply's message index");
    const lastState = events[events.length - 2];
    assert.equal(lastState.type, "state", "the final state comes just before end");
    assert.ok(lastState.type === "state" && !lastState.conversation.running, "the final state is idle");
    assert.ok(lastState.type === "state" && lastState.conversation.messages[1]?.content === "Hello world", "the final state holds the whole reply");
    assert.ok(lastState.type === "state" && typeof lastState.conversation.messages[1]?.durationMs === "number", "the reply records how long it took");
    assert.ok(lastState.type === "state" && typeof lastState.conversation.messages[1]?.startedAt === "number", "the reply records when it started");
    assert.equal(events[events.length - 1].type, "end", "end is last");
    assert.equal(midRead, "Hello ", "a read mid-run sees words not yet saved");
    assert.equal(convo.getConversation(ctx)?.running, false, "the conversation is idle afterwards");

    // 2. Stop now: the turn is aborted and the reply says so.
    const ctx2 = { ...ctx, convId: crypto.randomUUID() };
    const events2: LiveEvent[] = [];
    const off2 = bus.subscribe(bus.liveKey(tid, ctx2.convId), (e) => events2.push(JSON.parse(JSON.stringify(e)) as LiveEvent));
    convo.setTurnRunnerForTests(((args: RunAgentTurnArgs) =>
      new Promise<TurnResult>((_resolve, reject) => {
        args.onText?.("Part");
        args.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as unknown as Parameters<typeof convo.setTurnRunnerForTests>[0]);
    convo.act(ctx2, { type: "message", text: "Write a long thing" });
    await waitFor(events2, (e) => e.type === "text");
    convo.act(ctx2, { type: "stop", now: true });
    await waitFor(events2, (e) => e.type === "end");
    off2();
    const final = events2[events2.length - 2];
    assert.ok(final.type === "state" && final.conversation.messages[1]?.content === "Part\n\n_Stopped._", "a stopped reply keeps its words and says it stopped");
    assert.ok(final.type === "state" && !final.conversation.running, "a stopped conversation is idle");

    console.log("conversation live: all checks passed");
  } finally {
    convo.setTurnRunnerForTests(undefined);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      /* the scratch file is harmless if it stays */
    }
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/agents/conversation.live.test.ts`
Expected: FAIL with `convo.setTurnRunnerForTests is not a function`.

- [ ] **Step 4: Edit `conversation.ts`: imports**

Replace:

```ts
import { runAgentTurn } from "@/lib/agents/runAgentTurn";
```

with:

```ts
import { runAgentTurn } from "@/lib/agents/runAgentTurn";
import { liveKey as busKey, publish } from "@/lib/agents/liveBus";
```

- [ ] **Step 5: Edit `conversation.ts`: module state**

Replace:

```ts
/** Conversations with a turn in progress in THIS process. A row marked running that isn't here was cut off by a restart. */
const live = new Set<string>();
const liveKey = (c: Ctx) => `${c.tenantId}:${c.convId}`;

const SAVE_EVERY_MS = 500;
```

with:

```ts
/** Conversations with a turn in progress in THIS process. A row marked running that isn't here was cut off by a restart. */
const live = new Set<string>();
/**
 * The conversation object each running turn is writing to. Readers (the GET
 * route, a stream's first snapshot) are given this, so they see the reply as
 * it stands now rather than as of the last save, and the deltas published
 * after it apply to exactly that text.
 */
const memory = new Map<string, Conv>();
/** One per running turn: "Stop" in the compose box aborts the model call. */
const aborts = new Map<string, AbortController>();
const liveKey = (c: Ctx) => busKey(c.tenantId, c.convId);

const SAVE_EVERY_MS = 500;
const STOPPED_NOTE = "_Stopped._";

type TurnRunner = typeof runAgentTurn;
let turnRunner: TurnRunner = runAgentTurn;
/** Tests only: run turns with a fake instead of the model. Pass undefined to restore. */
export function setTurnRunnerForTests(fn: TurnRunner | undefined): void {
  turnRunner = fn ?? runAgentTurn;
}
```

- [ ] **Step 6: Edit `conversation.ts`: `write` keeps `updatedAt` in step**

Replace the whole `write` function:

```ts
function write(c: Ctx, conv: Conv): void {
  db(c.tenantId)
    .update(agentConversations)
    .set({
      title: conv.title,
      messages: JSON.stringify(conv.messages),
      campaignEvents: JSON.stringify(conv.campaignEvents),
      status: conv.status,
      building: conv.building,
      campaignId: conv.campaignId,
      stopRequested: conv.stopRequested,
      updatedAt: new Date(),
    })
    .where(eq(agentConversations.id, c.convId))
    .run();
}
```

with:

```ts
function write(c: Ctx, conv: Conv): void {
  const now = Date.now();
  conv.updatedAt = now;
  db(c.tenantId)
    .update(agentConversations)
    .set({
      title: conv.title,
      messages: JSON.stringify(conv.messages),
      campaignEvents: JSON.stringify(conv.campaignEvents),
      status: conv.status,
      building: conv.building,
      campaignId: conv.campaignId,
      stopRequested: conv.stopRequested,
      updatedAt: new Date(now),
    })
    .where(eq(agentConversations.id, c.convId))
    .run();
}
```

- [ ] **Step 7: Edit `conversation.ts`: `listConversations` and `getConversation`**

In `listConversations`, replace:

```ts
    .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.getTime(), running: r.status === "running" && live.has(`${tenantId}:${r.id}`) }));
```

with:

```ts
    .map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.getTime(), running: r.status === "running" && live.has(busKey(tenantId, r.id)) }));
```

Replace:

```ts
export function getConversation(c: Ctx): ConversationView | null {
  const conv = load(c);
  return conv ? view(conv) : null;
}
```

with:

```ts
/** The conversation for its owner; while a turn runs, as it stands this instant (see `memory`). */
export function getConversation(c: Ctx): ConversationView | null {
  const conv = load(c); // also the owner check: someone else's id is null
  if (!conv) return null;
  return view(memory.get(liveKey(c)) ?? conv);
}
```

- [ ] **Step 8: Edit `conversation.ts`: the stop action**

Replace:

```ts
  | { type: "stop" };
```

with:

```ts
  /** `now`: end the turn Adonis is on (the compose box's Stop). Without it, stop after the current step (the autopilot banner). */
  | { type: "stop"; now?: boolean };
```

Replace:

```ts
  if (action.type === "stop") {
    if (!conv) throw new ConversationError("Conversation not found.", 404);
    if (conv.status === "running") {
      conv.stopRequested = true;
      write(c, conv);
    }
    return view(conv);
  }
```

with:

```ts
  if (action.type === "stop") {
    if (!conv) throw new ConversationError("Conversation not found.", 404);
    const mem = memory.get(liveKey(c));
    if (conv.status === "running") {
      // Set it on the running turn's own object too, or its next save would
      // write stopRequested: false back over this click.
      conv.stopRequested = true;
      if (mem) mem.stopRequested = true;
      write(c, mem ?? conv);
      if (action.now) aborts.get(liveKey(c))?.abort();
    }
    return view(mem ?? conv);
  }
```

- [ ] **Step 9: Edit `conversation.ts`: replace `drive`**

Replace everything from `/** The loop: take turns until Adonis needs the operator. Runs detached; \`live\` already holds this conversation. */` to the end of the file with:

```ts
/** The loop: take turns until Adonis needs the operator. Runs detached; `live` already holds this conversation. */
async function drive(c: Ctx, kick: Kick): Promise<void> {
  const conv = parse(row(c)!);
  const key = liveKey(c);
  memory.set(key, conv);
  const abort = new AbortController();
  aborts.set(key, abort);
  let lastSave = 0;
  const save = () => {
    lastSave = Date.now();
    write(c, conv);
    publish(key, { type: "state", conversation: view(conv) });
  };
  const stopAsked = () => conv.stopRequested || row(c)?.stopRequested === true;
  // File every AI cost under the campaign being worked on, else this chat,
  // for the account's AI usage page.
  const campaignNames = new Map<number, string>();
  const usageTag = (): UsageContext => {
    const id = conv.campaignId;
    if (id === null) return { ref: `chat:${c.convId}`, label: `Adonis: ${conv.title}` };
    if (!campaignNames.has(id)) {
      const camp = db(c.tenantId).select({ name: campaigns.name }).from(campaigns).where(eq(campaigns.id, id)).get();
      campaignNames.set(id, camp?.name ?? `Campaign ${id}`);
    }
    return { ref: `campaign:${id}`, label: campaignNames.get(id)! };
  };

  const execute = async (actions: ConvAction[]) => {
    const out: (AutopilotResult & { artifact?: ToolArtifact })[] = [];
    for (const a of actions) {
      try {
        const r = await withUsageContext(usageTag(), () => executeTool(a.name, a.input ?? {}, { tenantId: c.tenantId, userId: c.userId }));
        out.push({ name: a.name, ok: true, text: r.text, artifact: r.artifact });
      } catch (err) {
        out.push({ name: a.name, ok: false, text: err instanceof Error ? err.message : "Action failed." });
      }
    }
    return out;
  };
  /** Show what an approval did on its card, and log campaign progress. */
  const record = (m: ConvMessage, results: Awaited<ReturnType<typeof execute>>, auto: boolean) => {
    const lines = results.map((r) => (r.ok ? humanResult(r.text) : `Failed: ${humanResult(r.text)}`)).join("\n\n");
    m.content = [m.content, auto ? "_Approved automatically._" : "", lines].filter(Boolean).join("\n\n");
    for (const r of results) {
      if (r.artifact) m.artifacts.push({ url: r.artifact.url, filename: r.artifact.filename, label: r.artifact.label });
      const e = r.ok ? campaignProgressEventFromResult(r.name, r.text) : null;
      if (e) conv.campaignEvents.push(e);
      conv.campaignId = campaignIdFromResult(r.name, r.text) ?? conv.campaignId;
    }
  };

  try {
    const resolved = resolveChatAgent(c.tenantId, c.agentKey);
    if (!resolved) throw new Error("Adonis isn't available on this account.");
    const system = composeAgentSystem(c.tenantId, c.agentKey);

    let next: string | null = null; // the hidden hand-back that opens the next turn
    if (kick.kind === "approve") {
      const card = conv.messages[kick.index];
      const actions = card.pending!.actions;
      const results = await execute(actions);
      card.pending!.status = "approved";
      record(card, results, false);
      const ok = results.every((r) => r.ok);
      conv.building = kick.all && ok && conv.campaignId !== null;
      next = continuationMessage(results, { auto: false, autopilot: conv.building });
      watchAds(c, adIdsFromResults(results));
      save();
    } else if (kick.kind === "followUp") {
      next = kick.message;
    } else if (kick.kind === "resume") {
      conv.building = true;
      conv.campaignId = kick.campaign.id;
      next = resumeMessage(kick.campaign);
    }

    let nudges = 0;
    for (let turn = 0; ; turn++) {
      if (turn >= AUTOPILOT_MAX_TURNS) {
        conv.messages.push({ role: "assistant", content: "_Adonis stopped after a long run. Say \"carry on\" to continue._", tools: [], artifacts: [] });
        break;
      }
      if (turn > 0 && stopAsked()) break;
      if (next) conv.messages.push({ role: "user", hidden: true, content: next, tools: [], artifacts: [] });
      const reply: ConvMessage = { role: "assistant", content: "", tools: [], artifacts: [], startedAt: Date.now() };
      const history = modelHistory(conv.messages);
      conv.messages.push(reply);
      const replyIndex = conv.messages.length - 1;
      save();

      const out = await withUsageContext(usageTag(), () => turnRunner({
        tenantId: c.tenantId,
        agentKey: c.agentKey,
        userId: c.userId,
        model: resolved.model,
        system,
        tools: resolved.tools,
        messages: history,
        signal: abort.signal,
        onText: (t) => {
          reply.content += t;
          // The words go to the page at once; the database save stays
          // throttled. Publish BEFORE save: a state must never arrive ahead
          // of a delta it already contains.
          publish(key, { type: "text", index: replyIndex, delta: t });
          if (Date.now() - lastSave > SAVE_EVERY_MS) save();
        },
        onTool: (n) => {
          reply.tools.push(n);
          publish(key, { type: "tool", index: replyIndex, name: n });
          save();
        },
      }));
      reply.content = out.text;
      reply.durationMs = Date.now() - (reply.startedAt ?? Date.now());
      for (const a of out.artifacts) {
        if (!reply.artifacts.some((x) => x.url === a.url)) reply.artifacts.push({ url: a.url, filename: a.filename, label: a.label });
      }
      if (abort.signal.aborted) {
        reply.content = [reply.content, STOPPED_NOTE].filter(Boolean).join("\n\n");
        break;
      }

      const decision = decideAfterTurn({ pending: out.pendingWrites, autopilot: conv.building, campaignId: conv.campaignId, nudges });
      if (decision === "ask") {
        reply.pending = { actions: out.pendingWrites, status: "awaiting" };
        const plan = campaignPlanEventFromActions(out.pendingWrites);
        if (plan) conv.campaignEvents.push(plan);
        break;
      }
      if (decision === "finish") break;
      if (decision === "nudge") {
        nudges++;
        next = AUTOPILOT_NUDGE;
        continue;
      }
      // "approve": the operator approved these in advance.
      reply.pending = { actions: out.pendingWrites, status: "approving" };
      save();
      const results = await execute(out.pendingWrites);
      reply.pending.status = "approved";
      record(reply, results, true);
      watchAds(c, adIdsFromResults(results));
      if (results.some((r) => !r.ok)) conv.building = false;
      nudges = 0;
      next = continuationMessage(results, { auto: true, autopilot: conv.building });
    }
  } catch (err) {
    const last = conv.messages[conv.messages.length - 1];
    if (last?.role === "assistant" && last.startedAt !== undefined && last.durationMs === undefined) {
      last.durationMs = Date.now() - last.startedAt;
    }
    if (abort.signal.aborted) {
      if (last?.role === "assistant") last.content = [last.content, STOPPED_NOTE].filter(Boolean).join("\n\n");
      else conv.messages.push({ role: "assistant", content: STOPPED_NOTE, tools: [], artifacts: [] });
    } else {
      const msg = err instanceof AiCapError ? err.message : agentErrorText(err);
      if (!(err instanceof AiCapError)) console.error(`[adonis ${c.convId}]`, err);
      if (last?.role === "assistant") last.content = [last.content, `_Error: ${msg}_`].filter(Boolean).join("\n\n");
      else conv.messages.push({ role: "assistant", content: `_Error: ${msg}_`, tools: [], artifacts: [] });
    }
  } finally {
    conv.status = "idle";
    conv.building = false;
    conv.stopRequested = false;
    write(c, conv);
    live.delete(key);
    memory.delete(key);
    aborts.delete(key);
    publish(key, { type: "state", conversation: view(conv) });
    publish(key, { type: "end" });
  }
}
```

- [ ] **Step 10: Pass `now` through the route**

In `app/src/app/api/agents/[key]/conversations/[id]/route.ts`, replace:

```ts
    case "stop":
      action = { type: "stop" };
      break;
```

with:

```ts
    case "stop":
      action = { type: "stop", now: body.now === true };
      break;
```

- [ ] **Step 11: Run the tests**

Run: `cd app && npm test -- src/lib/agents/conversation.live.test.ts && npm test -- src/lib/agents/conversationModel.test.ts && npm test -- src/lib/agents/autopilotModel.test.ts`
Expected: PASS, `conversation live: all checks passed`. If a module fails to load under tsx, add a `Module._load` stub for that exact request in the test (as the file's comment says) and re-run; do not change production code to suit the test.

- [ ] **Step 12: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add app/src/lib/agents/conversation.ts app/src/lib/agents/conversationModel.ts "app/src/app/api/agents/[key]/conversations/[id]/route.ts" app/src/lib/agents/conversation.live.test.ts
git commit -m "feat(adonis): the run loop publishes every word, tool and save as it happens

Readers get the in-memory reply while a turn runs, replies record when they
started and how long they took, and Stop in the compose box ends the turn.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The SSE stream route

**Files:**
- Create: `app/src/lib/agents/liveStream.ts`
- Create: `app/src/app/api/agents/[key]/conversations/[id]/stream/route.ts`
- Test: `app/src/lib/agents/liveStream.test.ts`

**Interfaces:**
- Consumes: `formatSse`, `SSE_HEARTBEAT`, `SSE_RETRY`, `LiveEvent` (Task 1); `liveKey`, `subscribe` (Task 1); `getConversation` (Task 2); `parseStamp` from `@/lib/api/tenantStampRules`.
- Produces:
  - `liveStream(o: { subscribe: (listener: (e: LiveEvent) => void) => () => void; snapshot: () => ConversationView | null; heartbeatMs?: number; maxMs?: number; signal?: AbortSignal }): ReadableStream<Uint8Array>`
  - `GET /api/agents/<key>/conversations/<id>/stream?stamp=<tenantId>` → `text/event-stream`. Frames: `retry: 1500`, then `data: {"type":"state",...}` (snapshot), then each bus event as `data: {...}`, `: hb` every 15 s; closes after `end` or after 10 minutes. Status 401 (no session), 409 (stamp mismatch), 404 (agent unavailable, bad id, not the owner's chat).

- [ ] **Step 1: Write the failing test**

`app/src/lib/agents/liveStream.test.ts`:

```ts
// Run: npm test -- src/lib/agents/liveStream.test.ts
//
// The bridge from the live bus to an SSE response: snapshot first, every
// event after it, a heartbeat while quiet, closed on `end`, on abort, or
// after its time cap; never left subscribed.
import assert from "node:assert/strict";

import type { ConversationView } from "./conversationModel";
import type { LiveEvent } from "./liveEvents";
import { liveStream } from "./liveStream";

function hub() {
  const listeners = new Set<(e: LiveEvent) => void>();
  return {
    subscribe: (fn: (e: LiveEvent) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    emit: (e: LiveEvent) => {
      for (const l of [...listeners]) l(e);
    },
    count: () => listeners.size,
  };
}

const view = (running: boolean): ConversationView => ({
  id: "c1",
  title: "t",
  updatedAt: 1,
  running,
  building: false,
  stopRequested: false,
  campaignEvents: [],
  messages: [{ role: "assistant", content: "Hi", tools: [], artifacts: [] }],
});

async function collect(stream: ReadableStream<Uint8Array>, timeoutMs = 2000): Promise<{ frames: string[]; closed: boolean }> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let text = "";
  let closed = false;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const r = await Promise.race([
      reader.read(),
      new Promise<"timeout">((res) => setTimeout(() => res("timeout"), left)),
    ]);
    if (r === "timeout") break;
    if (r.done) {
      closed = true;
      break;
    }
    text += dec.decode(r.value, { stream: true });
  }
  reader.releaseLock();
  return { frames: text.split("\n\n").filter(Boolean), closed };
}

const dataTypes = (frames: string[]) =>
  frames.filter((f) => f.startsWith("data: ")).map((f) => (JSON.parse(f.slice(6)) as LiveEvent).type);

(async () => {
  // A running conversation: snapshot, then events, closed on end.
  {
    const h = hub();
    const s = liveStream({ subscribe: h.subscribe, snapshot: () => view(true) });
    h.emit({ type: "text", index: 0, delta: " there" });
    h.emit({ type: "tool", index: 0, name: "list_leads" });
    h.emit({ type: "state", conversation: view(true) });
    h.emit({ type: "end" });
    const { frames, closed } = await collect(s);
    assert.ok(frames[0].startsWith("retry: "), "the retry hint goes first");
    assert.deepEqual(dataTypes(frames), ["state", "text", "tool", "state", "end"], "snapshot first, then every event in order");
    assert.ok(closed, "the stream closes after end");
    assert.equal(h.count(), 0, "and stops listening");
  }
  // An idle conversation: snapshot and end straight away.
  {
    const h = hub();
    const { frames, closed } = await collect(liveStream({ subscribe: h.subscribe, snapshot: () => view(false) }));
    assert.deepEqual(dataTypes(frames), ["state", "end"], "an idle chat gets its snapshot and end");
    assert.ok(closed && h.count() === 0, "and is not held open");
  }
  // A conversation that is gone.
  {
    const h = hub();
    const { frames, closed } = await collect(liveStream({ subscribe: h.subscribe, snapshot: () => null }));
    assert.deepEqual(dataTypes(frames), ["end"], "a missing chat just ends");
    assert.ok(closed && h.count() === 0);
  }
  // Quiet: heartbeats, then the time cap closes it (the page reconnects).
  {
    const h = hub();
    const { frames, closed } = await collect(liveStream({ subscribe: h.subscribe, snapshot: () => view(true), heartbeatMs: 20, maxMs: 120 }));
    assert.ok(frames.some((f) => f.startsWith(": hb")), "a quiet stream sends heartbeats");
    assert.ok(closed, "the time cap closes it");
    assert.ok(!dataTypes(frames).includes("end"), "the cap is not an end: the page reconnects");
    assert.equal(h.count(), 0);
  }
  // The page goes away.
  {
    const h = hub();
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    const { closed } = await collect(liveStream({ subscribe: h.subscribe, snapshot: () => view(true), signal: ac.signal }));
    assert.ok(closed && h.count() === 0, "an aborted request closes and unsubscribes");
  }
  console.log("liveStream: all checks passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/agents/liveStream.test.ts`
Expected: FAIL with `Cannot find module './liveStream'`.

- [ ] **Step 3: Write `liveStream.ts`**

```ts
/**
 * One open chat page's Server-Sent Events stream: a snapshot of the
 * conversation, then every live event after it.
 *
 * Subscribing and taking the snapshot happen in the same synchronous step,
 * and the run loop publishes from synchronous code, so nothing can be
 * published in between: every event after the snapshot applies to it.
 *
 * Closes on `end` (the run finished), when the request goes away, or after
 * `maxMs` (default 10 minutes; the browser's EventSource reconnects and gets
 * a fresh snapshot). A comment heartbeat every `heartbeatMs` (default 15 s)
 * keeps proxies from closing a quiet stream. Pure enough to test: no Next,
 * no database; the route hands it the bus and the snapshot.
 */

import type { ConversationView } from "@/lib/agents/conversationModel";
import { formatSse, SSE_HEARTBEAT, SSE_RETRY, type LiveEvent } from "@/lib/agents/liveEvents";

export type LiveStreamOptions = {
  subscribe: (listener: (e: LiveEvent) => void) => () => void;
  snapshot: () => ConversationView | null;
  heartbeatMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
};

export function liveStream(o: LiveStreamOptions): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let cleanup = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const send = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed by the reader */
        }
      };
      const heartbeat = setInterval(() => send(SSE_HEARTBEAT), o.heartbeatMs ?? 15_000);
      const cap = setTimeout(close, o.maxMs ?? 10 * 60_000);
      const onAbort = () => close();
      cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
        clearTimeout(cap);
        o.signal?.removeEventListener("abort", onAbort);
      };
      o.signal?.addEventListener("abort", onAbort);

      send(SSE_RETRY);
      unsubscribe = o.subscribe((e) => {
        send(formatSse(e));
        if (e.type === "end") close();
      });
      const snap = o.snapshot();
      if (!snap) {
        send(formatSse({ type: "end" }));
        close();
        return;
      }
      send(formatSse({ type: "state", conversation: snap }));
      if (!snap.running) {
        send(formatSse({ type: "end" }));
        close();
        return;
      }
      if (o.signal?.aborted) close();
    },
    cancel() {
      cleanup();
    },
  });
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `cd app && npm test -- src/lib/agents/liveStream.test.ts`
Expected: PASS, `liveStream: all checks passed`.

- [ ] **Step 5: Write the route**

`app/src/app/api/agents/[key]/conversations/[id]/stream/route.ts`:

```ts
import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { resolveChatAgent } from "@/lib/agents/chatAgent";
import { getConversation } from "@/lib/agents/conversation";
import { liveKey, subscribe } from "@/lib/agents/liveBus";
import { liveStream } from "@/lib/agents/liveStream";
import { parseStamp } from "@/lib/api/tenantStampRules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ key: string; id: string }> };

/**
 * The conversation as Adonis writes it, over Server-Sent Events: a snapshot,
 * then every word, tool and save (lib/agents/liveStream.ts). The chat opens
 * this while a run is going and polls the plain GET otherwise.
 *
 * The same checks as the conversation GET route: a session, an active
 * membership, an available agent, a sane id, and the owner's own chat
 * (getConversation looks it up by user; anyone else's id is a 404, never a
 * stream). EventSource cannot send the tenant-stamp header, so the page puts
 * the stamp in `?stamp=`, refused on mismatch like the header would be.
 */
export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  let userId: number;
  try {
    userId = (await requireUser()).id;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const membership = getCurrentMembership();
  if (!membership) return new Response("No active account", { status: 401 });
  const stamped = parseStamp(req.nextUrl.searchParams.get("stamp"));
  if (stamped !== null && stamped !== membership.tenant.id) {
    return new Response("This tab is showing another account. Reload it.", { status: 409 });
  }
  if (!resolveChatAgent(membership.tenant.id, params.key)) return new Response("Not found", { status: 404 });
  const id = String(params.id ?? "");
  if (!id || id.length > 80) return new Response("Not found", { status: 404 });

  const ctx = { tenantId: membership.tenant.id, userId, agentKey: params.key, convId: id };
  if (!getConversation(ctx)) return new Response("Not found", { status: 404 });

  const stream = liveStream({
    subscribe: (fn) => subscribe(liveKey(ctx.tenantId, id), fn),
    snapshot: () => getConversation(ctx),
    signal: req.signal,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform also stops `next start`'s compression from buffering the stream.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 6: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/agents/liveStream.ts app/src/lib/agents/liveStream.test.ts "app/src/app/api/agents/[key]/conversations/[id]/stream/route.ts"
git commit -m "feat(adonis): stream a conversation over Server-Sent Events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Follow-up suggestions (parser, prompt, history)

**Files:**
- Create: `app/src/components/adonis/chat/followups.ts`
- Modify: `app/src/lib/agents/specialists/orchestrator.ts:170` (end of `basePlaybook`)
- Modify: `app/src/lib/agents/conversationModel.ts:33-39` (`modelHistory`)
- Test: `app/src/components/adonis/chat/followups.test.ts`
- Test: `app/src/lib/agents/specialists/orchestratorFollowups.test.ts`
- Test: `app/src/lib/agents/conversationModel.test.ts` (append)

**Interfaces:**
- Produces:
  - `splitFollowups(content: string): { body: string; followups: string[]; complete: boolean }` — `body` is the reply without the block (text after the block kept), `followups` up to 3 cleaned lines, `complete` true once `</followups>` has arrived.
  - `stripFollowups(content: string): string`
  - `MAX_FOLLOWUPS = 3`

- [ ] **Step 1: Write the failing parser test**

`app/src/components/adonis/chat/followups.test.ts`:

```ts
// Run: npm test -- src/components/adonis/chat/followups.test.ts
//
// Adonis ends a reply with up to three suggested next questions in a
// <followups> block. The page hides the block and shows the lines as
// buttons, including while the reply is still streaming in.
import assert from "node:assert/strict";

import { MAX_FOLLOWUPS, splitFollowups, stripFollowups } from "./followups";

assert.deepEqual(splitFollowups("Massage is ahead."), { body: "Massage is ahead.", followups: [], complete: false }, "no block, nothing changes");

const full = "Massage is ahead.\n\n<followups>\n- Move budget to the bundle\n2. Draft the checkout email\n\"Show me last week\"\nA fourth one\n</followups>";
assert.deepEqual(
  splitFollowups(full),
  { body: "Massage is ahead.", followups: ["Move budget to the bundle", "Draft the checkout email", "Show me last week"], complete: true },
  "the block is hidden, bullets and quotes cleaned, capped at three",
);
assert.equal(MAX_FOLLOWUPS, 3);

assert.equal(splitFollowups("Done.\n<follo").body, "Done.", "a half-written opening tag is hidden while streaming");
assert.equal(splitFollowups("Done.\n<").body, "Done.", "even its first character");
assert.deepEqual(splitFollowups("Done.\n<followups>\nFirst que"), { body: "Done.", followups: ["First que"], complete: false }, "an open block is hidden before it closes");

const after = "Here's the change.\n<followups>\nUndo it\n</followups>\n\n_Approved automatically._";
assert.equal(splitFollowups(after).body, "Here's the change.\n\n_Approved automatically._", "lines the server adds after the block stay");

assert.deepEqual(splitFollowups("A\n<FollowUps>\nX\n</FOLLOWUPS>").followups, ["X"], "tags in any case");
assert.equal(splitFollowups("x <y> z").body, "x <y> z", "an unrelated tag mid-text is left alone");
assert.equal(splitFollowups("if a<b then").body, "if a<b then", "a < in the middle of a word is left alone");
assert.deepEqual(splitFollowups("A\n<followups>\n\n  \n- \n</followups>").followups, [], "empty lines are dropped");
assert.deepEqual(splitFollowups(`A\n<followups>\n${"x".repeat(200)}\n</followups>`).followups, [], "a runaway line is dropped");
assert.equal(stripFollowups(full), "Massage is ahead.");

console.log("followups: all checks passed");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/components/adonis/chat/followups.test.ts`
Expected: FAIL with `Cannot find module './followups'`.

- [ ] **Step 3: Write `followups.ts`**

```ts
/**
 * Adonis's suggested next questions.
 *
 * Its playbook (lib/agents/specialists/orchestrator.ts) asks it to end a
 * finished reply with
 *
 *   <followups>
 *   one suggestion per line
 *   </followups>
 *
 * The chat hides that block from the answer and shows the lines as buttons.
 * Pure string work, safe on a reply still streaming in: an open block, or
 * the first characters of the opening tag at the very end, are hidden too.
 * Anything after the closing tag stays in the answer (the server appends
 * "_Approved automatically._" and results to a card later).
 */

const OPEN = "<followups>";
const CLOSE = "</followups>";
export const MAX_FOLLOWUPS = 3;
const MAX_LINE = 140;

export type SplitReply = { body: string; followups: string[]; complete: boolean };

function cleanLines(inner: string): string[] {
  return inner
    .split("\n")
    .map((l) =>
      l
        .trim()
        .replace(/^([-*•]|\d{1,2}[.)])(\s+|$)/, "")
        .replace(/^["'“”]+|["'“”]+$/g, "")
        .trim(),
    )
    .filter((l) => l.length > 0 && l.length <= MAX_LINE && !l.includes("<"))
    .slice(0, MAX_FOLLOWUPS);
}

/** The end of `content` with a half-written opening tag removed (streaming). Only at the start of a line or after a space. */
function stripPartialOpen(content: string): string {
  const lower = content.toLowerCase();
  for (let k = Math.min(OPEN.length - 1, lower.length); k >= 1; k--) {
    const tail = lower.slice(lower.length - k);
    if (!OPEN.startsWith(tail)) continue;
    const before = content.slice(0, content.length - k);
    if (before === "" || /\s$/.test(before)) return before.trimEnd();
  }
  return content;
}

export function splitFollowups(content: string): SplitReply {
  const lower = content.toLowerCase();
  const at = lower.lastIndexOf(OPEN);
  if (at === -1) return { body: stripPartialOpen(content), followups: [], complete: false };
  const end = lower.indexOf(CLOSE, at + OPEN.length);
  const inner = content.slice(at + OPEN.length, end === -1 ? undefined : end);
  const after = end === -1 ? "" : content.slice(end + CLOSE.length).trim();
  const body = [content.slice(0, at).trimEnd(), after].filter(Boolean).join("\n\n");
  return { body, followups: cleanLines(inner), complete: end !== -1 };
}

export function stripFollowups(content: string): string {
  return splitFollowups(content).body;
}
```

- [ ] **Step 4: Run the parser test to make sure it passes**

Run: `cd app && npm test -- src/components/adonis/chat/followups.test.ts`
Expected: PASS, `followups: all checks passed`.

- [ ] **Step 5: Add the instruction to Adonis's playbook**

In `app/src/lib/agents/specialists/orchestrator.ts`, replace:

```ts
Channel: if a phone number's on file, prefer WhatsApp (short, friendly); otherwise email.`,
```

with:

```ts
Channel: if a phone number's on file, prefer WhatsApp (short, friendly); otherwise email.

Follow-up suggestions: end a finished reply with up to three short requests the operator is likely to make next, in this exact block on its own lines, with nothing after it:
<followups>
Draft the reply to Sarah
Show me this week's no-shows
</followups>
Write each one the way the operator would type it to you, under 70 characters, about what you just found or did. Leave the block out when an Approve card is waiting, when you have asked the operator a question, or when there is no clear next step. Never mention the block.`,
```

- [ ] **Step 6: Strip the block from the history Adonis is given**

In `app/src/lib/agents/conversationModel.ts`, add below the existing `import type { CampaignProgressEvent } ...` line:

```ts
import { stripFollowups } from "@/components/adonis/chat/followups";
```

Replace:

```ts
/** The messages Adonis is given for its next turn: the last 24 with something in them. */
export function modelHistory(messages: ConvMessage[]): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-24);
}
```

with:

```ts
/**
 * The messages Adonis is given for its next turn: the last 24 with something
 * in them. Its old follow-up suggestions are left out: they were for the
 * operator, and feeding them back only invites repeats.
 */
export function modelHistory(messages: ConvMessage[]): { role: "user" | "assistant"; content: string }[] {
  return messages
    .map((m) => ({ role: m.role, content: m.role === "assistant" ? stripFollowups(m.content) : m.content }))
    .filter((m) => m.content.trim())
    .slice(-24);
}
```

Also in the same file, replace the header line ` * and the chat shows it (AssistantChat). Pure, so both sides share one copy` with ` * and the chat shows it (components/adonis/chat). Pure, so both sides share one copy`.

- [ ] **Step 7: Add history checks**

In `app/src/lib/agents/conversationModel.test.ts`, insert before the line `const credit = Object.assign(`:

```ts
const withBlock = modelHistory([
  { role: "user", content: "hi", tools: [], artifacts: [] },
  { role: "assistant", content: "Done.\n<followups>\nNext thing\n</followups>", tools: [], artifacts: [] },
]);
check("follow-up suggestions are not fed back to Adonis", withBlock[1].content === "Done.");
check(
  "a reply that is only a follow-up block counts as empty",
  modelHistory([{ role: "assistant", content: "<followups>\nX\n</followups>", tools: [], artifacts: [] }]).length === 0,
);
```

- [ ] **Step 8: Write the playbook test**

`app/src/lib/agents/specialists/orchestratorFollowups.test.ts`:

```ts
// Run: npm test -- src/lib/agents/specialists/orchestratorFollowups.test.ts
//
// The example block in Adonis's playbook must parse with the chat's own
// parser, or the model would learn a format the page cannot read.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called in orchestratorFollowups.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);
const { ORCHESTRATOR_SPECIALIST } = requireLocal("./orchestrator") as typeof import("./orchestrator");
const { splitFollowups } = requireLocal("../../../components/adonis/chat/followups") as typeof import("@/components/adonis/chat/followups");

const pb = ORCHESTRATOR_SPECIALIST.basePlaybook;
const start = pb.indexOf("<followups>");
const end = pb.indexOf("</followups>");
assert.ok(start !== -1 && end > start, "the playbook shows the block");
const parsed = splitFollowups(`Answer.\n${pb.slice(start, end + "</followups>".length)}`);
assert.equal(parsed.body, "Answer.", "the example block is hidden");
assert.equal(parsed.followups.length, 2, "and its two lines read back");
assert.ok(parsed.complete);
assert.ok(pb.includes("Leave the block out when an Approve card is waiting"), "no suggestions under an Approve card");

console.log("orchestrator follow-ups: all checks passed");
```

- [ ] **Step 9: Run the tests**

Run: `cd app && npm test -- src/lib/agents/specialists/orchestratorFollowups.test.ts && npm test -- src/lib/agents/conversationModel.test.ts && npm test -- src/lib/agents/specialistToolSlice.test.ts`
Expected: PASS for all three.

- [ ] **Step 10: Commit**

```bash
git add app/src/components/adonis/chat/followups.ts app/src/components/adonis/chat/followups.test.ts app/src/lib/agents/specialists/orchestrator.ts app/src/lib/agents/specialists/orchestratorFollowups.test.ts app/src/lib/agents/conversationModel.ts app/src/lib/agents/conversationModel.test.ts
git commit -m "feat(adonis): replies end with up to three follow-up suggestions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Markdown parser for the answer document

**Files:**
- Create: `app/src/components/adonis/chat/markdown.ts`
- Test: `app/src/components/adonis/chat/markdown.test.ts`

**Interfaces:**
- Produces:
  - `type Inline = { kind: "text"; text: string } | { kind: "strong"; text: string } | { kind: "em"; text: string } | { kind: "code"; text: string } | { kind: "link"; text: string; href: string }`
  - `type Block = { kind: "heading"; level: 1 | 2 | 3; text: string } | { kind: "paragraph"; lines: string[] } | { kind: "list"; ordered: boolean; start: number; items: string[] } | { kind: "table"; header: string[]; rows: string[][] } | { kind: "code"; text: string } | { kind: "rule" }`
  - `parseBlocks(text: string): Block[]`, `parseInline(text: string): Inline[]`, `splitRow(line: string): string[]`

- [ ] **Step 1: Write the failing test**

`app/src/components/adonis/chat/markdown.test.ts`:

```ts
// Run: npm test -- src/components/adonis/chat/markdown.test.ts
//
// The markdown Adonis writes, parsed into blocks and inline runs for the
// answer document. Built as data, never HTML; partial input always parses.
import assert from "node:assert/strict";

import { parseBlocks, parseInline, splitRow } from "./markdown";

const doc = parseBlocks("# Title\n\nPara one\nline two\n\n- a\n- b\n\n- c\n1. x\n2. y\n---\n```\ncode here\n```\n#### Deep");
assert.deepEqual(
  doc.map((b) => b.kind),
  ["heading", "paragraph", "list", "list", "rule", "code", "heading"],
  "headings, paragraphs, lists, a rule and code",
);
assert.deepEqual(doc[0], { kind: "heading", level: 1, text: "Title" });
assert.deepEqual(doc[1], { kind: "paragraph", lines: ["Para one", "line two"] }, "lines of one paragraph stay together");
assert.deepEqual(doc[2], { kind: "list", ordered: false, start: 1, items: ["a", "b", "c"] }, "a blank line inside a list does not split it");
assert.deepEqual(doc[3], { kind: "list", ordered: true, start: 1, items: ["x", "y"] });
assert.deepEqual(doc[5], { kind: "code", text: "code here" });
assert.deepEqual(doc[6], { kind: "heading", level: 3, text: "Deep" }, "deeper headings are shown as the smallest level");

assert.deepEqual(parseBlocks("3. third\n4. fourth")[0], { kind: "list", ordered: true, start: 3, items: ["third", "fourth"] }, "a numbered list keeps its first number");
assert.deepEqual(
  parseBlocks("| Offer | Sold |\n|---|---:|\n| Massage | 6 |\n| Bundle |\nAfter"),
  [
    { kind: "table", header: ["Offer", "Sold"], rows: [["Massage", "6"], ["Bundle", ""]] },
    { kind: "paragraph", lines: ["After"] },
  ],
  "a table, short rows padded, ends at the first line without a pipe",
);
assert.deepEqual(parseBlocks("| Offer | Sold |"), [{ kind: "paragraph", lines: ["| Offer | Sold |"] }], "a header still waiting for its divider is a paragraph");
assert.deepEqual(parseBlocks("```\nlet a = 1"), [{ kind: "code", text: "let a = 1" }], "an unclosed fence is code to the end");
assert.deepEqual(parseBlocks("**Bold** start"), [{ kind: "paragraph", lines: ["**Bold** start"] }], "bold at the start of a line is not a bullet");
assert.deepEqual(parseBlocks(""), []);
assert.deepEqual(splitRow("| a | b |"), ["a", "b"]);

assert.deepEqual(parseInline("**6 sold** against `2`"), [
  { kind: "strong", text: "6 sold" },
  { kind: "text", text: " against " },
  { kind: "code", text: "2" },
]);
assert.deepEqual(parseInline("_quiet_ and *soft*"), [
  { kind: "em", text: "quiet" },
  { kind: "text", text: " and " },
  { kind: "em", text: "soft" },
]);
assert.deepEqual(parseInline("use list_leads_today now"), [{ kind: "text", text: "use list_leads_today now" }], "snake_case is not italic");
assert.deepEqual(parseInline("2 * 3 * 4"), [{ kind: "text", text: "2 * 3 * 4" }], "spaced asterisks are not italic");
assert.deepEqual(parseInline("Visit https://adonisagent.ie/pricing."), [
  { kind: "text", text: "Visit " },
  { kind: "link", text: "https://adonisagent.ie/pricing", href: "https://adonisagent.ie/pricing" },
  { kind: "text", text: "." },
], "a bare link drops the full stop after it");
assert.deepEqual(parseInline("[Open the ads](/marketing/ads/12)"), [{ kind: "link", text: "Open the ads", href: "/marketing/ads/12" }], "a link inside the app");
for (const bad of ["[x](javascript:alert(1))", "[x](//evil.example)", "[x](data:text/html,hi)"]) {
  const out = parseInline(bad);
  assert.ok(out.every((n) => n.kind === "text"), `${bad} is never a link`);
  assert.equal(out.map((n) => n.text).join(""), bad, "and its text is kept as written");
}

console.log("markdown: all checks passed");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/components/adonis/chat/markdown.test.ts`
Expected: FAIL with `Cannot find module './markdown'`.

- [ ] **Step 3: Write `markdown.ts`**

```ts
/**
 * The small markdown Adonis writes, as data: blocks (headings, paragraphs,
 * lists, tables, fenced code, rules) and inline runs (bold, italic, code,
 * links). AnswerDocument builds React nodes from this and never raw HTML, so
 * text Adonis quotes from a customer cannot inject markup. Links are only
 * http(s) or paths inside the app ("/marketing/ads/12").
 *
 * Partial input (a reply still streaming) always parses: an unclosed fence
 * is code to the end, a table header without its divider yet is a paragraph.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "code"; text: string }
  | { kind: "rule" };

const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^([-*_])(?:\s*\1){2,}$/;
const BULLET = /^[-*•]\s+(.*)$/;
const NUMBERED = /^(\d{1,3})[.)]\s+(.*)$/;
const FENCE = /^```/;

function isTableDivider(line: string): boolean {
  const t = line.trim();
  return t.includes("|") && t.includes("-") && /^[\s|:-]+$/.test(t);
}

export function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "paragraph", lines: para });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (FENCE.test(t)) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i].trim())) body.push(lines[i++]);
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (t === "") {
      flush();
      continue;
    }
    if (RULE.test(t)) {
      flush();
      out.push({ kind: "rule" });
      continue;
    }
    const h = HEADING.exec(t);
    if (h) {
      flush();
      out.push({ kind: "heading", level: Math.min(h[1].length, 3) as 1 | 2 | 3, text: h[2].trim() });
      continue;
    }
    if (t.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flush();
      const header = splitRow(t);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes("|")) rows.push(splitRow(lines[i++]));
      i--;
      out.push({ kind: "table", header, rows: rows.map((r) => header.map((_, k) => r[k] ?? "")) });
      continue;
    }
    const b = BULLET.exec(t);
    const n = b ? null : NUMBERED.exec(t);
    if (b || n) {
      flush();
      const ordered = n !== null;
      const item = b ? b[1] : n![2];
      const prev = out[out.length - 1];
      if (prev && prev.kind === "list" && prev.ordered === ordered) prev.items.push(item);
      else out.push({ kind: "list", ordered, start: n ? Number(n[1]) : 1, items: [item] });
      continue;
    }
    para.push(t);
  }
  flush();
  return out;
}

// Order matters: bold before italic, a markdown link before a bare URL.
// Italic needs a non-space just inside each marker, and underscores only at
// word edges, so "2 * 3" and snake_case tool names stay as written.
const TOKEN =
  /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(((?:https?:\/\/|\/(?!\/))[^\s)]*)\)|(https?:\/\/[^\s<>()]+)|(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])|(?<!\w)_(?=\S)([^_\n]*?\S)_(?!\w)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pushText = (s: string) => {
    if (!s) return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.text += s;
    else out.push({ kind: "text", text: s });
  };
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    pushText(text.slice(at, start));
    at = start + m[0].length;
    if (m[1] !== undefined) out.push({ kind: "strong", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "link", text: m[3], href: m[4] });
    else if (m[5] !== undefined) {
      const href = m[5].replace(/[.,;:!?'"]+$/, "");
      out.push({ kind: "link", text: href, href });
      pushText(m[5].slice(href.length));
    } else if (m[6] !== undefined) out.push({ kind: "em", text: m[6] });
    else if (m[7] !== undefined) out.push({ kind: "em", text: m[7] });
  }
  pushText(text.slice(at));
  return out;
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `cd app && npm test -- src/components/adonis/chat/markdown.test.ts`
Expected: PASS, `markdown: all checks passed`.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/adonis/chat/markdown.ts app/src/components/adonis/chat/markdown.test.ts
git commit -m "feat(adonis): parse Adonis's markdown into blocks, tables and safe links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Smooth text pacing and its hook

**Files:**
- Create: `app/src/components/adonis/chat/smoothText.ts`
- Create: `app/src/components/adonis/chat/useSmoothText.ts`
- Test: `app/src/components/adonis/chat/smoothText.test.ts`

**Interfaces:**
- Produces:
  - `type RevealState = { shown: number; carry: number }`, `type RevealOptions = { lagMs?: number; holdTail?: boolean }`
  - `advance(text: string, state: RevealState, dtMs: number, opts?: RevealOptions): RevealState`
  - `nextWordEnd(text: string, from: number): number`, `wordStartAtOrBefore(text: string, at: number): number`, `commonPrefix(a: string, b: string): number`
  - constants `BASE_CPS = 90`, `MAX_LAG_MS = 1500`, `FINISH_LAG_MS = 350`, `MAX_BACKLOG_CHARS = 800`, `MAX_FRAME_MS = 250`
  - `useSmoothText(target: string, streaming: boolean): { text: string; animating: boolean }`

- [ ] **Step 1: Write the failing test**

`app/src/components/adonis/chat/smoothText.test.ts`:

```ts
// Run: npm test -- src/components/adonis/chat/smoothText.test.ts
//
// How fast a streaming answer is revealed: whole words at an even pace,
// faster when far behind, never more than about 1.5 s behind what has
// arrived, and never stuck.
import assert from "node:assert/strict";

import {
  advance,
  commonPrefix,
  MAX_BACKLOG_CHARS,
  nextWordEnd,
  wordStartAtOrBefore,
  type RevealState,
} from "./smoothText";

assert.equal(nextWordEnd("Hello big world", 0), 5);
assert.equal(nextWordEnd("Hello big world", 5), 9, "skips the space, then the word");
assert.equal(nextWordEnd("Hello", 2), 5);
assert.equal(wordStartAtOrBefore("Hello big world", 7), 6);
assert.equal(commonPrefix("abcd", "abxy"), 2);

// Whole words only.
const text = "The massage offer is ahead of the bundle this week.";
let s: RevealState = { shown: 0, carry: 0 };
const stops = new Set<number>();
for (let i = 0; i < 300; i++) {
  s = advance(text, s, 16);
  stops.add(s.shown);
}
assert.equal(s.shown, text.length, "it finishes");
for (const n of stops) assert.ok(n === 0 || n === text.length || /\s/.test(text[n]), `never stops mid-word (stopped at ${n})`);

// A short frame shows nothing yet but keeps what it earned.
const one = advance("Hello world", { shown: 0, carry: 0 }, 16);
assert.equal(one.shown, 0);
assert.ok(one.carry > 1.4 && one.carry < 1.5, "the budget carries to the next frame");

// While streaming, a word still being written waits; finished text shows it.
assert.equal(advance("Hello wor", { shown: 0, carry: 0 }, 250, { holdTail: true }).shown, 5);
assert.equal(advance("Hello wor", { shown: 0, carry: 0 }, 250).shown, 9);

// A very long word (a link) still comes out.
const link = `See https://adonisagent.ie/${"x".repeat(70)} now`;
let l: RevealState = { shown: 0, carry: 0 };
for (let i = 0; i < 400; i++) l = advance(link, l, 16);
assert.equal(l.shown, link.length, "a word longer than any one frame's budget is not stuck");

// A huge backlog (a reconnect) jumps instead of crawling.
const long = "word ".repeat(400);
const jumped = advance(long, { shown: 0, carry: 0 }, 16);
assert.ok(long.length - jumped.shown <= MAX_BACKLOG_CHARS, "never more than the backlog cap behind");

// Streaming at 200 characters a second, the reveal stays within about 1.5 s.
let target = "";
let st: RevealState = { shown: 0, carry: 0 };
let worstLagMs = 0;
for (let t = 0; t < 5000; t += 16) {
  while (target.length < Math.floor((t / 1000) * 200)) target += "word ";
  st = advance(target, st, 16, { holdTail: true });
  if (t > 1000) worstLagMs = Math.max(worstLagMs, ((target.length - st.shown) / 200) * 1000);
}
assert.ok(worstLagMs <= 1700, `lag stays near 1.5 s (worst ${Math.round(worstLagMs)} ms)`);

// When the run ends, the rest drains fast.
const fin = advance("word ".repeat(100), { shown: 0, carry: 0 }, 100, { lagMs: 350 });
assert.ok(fin.shown >= 135, "finishing uses a much shorter lag");

console.log("smoothText: all checks passed");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/components/adonis/chat/smoothText.test.ts`
Expected: FAIL with `Cannot find module './smoothText'`.

- [ ] **Step 3: Write `smoothText.ts`**

```ts
/**
 * How fast a streaming answer is revealed. Pure, so the pacing is tested
 * without a browser; useSmoothText drives it on requestAnimationFrame.
 *
 * Each frame earns a character budget at `max(BASE_CPS, backlog / lag)`
 * characters a second, so the reveal catches up faster the further behind it
 * is, and settles about `lag` (1.5 s) behind a steady stream. Words come out
 * whole; while streaming, the last word waits until a space shows it is
 * complete. A backlog over MAX_BACKLOG_CHARS (a reconnect, a big save) jumps
 * forward rather than crawling through it.
 */

export const BASE_CPS = 90;
export const MAX_LAG_MS = 1500;
export const FINISH_LAG_MS = 350;
export const MAX_BACKLOG_CHARS = 800;
export const MAX_FRAME_MS = 250;
/** While a word is held back, the budget saved for it is capped so it does not release a burst. */
const MAX_HELD_CARRY = 24;

export type RevealState = { shown: number; carry: number };
export type RevealOptions = { lagMs?: number; holdTail?: boolean };

const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);

/** The end of the next word after `from` (skipping any spaces first). */
export function nextWordEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && isSpace(text[i])) i++;
  while (i < text.length && !isSpace(text[i])) i++;
  return i;
}

export function wordStartAtOrBefore(text: string, at: number): number {
  let i = Math.max(0, Math.min(at, text.length));
  while (i > 0 && !isSpace(text[i - 1])) i--;
  return i;
}

export function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

export function advance(text: string, state: RevealState, dtMs: number, opts: RevealOptions = {}): RevealState {
  const total = text.length;
  let shown = Math.max(0, Math.min(state.shown, total));
  if (shown >= total) return { shown: total, carry: 0 };
  if (total - shown > MAX_BACKLOG_CHARS) shown = Math.max(shown, wordStartAtOrBefore(text, total - MAX_BACKLOG_CHARS));
  const lag = opts.lagMs ?? MAX_LAG_MS;
  const cps = Math.max(BASE_CPS, ((total - shown) * 1000) / lag);
  let budget = state.carry + (cps * Math.min(Math.max(dtMs, 0), MAX_FRAME_MS)) / 1000;
  let held = false;
  while (shown < total) {
    const next = nextWordEnd(text, shown);
    if (opts.holdTail && next === total && !isSpace(text[total - 1])) {
      held = true;
      break;
    }
    if (next - shown > budget) break;
    budget -= next - shown;
    shown = next;
  }
  if (shown >= total) return { shown: total, carry: 0 };
  return { shown, carry: held ? Math.min(budget, MAX_HELD_CARRY) : budget };
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `cd app && npm test -- src/components/adonis/chat/smoothText.test.ts`
Expected: PASS, `smoothText: all checks passed`.

- [ ] **Step 5: Write `useSmoothText.ts`**

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

import { advance, commonPrefix, FINISH_LAG_MS, MAX_LAG_MS, type RevealState } from "./smoothText";

/**
 * Reveal `target` at an even pace while it streams (./smoothText), driven by
 * requestAnimationFrame. Text already there when the component mounts shows
 * at once (a reload, an old answer); only words that arrive afterwards are
 * paced. When streaming stops, what is left drains quickly instead of
 * jumping. If the text is rewritten (the final save can differ from the
 * streamed words), the reveal restarts from the part both share. Off under
 * prefers-reduced-motion. `animating` tells the renderer to fade new words in.
 */
export function useSmoothText(target: string, streaming: boolean): { text: string; animating: boolean } {
  const reduced = useReducedMotion() ?? false;
  const [shown, setShown] = useState(target.length);
  const stateRef = useRef<RevealState>({ shown: target.length, carry: 0 });
  const targetRef = useRef(target);
  const streamingRef = useRef(streaming);
  const everStreamed = useRef(streaming);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  if (streaming) everStreamed.current = true;
  const pace = !reduced && everStreamed.current;

  useEffect(() => {
    const prevShown = targetRef.current.slice(0, stateRef.current.shown);
    targetRef.current = target;
    streamingRef.current = streaming;
    if (!target.startsWith(prevShown)) stateRef.current = { shown: commonPrefix(prevShown, target), carry: 0 };
    if (!pace) {
      stateRef.current = { shown: target.length, carry: 0 };
      setShown(target.length);
      return;
    }
    setShown(stateRef.current.shown);
    if (rafRef.current || stateRef.current.shown >= target.length) return;
    lastRef.current = performance.now();
    const tick = (now: number) => {
      const next = advance(targetRef.current, stateRef.current, now - lastRef.current, {
        lagMs: streamingRef.current ? MAX_LAG_MS : FINISH_LAG_MS,
        holdTail: streamingRef.current,
      });
      lastRef.current = now;
      stateRef.current = next;
      setShown(next.shown);
      rafRef.current = next.shown < targetRef.current.length ? requestAnimationFrame(tick) : 0;
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [target, streaming, pace]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    },
    [],
  );

  const visible = Math.min(shown, target.length);
  return { text: target.slice(0, visible), animating: pace && (streaming || visible < target.length) };
}
```

- [ ] **Step 6: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/adonis/chat/smoothText.ts app/src/components/adonis/chat/smoothText.test.ts app/src/components/adonis/chat/useSmoothText.ts
git commit -m "feat(adonis): reveal streaming answers word by word at an even pace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Exchanges, tool labels and approval changes (pure)

**Files:**
- Create: `app/src/components/adonis/chat/toolLabels.ts`
- Create: `app/src/components/adonis/chat/exchanges.ts`
- Create: `app/src/components/adonis/chat/approvalModel.ts`
- Test: `app/src/components/adonis/chat/exchanges.test.ts`
- Test: `app/src/components/adonis/chat/approvalModel.test.ts`

**Interfaces:**
- Consumes: `splitFollowups` (Task 4); `splitAttachments` from `@/components/messaging/chatText` (existing); `ConvMessage`, `ConvArtifact`, `ConvAction` from `@/lib/agents/conversationModel`; `LivePhase` (Task 1).
- Produces:
  - `TOOL_LABEL: Record<string, string>`, `toolLabel(name: string): string`
  - `type ExchangeReply = { index: number; message: ConvMessage; body: string }`
  - `type ChatExchange = { key: string; questionIndex: number | null; question: string; attached: { name: string; kind: string; id: string }[]; replies: ExchangeReply[]; tools: string[]; artifacts: ConvArtifact[]; followups: string[]; startedAt: number | null; durationMs: number | null }`
  - `groupExchanges(messages: ConvMessage[]): ChatExchange[]` — key `q<index of the visible user message>` (or `a<index>` for an exchange that starts with a reply)
  - `type StepRow = { key: string; label: string; state: "running" | "done" }`, `stepRows(tools: string[], live: boolean, phase: LivePhase | null): StepRow[]`
  - `formatDuration(ms: number): string`, `stepsSummary(durationMs: number | null, steps: number): string`, `firstSentence(text: string, max?: number): string`
  - `type ActionChange = { from: string; to: string }`, `actionChanges(a: ConvAction, max?: number): { changes: ActionChange[]; more: number }`, `campaignAction(actions: ConvAction[]): ConvAction | null`

- [ ] **Step 1: Write the failing tests**

`app/src/components/adonis/chat/exchanges.test.ts`:

```ts
// Run: npm test -- src/components/adonis/chat/exchanges.test.ts
//
// A conversation shown as exchanges: each question with every reply until
// the next question (hidden hand-backs after an approval do not start a new
// one), its steps, files, follow-ups and timing.
import assert from "node:assert/strict";

import type { ConvMessage } from "@/lib/agents/conversationModel";
import { firstSentence, formatDuration, groupExchanges, stepRows, stepsSummary } from "./exchanges";
import { toolLabel } from "./toolLabels";

const msgs: ConvMessage[] = [
  { role: "user", content: "Which offer is selling better?", tools: [], artifacts: [] },
  {
    role: "assistant",
    content: "Massage is ahead, 6 sold to 2. The bundle is behind.\n<followups>\nMove budget to the bundle\n</followups>",
    tools: ["get_ad_results", "business_overview"],
    artifacts: [],
    startedAt: 1000,
    durationMs: 6200,
  },
  { role: "user", content: 'Move €5 a day\n\n[Attached to the library: "plan.pdf" — document #12]', tools: [], artifacts: [] },
  {
    role: "assistant",
    content: "Here's the change.",
    tools: ["list_ad_campaigns"],
    artifacts: [],
    pending: { status: "approved", actions: [{ name: "set_ad_budget", input: {}, summary: "Set budget" }] },
    startedAt: 9000,
    durationMs: 2000,
  },
  { role: "user", hidden: true, content: "[The operator approved that]", tools: [], artifacts: [] },
  {
    role: "assistant",
    content: "Done. Budgets moved.",
    tools: [],
    artifacts: [{ url: "/a.zip", filename: "a.zip", label: "Report" }],
    startedAt: 20000,
    durationMs: 1000,
  },
];

const xs = groupExchanges(msgs);
assert.equal(xs.length, 2, "two questions, two exchanges");
assert.deepEqual(xs.map((x) => x.key), ["q0", "q2"], "keys follow the question's message index");
assert.equal(xs[0].question, "Which offer is selling better?");
assert.equal(xs[0].replies[0].body, "Massage is ahead, 6 sold to 2. The bundle is behind.", "the follow-up block is not in the answer");
assert.deepEqual(xs[0].followups, ["Move budget to the bundle"]);
assert.deepEqual(xs[0].tools, ["get_ad_results", "business_overview"]);
assert.equal(xs[0].durationMs, 6200);
assert.equal(xs[1].question, "Move €5 a day", "the attachment line is not in the question");
assert.deepEqual(xs[1].attached, [{ name: "plan.pdf", kind: "document", id: "12" }]);
assert.equal(xs[1].replies.length, 2, "a hidden hand-back does not start a new exchange");
assert.equal(xs[1].startedAt, 9000);
assert.equal(xs[1].durationMs, 3000, "durations add up across replies");
assert.equal(xs[1].artifacts.length, 1);
assert.deepEqual(xs[1].followups, [], "the latest reply without a block clears follow-ups");

const lone = groupExchanges([{ role: "assistant", content: "_Adonis was interrupted._", tools: [], artifacts: [] }]);
assert.equal(lone.length, 1);
assert.equal(lone[0].key, "a0");
assert.equal(lone[0].questionIndex, null, "a reply before any question gets an exchange without a headline");
assert.deepEqual(groupExchanges([]), []);
assert.equal(groupExchanges([{ role: "user", content: "x", tools: [], artifacts: [] }, { role: "assistant", content: "y", tools: [], artifacts: [] }])[0].durationMs, null, "old replies have no timing");

assert.equal(firstSentence("**Massage** is ahead, 6 sold to 2. The bundle..."), "Massage is ahead, 6 sold to 2.");
assert.equal(firstSentence("## Heading\nIt costs €12.50 today. More."), "It costs €12.50 today.", "headings are skipped, prices are not sentence ends");
assert.equal(firstSentence("- [Open](/x) the ads now"), "Open the ads now");
const longOne = firstSentence("x".repeat(200));
assert.equal(longOne.length, 140);
assert.ok(longOne.endsWith("…"));
assert.equal(firstSentence(""), "");

assert.deepEqual(stepRows(["get_ad_results", "list_leads"], false, null).map((r) => r.state), ["done", "done"]);
assert.deepEqual(stepRows(["list_leads"], true, "tool").map((r) => r.state), ["running"]);
assert.deepEqual(stepRows(["list_leads"], true, null).map((r) => r.state), ["running"], "a tool with no word after it is still running");
assert.deepEqual(
  stepRows(["list_leads"], true, "writing").map((r) => [r.label, r.state]),
  [["Checking the pipeline", "done"], ["Writing the answer", "running"]],
);
assert.deepEqual(stepRows([], true, "writing"), [], "no steps for an answer that used no tools");

assert.equal(formatDuration(6200), "6.2s");
assert.equal(formatDuration(0), "0.0s");
assert.equal(formatDuration(72_000), "1m 12s");
assert.equal(stepsSummary(6200, 4), "Done in 6.2s, 4 steps");
assert.equal(stepsSummary(6200, 1), "Done in 6.2s, 1 step");
assert.equal(stepsSummary(null, 2), "Done, 2 steps");
assert.equal(stepsSummary(1000, 0), "Done in 1.0s");
assert.equal(stepsSummary(null, 0), "Done");

assert.equal(toolLabel("list_leads"), "Checking the pipeline");
assert.equal(toolLabel("some_new_tool"), "Some new tool", "unknown tools are shown in words");
assert.equal(toolLabel("Reading business overview"), "Reading business overview", "old chats saved the label itself");

console.log("exchanges: all checks passed");
```

`app/src/components/adonis/chat/approvalModel.test.ts`:

```ts
// Run: npm test -- src/components/adonis/chat/approvalModel.test.ts
//
// What an Approve card can show as old and new, and which cards are campaign
// cards (they get "Go again" behind "Change it").
import assert from "node:assert/strict";

import { actionChanges, campaignAction } from "./approvalModel";

assert.deepEqual(
  actionChanges({ name: "edit_website_text", input: { path: "/", find: "Book a consult", replace: "Book online" }, summary: "Change wording" }),
  { changes: [{ from: "Book a consult", to: "Book online" }], more: 0 },
  "a website text edit shows old and new",
);
const page = actionChanges({
  name: "create_website_page",
  input: { textChanges: Array.from({ length: 6 }, (_, i) => ({ find: `old ${i}`, replace: `new ${i}` })) },
  summary: "Create page",
});
assert.equal(page.changes.length, 4, "at most four pairs");
assert.equal(page.more, 2, "and how many more");
assert.deepEqual(actionChanges({ name: "set_ad_budget", input: { dailyBudget: 7.5 }, summary: "Set budget" }), { changes: [], more: 0 }, "no old value, no pair");
assert.deepEqual(actionChanges({ name: "edit_website_text", input: { find: "x" }, summary: "" }), { changes: [], more: 0 }, "half a pair is no pair");
const clipped = actionChanges({ name: "edit_website_text", input: { find: "a".repeat(300), replace: "b" }, summary: "" }).changes[0];
assert.equal(clipped.from.length, 140);
assert.ok(clipped.from.endsWith("…"));

const plan = { name: "create_campaign", input: {}, summary: "Create BF" };
assert.equal(campaignAction([plan]), plan);
assert.equal(campaignAction([{ name: "approve_campaign_asset", input: {}, summary: "" }])?.name, "approve_campaign_asset");
assert.equal(campaignAction([plan, plan]), null, "a batch has no single thing to redo");
assert.equal(campaignAction([{ name: "send_whatsapp", input: {}, summary: "" }]), null);

console.log("approvalModel: all checks passed");
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd app && npm test -- src/components/adonis/chat/exchanges.test.ts && npm test -- src/components/adonis/chat/approvalModel.test.ts`
Expected: FAIL with `Cannot find module './exchanges'` (and `./approvalModel`).

- [ ] **Step 3: Write `toolLabels.ts`**

```ts
/**
 * What each tool is called in the steps panel: plain words for what Adonis
 * is doing. A tool missing from the map is shown with its name in words
 * ("list_social_posts" becomes "List social posts"); chats saved by an older
 * page hold the label itself, which passes through unchanged.
 */

export const TOOL_LABEL: Record<string, string> = {
  business_overview: "Reading the business overview",
  list_recent_messages: "Scanning recent messages",
  search_messages: "Searching messages",
  list_invoices: "Finding invoices",
  bundle_invoices: "Bundling invoices",
  upload_invoices_to_drive: "Uploading to Google Drive",
  financial_summary: "Adding up the numbers",
  list_appointments: "Checking the diary",
  get_client: "Looking up the client",
  get_client_nutrition: "Reading the nutrition plan",
  create_calendar_event: "Adding to the calendar",
  create_client: "Creating the client",
  create_appointment: "Booking the appointment",
  log_payment: "Logging the payment",
  send_client_email: "Sending the email",
  add_food: "Adding the food",
  create_nutrition_plan: "Building the nutrition plan",
  add_exercise: "Adding the exercise",
  create_workout_program: "Building the workout program",
  assign_nutrition_plan: "Assigning the nutrition plan",
  assign_workout_program: "Assigning the workout program",
  create_lead: "Adding the lead",
  assign_membership: "Assigning the membership",
  list_classes: "Checking the timetable",
  create_class: "Creating the class",
  book_client_into_class: "Booking into the class",
  update_client: "Updating the client",
  cancel_appointment: "Cancelling the appointment",
  reschedule_appointment: "Rescheduling the appointment",
  cancel_class: "Cancelling the class",
  cancel_booking: "Cancelling the booking",
  cancel_membership: "Cancelling the membership",
  assign_package: "Assigning the package",
  create_form: "Building the form",
  list_leads: "Checking the pipeline",
  get_lead_health: "Checking lead health",
  draft_lead_reply: "Drafting a reply",
  send_whatsapp: "Sending the WhatsApp",
  set_lead_stage: "Updating the pipeline stage",
  log_lead_touch: "Logging a touch",
  list_no_shows: "Finding no-shows",
  list_lapsed_members: "Finding members gone quiet",
  plan_campaign: "Planning the campaign",
  create_campaign: "Creating the campaign",
  draft_campaign_asset: "Drafting the next asset",
  approve_campaign_asset: "Saving the asset",
  get_campaign: "Checking the campaign",
  launch_campaign: "Launching the campaign",
  list_blog_posts: "Checking the blog",
  draft_blog_post: "Drafting the blog post",
  draft_carousel: "Drafting the carousel",
  list_social_posts: "Checking the social posts",
  list_schedule: "Checking the schedule",
  list_website_pages: "Checking the website",
  read_website_page: "Reading the page",
  list_website_images: "Checking the images",
  list_ad_campaigns: "Checking the ad campaigns",
  search_ad_audience: "Searching the audience",
  get_ad_results: "Reading the ad results",
  get_ad_account_performance: "Checking the ads",
  get_social_metrics: "Reading the social numbers",
  get_google_metrics: "Reading the Google numbers",
  list_google_reviews: "Reading Google reviews",
  map_find: "Searching the business",
  map_get: "Reading the record",
  map_follow: "Following the links",
  map_count: "Counting",
  load_skill: "Reading a skill",
};

export function toolLabel(name: string): string {
  const known = TOOL_LABEL[name];
  if (known) return known;
  if (!name.includes("_")) return name;
  const words = name.replace(/_+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
```

- [ ] **Step 4: Write `exchanges.ts`**

```ts
/**
 * A conversation shown as exchanges (the answer-page layout): each visible
 * question with every reply that follows it until the next question. The
 * hidden hand-backs the app sends after an approval stay inside the same
 * exchange, so "approve, then Adonis carries on" reads as one answer.
 * Pure, so the grouping is tested without React.
 */

import type { ConvArtifact, ConvMessage } from "@/lib/agents/conversationModel";
import type { LivePhase } from "@/lib/agents/liveEvents";
import { splitAttachments } from "@/components/messaging/chatText";
import { splitFollowups } from "./followups";
import { toolLabel } from "./toolLabels";

export type ExchangeReply = { index: number; message: ConvMessage; body: string };

export type ChatExchange = {
  /** `q<index of the question>`, or `a<index>` for an exchange that starts with a reply. Stable as messages are added. */
  key: string;
  questionIndex: number | null;
  question: string;
  attached: { name: string; kind: string; id: string }[];
  replies: ExchangeReply[];
  tools: string[];
  artifacts: ConvArtifact[];
  /** From the latest reply that says anything. */
  followups: string[];
  startedAt: number | null;
  /** The sum of the replies' durations; null when none was timed (replies saved before timing existed). */
  durationMs: number | null;
};

export function groupExchanges(messages: ConvMessage[]): ChatExchange[] {
  const out: ChatExchange[] = [];
  let cur: ChatExchange | null = null;
  const start = (key: string, questionIndex: number | null, question: string, attached: ChatExchange["attached"]): ChatExchange => {
    const x: ChatExchange = { key, questionIndex, question, attached, replies: [], tools: [], artifacts: [], followups: [], startedAt: null, durationMs: null };
    out.push(x);
    return x;
  };
  for (let index = 0; index < messages.length; index++) {
    const m = messages[index];
    if (m.hidden) continue;
    if (m.role === "user") {
      const { body, attached } = splitAttachments(m.content);
      cur = start(`q${index}`, index, body, attached);
      continue;
    }
    if (!cur) cur = start(`a${index}`, null, "", []);
    const split = splitFollowups(m.content);
    cur.replies.push({ index, message: m, body: split.body });
    cur.tools.push(...m.tools);
    for (const a of m.artifacts) if (!cur.artifacts.some((x) => x.url === a.url)) cur.artifacts.push(a);
    if (split.body.trim() || split.followups.length) cur.followups = split.followups;
    if (cur.startedAt === null && typeof m.startedAt === "number") cur.startedAt = m.startedAt;
    if (typeof m.durationMs === "number") cur.durationMs = (cur.durationMs ?? 0) + m.durationMs;
  }
  return out;
}

export type StepRow = { key: string; label: string; state: "running" | "done" };

/**
 * The steps panel's rows. While live: the latest tool spins until words
 * start, then every tool is ticked and "Writing the answer" spins. Without a
 * phase from the stream (polling), the latest tool is taken as running.
 */
export function stepRows(tools: string[], live: boolean, phase: LivePhase | null): StepRow[] {
  const rows: StepRow[] = tools.map((t, i) => ({ key: `t${i}`, label: toolLabel(t), state: "done" }));
  if (!live || rows.length === 0) return rows;
  if (phase === "writing") return [...rows, { key: "write", label: "Writing the answer", state: "running" }];
  rows[rows.length - 1] = { ...rows[rows.length - 1], state: "running" };
  return rows;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function stepsSummary(durationMs: number | null, steps: number): string {
  const count = `${steps} step${steps === 1 ? "" : "s"}`;
  if (durationMs !== null && steps > 0) return `Done in ${formatDuration(durationMs)}, ${count}`;
  if (durationMs !== null) return `Done in ${formatDuration(durationMs)}`;
  if (steps > 0) return `Done, ${count}`;
  return "Done";
}

/** The first sentence of an answer in plain text, for a folded exchange. */
export function firstSentence(text: string, max = 140): string {
  const plain = text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/^\s*([-*•]|\d{1,3}[.)])\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|`/g, "")
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(plain);
  const s = m ? m[1] : plain;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
```

- [ ] **Step 5: Write `approvalModel.ts`**

```ts
/**
 * What an Approve card can say about a pending write. Pure.
 *
 * Old-and-new pairs come only from writes whose input carries both: a
 * website text edit names the exact text it replaces. Other writes carry the
 * new value only (a budget, a stage), so their card shows the summary alone.
 */

import type { ConvAction } from "@/lib/agents/conversationModel";

export type ActionChange = { from: string; to: string };

const CLIP = 140;
const clip = (s: string) => (s.length > CLIP ? `${s.slice(0, CLIP - 1).trimEnd()}…` : s);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The one campaign plan or asset this card is about, or null (a batch, or any other write). */
export function campaignAction(actions: ConvAction[]): ConvAction | null {
  return actions.length === 1 && (actions[0].name === "create_campaign" || actions[0].name === "approve_campaign_asset") ? actions[0] : null;
}

export function actionChanges(a: ConvAction, max = 4): { changes: ActionChange[]; more: number } {
  const pairs: ActionChange[] = [];
  const add = (from: unknown, to: unknown) => {
    const f = str(from);
    const t = str(to);
    if (f && t) pairs.push({ from: f, to: t });
  };
  if (a.name === "edit_website_text") add(a.input.find, a.input.replace);
  if (a.name === "create_website_page" && Array.isArray(a.input.textChanges)) {
    for (const c of a.input.textChanges as unknown[]) {
      if (c && typeof c === "object") add((c as Record<string, unknown>).find, (c as Record<string, unknown>).replace);
    }
  }
  return {
    changes: pairs.slice(0, max).map((p) => ({ from: clip(p.from), to: clip(p.to) })),
    more: Math.max(0, pairs.length - max),
  };
}
```

- [ ] **Step 6: Run the tests to make sure they pass**

Run: `cd app && npm test -- src/components/adonis/chat/exchanges.test.ts && npm test -- src/components/adonis/chat/approvalModel.test.ts`
Expected: PASS, `exchanges: all checks passed` and `approvalModel: all checks passed`.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/adonis/chat/toolLabels.ts app/src/components/adonis/chat/exchanges.ts app/src/components/adonis/chat/approvalModel.ts app/src/components/adonis/chat/exchanges.test.ts app/src/components/adonis/chat/approvalModel.test.ts
git commit -m "feat(adonis): group a chat into exchanges with steps, timing and follow-ups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: History grouping by Irish day, and the greeting

**Files:**
- Create: `app/src/components/adonis/chat/history.ts`
- Test: `app/src/components/adonis/chat/history.test.ts`

**Interfaces:**
- Consumes: `dublinDay(ms): string` from `@/lib/cashModel`, `dublinHour(ms): number` from `@/lib/remindersModel` (both pure, existing); `ConversationSummary`.
- Produces:
  - `type HistoryLabel = "Today" | "Yesterday" | "Earlier"`, `type HistoryGroup = { label: HistoryLabel; items: ConversationSummary[] }`
  - `groupHistory(items: ConversationSummary[], now: number): HistoryGroup[]` (empty groups dropped, newest first inside each)
  - `historyTimeLabel(at: number, now: number): string` ("now", "11:20", "Mon", "20 Nov")
  - `filterHistory(items: ConversationSummary[], query: string): ConversationSummary[]`
  - `previousDay(day: string): string`
  - `greetingFor(now: number, firstName: string | null): string`

- [ ] **Step 1: Write the failing test**

`app/src/components/adonis/chat/history.test.ts`:

```ts
// Run: npm test -- src/components/adonis/chat/history.test.ts
//
// The history drawer groups chats by Irish calendar day and labels each one;
// the opening screen greets by Irish time of day.
import assert from "node:assert/strict";

import type { ConversationSummary } from "@/lib/agents/conversationModel";
import { filterHistory, greetingFor, groupHistory, historyTimeLabel, previousDay } from "./history";

const now = Date.UTC(2026, 10, 24, 15, 0); // Tuesday 24 November 2026, 15:00 in Dublin (UTC+0)
const chat = (id: string, title: string, updatedAt: number): ConversationSummary => ({ id, title, updatedAt, running: false });
const items = [
  chat("d", "Who hasn't booked in 30 days", Date.UTC(2026, 10, 20, 9, 0)),
  chat("a", "Black Friday budget split", now - 30_000),
  chat("c", "Voucher store wording", Date.UTC(2026, 10, 23, 9, 0)),
  chat("b", "Reply to Messenger leads", Date.UTC(2026, 10, 24, 11, 20)),
  chat("e", "Early one", Date.UTC(2026, 10, 24, 0, 10)),
];

const groups = groupHistory(items, now);
assert.deepEqual(groups.map((g) => g.label), ["Today", "Yesterday", "Earlier"]);
assert.deepEqual(groups[0].items.map((c) => c.id), ["a", "b", "e"], "newest first within a day");
assert.deepEqual(groups[1].items.map((c) => c.id), ["c"]);
assert.deepEqual(groups[2].items.map((c) => c.id), ["d"]);
assert.deepEqual(groupHistory([items[0]], now).map((g) => g.label), ["Earlier"], "empty groups are left out");

assert.equal(historyTimeLabel(now - 30_000, now), "now");
assert.equal(historyTimeLabel(Date.UTC(2026, 10, 24, 11, 20), now), "11:20");
assert.equal(historyTimeLabel(Date.UTC(2026, 10, 23, 9, 0), now), "Mon");
assert.equal(historyTimeLabel(Date.UTC(2026, 10, 20, 9, 0), now), "20 Nov");

// Summer time: 23:30 UTC on 1 July is 00:30 on 2 July in Dublin.
const summer = Date.UTC(2026, 6, 2, 10, 0);
const late = groupHistory([chat("x", "x", Date.UTC(2026, 6, 1, 23, 30)), chat("y", "y", Date.UTC(2026, 6, 1, 22, 30))], summer);
assert.deepEqual(late.map((g) => [g.label, g.items.map((c) => c.id)]), [["Today", ["x"]], ["Yesterday", ["y"]]], "days are Irish days");

assert.equal(previousDay("2026-01-01"), "2025-12-31");
assert.equal(previousDay("2026-03-01"), "2026-02-28");

assert.deepEqual(filterHistory(items, "  BLACK ").map((c) => c.id), ["a"], "search ignores case and spaces");
assert.equal(filterHistory(items, "").length, items.length);

assert.equal(greetingFor(now, "Chris"), "Good afternoon, Chris.");
assert.equal(greetingFor(Date.UTC(2026, 10, 24, 8, 0), "Chris"), "Good morning, Chris.");
assert.equal(greetingFor(Date.UTC(2026, 10, 24, 20, 0), null), "Good evening.");
assert.equal(greetingFor(Date.UTC(2026, 6, 2, 11, 30), null), "Good afternoon.", "12:30 in Dublin in summer");

console.log("history: all checks passed");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/components/adonis/chat/history.test.ts`
Expected: FAIL with `Cannot find module './history'`.

- [ ] **Step 3: Write `history.ts`**

```ts
/**
 * The history drawer's grouping and labels, and the opening screen's
 * greeting. Days and hours are Irish (Europe/Dublin), whatever the browser's
 * own time zone. Pure.
 */

import type { ConversationSummary } from "@/lib/agents/conversationModel";
import { dublinDay } from "@/lib/cashModel";
import { dublinHour } from "@/lib/remindersModel";

const TZ = "Europe/Dublin";
const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" });

export type HistoryLabel = "Today" | "Yesterday" | "Earlier";
export type HistoryGroup = { label: HistoryLabel; items: ConversationSummary[] };

/** The calendar day before an ISO date ("2026-03-01" -> "2026-02-28"). */
export function previousDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function groupHistory(items: ConversationSummary[], now: number): HistoryGroup[] {
  const today = dublinDay(now);
  const yesterday = previousDay(today);
  const byLabel: Record<HistoryLabel, ConversationSummary[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const c of [...items].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const day = dublinDay(c.updatedAt);
    byLabel[day === today ? "Today" : day === yesterday ? "Yesterday" : "Earlier"].push(c);
  }
  return (["Today", "Yesterday", "Earlier"] as const).filter((l) => byLabel[l].length > 0).map((label) => ({ label, items: byLabel[label] }));
}

export function historyTimeLabel(at: number, now: number): string {
  if (now - at < 60_000) return "now";
  const day = dublinDay(at);
  const today = dublinDay(now);
  if (day === today) return TIME.format(at);
  if (day === previousDay(today)) return WEEKDAY.format(at);
  return DAY_MONTH.format(at);
}

export function filterHistory(items: ConversationSummary[], query: string): ConversationSummary[] {
  const q = query.trim().toLowerCase();
  return q ? items.filter((c) => (c.title || "").toLowerCase().includes(q)) : items;
}

export function greetingFor(now: number, firstName: string | null): string {
  const h = dublinHour(now);
  const part = h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 18 ? "Good afternoon" : "Good evening";
  return firstName ? `${part}, ${firstName}.` : `${part}.`;
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `cd app && npm test -- src/components/adonis/chat/history.test.ts`
Expected: PASS, `history: all checks passed`.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/adonis/chat/history.ts app/src/components/adonis/chat/history.test.ts
git commit -m "feat(adonis): group chat history by Irish day and greet by time of day

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: useConversationLive (stream while running, poll as fallback)

**Files:**
- Create: `app/src/components/adonis/chat/useConversationLive.ts`

**Interfaces:**
- Consumes: `applyLiveEvent`, `parseLiveEvent`, `LivePhase` (Task 1); the SSE route (Task 3); `GET /api/agents/<key>/conversations/<id>` (existing, 404 for a chat that does not exist yet).
- Produces:
  - `type LiveTransport = "stream" | "poll" | "idle"`
  - `type LiveConversation = { conv: ConversationView | null; setConv: Dispatch<SetStateAction<ConversationView | null>>; phases: Record<number, LivePhase>; transport: LiveTransport; settledId: string | null; holdRef: RefObject<boolean>; wake: () => void }`
  - `useConversationLive(o: { base: string; id: string; enabled: boolean; tenantId: number; onSettled?: () => void }): LiveConversation`
  - Contract for callers: set `holdRef.current = true` while your own POST is in flight (poll answers are ignored so they do not overwrite your optimistic state), set it back and call `wake()` when it settles. `settledId` equals `id` once the first GET for that id has answered. `onSettled` fires when a run ends.

- [ ] **Step 1: Write the hook**

```ts
"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { ConversationView } from "@/lib/agents/conversationModel";
import { applyLiveEvent, parseLiveEvent, type LivePhase } from "@/lib/agents/liveEvents";

export type { LivePhase } from "@/lib/agents/liveEvents";
export type LiveTransport = "stream" | "poll" | "idle";

/** Poll intervals: a run going without the stream; idle (another device may start one); a hidden tab. */
const FAST_MS = 700;
const IDLE_MS = 5_000;
const HIDDEN_MS = 15_000;
/** EventSource reconnects by itself; after this many errors in a row, poll for the rest of the run. */
const MAX_STREAM_ERRORS = 2;

export type LiveConversationOptions = {
  /** `/api/agents/<key>/conversations` */
  base: string;
  /** The open conversation ("" before the first load). */
  id: string;
  /** False until the chat list has loaded and an id is picked. */
  enabled: boolean;
  /** Sent as `?stamp=` on the stream (EventSource cannot send the tenant-stamp header). */
  tenantId: number;
  /** A run finished (refresh the history list). */
  onSettled?: () => void;
};

export type LiveConversation = {
  conv: ConversationView | null;
  setConv: Dispatch<SetStateAction<ConversationView | null>>;
  /** What each live reply is doing, by message index, as the stream reports it. */
  phases: Record<number, LivePhase>;
  transport: LiveTransport;
  /** The id whose first GET has answered (so "no messages" really means a new chat). */
  settledId: string | null;
  /** True while the caller's own POST is in flight. */
  holdRef: RefObject<boolean>;
  /** Fetch now (after a POST) unless the stream already has the conversation. */
  wake: () => void;
};

/**
 * Follow the open conversation.
 *
 * While Adonis is working, an EventSource on the stream route applies each
 * word and tool as it happens and replaces the whole conversation on every
 * save. When the stream is missing, refused or keeps failing, the old
 * polling loop takes over (fast while running), so a run is always followed.
 * Idle conversations are not held open: they are polled slowly, which is also
 * how a run started from another device is noticed.
 */
export function useConversationLive({ base, id, enabled, tenantId, onSettled }: LiveConversationOptions): LiveConversation {
  const [conv, setConv] = useState<ConversationView | null>(null);
  const [phases, setPhases] = useState<Record<number, LivePhase>>({});
  const [transport, setTransport] = useState<LiveTransport>("idle");
  const [settledId, setSettledId] = useState<string | null>(null);
  const convRef = useRef<ConversationView | null>(null);
  const holdRef = useRef(false);
  const esRef = useRef<EventSource | null>(null);
  const streamErrors = useRef(0);
  const streamFailed = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(id);
  const onSettledRef = useRef(onSettled);
  const tickRef = useRef<() => void>(() => {});
  idRef.current = id;
  onSettledRef.current = onSettled;

  useEffect(() => {
    convRef.current = conv;
  }, [conv]);

  const later = useCallback((ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => tickRef.current(), ms);
  }, []);

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const settle = useCallback(() => {
    setPhases({});
    onSettledRef.current?.();
  }, []);

  const openStream = useCallback((): boolean => {
    if (esRef.current) return true;
    const convId = idRef.current;
    if (streamFailed.current || !convId || typeof EventSource === "undefined") return false;
    const es = new EventSource(`${base}/${encodeURIComponent(convId)}/stream?stamp=${tenantId}`);
    esRef.current = es;
    streamErrors.current = 0;
    setTransport("stream");
    es.onmessage = (msg: MessageEvent<string>) => {
      if (esRef.current !== es || idRef.current !== convId) return;
      const e = parseLiveEvent(msg.data);
      if (!e) return;
      streamErrors.current = 0;
      if (e.type === "end") {
        closeStream();
        setTransport("idle");
        settle();
        later(IDLE_MS);
        return;
      }
      if (e.type === "text") setPhases((p) => (p[e.index] === "writing" ? p : { ...p, [e.index]: "writing" }));
      else if (e.type === "tool") setPhases((p) => ({ ...p, [e.index]: "tool" }));
      setConv((c) => applyLiveEvent(c, e));
    };
    es.onerror = () => {
      if (esRef.current !== es) return;
      streamErrors.current += 1;
      if (es.readyState === EventSource.CLOSED || streamErrors.current > MAX_STREAM_ERRORS) {
        closeStream();
        streamFailed.current = true;
        setTransport("poll");
        later(0);
      }
    };
    return true;
  }, [base, tenantId, closeStream, settle, later]);

  const tick = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const convId = idRef.current;
    if (!convId || esRef.current) return;
    let next: ConversationView | null | undefined;
    try {
      const res = await fetch(`${base}/${encodeURIComponent(convId)}`, { cache: "no-store" });
      if (res.status === 404) next = null;
      else if (res.ok) next = (await res.json()) as ConversationView;
    } catch {
      /* a network blip: try again on the next tick */
    }
    if (idRef.current !== convId || esRef.current) return;
    if (next !== undefined) setSettledId(convId);
    if (next !== undefined && !holdRef.current) {
      const wasRunning = Boolean(convRef.current?.running);
      convRef.current = next;
      setConv(next);
      if (wasRunning && !next?.running) settle();
      if (next?.running && openStream()) return;
    }
    const running = Boolean(convRef.current?.running) || holdRef.current;
    later(running ? FAST_MS : document.hidden ? HIDDEN_MS : IDLE_MS);
  }, [base, openStream, settle, later]);
  tickRef.current = () => void tick();

  // A different conversation: start from nothing and fetch it.
  useEffect(() => {
    if (!enabled || !id) return;
    closeStream();
    streamFailed.current = false;
    convRef.current = null;
    setConv(null);
    setPhases({});
    setTransport("idle");
    void tick();
    const onVisible = () => {
      if (!document.hidden && !esRef.current) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      closeStream();
    };
  }, [enabled, id, tick, closeStream]);

  // A run started (the answer to a send, or seen by a poll): follow it on the stream.
  const running = Boolean(conv?.running);
  useEffect(() => {
    if (!enabled) return;
    if (running) {
      if (!openStream()) later(FAST_MS);
    } else {
      streamFailed.current = false; // the next run tries the stream again
    }
  }, [enabled, running, openStream, later]);

  const wake = useCallback(() => {
    if (!esRef.current) void tick();
  }, [tick]);

  return { conv, setConv, phases, transport, settledId, holdRef, wake };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors. (The hook is exercised in the browser in Task 23 and live in Task 24.)

- [ ] **Step 3: Commit**

```bash
git add app/src/components/adonis/chat/useConversationLive.ts
git commit -m "feat(adonis): follow a conversation on the live stream, polling as the fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Scroll behaviour (question to the top, never yank, jump pill)

**Files:**
- Create: `app/src/components/adonis/chat/scrollModel.ts`
- Create: `app/src/components/adonis/chat/useChatScroll.ts`
- Test: `app/src/components/adonis/chat/scrollModel.test.ts`

**Interfaces:**
- Produces:
  - `type ScrollMetrics = { scrollTop: number; clientHeight: number; scrollHeight: number }` (an `HTMLElement` satisfies it)
  - `distanceFromBottom(m: ScrollMetrics): number`, `stickAfterScroll(distance: number, stuck: boolean, userDriven: boolean): boolean`, `shouldShowJump(m: ScrollMetrics): boolean`, `keyboardInset(innerHeight: number, viewportHeight: number, offsetTop: number): number`, constants `NEAR_BOTTOM_PX = 32`, `JUMP_AFTER_PX = 160`
  - `type ChatScroll = { scrollRef: RefObject<HTMLDivElement | null>; contentRef: RefObject<HTMLDivElement | null>; showJump: boolean; onScroll: () => void; pinNext: (exchangeKey: string) => void; toLatest: (behavior?: ScrollBehavior) => void }`
  - `useChatScroll(active: boolean): ChatScroll` — `active` is true while the thread view (not the opening screen) is mounted. Sets `--ax-view-h` on the scroll element (used by `.ax-ex--last` min-height, Task 11). Finds exchanges by `[data-exchange="<key>"]`.

- [ ] **Step 1: Write the failing test**

`app/src/components/adonis/chat/scrollModel.test.ts`:

```ts
// Run: npm test -- src/components/adonis/chat/scrollModel.test.ts
//
// When the chat follows new content, when it shows "Jump to latest", and how
// far the on-screen keyboard pushes the composer up.
import assert from "node:assert/strict";

import { distanceFromBottom, JUMP_AFTER_PX, keyboardInset, shouldShowJump, stickAfterScroll } from "./scrollModel";

assert.equal(distanceFromBottom({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 }), 0);
assert.equal(distanceFromBottom({ scrollTop: 100, clientHeight: 400, scrollHeight: 1000 }), 500);
assert.equal(distanceFromBottom({ scrollTop: 700, clientHeight: 400, scrollHeight: 1000 }), 0, "never negative (overscroll)");

assert.equal(stickAfterScroll(10, false, true), true, "scrolling to the bottom yourself starts following");
assert.equal(stickAfterScroll(400, true, true), false, "scrolling up yourself stops following");
assert.equal(stickAfterScroll(400, true, false), true, "the page's own scrolling never changes it");
assert.equal(stickAfterScroll(0, false, false), false);

assert.equal(shouldShowJump({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 + JUMP_AFTER_PX }), false);
assert.equal(shouldShowJump({ scrollTop: 0, clientHeight: 400, scrollHeight: 401 + JUMP_AFTER_PX }), true);

assert.equal(keyboardInset(844, 844, 0), 0, "no keyboard");
assert.equal(keyboardInset(844, 508, 0), 336, "the keyboard's height");
assert.equal(keyboardInset(844, 508, 120), 216, "less what the browser already scrolled");
assert.equal(keyboardInset(844, 900, 0), 0);

console.log("scrollModel: all checks passed");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/components/adonis/chat/scrollModel.test.ts`
Expected: FAIL with `Cannot find module './scrollModel'`.

- [ ] **Step 3: Write `scrollModel.ts`**

```ts
/**
 * The chat's scroll rules, as arithmetic. Pure.
 *
 * The view follows new content only while the operator has put it at the
 * bottom themselves; anything the page scrolls by itself (bringing a new
 * question to the top) never changes that. "Jump to latest" shows when there
 * is more than a little below the view.
 */

export const NEAR_BOTTOM_PX = 32;
export const JUMP_AFTER_PX = 160;

export type ScrollMetrics = { scrollTop: number; clientHeight: number; scrollHeight: number };

export function distanceFromBottom(m: ScrollMetrics): number {
  return Math.max(0, m.scrollHeight - m.clientHeight - m.scrollTop);
}

export function stickAfterScroll(distance: number, stuck: boolean, userDriven: boolean): boolean {
  return userDriven ? distance <= NEAR_BOTTOM_PX : stuck;
}

export function shouldShowJump(m: ScrollMetrics): boolean {
  return distanceFromBottom(m) > JUMP_AFTER_PX;
}

/** How much of the layout the on-screen keyboard covers (visualViewport), so the composer can sit above it. */
export function keyboardInset(innerHeight: number, viewportHeight: number, offsetTop: number): number {
  return Math.max(0, Math.round(innerHeight - viewportHeight - offsetTop));
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `cd app && npm test -- src/components/adonis/chat/scrollModel.test.ts`
Expected: PASS, `scrollModel: all checks passed`.

- [ ] **Step 5: Write `useChatScroll.ts`**

```ts
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { distanceFromBottom, shouldShowJump, stickAfterScroll } from "./scrollModel";

/** A scroll within this long of a wheel, touch, drag or scroll key is the operator's own. */
const INTENT_MS = 1200;
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End", " "]);

export type ChatScroll = {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  showJump: boolean;
  onScroll: () => void;
  /** After the next render, bring the exchange with this key to the top of the view, and stop following the bottom. */
  pinNext: (exchangeKey: string) => void;
  toLatest: (behavior?: ScrollBehavior) => void;
};

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The thread's scrolling. On send, the new question glides to the top and
 * the answer grows beneath it (the last exchange has a min-height of one view,
 * set from `--ax-view-h`, so there is always room to put it there). The view
 * follows growth only while the operator has scrolled to the bottom; it never
 * pulls them down while they read further up. "Jump to latest" appears when
 * there is new content below.
 */
export function useChatScroll(active: boolean): ChatScroll {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const pinRef = useRef<string | null>(null);
  const intentAt = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const toLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : behavior });
    setShowJump(false);
  }, []);

  const pinNext = useCallback((exchangeKey: string) => {
    pinRef.current = exchangeKey;
    stickRef.current = false;
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = stickAfterScroll(distanceFromBottom(el), stickRef.current, Date.now() - intentAt.current < INTENT_MS);
    setShowJump(shouldShowJump(el));
  }, []);

  // After the render that shows a just-sent question, bring it to the top.
  useLayoutEffect(() => {
    const key = pinRef.current;
    const el = scrollRef.current;
    if (!key || !el) return;
    const target = el.querySelector<HTMLElement>(`[data-exchange="${CSS.escape(key)}"]`);
    if (!target) return;
    pinRef.current = null;
    const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12;
    el.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? "auto" : "smooth" });
  });

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!active || !el || !content) return;
    const intent = () => {
      intentAt.current = Date.now();
    };
    const keyIntent = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      if (SCROLL_KEYS.has(e.key)) intent();
    };
    el.addEventListener("wheel", intent, { passive: true });
    el.addEventListener("touchmove", intent, { passive: true });
    el.addEventListener("pointerdown", intent);
    window.addEventListener("keydown", keyIntent);
    const sync = () => {
      el.style.setProperty("--ax-view-h", `${el.clientHeight}px`);
      if (stickRef.current && !pinRef.current) el.scrollTop = el.scrollHeight;
      setShowJump(shouldShowJump(el));
    };
    sync();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    ro?.observe(el);
    ro?.observe(content);
    return () => {
      ro?.disconnect();
      el.removeEventListener("wheel", intent);
      el.removeEventListener("touchmove", intent);
      el.removeEventListener("pointerdown", intent);
      window.removeEventListener("keydown", keyIntent);
    };
  }, [active]);

  return { scrollRef, contentRef, showJump, onScroll, pinNext, toLatest };
}
```

- [ ] **Step 6: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/adonis/chat/scrollModel.ts app/src/components/adonis/chat/scrollModel.test.ts app/src/components/adonis/chat/useChatScroll.ts
git commit -m "feat(adonis): chat scrolling that pins the question and never yanks the view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: Chat styles and the answer document

**Files:**
- Create: `app/src/components/adonis/chat/chat.css`
- Create: `app/src/components/adonis/chat/AnswerDocument.tsx`

**Interfaces:**
- Consumes: `parseBlocks`, `parseInline`, `Inline` (Task 5); `useSmoothText` (Task 6).
- Produces:
  - Every `.ax-*` class the later components use (listed in the CSS below). Components import `"./chat.css"` at the top.
  - `AnswerDocument({ text, streaming }: { text: string; streaming?: boolean }): JSX.Element`

Mockup to token mapping used throughout (from `chat-directions.html` option A and `chat-a-details.html`): mockup `--bg` -> `var(--bg)`; `--s1` -> `var(--surface-1)`; `--s2` -> `var(--surface-2)`; `--s3` -> `var(--surface-3)`; `--line` -> `var(--hairline)`; `--line2` -> `var(--hairline-strong)`; `--t1/--t2/--t3` -> `var(--text-primary/secondary/tertiary)`; `--ok` -> `var(--success)`; `--warn` -> `var(--warning)`; solid white pills -> `var(--accent)` on `var(--accent-contrast)` ink (the accent is near-white in dark mode, near-black in light); answer ink `#e4e6ea` -> `color-mix(in srgb, var(--text-primary) 90%, var(--bg))`; Inter -> `var(--font-body)`; Space Grotesk -> `var(--font-heading)`; JetBrains Mono -> `var(--font-mono)`.

- [ ] **Step 1: Write `chat.css`**

```css
/*
 * The /adonis chat (components/adonis/chat). Sizes and spacing from the
 * approved mockups; every colour from the app tokens so dark and light both
 * work. Imported by each chat component.
 */

.ax-root {
  --ax-ink: color-mix(in srgb, var(--text-primary) 90%, var(--bg));
  --ax-line: var(--hairline);
  --ax-line-2: var(--hairline-strong);
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
  color: var(--text-primary);
}

/* Top bar: New chat on the left, History (and the settings gear) on the right. */
.ax-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; padding: 0 4px; flex-shrink: 0; }
.ax-top-end { display: flex; align-items: center; gap: 4px; }
.ax-top-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  height: 36px; min-width: 36px; padding: 0 12px; border-radius: 999px;
  border: 1px solid transparent; background: none; color: var(--text-secondary);
  font: 500 13px/1 var(--font-body), sans-serif; text-decoration: none; cursor: pointer;
  transition: color 0.15s var(--ease), background 0.15s var(--ease);
}
.ax-top-btn:hover { color: var(--text-primary); background: var(--surface-1); }
.ax-top-btn:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }

/* The scrolling thread and its column. */
.ax-scroll { position: relative; flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.ax-col { max-width: 728px; margin: 0 auto; padding: 34px 24px 24px; }
@media (max-width: 640px) { .ax-col { padding: 22px 16px 16px; } }

/* One exchange. The last one is at least one view tall so its question can sit at the top. */
.ax-ex { padding-bottom: 36px; }
.ax-ex--last { min-height: calc(var(--ax-view-h, 70vh) - 36px); }
.ax-q { margin: 0 0 16px; font: 600 27px/1.25 var(--font-heading), sans-serif; letter-spacing: -0.01em; color: var(--text-primary); overflow-wrap: anywhere; }
@media (max-width: 640px) { .ax-q { font-size: 22px; } }
.ax-attached { display: flex; flex-wrap: wrap; gap: 6px; margin: -6px 0 14px; }
.ax-chip {
  display: inline-flex; align-items: center; gap: 6px; max-width: 260px; min-height: 28px;
  padding: 0 6px 0 10px; border: 1px solid var(--ax-line-2); border-radius: 999px;
  font-size: 12px; color: var(--text-secondary);
}
.ax-chip > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ax-chip > button { display: inline-grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 999px; background: none; color: var(--text-tertiary); cursor: pointer; }
.ax-chip > button:hover { color: var(--text-primary); background: var(--surface-3); }

/* Tabs: Answer / Steps / Results. */
.ax-tabs { display: flex; align-items: flex-end; gap: 20px; margin-bottom: 18px; border-bottom: 1px solid var(--ax-line); font-size: 13.5px; }
.ax-tab {
  display: inline-flex; align-items: center; gap: 7px; min-height: 32px; padding: 0 0 10px;
  border: 0; background: none; color: var(--text-tertiary); font: inherit; cursor: pointer;
  box-shadow: inset 0 -2px 0 transparent; transition: color 0.15s var(--ease), box-shadow 0.15s var(--ease);
}
.ax-tab:hover { color: var(--text-secondary); }
.ax-tab[aria-selected="true"] { color: var(--text-primary); box-shadow: inset 0 -2px 0 var(--text-primary); }
.ax-tab:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 4px; border-radius: 4px; }
.ax-tab--end { margin-left: auto; }
.ax-count { padding: 1px 6px; border-radius: 999px; background: var(--surface-3); color: var(--text-tertiary); font: 500 11px/1.4 var(--font-mono), ui-monospace, monospace; }

/* A folded earlier exchange. */
.ax-fold {
  display: block; width: 100%; margin: 0 0 18px; padding: 0 0 12px; text-align: left;
  border: 0; border-bottom: 1px solid var(--ax-line); background: none;
  color: var(--text-tertiary); font: 13px/1.5 var(--font-body), sans-serif; cursor: pointer;
}
.ax-fold b { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 2px; color: var(--text-secondary); font: 600 14.5px/1.35 var(--font-heading), sans-serif; }
.ax-fold:hover b { color: var(--text-primary); }
.ax-fold:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 4px; border-radius: 6px; }

/* Steps panel. */
.ax-steps { margin-bottom: 22px; padding: 12px 14px; border: 1px solid var(--ax-line); border-radius: 14px; background: var(--surface-1); overflow: hidden; }
.ax-steps-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--text-secondary); }
.ax-steps-h + .ax-step-list, .ax-steps-h + .ax-steps-none { margin-top: 8px; }
.ax-steps-none { font-size: 13px; color: var(--text-tertiary); }
.ax-timer { font: 500 12px/1 var(--font-mono), ui-monospace, monospace; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
.ax-thinking { display: inline-flex; align-items: center; gap: 8px; }
.ax-thinking::before { content: ""; width: 7px; height: 7px; border-radius: 999px; background: var(--text-primary); animation: ax-pulse 1.2s ease-in-out infinite; }
.ax-step-list { list-style: none; margin: 0; padding: 0; }
.ax-step { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 13.5px; color: var(--text-tertiary); animation: ax-rise 0.35s var(--ease) both; }
.ax-step[data-state="running"] { color: var(--text-primary); }
.ax-step[data-state="done"] { color: var(--text-secondary); }
.ax-dot { flex: none; display: grid; place-items: center; width: 16px; height: 16px; border-radius: 999px; border: 1.5px solid var(--ax-line-2); color: var(--bg); }
.ax-step[data-state="running"] .ax-dot { border-color: var(--text-primary); border-top-color: transparent; animation: spin 0.8s linear infinite; }
.ax-step[data-state="done"] .ax-dot { background: var(--success); border-color: var(--success); }
.ax-done { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; font-size: 12.5px; color: var(--text-tertiary); }
.ax-done .ax-dot { width: 14px; height: 14px; background: var(--success); border-color: var(--success); }

/* The answer, as a document. */
.ax-answer { max-width: 680px; font-size: 15.5px; line-height: 1.7; color: var(--ax-ink); overflow-wrap: anywhere; }
.ax-answer + .ax-answer { margin-top: 14px; }
.ax-answer > :first-child { margin-top: 0; }
.ax-answer h3, .ax-answer h4 { margin: 22px 0 8px; font-family: var(--font-heading), sans-serif; font-weight: 600; line-height: 1.3; color: var(--text-primary); }
.ax-answer h3 { font-size: 16.5px; }
.ax-answer h4 { font-size: 15px; }
.ax-answer p { margin: 0 0 12px; }
.ax-answer ul, .ax-answer ol { margin: 0 0 12px; padding-left: 20px; }
.ax-answer li { margin: 3px 0; padding-left: 2px; }
.ax-answer li::marker { color: var(--text-tertiary); }
.ax-answer strong { font-weight: 600; color: var(--text-primary); }
.ax-answer em { color: var(--text-secondary); }
.ax-answer a { color: var(--text-primary); text-decoration: underline; text-decoration-color: var(--ax-line-2); text-underline-offset: 3px; }
.ax-answer a:hover { text-decoration-color: var(--text-primary); }
.ax-answer code { padding: 1px 5px; border-radius: 5px; background: var(--surface-2); font-family: var(--font-mono), ui-monospace, monospace; font-size: 0.86em; }
.ax-answer pre { margin: 0 0 14px; padding: 12px 14px; border: 1px solid var(--ax-line); border-radius: 12px; background: var(--surface-1); overflow-x: auto; font-size: 13px; line-height: 1.55; }
.ax-answer pre code { padding: 0; background: none; font-size: inherit; }
.ax-answer hr { margin: 18px 0; border: 0; border-top: 1px solid var(--ax-line); }
.ax-table-wrap { margin: 4px 0 14px; border: 1px solid var(--ax-line); border-radius: 12px; overflow-x: auto; }
.ax-answer table { width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.5; }
.ax-answer th { text-align: left; font-weight: 600; color: var(--text-primary); background: var(--surface-1); }
.ax-answer th, .ax-answer td { padding: 8px 12px; border-bottom: 1px solid var(--ax-line); vertical-align: top; }
.ax-answer tbody tr:last-child td { border-bottom: 0; }
.ax-w { animation: ax-word 0.28s ease both; }

/* Result cards. */
.ax-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; max-width: 680px; margin: 16px 0 6px; animation: ax-rise 0.4s var(--ease) both; }
@media (max-width: 640px) { .ax-cards { grid-template-columns: 1fr; } }
.ax-card { min-width: 0; padding: 12px; border: 1px solid var(--ax-line); border-radius: 12px; background: var(--surface-1); }
.ax-card-wide { grid-column: 1 / -1; }
.ax-card-wide .ai-tasks { max-width: none; margin: 0; border-radius: 12px; }
.ax-card-k { font: 500 11px/1.4 var(--font-mono), ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
.ax-card-t { margin-top: 4px; font-size: 14px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
.ax-card-m { margin-top: 2px; font-size: 12.5px; color: var(--text-secondary); overflow-wrap: anywhere; }
.ax-card-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.ax-pill {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 0 14px;
  border: 1px solid var(--ax-line-2); border-radius: 999px; background: transparent; color: var(--text-primary);
  font: 500 12.5px/1 var(--font-body), sans-serif; text-decoration: none; cursor: pointer;
}
.ax-pill:hover { background: var(--surface-2); }
.ax-pill--solid { border-color: var(--accent); background: var(--accent); color: var(--accent-contrast); font-weight: 600; }
.ax-pill--solid:hover { background: var(--accent); filter: brightness(0.92); }
.ax-pill:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }

/* Approval card. */
.ax-appr { max-width: 680px; margin-top: 12px; border: 1px solid var(--ax-line-2); border-radius: 14px; overflow: hidden; background: linear-gradient(180deg, color-mix(in srgb, var(--surface-2) 45%, var(--surface-1)), var(--surface-1)); }
.ax-appr-h { display: flex; align-items: center; gap: 8px; padding: 11px 14px; border-bottom: 1px solid var(--ax-line); font-size: 13px; color: var(--text-secondary); }
.ax-appr-h::before { content: ""; flex: none; width: 8px; height: 8px; border-radius: 999px; background: var(--warning); box-shadow: 0 0 10px var(--warning); }
.ax-appr[data-status="approving"] .ax-appr-h::before { background: var(--text-primary); box-shadow: none; animation: ax-pulse 1.4s infinite; }
.ax-act { padding: 11px 14px; border-bottom: 1px solid var(--ax-line); }
.ax-act-t { font-size: 14px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
.ax-act-m { margin-top: 2px; font-size: 12.5px; color: var(--text-secondary); }
.ax-diff { margin-top: 6px; font: 400 12px/1.5 var(--font-mono), ui-monospace, monospace; color: var(--text-secondary); overflow-wrap: anywhere; }
.ax-diff s { color: var(--text-tertiary); }
.ax-diff b { font-weight: 500; color: var(--success); }
.ax-appr-preview { padding: 11px 14px; border-bottom: 1px solid var(--ax-line); }
.ax-appr-f { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 11px 14px; }
.ax-appr-n { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
.ax-appr-note { padding: 0 14px 11px; font-size: 12px; color: var(--text-tertiary); }
.ax-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 0 16px;
  border: 1px solid var(--ax-line-2); border-radius: 999px; background: transparent; color: var(--text-primary);
  font: 500 13px/1 var(--font-body), sans-serif; cursor: pointer;
}
.ax-btn:hover:not(:disabled) { background: var(--surface-2); }
.ax-btn--solid { border-color: var(--accent); background: var(--accent); color: var(--accent-contrast); font-weight: 600; }
.ax-btn--solid:hover:not(:disabled) { background: var(--accent); filter: brightness(0.92); }
.ax-btn--quiet { border-color: transparent; color: var(--text-secondary); }
.ax-btn:disabled { opacity: 0.5; cursor: default; }
.ax-btn:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
.ax-tweak { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 11px 14px; }
.ax-tweak input {
  flex: 1 1 220px; min-width: 0; height: 36px; padding: 0 14px; border: 1px solid var(--ax-line-2); border-radius: 999px;
  background: var(--surface-2); color: var(--text-primary); font: 13px/1 var(--font-body), sans-serif; outline: none;
}
.ax-tweak input:focus { border-color: var(--text-primary); }

/* Follow-ups. */
.ax-rel { max-width: 680px; margin-top: 18px; border-top: 1px solid var(--ax-line); animation: ax-fade 0.4s ease both; }
.ax-rel-h { margin: 14px 0 4px; font: 600 13px/1.3 var(--font-heading), sans-serif; color: var(--text-secondary); }
.ax-rel-i {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 44px; padding: 10px 0;
  border: 0; border-bottom: 1px solid var(--ax-line); background: none; text-align: left;
  font: 14px/1.4 var(--font-body), sans-serif; color: var(--text-secondary); cursor: pointer;
}
.ax-rel-i:hover:not(:disabled) { color: var(--text-primary); }
.ax-rel-i:disabled { opacity: 0.5; cursor: default; }
.ax-rel-i svg { flex: none; color: var(--text-tertiary); }
.ax-rel-i:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; border-radius: 4px; }

/* Composer: pinned at the bottom of the thread, or inside the opening screen. */
.ax-dock { position: relative; flex-shrink: 0; padding: 12px 24px calc(16px + var(--ax-kb, 0px)); }
.ax-dock::before { content: ""; position: absolute; left: 0; right: 0; top: -28px; height: 28px; background: linear-gradient(to top, var(--bg), transparent); pointer-events: none; }
@media (max-width: 640px) { .ax-dock { padding: 10px 12px calc(12px + var(--ax-kb, 0px)); } }
.ax-box {
  max-width: 680px; margin: 0 auto; padding: 14px 12px 10px 18px;
  border: 1px solid var(--ax-line-2); border-radius: 22px; background: var(--surface-2);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.45); transition: border-color 0.15s var(--ease);
}
:root[data-theme="light"] .ax-box { box-shadow: 0 10px 32px rgba(16, 24, 40, 0.1); }
.ax-box:focus-within { border-color: color-mix(in srgb, var(--text-primary) 35%, transparent); }
.ax-box--hero { padding: 12px 12px 9px 16px; border-radius: 20px; }
.ax-input {
  display: block; width: 100%; min-height: 24px; max-height: 200px; padding: 0; resize: none; overflow-y: auto;
  border: 0; outline: none; background: transparent; color: var(--text-primary); font: 15px/1.55 var(--font-body), sans-serif;
}
.ax-input::placeholder { color: var(--text-tertiary); }
.ax-wave canvas { height: 24px !important; border: 0 !important; background: transparent !important; }
.ax-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.ax-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.ax-ic {
  position: relative; flex: none; display: inline-grid; place-items: center; width: 36px; height: 36px;
  border: 1px solid transparent; border-radius: 999px; background: none; color: var(--text-secondary); cursor: pointer;
}
.ax-ic:hover:not(:disabled) { background: var(--surface-3); color: var(--text-primary); }
.ax-ic:disabled { opacity: 0.45; cursor: default; }
.ax-ic[data-recording="true"] { border-color: var(--danger); color: var(--danger); }
.ax-ic:focus-visible, .ax-send:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
.ax-rec-time { font: 500 11px/1 var(--font-mono), ui-monospace, monospace; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
.ax-send {
  flex: none; display: inline-grid; place-items: center; width: 36px; height: 36px; margin-left: auto;
  border: 0; border-radius: 999px; background: var(--accent); color: var(--accent-contrast); cursor: pointer;
}
.ax-send:disabled { opacity: 0.35; cursor: default; }
.ax-hint { max-width: 680px; margin: 8px auto 0; text-align: center; font-size: 11.5px; color: var(--text-tertiary); }
.ax-jump {
  position: absolute; top: -48px; left: 50%; z-index: 2; transform: translateX(-50%);
  display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px;
  border: 1px solid var(--ax-line-2); border-radius: 999px; background: var(--surface-2); color: var(--text-primary);
  font: 500 12.5px/1 var(--font-body), sans-serif; box-shadow: var(--shadow-2); cursor: pointer; animation: ax-fade 0.25s ease both;
}

/* Opening screen. */
.ax-hero { display: flex; flex-direction: column; justify-content: center; min-height: 100%; max-width: 680px; margin: 0 auto; padding: 24px 24px 40px; }
@media (max-width: 640px) { .ax-hero { padding: 16px 16px 24px; } }
.ax-mark {
  display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 16px; border-radius: 13px;
  background: linear-gradient(140deg, var(--text-primary), color-mix(in srgb, var(--text-primary) 55%, var(--bg)));
  color: var(--bg); font: 700 21px/1 var(--font-heading), sans-serif;
  box-shadow: 0 0 50px color-mix(in srgb, var(--text-primary) 12%, transparent);
}
.ax-hello { margin: 0 0 6px; font: 600 26px/1.2 var(--font-heading), sans-serif; letter-spacing: -0.01em; color: var(--text-primary); }
.ax-sub { margin: 0 0 20px; font-size: 14px; color: var(--text-secondary); }
.ax-sug { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
@media (max-width: 480px) { .ax-sug { grid-template-columns: 1fr; } }
.ax-sg {
  min-height: 44px; padding: 10px 12px; border: 1px solid var(--ax-line); border-radius: 12px; background: transparent;
  text-align: left; font: 13px/1.4 var(--font-body), sans-serif; color: var(--text-secondary); cursor: pointer;
  transition: border-color 0.15s var(--ease), color 0.15s var(--ease), background 0.15s var(--ease);
}
.ax-sg:hover:not(:disabled) { border-color: var(--ax-line-2); background: var(--surface-1); color: var(--text-primary); }
.ax-sg:disabled { opacity: 0.5; cursor: default; }
.ax-sg:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
.ax-today { margin-top: 18px; padding: 12px 14px; border: 1px solid var(--ax-line); border-radius: 14px; background: var(--surface-1); }
.ax-today-k { margin-bottom: 6px; font: 500 10.5px/1.4 var(--font-mono), ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
.ax-ti { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; padding: 6px 0; border-top: 1px solid var(--ax-line); font-size: 13.5px; color: var(--text-secondary); text-decoration: none; }
.ax-today-k + .ax-ti { border-top: 0; }
.ax-ti b { font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
a.ax-ti:hover { color: var(--text-primary); }
a.ax-ti:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; border-radius: 4px; }

/* History drawer. */
.ax-scrim { position: fixed; inset: 0; z-index: 60; background: color-mix(in srgb, var(--bg) 55%, transparent); backdrop-filter: blur(2px); }
.ax-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 61; display: flex; flex-direction: column;
  width: min(380px, 100vw); padding: 18px 14px; border-left: 1px solid var(--ax-line-2); background: var(--surface-1);
  box-shadow: -30px 0 60px rgba(0, 0, 0, 0.5);
}
:root[data-theme="light"] .ax-drawer { box-shadow: -24px 0 48px rgba(16, 24, 40, 0.14); }
@media (max-width: 640px) { .ax-drawer { width: 100vw; border-left: 0; } }
.ax-drawer-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.ax-drawer-top b { font: 600 15px/1 var(--font-heading), sans-serif; }
.ax-drawer-actions { display: flex; align-items: center; gap: 4px; }
.ax-new { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--accent); color: var(--accent-contrast); font: 600 12.5px/1 var(--font-body), sans-serif; cursor: pointer; }
.ax-search { display: flex; align-items: center; gap: 8px; height: 38px; margin-bottom: 12px; padding: 0 11px; border: 1px solid var(--ax-line-2); border-radius: 10px; color: var(--text-tertiary); }
.ax-search:focus-within { border-color: var(--text-primary); }
.ax-search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; color: var(--text-primary); font: 13px/1 var(--font-body), sans-serif; }
.ax-hlist { flex: 1; margin: 0 -4px; padding: 0 4px; overflow-y: auto; }
.ax-grp { margin: 12px 4px 4px; font: 500 10.5px/1.4 var(--font-mono), ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
.ax-hi { display: flex; align-items: center; gap: 4px; border-radius: 10px; }
.ax-hi[data-active="true"] { background: var(--surface-3); }
.ax-hi-open {
  flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; padding: 9px 10px;
  border: 0; border-radius: 10px; background: none; text-align: left; font: 13.5px/1.35 var(--font-body), sans-serif; color: var(--text-secondary); cursor: pointer;
}
.ax-hi[data-active="true"] .ax-hi-open, .ax-hi-open:hover { color: var(--text-primary); }
.ax-hi-open:focus-visible { outline: 2px solid var(--text-primary); outline-offset: -2px; }
.ax-hi-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ax-hi-time { flex: none; font: 500 11px/1 var(--font-mono), ui-monospace, monospace; color: var(--text-tertiary); }
.ax-live { flex: none; display: inline-flex; align-items: center; gap: 5px; font: 500 11px/1 var(--font-mono), ui-monospace, monospace; color: var(--success); }
.ax-live::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: var(--success); animation: ax-pulse 1.4s infinite; }
.ax-hi-del { flex: none; display: inline-grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 8px; background: none; color: var(--text-tertiary); opacity: 0; cursor: pointer; }
.ax-hi:hover .ax-hi-del, .ax-hi-del:focus-visible { opacity: 1; }
@media (hover: none) { .ax-hi-del { opacity: 0.7; } }
.ax-hi-del:hover { background: var(--surface-2); color: var(--danger); }
.ax-empty-list { padding: 24px 8px; text-align: center; font-size: 13px; color: var(--text-tertiary); }

@keyframes ax-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes ax-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ax-word { from { opacity: 0; } to { opacity: 1; } }
@keyframes ax-pulse { 50% { opacity: 0.3; } }

@media (prefers-reduced-motion: reduce) {
  .ax-w, .ax-step, .ax-cards, .ax-rel, .ax-jump, .ax-thinking::before, .ax-live::before, .ax-appr-h::before { animation: none !important; }
  .ax-step[data-state="running"] .ax-dot { animation: none !important; border-top-color: var(--text-primary); }
}
```

- [ ] **Step 2: Write `AnswerDocument.tsx`**

```tsx
"use client";

import "./chat.css";
import { Fragment, type ReactNode } from "react";

import { parseBlocks, parseInline, type Inline } from "./markdown";
import { useSmoothText } from "./useSmoothText";

/**
 * Adonis's answer as a document: headings, paragraphs, lists, tables and
 * code, 15.5px at 1.7 line height, no bubble. Built as React nodes from the
 * markdown parser (never raw HTML), so text Adonis quotes from a customer
 * cannot inject markup. While the answer streams, useSmoothText reveals it
 * at an even pace and each new word fades in (an `.ax-w` span mounts once
 * per word; keys are positional, so words already shown never re-animate).
 */
export function AnswerDocument({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const { text: shown, animating } = useSmoothText(text, streaming);
  const blocks = parseBlocks(shown);

  const words = (s: string, key: string): ReactNode => {
    if (!animating) return s;
    return s.split(/(\s+)/).map((w, i) => (w.trim() ? <span key={`${key}w${i}`} className="ax-w">{w}</span> : w));
  };

  const inline = (nodes: Inline[], key: string): ReactNode[] =>
    nodes.map((n, i) => {
      const k = `${key}i${i}`;
      switch (n.kind) {
        case "strong":
          return <strong key={k}>{words(n.text, k)}</strong>;
        case "em":
          return <em key={k}>{words(n.text, k)}</em>;
        case "code":
          return <code key={k}>{n.text}</code>;
        case "link": {
          const external = /^https?:\/\//.test(n.href);
          return (
            <a key={k} href={n.href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
              {n.text}
            </a>
          );
        }
        default:
          return <Fragment key={k}>{words(n.text, k)}</Fragment>;
      }
    });

  return (
    <div className="ax-answer">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case "heading":
            return b.level === 3 ? <h4 key={key}>{inline(parseInline(b.text), key)}</h4> : <h3 key={key}>{inline(parseInline(b.text), key)}</h3>;
          case "paragraph":
            return (
              <p key={key}>
                {b.lines.map((line, j) => (
                  <Fragment key={`${key}l${j}`}>
                    {j > 0 && <br />}
                    {inline(parseInline(line), `${key}l${j}`)}
                  </Fragment>
                ))}
              </p>
            );
          case "list": {
            const items = b.items.map((item, j) => <li key={`${key}li${j}`}>{inline(parseInline(item), `${key}li${j}`)}</li>);
            return b.ordered ? (
              <ol key={key} start={b.start}>
                {items}
              </ol>
            ) : (
              <ul key={key}>{items}</ul>
            );
          }
          case "table":
            return (
              <div key={key} className="ax-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {b.header.map((h, j) => (
                        <th key={`${key}h${j}`}>{inline(parseInline(h), `${key}h${j}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={`${key}r${r}`}>
                        {row.map((cell, j) => (
                          <td key={`${key}r${r}c${j}`}>{inline(parseInline(cell), `${key}r${r}c${j}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "code":
            return (
              <pre key={key}>
                <code>{b.text}</code>
              </pre>
            );
          case "rule":
            return <hr key={key} />;
        }
      })}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors. (Rendering is checked in Task 23.)

- [ ] **Step 4: Commit**

```bash
git add app/src/components/adonis/chat/chat.css app/src/components/adonis/chat/AnswerDocument.tsx
git commit -m "feat(adonis): chat styles and the answer document renderer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Steps panel

**Files:**
- Create: `app/src/components/adonis/chat/StepsPanel.tsx`

**Interfaces:**
- Consumes: `stepRows`, `stepsSummary`, `formatDuration`, `StepRow` (Task 7); `LivePhase` (Task 1); `EASE` from `@/lib/motion`.
- Produces: `StepsPanel(props: { tools: string[]; live: boolean; phase: LivePhase | null; startedAt: number | null; durationMs: number | null; variant: "answer" | "full" })`.
  - `variant="answer"`: while live, a box with "Thinking" (no tool or word yet) or "Working on it", a running timer and the steps (spinner then tick, "Writing the answer" once words flow). It is hidden while words flow for an answer that used no tools. When the run ends, the box holds 900 ms with every step ticked, then folds to one line "Done in 6.2s, 4 steps". An answer that was already finished when the page opened shows the line directly.
  - `variant="full"`: the Steps tab, always the full list.

- [ ] **Step 1: Write `StepsPanel.tsx`**

```tsx
"use client";

import "./chat.css";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";

import { EASE } from "@/lib/motion";
import type { LivePhase } from "@/lib/agents/liveEvents";
import { formatDuration, stepRows, stepsSummary, type StepRow } from "./exchanges";

/** How long the finished steps stay up before folding to one line, so the last tick is seen. */
const FOLD_AFTER_MS = 900;

function useElapsed(startedAt: number | null, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [live]);
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}

function Rows({ rows }: { rows: StepRow[] }) {
  return (
    <ol className="ax-step-list">
      {rows.map((r) => (
        <li key={r.key} className="ax-step" data-state={r.state}>
          <span className="ax-dot" aria-hidden>
            {r.state === "done" && <Check size={10} strokeWidth={3.5} />}
          </span>
          {r.label}
        </li>
      ))}
    </ol>
  );
}

export type StepsPanelProps = {
  tools: string[];
  live: boolean;
  phase: LivePhase | null;
  startedAt: number | null;
  durationMs: number | null;
  variant: "answer" | "full";
};

/**
 * What Adonis is doing, so waiting is never a blank pause: "Thinking" with a
 * timer before the first tool or word, then each tool as a plain label with a
 * spinner and then a tick. Folds to "Done in 6.2s, 4 steps" when the answer
 * is complete.
 */
export function StepsPanel({ tools, live, phase, startedAt, durationMs, variant }: StepsPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const rows = stepRows(tools, live, phase);
  const elapsed = useElapsed(startedAt, live);
  const summary = stepsSummary(durationMs, tools.length);
  const thinking = live && tools.length === 0 && phase !== "writing";
  const [holding, setHolding] = useState(false);
  const wasLive = useRef(live);

  useEffect(() => {
    const was = wasLive.current;
    wasLive.current = live;
    if (!was || live) return;
    setHolding(true);
    const t = setTimeout(() => setHolding(false), reduced ? 0 : FOLD_AFTER_MS);
    return () => clearTimeout(t);
  }, [live, reduced]);

  const header = (
    <div className="ax-steps-h">
      <span className={thinking ? "ax-thinking" : undefined}>{live ? (thinking ? "Thinking" : "Working on it") : summary}</span>
      {live && <span className="ax-timer">{formatDuration(elapsed)}</span>}
    </div>
  );

  if (variant === "full") {
    return (
      <div className="ax-steps">
        {header}
        {rows.length > 0 ? <Rows rows={rows} /> : !live && <p className="ax-steps-none">Adonis answered without looking anything up.</p>}
      </div>
    );
  }

  const showBox = live ? !(tools.length === 0 && phase === "writing") : holding;
  const showLine = !live && !holding && (tools.length > 0 || durationMs !== null);
  const transition = { duration: reduced ? 0 : 0.3, ease: EASE };

  return (
    <AnimatePresence initial={false} mode="wait">
      {showBox ? (
        <motion.div
          key="box"
          className="ax-steps"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
          transition={transition}
        >
          {header}
          {rows.length > 0 && <Rows rows={rows} />}
        </motion.div>
      ) : showLine ? (
        <motion.div key="line" className="ax-done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={transition}>
          <span className="ax-dot" aria-hidden>
            <Check size={9} strokeWidth={3.5} />
          </span>
          {summary}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/adonis/chat/StepsPanel.tsx
git commit -m "feat(adonis): a live steps panel that folds away when the answer is done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Approval card

**Files:**
- Create: `app/src/components/adonis/chat/ApprovalCard.tsx`

**Interfaces:**
- Consumes: `actionChanges`, `campaignAction` (Task 7); `toolLabel` (Task 7); `AdApprovalPreview({ name, input })` from `@/components/ads/AdApprovalPreview` (existing); `ConvMessage`.
- Produces: `ApprovalCard(props: { pending: NonNullable<ConvMessage["pending"]>; busy: boolean; canApprove: boolean; onApprove: () => void; onApproveAll: () => void; onCancel: () => void; onChange: (tweak: string) => void })`. Rendered only for `awaiting` / `approving` cards. "Change it" opens a one-line input; Enter or the button calls `onChange(tweak)` (empty tweak allowed only for a campaign card, where it means "write it again").

- [ ] **Step 1: Write `ApprovalCard.tsx`**

```tsx
"use client";

import "./chat.css";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { AdApprovalPreview } from "@/components/ads/AdApprovalPreview";
import type { ConvMessage } from "@/lib/agents/conversationModel";
import { actionChanges, campaignAction } from "./approvalModel";
import { toolLabel } from "./toolLabels";

type Pending = NonNullable<ConvMessage["pending"]>;

export type ApprovalCardProps = {
  pending: Pending;
  busy: boolean;
  /** Approvals run writes and are admin-only (the route returns 403 otherwise). */
  canApprove: boolean;
  onApprove: () => void;
  /** "Approve and build everything" on a campaign plan. */
  onApproveAll: () => void;
  onCancel: () => void;
  /** "Change it": a campaign card is written again with the tweak; any other card is cancelled and the words sent as a message. */
  onChange: (tweak: string) => void;
};

/**
 * Something Adonis wants to change, waiting for the operator. Nothing has
 * run yet: the write-approval gate holds every write until Approve. Each
 * action shows its summary, old and new text where the write carries both,
 * and a preview of any ad it would save.
 */
export function ApprovalCard({ pending, busy, canApprove, onApprove, onApproveAll, onCancel, onChange }: ApprovalCardProps) {
  const [changing, setChanging] = useState(false);
  const [tweak, setTweak] = useState("");
  const approving = pending.status === "approving";
  const campaign = campaignAction(pending.actions);
  const n = pending.actions.length;
  const canSubmit = !busy && (campaign !== null || tweak.trim().length > 0);

  function submit() {
    if (!canSubmit) return;
    onChange(tweak);
    setChanging(false);
    setTweak("");
  }

  return (
    <section className="ax-appr" data-status={pending.status} aria-label="Waiting for your approval">
      <div className="ax-appr-h">{approving ? "Running what you approved" : "Waiting for your OK, nothing has changed yet"}</div>
      {pending.actions.map((a, i) => {
        const { changes, more } = actionChanges(a);
        return (
          <div className="ax-act" key={`a${i}`}>
            <div className="ax-act-t">{a.summary || toolLabel(a.name)}</div>
            <div className="ax-act-m">{toolLabel(a.name)}</div>
            {changes.map((c, k) => (
              <div className="ax-diff" key={`d${k}`}>
                <s>{c.from}</s> <b>{c.to}</b>
              </div>
            ))}
            {more > 0 && <div className="ax-diff">and {more} more</div>}
          </div>
        );
      })}
      {pending.actions
        .filter((a) => a.name === "draft_ad_campaign" || a.name === "add_ad_to_campaign")
        .map((a, i) => (
          <div className="ax-appr-preview" key={`ad${i}`}>
            <AdApprovalPreview name={a.name} input={a.input} />
          </div>
        ))}
      {changing ? (
        <div className="ax-tweak">
          <input
            autoFocus
            value={tweak}
            onChange={(e) => setTweak(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setChanging(false);
              }
            }}
            placeholder={campaign ? "What should be different? You can leave this empty." : "What should change?"}
            aria-label="What should change"
          />
          <button type="button" className="ax-btn ax-btn--quiet" onClick={() => setChanging(false)}>
            Back
          </button>
          <button type="button" className="ax-btn ax-btn--solid" onClick={submit} disabled={!canSubmit}>
            {campaign ? "Write it again" : "Send"}
          </button>
        </div>
      ) : (
        <div className="ax-appr-f">
          <button type="button" className="ax-btn ax-btn--solid" onClick={onApprove} disabled={!canApprove || approving || busy}>
            {approving && <Loader2 size={14} className="spin" aria-hidden />}
            Approve
          </button>
          {campaign?.name === "create_campaign" && (
            <button
              type="button"
              className="ax-btn"
              onClick={onApproveAll}
              disabled={!canApprove || approving || busy}
              title="Approve the plan and every asset as it is written. Adonis still asks before launching, scheduling or sending anything."
            >
              Approve and build everything
            </button>
          )}
          <button type="button" className="ax-btn" onClick={() => setChanging(true)} disabled={approving || busy}>
            Change it
          </button>
          <button type="button" className="ax-btn ax-btn--quiet" onClick={onCancel} disabled={approving}>
            Cancel
          </button>
          <span className="ax-appr-n">{n === 1 ? "1 change" : `${n} changes`}</span>
        </div>
      )}
      {!canApprove && !approving && <div className="ax-appr-note">Only an admin can approve changes.</div>}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/adonis/chat/ApprovalCard.tsx
git commit -m "feat(adonis): an approval card that shows each change before it runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Result cards, campaign checklist and follow-ups

**Files:**
- Create: `app/src/components/adonis/chat/CampaignChecklist.tsx` (moved from `AssistantChat.tsx:1014-1062`, unchanged behaviour)
- Create: `app/src/components/adonis/chat/ResultCards.tsx`
- Create: `app/src/components/adonis/chat/FollowUps.tsx`

**Interfaces:**
- Consumes: `CampaignProgress` from `@/components/messaging/campaignProgress`; `Button` from `@/components/ui/Button`; `ConvArtifact`.
- Produces:
  - `CampaignChecklist(props: { progress: CampaignProgress; working: boolean; onBuildRest?: () => void })` (uses the existing `.ai-tasks*` classes in globals.css)
  - `ResultCards(props: { artifacts: ConvArtifact[]; campaign?: ReactNode })` — renders nothing when both are empty
  - `FollowUps(props: { items: string[]; disabled: boolean; onPick: (text: string) => void })` — renders nothing for an empty list

- [ ] **Step 1: Write `CampaignChecklist.tsx`**

```tsx
"use client";

import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import type { CampaignProgress } from "@/components/messaging/campaignProgress";

/**
 * The campaign being built, as a checklist: ticked when done, spinning on the
 * one Adonis is working on, empty for what is next. Shown in the latest
 * exchange's results, so it moves down the chat as work goes on. Moved here
 * unchanged from the old AssistantChat.
 */
export function CampaignChecklist({
  progress,
  working,
  onBuildRest,
}: {
  progress: CampaignProgress;
  working: boolean;
  /** Finish a part-built campaign on the server without stopping (shown when nothing is running). */
  onBuildRest?: () => void;
}) {
  const done = progress.assets.filter((a) => a.status === "done").length;
  const total = progress.assets.length;
  const finished = done === total;
  return (
    <div className="ai-tasks" role="status" aria-label={`${progress.name}: ${done} of ${total} done`}>
      <div className="ai-tasks-head">
        <span className="ai-tasks-name">{progress.name}</span>
        <span className="ai-tasks-count">{finished ? "All done" : `${done} of ${total} done`}</span>
      </div>
      <div className="ai-tasks-bar" aria-hidden>
        <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <ol className="ai-tasks-list">
        {progress.assets.map((a, idx) => (
          <li key={`${idx}-${a.kind}`} data-status={a.status}>
            <span className="ai-task-icon" aria-hidden>
              {a.status === "done" ? <Check size={12} strokeWidth={3} /> : a.status === "current" && working ? <Loader2 size={13} className="spin" /> : null}
            </span>
            <span className="ai-task-title">{a.title}</span>
            {a.status === "current" && <span className="ai-task-now">{working ? "Working on it" : "Next"}</span>}
          </li>
        ))}
      </ol>
      {!finished && !working && onBuildRest && (
        <div className="ai-tasks-foot">
          <Button size="sm" variant="secondary" onClick={onBuildRest}>
            Build the rest
          </Button>
          <span>Approves each asset as it&rsquo;s written, even if you leave this page. Launching still asks you.</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write `ResultCards.tsx`**

```tsx
"use client";

import "./chat.css";
import type { ReactNode } from "react";
import { Download } from "lucide-react";

import type { ConvArtifact } from "@/lib/agents/conversationModel";

/** What an answer produced, as cards under it: files to download and, on the latest exchange, the campaign checklist. */
export function ResultCards({ artifacts, campaign }: { artifacts: ConvArtifact[]; campaign?: ReactNode }) {
  if (artifacts.length === 0 && !campaign) return null;
  return (
    <div className="ax-cards">
      {campaign && <div className="ax-card-wide">{campaign}</div>}
      {artifacts.map((a) => (
        <div className="ax-card" key={a.url}>
          <div className="ax-card-k">File</div>
          <div className="ax-card-t">{a.label || a.filename}</div>
          <div className="ax-card-m">{a.filename}</div>
          <div className="ax-card-btns">
            <a className="ax-pill ax-pill--solid" href={a.url} download={a.filename}>
              <Download size={13} strokeWidth={2} aria-hidden />
              Download
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write `FollowUps.tsx`**

```tsx
"use client";

import "./chat.css";
import { Plus } from "lucide-react";

/** Up to three next questions Adonis suggested; a click asks it. */
export function FollowUps({ items, disabled, onPick }: { items: string[]; disabled: boolean; onPick: (text: string) => void }) {
  if (items.length === 0) return null;
  return (
    <nav className="ax-rel" aria-label="Follow up">
      <div className="ax-rel-h">Follow up</div>
      {items.map((t) => (
        <button key={t} type="button" className="ax-rel-i" disabled={disabled} onClick={() => onPick(t)}>
          <span>{t}</span>
          <Plus size={15} strokeWidth={1.75} aria-hidden />
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/adonis/chat/CampaignChecklist.tsx app/src/components/adonis/chat/ResultCards.tsx app/src/components/adonis/chat/FollowUps.tsx
git commit -m "feat(adonis): result cards, campaign checklist and follow-up buttons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Exchange (question headline, tabs, folding)

**Files:**
- Create: `app/src/components/adonis/chat/Exchange.tsx`

**Interfaces:**
- Consumes: `ChatExchange`, `ExchangeReply`, `firstSentence` (Task 7); `AnswerDocument` (Task 11); `StepsPanel` (Task 12); `ApprovalCard` (Task 13); `ResultCards`, `FollowUps` (Task 14); `LivePhase` (Task 1).
- Produces:
  - `type ExchangeActions = { onApprove: (index: number) => void; onApproveAll: (index: number) => void; onCancel: (index: number) => void; onChange: (index: number, tweak: string) => void; onFollowUp: (text: string) => void }` (indexes are message indexes in the conversation)
  - `Exchange(props: { exchange: ChatExchange; live: boolean; phases: Record<number, LivePhase>; isLast: boolean; folded: boolean; onToggleFold?: () => void; busy: boolean; canApprove: boolean; campaign?: ReactNode; actions: ExchangeActions })`
  - The root element carries `data-exchange={exchange.key}` (useChatScroll finds it by that) and the class `ax-ex--last` when `isLast`.

- [ ] **Step 1: Write `Exchange.tsx`**

```tsx
"use client";

import "./chat.css";
import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Paperclip } from "lucide-react";

import type { LivePhase } from "@/lib/agents/liveEvents";
import { AnswerDocument } from "./AnswerDocument";
import { ApprovalCard } from "./ApprovalCard";
import { FollowUps } from "./FollowUps";
import { ResultCards } from "./ResultCards";
import { StepsPanel } from "./StepsPanel";
import { firstSentence, type ChatExchange, type ExchangeReply } from "./exchanges";

export type ExchangeActions = {
  onApprove: (index: number) => void;
  onApproveAll: (index: number) => void;
  onCancel: (index: number) => void;
  onChange: (index: number, tweak: string) => void;
  onFollowUp: (text: string) => void;
};

export type ExchangeProps = {
  exchange: ChatExchange;
  /** Adonis is working on this exchange now. */
  live: boolean;
  phases: Record<number, LivePhase>;
  isLast: boolean;
  /** An earlier exchange shown as one line (question and first sentence). */
  folded: boolean;
  onToggleFold?: () => void;
  busy: boolean;
  canApprove: boolean;
  /** The campaign checklist, on the latest exchange only. */
  campaign?: ReactNode;
  actions: ExchangeActions;
};

type Tab = "answer" | "steps" | "results";

function openCard(r: ExchangeReply): boolean {
  const s = r.message.pending?.status;
  return s === "awaiting" || s === "approving";
}

/**
 * One question and its answer, as a page: the question as a headline, tabs
 * Answer / Steps / Results, the steps panel, the answer as a document, any
 * Approve card under the reply that asked for it, result cards and, on the
 * latest finished exchange, follow-up suggestions.
 */
export function Exchange({ exchange: x, live, phases, isLast, folded, onToggleFold, busy, canApprove, campaign, actions }: ExchangeProps) {
  const [tab, setTab] = useState<Tab>("answer");
  const lastReply = x.replies[x.replies.length - 1];
  const phase: LivePhase | null = live && lastReply ? (phases[lastReply.index] ?? null) : null;
  const cards = x.replies.filter(openCard);
  const resultCount = x.artifacts.length + cards.length + (campaign ? 1 : 0);
  const shownTab: Tab = tab === "results" && resultCount === 0 ? "answer" : tab;

  if (folded) {
    const summary = firstSentence(x.replies.map((r) => r.body).find((b) => b.trim()) ?? "");
    return (
      <div className="ax-ex" data-exchange={x.key}>
        <button type="button" className="ax-fold" onClick={onToggleFold} aria-expanded={false}>
          <b>
            <span>{x.question || "Adonis"}</span>
            <ChevronDown size={15} strokeWidth={1.75} aria-hidden />
          </b>
          {summary || "Open to read the answer."}
        </button>
      </div>
    );
  }

  const card = (r: ExchangeReply) =>
    r.message.pending ? (
      <ApprovalCard
        key={`card${r.index}`}
        pending={r.message.pending}
        busy={busy}
        canApprove={canApprove}
        onApprove={() => actions.onApprove(r.index)}
        onApproveAll={() => actions.onApproveAll(r.index)}
        onCancel={() => actions.onCancel(r.index)}
        onChange={(tweak) => actions.onChange(r.index, tweak)}
      />
    ) : null;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "answer", label: "Answer" },
    { id: "steps", label: "Steps", count: x.tools.length },
    ...(resultCount > 0 ? [{ id: "results" as const, label: "Results", count: resultCount }] : []),
  ];

  return (
    <div className={isLast ? "ax-ex ax-ex--last" : "ax-ex"} data-exchange={x.key}>
      {x.question && <h2 className="ax-q">{x.question}</h2>}
      {x.attached.length > 0 && (
        <div className="ax-attached">
          {x.attached.map((a) => (
            <span key={a.id} className="ax-chip" title={`${a.name} (${a.kind})`}>
              <Paperclip size={12} strokeWidth={2} aria-hidden />
              <span>{a.name}</span>
            </span>
          ))}
        </div>
      )}
      <div className="ax-tabs" role="tablist" aria-label="Answer views">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${x.key}-tab-${t.id}`}
            aria-controls={`${x.key}-panel`}
            aria-selected={shownTab === t.id}
            className="ax-tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count !== undefined && <span className="ax-count">{t.count}</span>}
          </button>
        ))}
        {!isLast && onToggleFold && (
          <button type="button" className="ax-tab ax-tab--end" onClick={onToggleFold} aria-expanded>
            Fold
            <ChevronUp size={14} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>
      <div role="tabpanel" id={`${x.key}-panel`} aria-labelledby={`${x.key}-tab-${shownTab}`}>
        {shownTab === "answer" && (
          <>
            <StepsPanel variant="answer" tools={x.tools} live={live} phase={phase} startedAt={x.startedAt} durationMs={x.durationMs} />
            {x.replies.map((r) => (
              <Fragment key={r.index}>
                {r.body && <AnswerDocument text={r.body} streaming={live && r === lastReply} />}
                {openCard(r) && card(r)}
              </Fragment>
            ))}
            <ResultCards artifacts={x.artifacts} campaign={campaign} />
            {isLast && !live && <FollowUps items={x.followups} disabled={busy} onPick={actions.onFollowUp} />}
          </>
        )}
        {shownTab === "steps" && (
          <StepsPanel variant="full" tools={x.tools} live={live} phase={phase} startedAt={x.startedAt} durationMs={x.durationMs} />
        )}
        {shownTab === "results" && (
          <>
            {cards.map((r) => card(r))}
            <ResultCards artifacts={x.artifacts} campaign={campaign} />
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/adonis/chat/Exchange.tsx
git commit -m "feat(adonis): each exchange as a headline with Answer, Steps and Results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Composer

**Files:**
- Create: `app/src/components/adonis/chat/Composer.tsx`

**Interfaces:**
- Consumes: `useVoiceInput(onTranscript)` returning `{ state: "idle" | "recording" | "transcribing"; elapsedLabel: string; toggle: () => void; stream: MediaStream | null }` and `appendTranscript(current, text)` (existing, `components/messaging`); `Soundwave({ stream })` (existing); `Tooltip({ label, children })` (existing, needs the layout's `TooltipProvider`).
- Produces:
  - `type ComposerAttachment = { id: number; name: string; kind: string }`, `ATTACH_ACCEPT: string`
  - `Composer(props: { value: string; onChange: (value: string) => void; onSend: () => void; onStop?: () => void; busy: boolean; running: boolean; attachments: ComposerAttachment[]; attaching: boolean; onAttach: (files: File[]) => void; onRemoveAttachment: (id: number) => void; voiceEnabled: boolean; modelChip?: ReactNode; placeholder: string; variant?: "hero" | "dock"; hint?: string })`
  - Enter sends (not while composing with an IME, not while recording or transcribing, not while busy); Shift+Enter is a new line. While `running && onStop`, the send button becomes Stop.

- [ ] **Step 1: Write `Composer.tsx`**

```tsx
"use client";

import "./chat.css";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowUp, Loader2, Mic, Paperclip, Square, X } from "lucide-react";

import { Soundwave } from "@/components/messaging/Soundwave";
import { appendTranscript } from "@/components/messaging/voiceInput";
import { useVoiceInput } from "@/components/messaging/useVoiceInput";
import { Tooltip } from "@/components/ui/Tooltip";

export type ComposerAttachment = { id: number; name: string; kind: string };

/** What the media library takes from the chat (same list as before). */
export const ATTACH_ACCEPT =
  "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,application/pdf,text/plain,text/csv,text/markdown,application/json,.docx,.xlsx,.pptx";

export type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** Shown in place of Send while Adonis is working. */
  onStop?: () => void;
  /** A run is going or a request is in flight: no sending. */
  busy: boolean;
  running: boolean;
  attachments: ComposerAttachment[];
  attaching: boolean;
  onAttach: (files: File[]) => void;
  onRemoveAttachment: (id: number) => void;
  /** Server-computed (transcribeConfigured); the mic only shows when transcription can run. */
  voiceEnabled: boolean;
  modelChip?: ReactNode;
  placeholder: string;
  variant?: "hero" | "dock";
  hint?: string;
};

/**
 * One rounded box: attachment chips above the text, then attach, voice, the
 * model chip and send (or stop). The box grows with the text up to 200px.
 * Voice records, transcribes and appends the words for the operator to
 * review; it never sends by itself.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  running,
  attachments,
  attaching,
  onAttach,
  onRemoveAttachment,
  voiceEnabled,
  modelChip,
  placeholder,
  variant = "dock",
  hint,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  // Set when a transcript lands; consumed once the new value is in the textarea, so the caret goes after it.
  const focusAfterVoice = useRef(false);
  const voice = useVoiceInput((text) => {
    onChange(appendTranscript(valueRef.current, text));
    focusAfterVoice.current = true;
  });

  useEffect(() => {
    if (!focusAfterVoice.current) return;
    focusAfterVoice.current = false;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [value]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, voice.state]);

  const recording = voice.state === "recording";
  const canSend = !busy && voice.state === "idle" && (value.trim().length > 0 || attachments.length > 0);

  return (
    <div>
      <div className={variant === "hero" ? "ax-box ax-box--hero" : "ax-box"}>
        {attachments.length > 0 && (
          <div className="ax-attachments">
            {attachments.map((a) => (
              <span key={a.id} className="ax-chip">
                <Paperclip size={12} strokeWidth={2} aria-hidden />
                <span>{a.name}</span>
                <button type="button" onClick={() => onRemoveAttachment(a.id)} aria-label={`Remove ${a.name}`}>
                  <X size={12} strokeWidth={2} />
                </button>
              </span>
            ))}
          </div>
        )}
        {recording && voice.stream ? (
          <div className="ax-wave">
            <Soundwave stream={voice.stream} />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            className="ax-input"
            rows={1}
            value={value}
            placeholder={placeholder}
            aria-label="Message Adonis"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
          />
        )}
        <div className="ax-row">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={ATTACH_ACCEPT}
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (files.length) onAttach(files);
            }}
          />
          <Tooltip label="Attach a file">
            <button type="button" className="ax-ic" onClick={() => fileRef.current?.click()} disabled={busy || attaching} aria-label="Attach a file">
              {attaching ? <Loader2 size={16} className="spin" /> : <Paperclip size={16} strokeWidth={1.9} />}
            </button>
          </Tooltip>
          {voiceEnabled && (
            <Tooltip label={recording ? "Stop and transcribe" : "Speak instead of typing"}>
              <button
                type="button"
                className="ax-ic"
                data-recording={recording}
                onClick={voice.toggle}
                disabled={voice.state === "transcribing" || (voice.state === "idle" && busy)}
                aria-label={recording ? "Stop and transcribe" : "Start voice input"}
              >
                {voice.state === "transcribing" ? (
                  <Loader2 size={16} className="spin" />
                ) : recording ? (
                  <Square size={13} strokeWidth={2} fill="currentColor" />
                ) : (
                  <Mic size={16} strokeWidth={1.9} />
                )}
              </button>
            </Tooltip>
          )}
          {recording && (
            <span className="ax-rec-time" aria-hidden>
              {voice.elapsedLabel}
            </span>
          )}
          {modelChip}
          {running && onStop ? (
            <Tooltip label="Stop">
              <button type="button" className="ax-send" onClick={onStop} aria-label="Stop Adonis">
                <Square size={12} strokeWidth={2} fill="currentColor" />
              </button>
            </Tooltip>
          ) : (
            <button type="button" className="ax-send" onClick={onSend} disabled={!canSend} aria-label="Send">
              {busy ? <Loader2 size={16} className="spin" /> : <ArrowUp size={17} strokeWidth={2.2} />}
            </button>
          )}
        </div>
      </div>
      {hint && <div className="ax-hint">{hint}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/adonis/chat/Composer.tsx
git commit -m "feat(adonis): one rounded composer with attach, voice, model and send or stop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: History drawer

**Files:**
- Create: `app/src/components/adonis/chat/HistoryDrawer.tsx`

**Interfaces:**
- Consumes: `groupHistory`, `filterHistory`, `historyTimeLabel` (Task 8); `ConversationSummary`; `EASE`.
- Produces: `HistoryDrawer(props: { open: boolean; onClose: () => void; items: ConversationSummary[]; activeId: string; onOpen: (id: string) => void; onNew: () => void; onDelete: (id: string) => void; now?: number })`. Portalled to `document.body` (the app shell's page transition uses transforms, which would trap a fixed element). Escape and the scrim close it; the search box takes focus on open.

- [ ] **Step 1: Write `HistoryDrawer.tsx`**

```tsx
"use client";

import "./chat.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Plus, Search, Trash2, X } from "lucide-react";

import { EASE } from "@/lib/motion";
import type { ConversationSummary } from "@/lib/agents/conversationModel";
import { filterHistory, groupHistory, historyTimeLabel } from "./history";

export type HistoryDrawerProps = {
  open: boolean;
  onClose: () => void;
  items: ConversationSummary[];
  activeId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  /** For screenshots with fixed data; defaults to the current time. */
  now?: number;
};

/**
 * Chats, from the right: search, New chat, grouped by Irish day (Today /
 * Yesterday / Earlier), a live "Working" tag on chats Adonis is still
 * working in. Full width on a phone.
 */
export function HistoryDrawer({ open, onClose, items, activeId, onOpen, onNew, onDelete, now }: HistoryDrawerProps) {
  const reduced = useReducedMotion() ?? false;
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const focus = setTimeout(() => searchRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(focus);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!mounted) return null;
  const at = now ?? Date.now();
  const groups = groupHistory(filterHistory(items, query), at);
  const t = { duration: reduced ? 0 : 0.28, ease: EASE };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="ax-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t} />
          <motion.aside
            key="drawer"
            className="ax-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Chats"
            initial={{ x: reduced ? 0 : "100%" }}
            animate={{ x: 0 }}
            exit={{ x: reduced ? 0 : "100%" }}
            transition={t}
          >
            <div className="ax-drawer-top">
              <b>Chats</b>
              <div className="ax-drawer-actions">
                <button type="button" className="ax-new" onClick={onNew}>
                  <Plus size={14} strokeWidth={2} aria-hidden />
                  New chat
                </button>
                <button type="button" className="ax-ic" onClick={onClose} aria-label="Close chats">
                  <X size={16} strokeWidth={1.9} />
                </button>
              </div>
            </div>
            <label className="ax-search">
              <Search size={14} strokeWidth={1.9} aria-hidden />
              <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
            </label>
            <div className="ax-hlist">
              {groups.length === 0 ? (
                <div className="ax-empty-list">{query.trim() ? "No chats match that." : "No chats yet."}</div>
              ) : (
                groups.map((g) => (
                  <section key={g.label} aria-label={g.label}>
                    <div className="ax-grp">{g.label}</div>
                    {g.items.map((c) => (
                      <div key={c.id} className="ax-hi" data-active={c.id === activeId}>
                        <button type="button" className="ax-hi-open" onClick={() => onOpen(c.id)} aria-current={c.id === activeId ? "true" : undefined}>
                          <span className="ax-hi-title">{c.title || "Untitled"}</span>
                          {c.running ? <span className="ax-live">Working</span> : <span className="ax-hi-time">{historyTimeLabel(c.updatedAt, at)}</span>}
                        </button>
                        {!c.running && (
                          <button type="button" className="ax-hi-del" onClick={() => onDelete(c.id)} aria-label={`Delete ${c.title || "this chat"}`}>
                            <Trash2 size={14} strokeWidth={1.9} />
                          </button>
                        )}
                      </div>
                    ))}
                  </section>
                ))
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/adonis/chat/HistoryDrawer.tsx
git commit -m "feat(adonis): a history drawer with search, day groups and running chats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 18: "Needs you today" counts and their route

**Files:**
- Create: `app/src/lib/adonis/todayModel.ts`
- Create: `app/src/lib/adonis/today.ts`
- Create: `app/src/app/api/adonis/today/route.ts`
- Test: `app/src/lib/adonis/todayModel.test.ts`

**Interfaces:**
- Consumes: `listConversations()` from `@/lib/conversations` (existing; `{ kind, lastDirection, needsAttention, ... }[]` for the current tenant); `getStripeConnection(tenantId)` from `@/lib/stripe/connection` (`{ accountId, ... } | null`); `offerOrders`, `voucherOrders` from `@/lib/db/schema`; `db` from `@/lib/db`; `guard` from `@/lib/api/guard`; `getCurrentMembership` from `@/lib/auth`; `dublinDay` (`@/lib/cashModel`), `dublinToMs` (`@/lib/remindersModel`).
- Produces:
  - `type TodayCounts = { leadsWaiting: number; draftsToApprove: number; salesCents: number | null; salesCount: number | null }` (sales null for non-admins)
  - `weekStartDublin(now: number): number`, `countInbox(rows: { kind: "lead" | "client"; lastDirection: string; needsAttention: boolean }[]): { leadsWaiting: number; draftsToApprove: number }`, `formatEuros(cents: number): string`
  - `getTodayCounts(o: { tenantId: number; withSales: boolean; now?: number }): TodayCounts`
  - `GET /api/adonis/today` → `{ ok: true, today: TodayCounts }`; 401/403/402/409 from `guard("user")`; 500 `{ ok: false, error }`.

- [ ] **Step 1: Write the failing test**

`app/src/lib/adonis/todayModel.test.ts`:

```ts
// Run: npm test -- src/lib/adonis/todayModel.test.ts
//
// The opening screen's "Needs you today": the week starts Monday 00:00 Irish
// time; leads waiting are lead conversations whose last message came in;
// drafts to approve are the inbox's unresolved AI drafts.
import assert from "node:assert/strict";

import { countInbox, formatEuros, weekStartDublin } from "./todayModel";

assert.equal(weekStartDublin(Date.UTC(2026, 10, 24, 15, 0)), Date.UTC(2026, 10, 23, 0, 0), "Tuesday: back to Monday (Irish winter time is UTC)");
assert.equal(weekStartDublin(Date.UTC(2026, 10, 29, 22, 0)), Date.UTC(2026, 10, 23, 0, 0), "Sunday belongs to the week that started Monday");
assert.equal(weekStartDublin(Date.UTC(2026, 10, 23, 0, 30)), Date.UTC(2026, 10, 23, 0, 0), "Monday just after midnight");
assert.equal(weekStartDublin(Date.UTC(2026, 6, 1, 10, 0)), Date.UTC(2026, 5, 28, 23, 0), "summer: Monday 00:00 in Dublin is 23:00 UTC on Sunday");
assert.equal(weekStartDublin(Date.UTC(2026, 5, 28, 23, 30)), Date.UTC(2026, 5, 28, 23, 0), "00:30 Monday in Dublin is already the new week");

assert.deepEqual(
  countInbox([
    { kind: "lead", lastDirection: "inbound", needsAttention: true },
    { kind: "lead", lastDirection: "outbound", needsAttention: false },
    { kind: "client", lastDirection: "inbound", needsAttention: true },
    { kind: "lead", lastDirection: "inbound", needsAttention: false },
    { kind: "lead", lastDirection: "note", needsAttention: false },
  ]),
  { leadsWaiting: 2, draftsToApprove: 2 },
);
assert.deepEqual(countInbox([]), { leadsWaiting: 0, draftsToApprove: 0 });

assert.equal(formatEuros(78400), "€784");
assert.equal(formatEuros(1250), "€12.50");
assert.equal(formatEuros(0), "€0");

console.log("todayModel: all checks passed");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/adonis/todayModel.test.ts`
Expected: FAIL with `Cannot find module './todayModel'`.

- [ ] **Step 3: Write `todayModel.ts`**

```ts
/**
 * The "Needs you today" panel on the /adonis opening screen, as pure rules
 * (lib/adonis/today.ts reads the rows). Irish time throughout.
 */

import { dublinDay } from "@/lib/cashModel";
import { dublinToMs } from "@/lib/remindersModel";

export type TodayCounts = {
  /** Lead conversations (WhatsApp, Messenger, Instagram) whose latest message came in. */
  leadsWaiting: number;
  /** Conversations whose latest inbound message has an AI draft waiting (drafted or held). */
  draftsToApprove: number;
  /** Paid offer and voucher orders since Monday; null for staff who are not admins. */
  salesCents: number | null;
  salesCount: number | null;
};

/** Monday 00:00 in Dublin, for the week `now` is in. */
export function weekStartDublin(now: number): number {
  const [y, m, d] = dublinDay(now).split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 is Sunday
  const back = (dow + 6) % 7;
  const monday = new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10);
  return dublinToMs(monday, "00:00");
}

export function countInbox(rows: { kind: "lead" | "client"; lastDirection: string; needsAttention: boolean }[]): {
  leadsWaiting: number;
  draftsToApprove: number;
} {
  return {
    leadsWaiting: rows.filter((r) => r.kind === "lead" && r.lastDirection === "inbound").length,
    draftsToApprove: rows.filter((r) => r.needsAttention).length,
  };
}

export function formatEuros(cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `cd app && npm test -- src/lib/adonis/todayModel.test.ts`
Expected: PASS, `todayModel: all checks passed`.

- [ ] **Step 5: Write `today.ts`**

```ts
import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { offerOrders, voucherOrders } from "@/lib/db/schema";
import { listConversations } from "@/lib/conversations";
import { getStripeConnection } from "@/lib/stripe/connection";
import { countInbox, weekStartDublin, type TodayCounts } from "./todayModel";

/**
 * The three numbers on the /adonis opening screen, for the CURRENT tenant
 * (ambient db). Sales count paid offer orders and paid voucher orders since
 * Monday 00:00 Irish time, on the Stripe account connected now, so test-mode
 * sales on an old account are not counted. A business with no Stripe
 * connection has no sales.
 */
export function getTodayCounts(o: { tenantId: number; withSales: boolean; now?: number }): TodayCounts {
  const inbox = countInbox(listConversations());
  if (!o.withSales) return { ...inbox, salesCents: null, salesCount: null };
  const conn = getStripeConnection(o.tenantId);
  if (!conn) return { ...inbox, salesCents: 0, salesCount: 0 };
  const since = weekStartDublin(o.now ?? Date.now());
  const offers = db
    .select({ n: sql<number>`count(*)`, cents: sql<number>`coalesce(sum(${offerOrders.amountCents}), 0)` })
    .from(offerOrders)
    .where(
      sql`${offerOrders.status} = 'paid' and ${offerOrders.stripeAccountId} = ${conn.accountId} and coalesce(${offerOrders.paidAt}, ${offerOrders.createdAt}) >= ${since}`,
    )
    .get();
  const vouchers = db
    .select({ n: sql<number>`count(*)`, cents: sql<number>`coalesce(sum(${voucherOrders.valueCents}), 0)` })
    .from(voucherOrders)
    .where(
      sql`${voucherOrders.status} = 'paid' and ${voucherOrders.stripeAccountId} = ${conn.accountId} and coalesce(${voucherOrders.paidAt}, ${voucherOrders.createdAt}) >= ${since}`,
    )
    .get();
  return {
    ...inbox,
    salesCents: Number(offers?.cents ?? 0) + Number(vouchers?.cents ?? 0),
    salesCount: Number(offers?.n ?? 0) + Number(vouchers?.n ?? 0),
  };
}
```

- [ ] **Step 6: Write the route**

`app/src/app/api/adonis/today/route.ts`:

```ts
import { guard } from "@/lib/api/guard";
import { getCurrentMembership } from "@/lib/auth";
import { getTodayCounts } from "@/lib/adonis/today";

export const dynamic = "force-dynamic";

/** "Needs you today" on the /adonis opening screen. Staff see the inbox numbers; money is for admins. */
export async function GET() {
  const denied = await guard("user");
  if (denied) return denied;
  const membership = getCurrentMembership();
  if (!membership) return Response.json({ ok: false, error: "No active account" }, { status: 401 });
  try {
    return Response.json({ ok: true, today: getTodayCounts({ tenantId: membership.tenant.id, withSales: membership.role === "admin" }) });
  } catch (err) {
    console.error("[adonis/today]", err);
    return Response.json({ ok: false, error: "Could not read today's numbers." }, { status: 500 });
  }
}
```

- [ ] **Step 7: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Check the route against local data**

Run (dev server on): `cd app && npm run dev` in one terminal, sign in at http://localhost:3000 as a local admin, then open http://localhost:3000/api/adonis/today in the same browser.
Expected: `{"ok":true,"today":{"leadsWaiting":<n>,"draftsToApprove":<n>,"salesCents":<n>,"salesCount":<n>}}` with no server error in the dev terminal. Local data is a stale copy; only the shape and the absence of SQL errors matter here.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/adonis/todayModel.ts app/src/lib/adonis/todayModel.test.ts app/src/lib/adonis/today.ts app/src/app/api/adonis/today/route.ts
git commit -m "feat(adonis): count leads waiting, drafts to approve and this week's sales

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Opening screen

**Files:**
- Create: `app/src/components/adonis/chat/EmptyState.tsx`

**Interfaces:**
- Consumes: `greetingFor` (Task 8); `TodayCounts`, `formatEuros` (Task 18).
- Produces: `EmptyState(props: { firstName: string | null; businessName: string; suggestions: string[]; onPick: (text: string) => void; disabled: boolean; composer: ReactNode; today: TodayCounts | null; now?: number })`. Shows the "A" mark, "Good afternoon, Chris.", "What should we get done for Optimal Health?", the composer passed in, up to four suggestion tiles, and the "Needs you today" panel when `today` is set (sales row only when `salesCents` is not null).

- [ ] **Step 1: Write `EmptyState.tsx`**

```tsx
"use client";

import "./chat.css";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatEuros, type TodayCounts } from "@/lib/adonis/todayModel";
import { greetingFor } from "./history";

export type EmptyStateProps = {
  firstName: string | null;
  businessName: string;
  suggestions: string[];
  onPick: (text: string) => void;
  disabled: boolean;
  /** The composer, rendered here (big) until the first question is sent. */
  composer: ReactNode;
  today: TodayCounts | null;
  /** For screenshots with fixed data; defaults to the current time. */
  now?: number;
};

/** What the operator sees before asking anything. */
export function EmptyState({ firstName, businessName, suggestions, onPick, disabled, composer, today, now }: EmptyStateProps) {
  return (
    <div className="ax-hero">
      <div className="ax-mark" aria-hidden>
        A
      </div>
      <h1 className="ax-hello">{greetingFor(now ?? Date.now(), firstName)}</h1>
      <p className="ax-sub">{businessName ? `What should we get done for ${businessName}?` : "What should we get done today?"}</p>
      {composer}
      {suggestions.length > 0 && (
        <div className="ax-sug">
          {suggestions.slice(0, 4).map((s) => (
            <button key={s} type="button" className="ax-sg" disabled={disabled} onClick={() => onPick(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {today && (
        <section className="ax-today" aria-label="Needs you today">
          <div className="ax-today-k">Needs you today</div>
          <Link className="ax-ti" href="/communication">
            <span>Leads waiting for a reply</span>
            <b>{today.leadsWaiting}</b>
          </Link>
          <Link className="ax-ti" href="/communication">
            <span>AI drafts to approve</span>
            <b>{today.draftsToApprove}</b>
          </Link>
          {today.salesCents !== null && (
            <div className="ax-ti">
              <span>Offer and voucher sales this week</span>
              <b>{formatEuros(today.salesCents)}</b>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/adonis/chat/EmptyState.tsx
git commit -m "feat(adonis): the opening screen with greeting, suggestions and Needs you today

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: AdonisChat (state and layout)

**Files:**
- Create: `app/src/components/adonis/chat/AdonisChat.tsx`

**Interfaces:**
- Consumes: everything above: `useConversationLive` (Task 9), `useChatScroll`, `keyboardInset` (Task 10), `groupExchanges` (Task 7), `campaignAction` (Task 7), `Exchange`, `ExchangeActions` (Task 15), `Composer`, `ComposerAttachment` (Task 16), `HistoryDrawer` (Task 17), `EmptyState` (Task 19), `CampaignChecklist` (Task 14), `TodayCounts` (Task 18); existing `deriveCampaignProgress` (`@/components/messaging/campaignProgress`), `useConfirm` (`@/components/ui/ConfirmDialog`), `toast` (`sonner`); existing routes `GET/POST /api/agents/<key>/conversations`, `GET/POST/DELETE /api/agents/<key>/conversations/<id>`, `POST /api/content-studio/image-library`, `GET /api/adonis/today`.
- Produces: `type AdonisChatProps = { tenantId: number; agentKey?: string; isAdmin: boolean; firstName: string | null; businessName: string; suggestions: string[]; voiceEnabled: boolean; initialInput?: string; modelChip?: ReactNode; headerEnd?: ReactNode }` and `AdonisChat(props: AdonisChatProps)`. POST bodies sent: `{ type: "message", text }`, `{ type: "approve", index, all }`, `{ type: "cancel", index }`, `{ type: "goAgain", index, tweak }`, `{ type: "buildRest", campaignId }`, `{ type: "stop", now?: true }`.

- [ ] **Step 1: Write `AdonisChat.tsx`**

```tsx
"use client";

import "./chat.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, History, Plus } from "lucide-react";
import { toast } from "sonner";

import type { ConversationSummary, ConversationView } from "@/lib/agents/conversationModel";
import type { TodayCounts } from "@/lib/adonis/todayModel";
import { deriveCampaignProgress } from "@/components/messaging/campaignProgress";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { campaignAction } from "./approvalModel";
import { CampaignChecklist } from "./CampaignChecklist";
import { Composer, type ComposerAttachment } from "./Composer";
import { EmptyState } from "./EmptyState";
import { Exchange, type ExchangeActions } from "./Exchange";
import { HistoryDrawer } from "./HistoryDrawer";
import { groupExchanges } from "./exchanges";
import { keyboardInset } from "./scrollModel";
import { useChatScroll } from "./useChatScroll";
import { useConversationLive } from "./useConversationLive";

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

const blankView = (id: string): ConversationView => ({
  id,
  title: "New chat",
  updatedAt: Date.now(),
  running: false,
  messages: [],
  campaignEvents: [],
  building: false,
  stopRequested: false,
});

export type AdonisChatProps = {
  tenantId: number;
  /** The agent's registry key; its chats live under /api/agents/<key>/conversations. */
  agentKey?: string;
  /** Approvals run writes and are admin-only. */
  isAdmin: boolean;
  firstName: string | null;
  businessName: string;
  suggestions: string[];
  /** Server-computed (transcribeConfigured). */
  voiceEnabled: boolean;
  /** A starter for the compose box (a "Build campaign" link): fills an empty box once, starts a fresh chat, never sends itself. */
  initialInput?: string;
  /** The model chip (ModelPicker) for the composer. */
  modelChip?: ReactNode;
  /** Extra controls at the right of the top bar (the settings gear). */
  headerEnd?: ReactNode;
};

/**
 * The /adonis chat: state and layout. Conversations live on the server
 * (lib/agents/conversation.ts), which runs every turn and carries on with the
 * page closed; this component sends what the operator does and shows the
 * conversation as it changes (useConversationLive: the live stream while a
 * run goes, polling otherwise).
 */
export function AdonisChat({
  tenantId,
  agentKey = "orchestrator",
  isAdmin,
  firstName,
  businessName,
  suggestions,
  voiceEnabled,
  initialInput,
  modelChip,
  headerEnd,
}: AdonisChatProps) {
  const base = `/api/agents/${agentKey}/conversations`;
  // Where an older build of this page kept chats in the browser; moved to the server once, below.
  const legacyKey = `cf_assistant_chats_v2_${tenantId}_${`/api/agents/${agentKey}/chat`.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  const openKey = `adonis_open_${tenantId}_${agentKey}`;
  const confirm = useConfirm();
  const rootRef = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState("");
  const [freshId, setFreshId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [today, setToday] = useState<TodayCounts | null>(null);
  const initialInputApplied = useRef(false);
  // The conversation the view was last opened at the bottom of: opening a chat lands on its latest exchange, once.
  const openedAt = useRef<string | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const fetchList = useCallback(async (): Promise<ConversationSummary[]> => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) return [];
      const data = (await res.json()) as { conversations?: ConversationSummary[] };
      const next = data.conversations ?? [];
      setList(next);
      return next;
    } catch {
      return [];
    }
  }, [base]);

  const live = useConversationLive({ base, id: activeId, enabled: loaded, tenantId, onSettled: () => void fetchList() });
  const { conv, setConv, holdRef, wake } = live;
  const running = Boolean(conv?.running);
  const busy = sending || running;
  const exchanges = useMemo(() => groupExchanges(conv?.messages ?? []), [conv?.messages]);
  const known = conv !== null || live.settledId === activeId || freshId === activeId;
  const empty = loaded && known && exchanges.length === 0;
  const chatting = known && exchanges.length > 0;
  const scroll = useChatScroll(chatting);
  const { toLatest, pinNext } = scroll;

  // First load: move any browser-kept chats to the server (once), then open
  // the chat this device had open last, or the newest. A starter (New
  // campaign) begins a fresh chat.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = localStorage.getItem(legacyKey);
        if (raw && !localStorage.getItem(`${legacyKey}_moved`)) {
          const parsed = JSON.parse(raw) as { conversations?: unknown[] };
          const res = await fetch(base, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversations: parsed.conversations ?? [] }),
          });
          if (res.ok) localStorage.setItem(`${legacyKey}_moved`, "1");
        }
      } catch {
        /* the old history stays in the browser; tried again next load */
      }
      const summaries = await fetchList();
      if (cancelled) return;
      let last: string | null = null;
      try {
        last = localStorage.getItem(openKey);
      } catch {
        /* storage blocked */
      }
      const pick = initialInput ? undefined : (summaries.find((s) => s.id === last) ?? summaries[0]);
      if (pick) {
        setActiveId(pick.id);
      } else {
        const id = newId();
        setFreshId(id);
        setActiveId(id);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, legacyKey, openKey]);

  // Remember which chat this device has open.
  useEffect(() => {
    if (!loaded || !activeId) return;
    try {
      localStorage.setItem(openKey, activeId);
    } catch {
      /* storage blocked */
    }
  }, [loaded, activeId, openKey]);

  // A "Build campaign" starter fills an empty compose box, once.
  useEffect(() => {
    if (!loaded || initialInputApplied.current || !initialInput) return;
    initialInputApplied.current = true;
    setInput((cur) => cur || initialInput);
  }, [loaded, initialInput]);

  // Opening a chat lands on its latest exchange, once; polling and streaming never move the view after that.
  useEffect(() => {
    if (!conv || conv.messages.length === 0 || openedAt.current === conv.id) return;
    openedAt.current = conv.id;
    toLatest("auto");
  }, [conv, toLatest]);

  // "Needs you today", read when the opening screen shows.
  useEffect(() => {
    if (!empty) return;
    let off = false;
    fetch("/api/adonis/today", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; today?: TodayCounts } | null) => {
        if (!off && j?.ok && j.today) setToday(j.today);
      })
      .catch(() => {
        /* the panel stays hidden */
      });
    return () => {
      off = true;
    };
  }, [empty]);

  // Keep the composer above the on-screen keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    const root = rootRef.current;
    if (!vv || !root) return;
    const update = () => root.style.setProperty("--ax-kb", `${keyboardInset(window.innerHeight, vv.height, vv.offsetTop)}px`);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // A fresh list when the drawer opens (running tags, titles).
  useEffect(() => {
    if (historyOpen) void fetchList();
  }, [historyOpen, fetchList]);

  /**
   * An attachment is uploaded to the media library the moment it is picked,
   * so Adonis is handed an id it can act on (place that photograph, read that
   * document). The message names each file and its id on a line of its own.
   */
  async function attachFiles(files: File[]) {
    setAttaching(true);
    try {
      const form = new FormData();
      for (const f of files) form.append("file", f);
      const res = await fetch("/api/content-studio/image-library", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; assets?: { id: number; originalName: string; kind: string }[] };
      if (!res.ok || !json.ok || !json.assets) {
        toast.error(json.error || "Could not attach that file.");
        return;
      }
      const added = json.assets.map((a) => ({ id: a.id, name: a.originalName, kind: a.kind }));
      setAttachments((prev) => [...prev, ...added]);
    } catch {
      toast.error("Could not attach that file.");
    } finally {
      setAttaching(false);
    }
  }

  /** Tell the server what the operator did. `optimistic` shows it at once; the server's answer replaces it. */
  async function post(body: Record<string, unknown>, optimistic?: (c: ConversationView) => ConversationView): Promise<boolean> {
    const id = activeId;
    if (!id) return false;
    if (optimistic) setConv((c) => optimistic(c ?? blankView(id)));
    holdRef.current = true;
    setSending(true);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; conversation?: ConversationView; error?: string } | null;
      if (!res.ok || !data?.ok || !data.conversation) {
        toast.error(data?.error ?? `Adonis couldn't do that (${res.status}).`);
        return false;
      }
      if (activeIdRef.current === id) setConv(data.conversation);
      void fetchList();
      return true;
    } catch {
      toast.error("Couldn't reach Adonis. Check your connection and try again.");
      return false;
    } finally {
      holdRef.current = false;
      setSending(false);
      wake();
    }
  }

  function send(text: string) {
    // The id is the useful part: it is what every tool that touches a picture or a document takes.
    const attachLine = attachments.map((a) => `[Attached to the library: "${a.name}" — ${a.kind} #${a.id}]`).join("\n");
    const q = [text.trim(), attachLine].filter(Boolean).join("\n\n");
    if (!q || busy || !activeId) return;
    setInput("");
    setAttachments([]);
    pinNext(`q${conv?.messages.length ?? 0}`);
    openedAt.current = activeId; // sending is not opening: keep the question at the top
    void post({ type: "message", text: q }, (c) => ({
      ...c,
      running: true,
      messages: [
        ...c.messages,
        { role: "user", content: q, tools: [], artifacts: [] },
        { role: "assistant", content: "", tools: [], artifacts: [], startedAt: Date.now() },
      ],
    }));
  }

  const markCard = (index: number, status: "approving" | "cancelled") => (c: ConversationView): ConversationView => ({
    ...c,
    messages: c.messages.map((m, i) => (i === index && m.pending ? { ...m, pending: { ...m.pending, status } } : m)),
  });

  function approve(index: number, all = false) {
    void post({ type: "approve", index, all }, (c) => ({ ...markCard(index, "approving")(c), running: true, building: all }));
  }
  function cancelCard(index: number) {
    void post({ type: "cancel", index }, markCard(index, "cancelled"));
  }
  /** "Change it": a campaign card is written again with the tweak; any other card is cancelled and the words sent. */
  async function changeCard(index: number, tweak: string) {
    const pending = conv?.messages[index]?.pending;
    if (pending && campaignAction(pending.actions)) {
      void post({ type: "goAgain", index, tweak }, (c) => ({ ...markCard(index, "cancelled")(c), running: true }));
      return;
    }
    const ok = await post({ type: "cancel", index }, markCard(index, "cancelled"));
    if (ok && tweak.trim()) send(`Change that before I approve it: ${tweak.trim()}`);
  }
  function buildRest(campaignId: number) {
    void post({ type: "buildRest", campaignId }, (c) => ({ ...c, running: true, building: true }));
  }
  function stopNow() {
    void post({ type: "stop", now: true }, (c) => ({ ...c, stopRequested: true }));
  }
  function stopAfterThis() {
    void post({ type: "stop" }, (c) => ({ ...c, stopRequested: true }));
  }

  function newChat() {
    setHistoryOpen(false);
    if (!conv || conv.messages.length === 0) return; // already a fresh chat
    const id = newId();
    setConv(null);
    setExpanded(new Set());
    setFreshId(id);
    setActiveId(id);
  }
  function openChat(id: string) {
    setHistoryOpen(false);
    if (id === activeId) return;
    setConv(null);
    setExpanded(new Set());
    setActiveId(id);
  }
  async function deleteChat(id: string) {
    const target = list.find((c) => c.id === id);
    const ok = await confirm({
      title: "Delete this chat?",
      body: `Delete "${target?.title || "this chat"}"? This cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      toast.error("Adonis is still working in that chat. Delete it when it has finished.");
      return;
    }
    const next = await fetchList();
    if (id === activeId) {
      setConv(null);
      setExpanded(new Set());
      const pick = next[0]?.id;
      if (pick) {
        setActiveId(pick);
      } else {
        const fresh = newId();
        setFreshId(fresh);
        setActiveId(fresh);
      }
    }
  }
  function toggleFold(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const campaignProgress = deriveCampaignProgress(conv?.campaignEvents ?? []);
  const campaign = campaignProgress ? (
    <CampaignChecklist
      progress={campaignProgress}
      working={busy}
      onBuildRest={campaignProgress.campaignId !== null ? () => buildRest(campaignProgress.campaignId!) : undefined}
    />
  ) : null;

  const actions: ExchangeActions = {
    onApprove: (i) => approve(i),
    onApproveAll: (i) => approve(i, true),
    onCancel: cancelCard,
    onChange: (i, tweak) => void changeCard(i, tweak),
    onFollowUp: send,
  };

  const composer = (variant: "hero" | "dock") => (
    <Composer
      value={input}
      onChange={setInput}
      onSend={() => send(input)}
      onStop={stopNow}
      busy={busy}
      running={running}
      attachments={attachments}
      attaching={attaching}
      onAttach={(files) => void attachFiles(files)}
      onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
      voiceEnabled={voiceEnabled}
      modelChip={modelChip}
      placeholder={variant === "hero" ? "Ask Adonis anything, or tell it what to do" : "Ask a follow-up"}
      variant={variant}
      hint={variant === "dock" ? "Adonis asks before it changes anything." : undefined}
    />
  );

  return (
    <div className="ax-root" ref={rootRef}>
      <div className="ax-top">
        <button type="button" className="ax-top-btn" onClick={newChat}>
          <Plus size={15} strokeWidth={1.9} aria-hidden />
          New chat
        </button>
        <div className="ax-top-end">
          <button type="button" className="ax-top-btn" onClick={() => setHistoryOpen(true)} aria-haspopup="dialog">
            <History size={15} strokeWidth={1.9} aria-hidden />
            History
          </button>
          {headerEnd}
        </div>
      </div>

      {conv?.building && running && (
        <div className="ai-autopilot" role="status">
          <span>
            {conv.stopRequested
              ? "Stopping after the step Adonis is on."
              : "Building every asset without stopping, even if you leave this page. Adonis will ask before launching, scheduling or sending anything."}
          </span>
          {!conv.stopRequested && (
            <button type="button" onClick={stopAfterThis}>
              Stop after this one
            </button>
          )}
        </div>
      )}

      {empty && (
        <div className="ax-scroll">
          <EmptyState
            firstName={firstName}
            businessName={businessName}
            suggestions={suggestions}
            onPick={send}
            disabled={busy}
            composer={composer("hero")}
            today={today}
          />
        </div>
      )}

      {chatting && (
        <>
          <div className="ax-scroll" ref={scroll.scrollRef} onScroll={scroll.onScroll}>
            <div className="ax-col" ref={scroll.contentRef}>
              {exchanges.map((x, i) => {
                const isLast = i === exchanges.length - 1;
                const waiting = x.replies.some((r) => r.message.pending?.status === "awaiting");
                return (
                  <Exchange
                    key={x.key}
                    exchange={x}
                    live={isLast && running}
                    phases={live.phases}
                    isLast={isLast}
                    folded={!isLast && !waiting && !expanded.has(x.key)}
                    onToggleFold={isLast || waiting ? undefined : () => toggleFold(x.key)}
                    busy={busy}
                    canApprove={isAdmin}
                    campaign={isLast ? campaign : null}
                    actions={actions}
                  />
                );
              })}
            </div>
          </div>
          <div className="ax-dock">
            {scroll.showJump && (
              <button type="button" className="ax-jump" onClick={() => toLatest("smooth")}>
                <ArrowDown size={14} strokeWidth={2} aria-hidden />
                Jump to latest
              </button>
            )}
            {composer("dock")}
          </div>
        </>
      )}

      {!empty && !chatting && <div className="ax-scroll" aria-busy="true" />}

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        items={list}
        activeId={activeId}
        onOpen={openChat}
        onNew={newChat}
        onDelete={(id) => void deleteChat(id)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/adonis/chat/AdonisChat.tsx
git commit -m "feat(adonis): the new chat, wiring streaming, exchanges, composer and history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Put the new chat on /adonis

**Files:**
- Modify: `app/src/components/adonis/AdonisView.tsx` (whole file)
- Modify: `app/src/app/adonis/page.tsx` (props)
- Modify: `app/src/components/adonis/ModelPicker.tsx` (chip size)

**Interfaces:**
- Consumes: `AdonisChat`, `AdonisChatProps` (Task 20); `ModelPicker` (existing); `getBusinessProfile()` from `@/lib/businessProfile` (returns `{ businessName, ... }`, falls back to the tenant name).
- Produces: `AdonisView(props: { tenantId: number; isAdmin: boolean; voiceEnabled: boolean; initialInput?: string; model: string; openRouterConfigured: boolean; firstName: string | null; businessName: string })`.

- [ ] **Step 1: Replace `AdonisView.tsx`**

```tsx
"use client";

import Link from "next/link";
import { Settings } from "lucide-react";

import { Tooltip } from "@/components/ui/Tooltip";
import { AdonisChat } from "./chat/AdonisChat";
import { ModelPicker } from "./ModelPicker";

const SUGGESTIONS = [
  "How are my ads doing this week?",
  "Reply to today's leads",
  "Plan next week's posts",
  "Who hasn't booked in 30 days?",
];

/**
 * The /adonis page: Adonis's chat, full height (components/adonis/chat).
 * The settings gear, admin-only because its target (/agents) is
 * requireAdminPage()-gated, sits at the right of the chat's top bar. The
 * model chip lives in the composer.
 */
export function AdonisView({
  tenantId,
  isAdmin,
  voiceEnabled,
  initialInput,
  model,
  openRouterConfigured,
  firstName,
  businessName,
}: {
  tenantId: number;
  isAdmin: boolean;
  /** Server-computed via transcribeConfigured(); the client never reads process.env. */
  voiceEnabled: boolean;
  /** A "Build campaign" seed for the compose box (see app/adonis/page.tsx). */
  initialInput?: string;
  /** Adonis's current agents.model, shown (and for an admin switchable) in the composer. */
  model: string;
  /** Whether the open (non-Claude) models can run. */
  openRouterConfigured: boolean;
  firstName: string | null;
  businessName: string;
}) {
  return (
    // `.adonis-shell` owns the height (100dvh, less the mobile top bar; see globals.css).
    <div
      className="adonis-shell"
      style={{ display: "flex", flexDirection: "column", padding: "12px clamp(8px, 3vw, 20px) 0", boxSizing: "border-box" }}
    >
      <AdonisChat
        tenantId={tenantId}
        agentKey="orchestrator"
        isAdmin={isAdmin}
        firstName={firstName}
        businessName={businessName}
        suggestions={SUGGESTIONS}
        voiceEnabled={voiceEnabled}
        initialInput={initialInput}
        modelChip={<ModelPicker agentKey="orchestrator" initialModel={model} canEdit={isAdmin} openRouterConfigured={openRouterConfigured} />}
        headerEnd={
          isAdmin ? (
            <Tooltip label="Agent settings">
              <Link href="/agents" aria-label="Agent settings" className="ax-top-btn" style={{ padding: 0, width: 36 }}>
                <Settings size={17} strokeWidth={1.75} />
              </Link>
            </Tooltip>
          ) : null
        }
      />
    </div>
  );
}
```

- [ ] **Step 2: Pass the name and business from the page**

In `app/src/app/adonis/page.tsx`, add below `import { getCurrentMembership } from "@/lib/auth";`:

```ts
import { getBusinessProfile } from "@/lib/businessProfile";
```

Replace:

```ts
  const tenantId = getCurrentTenant().id;
  const isAdmin = getCurrentMembership()?.role === "admin";
```

with:

```ts
  const tenantId = getCurrentTenant().id;
  const membership = getCurrentMembership();
  const isAdmin = membership?.role === "admin";
  // The opening screen greets by first name and names the business.
  const firstName = membership?.user.name?.trim().split(/\s+/)[0] || null;
  const businessName = getBusinessProfile().businessName || membership?.tenant.name || "";
```

Replace:

```tsx
      model={model}
      openRouterConfigured={openRouterConfigured}
    />
```

with:

```tsx
      model={model}
      openRouterConfigured={openRouterConfigured}
      firstName={firstName}
      businessName={businessName}
    />
```

Also replace the comment line `    // (client-side nav, same route) remounts AdonisView — AssistantChat applies` with `    // (client-side nav, same route) remounts AdonisView — AdonisChat applies`.

- [ ] **Step 3: Give the model chip room**

In `app/src/components/adonis/ModelPicker.tsx`, replace:

```ts
    gap: 6,
    padding: "4px 10px",
    border: "1px solid var(--hairline)",
    borderRadius: 999,
    background: "transparent",
    color: "var(--text-tertiary)",
    fontSize: 11.5,
```

with:

```ts
    gap: 6,
    minHeight: 32,
    padding: "0 12px",
    border: "1px solid var(--hairline)",
    borderRadius: 999,
    background: "transparent",
    color: "var(--text-tertiary)",
    fontSize: 12,
```

And replace the doc line ` * The model chip under the /adonis compose box: names the model Adonis is` with ` * The model chip in the /adonis composer: names the model Adonis is`.

- [ ] **Step 4: Typecheck and run the whole suite**

Run: `cd app && npm run typecheck && npm test`
Expected: no type errors; every test file passes (the final line reads `✓ N/N test file(s) passed`).

- [ ] **Step 5: Try it in the dev server**

Run: `cd app && npm run dev`, sign in locally as an admin, open http://localhost:3000/adonis.
Expected: the opening screen (mark, greeting, composer, four tiles, Needs you today). Ask "What's in my diary tomorrow?": the question moves to the top, "Thinking" with a timer appears, steps tick, words flow in evenly, the steps fold to "Done in ...", follow-ups appear if Adonis wrote them. In the browser devtools Network tab, the `stream?stamp=` request is `text/event-stream` and stays open until the answer is done. Close the tab mid-answer, reopen: the answer is there (durable runs). This needs `ANTHROPIC_API_KEY` in `app/.env.local`; without it, check the opening screen and history only and leave the streaming check to Task 24.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/adonis/AdonisView.tsx app/src/app/adonis/page.tsx app/src/components/adonis/ModelPicker.tsx
git commit -m "feat(adonis): /adonis uses the new streaming answer-page chat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Delete AssistantChat

**Files:**
- Delete: `app/src/components/messaging/AssistantChat.tsx`

- [ ] **Step 1: Make sure nothing imports it**

Run: `cd /Users/truep/Desktop/Clients/Renova && grep -rn "AssistantChat" app/src --include="*.ts" --include="*.tsx" | grep -v "^app/src/components/messaging/AssistantChat.tsx"`
Expected: no `import` lines. Comment mentions in `Soundwave.tsx`, `useVoiceInput.ts`, `voiceInput.ts`, `campaignProgress.ts`, `buildCampaignSeed.ts` and tests may remain; they describe history. If any line is an import, stop and move that caller to `components/adonis/chat` first.

- [ ] **Step 2: Delete the file**

Run: `cd /Users/truep/Desktop/Clients/Renova && git rm app/src/components/messaging/AssistantChat.tsx`

- [ ] **Step 3: Typecheck, test and build**

Run: `cd app && npm run typecheck && npm test && npx next build`
Expected: no type errors; all tests pass; `next build` finishes with the route list (including `/api/agents/[key]/conversations/[id]/stream` and `/api/adonis/today`).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(adonis): remove the old AssistantChat now that nothing uses it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Browser check at 1280 and 390, dark and light

**Files (temporary, never committed):**
- Create: `app/src/app/f/zz-adonis-chat/page.tsx`
- Create: `app/src/app/f/zz-adonis-chat/ChatPreview.tsx`
- Create: `app/scripts/shoot-adonis-chat.mjs`

`/f/*` is public in the middleware and renders without the app shell (root layout), so the preview injects the theme itself and wraps the components in `TooltipProvider`. It renders the presentational components with fixed data; nothing on it calls an API.

- [ ] **Step 1: Write the preview page**

`app/src/app/f/zz-adonis-chat/page.tsx`:

```tsx
import { coerceThemeMode, themeCss, themeForMode } from "@/lib/theme";
import { ChatPreview, type PreviewScene } from "./ChatPreview";

export const dynamic = "force-dynamic";

/** Throwaway screenshot page for the Adonis chat redesign. Deleted after the check; never committed. */
export default async function Page(props: { searchParams: Promise<{ theme?: string; scene?: string }> }) {
  const sp = await props.searchParams;
  const mode = coerceThemeMode(sp.theme);
  const scene: PreviewScene = sp.scene === "streaming" || sp.scene === "approval" || sp.scene === "drawer" ? sp.scene : "empty";
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `${themeCss(themeForMode(mode))} html,body{background:var(--bg);color:var(--text-primary);font-family:var(--font-body),sans-serif}`,
        }}
      />
      <ChatPreview mode={mode} scene={scene} />
    </>
  );
}
```

`app/src/app/f/zz-adonis-chat/ChatPreview.tsx`:

```tsx
"use client";

import { useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { Cpu, History, Plus } from "lucide-react";

import "@/components/adonis/chat/chat.css";
import { TooltipProvider } from "@/components/ui/Tooltip";
import type { ConvMessage, ConversationSummary } from "@/lib/agents/conversationModel";
import { Composer } from "@/components/adonis/chat/Composer";
import { EmptyState } from "@/components/adonis/chat/EmptyState";
import { Exchange, type ExchangeActions } from "@/components/adonis/chat/Exchange";
import { HistoryDrawer } from "@/components/adonis/chat/HistoryDrawer";
import { groupExchanges } from "@/components/adonis/chat/exchanges";

export type PreviewScene = "empty" | "streaming" | "approval" | "drawer";

const NOW = Date.UTC(2026, 10, 24, 15, 0);
const noop = () => {};
const actions: ExchangeActions = { onApprove: noop, onApproveAll: noop, onCancel: noop, onChange: noop, onFollowUp: noop };

const ANSWER =
  "The massage offer is ahead: **6 sold** against **2** for infrared + HBOT, though the bundle has brought in about the same money, **€400 to €384**.\n\n" +
  "### Why the bundle is behind\n- Its ads have had a third of the clicks the massage ads got.\n- Two people started checkout and didn't finish.\n\n" +
  "### Post this tomorrow\nA carousel on the bundle with the deadline up front: two days left, €200 instead of €260.\n\n" +
  "| Offer | Sold | Revenue |\n|---|---|---|\n| Massage | 6 | €384 |\n| Infrared + HBOT | 2 | €400 |\n\n" +
  "<followups>\nMove €5 a day from massage ads to the bundle\nWrite the email for buyers who didn't finish checkout\n</followups>";

const HISTORY: ConversationSummary[] = [
  { id: "h1", title: "Black Friday budget split", updatedAt: NOW - 20_000, running: false },
  { id: "h2", title: "Build the December campaign", updatedAt: NOW - 600_000, running: true },
  { id: "h3", title: "Reply to Messenger leads", updatedAt: Date.UTC(2026, 10, 24, 11, 20), running: false },
  { id: "h4", title: "Voucher store wording", updatedAt: Date.UTC(2026, 10, 23, 16, 0), running: false },
  { id: "h5", title: "Massage ad copy, version 2", updatedAt: Date.UTC(2026, 10, 23, 10, 0), running: false },
  { id: "h6", title: "Who hasn't booked in 30 days", updatedAt: Date.UTC(2026, 10, 20, 9, 0), running: false },
  { id: "h7", title: "Infrared page FAQs", updatedAt: Date.UTC(2026, 10, 18, 9, 0), running: false },
];

const modelChip = (
  <span
    style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32, padding: "0 12px", border: "1px solid var(--hairline)", borderRadius: 999, fontSize: 12, color: "var(--text-tertiary)" }}
  >
    <Cpu size={12} strokeWidth={1.75} />
    Sonnet 5.5
  </span>
);

function composer(variant: "hero" | "dock", running = false) {
  return (
    <Composer
      value=""
      onChange={noop}
      onSend={noop}
      onStop={noop}
      busy={running}
      running={running}
      attachments={[]}
      attaching={false}
      onAttach={noop}
      onRemoveAttachment={noop}
      voiceEnabled
      modelChip={modelChip}
      placeholder={variant === "hero" ? "Ask Adonis anything, or tell it what to do" : "Ask a follow-up"}
      variant={variant}
      hint={variant === "dock" ? "Adonis asks before it changes anything." : undefined}
    />
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="adonis-shell" style={{ height: "100dvh", display: "flex", flexDirection: "column", padding: "12px clamp(8px, 3vw, 20px) 0", boxSizing: "border-box" }}>
      <div className="ax-root">
        <div className="ax-top">
          <button type="button" className="ax-top-btn">
            <Plus size={15} strokeWidth={1.9} aria-hidden />
            New chat
          </button>
          <div className="ax-top-end">
            <button type="button" className="ax-top-btn">
              <History size={15} strokeWidth={1.9} aria-hidden />
              History
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ChatPreview({ mode, scene }: { mode: "dark" | "light"; scene: PreviewScene }) {
  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);
  const startedAt = useMemo(() => Date.now() - 4200, []);

  const thread = (messages: ConvMessage[], live: boolean, phases: Record<number, "tool" | "writing">) => {
    const xs = groupExchanges(messages);
    return (
      <>
        <div className="ax-scroll" style={{ "--ax-view-h": "640px" } as CSSProperties}>
          <div className="ax-col">
            {xs.map((x, i) => (
              <Exchange
                key={x.key}
                exchange={x}
                live={live && i === xs.length - 1}
                phases={phases}
                isLast={i === xs.length - 1}
                folded={i < xs.length - 1}
                onToggleFold={noop}
                busy={live}
                canApprove
                actions={actions}
              />
            ))}
          </div>
        </div>
        <div className="ax-dock">{composer("dock", live)}</div>
      </>
    );
  };

  const approvalMessages: ConvMessage[] = [
    { role: "user", content: "Which Black Friday offer is selling better?", tools: [], artifacts: [] },
    {
      role: "assistant",
      content: ANSWER,
      tools: ["get_ad_results", "list_ad_campaigns", "list_social_posts", "business_overview"],
      artifacts: [{ url: "#", filename: "black-friday-sales.csv", label: "Black Friday sales so far" }],
      startedAt: NOW - 60_000,
      durationMs: 6200,
    },
    { role: "user", content: "Change the homepage button to say Book online", tools: [], artifacts: [] },
    {
      role: "assistant",
      content: "Here's the change. It swaps the words on the button; the link stays the same.",
      tools: ["list_website_pages", "read_website_page"],
      artifacts: [],
      startedAt: NOW - 10_000,
      durationMs: 3100,
      pending: {
        status: "awaiting",
        actions: [
          {
            name: "edit_website_text",
            input: { path: "/", find: "Book a consultation", replace: "Book online" },
            summary: 'Change wording on /: "Book a consultation" -> "Book online"',
          },
        ],
      },
    },
  ];

  let body: ReactNode;
  if (scene === "empty") {
    body = (
      <div className="ax-scroll">
        <EmptyState
          firstName="Chris"
          businessName="Optimal Health"
          suggestions={["How are my ads doing this week?", "Reply to today's leads", "Plan next week's posts", "Who hasn't booked in 30 days?"]}
          onPick={noop}
          disabled={false}
          composer={composer("hero")}
          today={{ leadsWaiting: 6, draftsToApprove: 2, salesCents: 78400, salesCount: 8 }}
          now={NOW}
        />
      </div>
    );
  } else if (scene === "streaming") {
    body = thread(
      [
        { role: "user", content: "Which Black Friday offer is selling better, and what should I post tomorrow?", tools: [], artifacts: [] },
        {
          role: "assistant",
          content: "The massage offer is ahead: **6 sold** against **2** for infrared + HBOT, though the bundle has brought in about the same money",
          tools: ["get_ad_results", "get_ad_account_performance", "list_social_posts"],
          artifacts: [],
          startedAt,
        },
      ],
      true,
      { 1: "writing" },
    );
  } else {
    body = thread(approvalMessages, false, {});
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Frame>{body}</Frame>
      {scene === "drawer" && <HistoryDrawer open onClose={noop} items={HISTORY} activeId="h1" onOpen={noop} onNew={noop} onDelete={noop} now={NOW} />}
    </TooltipProvider>
  );
}
```

- [ ] **Step 2: Write the screenshot script**

`app/scripts/shoot-adonis-chat.mjs`:

```js
// Throwaway: screenshots of /f/zz-adonis-chat for the chat redesign check. Deleted after; never committed.
//   node scripts/shoot-adonis-chat.mjs <out-dir>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: node scripts/shoot-adonis-chat.mjs <out-dir>");
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const executablePath = path.join(
  os.homedir(),
  "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);

const browser = await chromium.launch({ executablePath, headless: true });
let failures = 0;
try {
  for (const [width, height] of [[1280, 860], [390, 844]]) {
    for (const theme of ["dark", "light"]) {
      for (const scene of ["empty", "streaming", "approval", "drawer"]) {
        const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
        await page.goto(`${BASE}/f/zz-adonis-chat?theme=${theme}&scene=${scene}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1000);
        const file = path.join(OUT, `${scene}-${theme}-${width}.png`);
        await page.screenshot({ path: file });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const problems = [overflow > 0 ? `horizontal overflow ${overflow}px` : "", ...errors].filter(Boolean);
        if (problems.length) failures++;
        console.log(file, problems.length ? `PROBLEMS: ${problems.join(" | ")}` : "ok");
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
```

- [ ] **Step 3: Take the screenshots**

Run: `cd app && npm run dev` (leave it running in another terminal), then `cd app && node scripts/shoot-adonis-chat.mjs /private/tmp/claude-502/-Users-truep-Desktop-Clients-Renova/adonis-chat-shots`
Expected: 16 lines, each ending `ok`, and exit code 0. A hydration warning about the timer text on the streaming scene is acceptable (the preview computes it from the clock); anything else is a failure to fix.

- [ ] **Step 4: Look at every screenshot**

Open each PNG (Read tool on the file path) and check against the mockups:
- empty: "A" mark tile, greeting in Space Grotesk 26px, sub line, the big composer (attach, mic, model chip, round send), four tiles in two columns (one column at 390), Needs you today with 6 / 2 / €784. Light: the mark is a dark tile with a light letter; nothing is invisible.
- streaming: question as a 27px headline (22px at 390), tabs Answer / Steps 3, the steps box with three ticked tools, "Writing the answer" spinning and a timer near 4.2s, the partial answer at 15.5px, composer pinned at the bottom with Stop in place of Send.
- approval: the first exchange folded to one line (question and "The massage offer is ahead: 6 sold against 2 ..."), the second with "Done in 3.1s, 2 steps", the answer, the Approve card with the amber dot, "Waiting for your OK, nothing has changed yet", the struck-through "Book a consultation" and green "Book online", buttons Approve / Change it / Cancel and "1 change".
- drawer: drawer from the right (full width at 390), "Chats", New chat, search, groups TODAY / YESTERDAY / EARLIER, "Working" with a green pulse on the December campaign, "now", "11:20", "Mon", "20 Nov".
- All: no text overlapping, no cramped controls (buttons at least 36px high), no horizontal scroll at 390, no emojis, every colour from the theme in both modes.
Fix any problem in the component or `chat.css`, re-run Step 3, and look again until all 16 pass.

- [ ] **Step 5: Remove the throwaway files**

Run: `cd /Users/truep/Desktop/Clients/Renova && rm -r app/src/app/f/zz-adonis-chat app/scripts/shoot-adonis-chat.mjs && git status --short`
Expected: no `zz-adonis-chat` or `shoot-adonis-chat` paths listed; only the fixes from Step 4 (if any) show as modified.

- [ ] **Step 6: Commit any fixes from Step 4**

```bash
git add app/src/components/adonis/chat
git commit -m "fix(adonis): chat layout fixes from the screenshot check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Skip this step when Step 4 needed no changes.)

---

### Task 24: Ship and watch one real answer stream

**Files:** none new.

- [ ] **Step 1: Full checks**

Run: `cd app && npm run typecheck && npm test && npx next build`
Expected: no type errors, every test file passes, the build succeeds.

- [ ] **Step 2: Push main**

Run: `cd /Users/truep/Desktop/Clients/Renova && git status --short && git log --oneline origin/main..HEAD && git push origin main`
Expected: only unrelated untracked files remain in the status (eval results, design previews); the log lists this plan's commits; the push succeeds.

- [ ] **Step 3: Deploy**

Run: `cd /Users/truep/Desktop/Clients/Renova/app && railway up`
Expected: the build and deploy finish; `curl -s https://www.adonisagent.ie/api/health` (or the Railway domain) answers OK.

- [ ] **Step 4: Watch a real answer on Optimal Health**

Ask the operator (or, signed in as them, do it yourself) to open /adonis on Optimal Health (tenant 1028, not Renova) and ask one real question, for example "How many people booked this week?".
Expected: the question moves to the top, "Thinking" then steps tick, words flow in evenly with no jumps, the view does not move while scrolled up, the steps fold to "Done in ...", follow-ups appear. In devtools, the `stream?stamp=` request is `text/event-stream` and receives data while the answer is written (if it only receives everything at the end, Railway's proxy is buffering: check the `X-Accel-Buffering` and `Cache-Control` headers on the response). Reload mid-answer once: the answer carries on and finishes.

- [ ] **Step 5: Record what shipped**

Add a short entry to `/Users/truep/.claude/projects/-Users-truep-Desktop-Clients-Renova/memory/where-we-left-off.md` and a line in `MEMORY.md`: Adonis chat redesign live (SSE streaming via lib/agents/liveBus + stream route, components/adonis/chat, follow-ups block in the playbook, Needs you today at /api/adonis/today), what was checked live, and the known gaps (no old values for non-website writes; aborted model calls are not metered; streaming is single-instance).
