// Run: npm test -- src/lib/agents/conversation.live.test.ts
//
// The run loop publishes what Adonis writes as it writes it. On a scratch
// tenant, with the model replaced by a fake turn (setTurnRunnerForTests), a
// subscriber must get the first state, the tool, the text deltas, then the
// final state and `end`, in that order; a mid-run read must see words not
// yet saved; "stop now" must end the turn and say so, even when the model
// call ignores the signal; and throttled text saves must send no state.
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

    // 3. Stop now, with a model call that IGNORES the signal (the native
    // Claude provider never reads it): it keeps writing after the stop and
    // returns later with a write. The page must get no more words, the reply
    // must end at the words shown plus the note, the run must end at once,
    // and the late write must never become an Approve card.
    const ctx3 = { ...ctx, convId: crypto.randomUUID() };
    const events3: LiveEvent[] = [];
    const off3 = bus.subscribe(bus.liveKey(tid, ctx3.convId), (e) => events3.push(JSON.parse(JSON.stringify(e)) as LiveEvent));
    let lateCalls = 0;
    let runnerFinished = false;
    convo.setTurnRunnerForTests(((args: RunAgentTurnArgs) =>
      new Promise((resolve) => {
        args.onText?.("Before ");
        args.onText?.("stop");
        const tick = setInterval(() => {
          lateCalls++;
          args.onText?.(" after");
          args.onTool?.("list_leads");
        }, 20);
        setTimeout(() => {
          clearInterval(tick);
          runnerFinished = true;
          resolve({
            text: "Before stop after after after",
            pendingWrites: [{ name: "set_lead_stage", input: { leadId: 1, stage: "Won" }, summary: "Move lead" }],
            artifacts: [],
          });
        }, 300);
      })) as unknown as Parameters<typeof convo.setTurnRunnerForTests>[0]);
    convo.act(ctx3, { type: "message", text: "Write a long thing" });
    await waitFor(events3, (e) => e.type === "text");
    convo.act(ctx3, { type: "stop", now: true });
    await waitFor(events3, (e) => e.type === "end", 250);
    assert.equal(runnerFinished, false, "the run ends without waiting for the model call to finish");
    const endAt = events3.length;
    await new Promise((r) => setTimeout(r, 450));
    off3();
    assert.ok(runnerFinished && lateCalls > 0, "the fake kept writing after the stop, so the check below means something");
    assert.equal(events3.length, endAt, "nothing is published after end");
    const texts3 = events3.filter((e): e is Extract<LiveEvent, { type: "text" }> => e.type === "text");
    assert.equal(texts3.map((e) => e.delta).join(""), "Before stop", "no words reach the page after Stop");
    assert.ok(!events3.some((e) => e.type === "tool"), "no tool reaches the page after Stop");
    const final3 = events3[endAt - 2];
    assert.ok(final3.type === "state" && final3.conversation.messages[1]?.content === "Before stop\n\n_Stopped._", "the reply is the words shown plus the stop note");
    assert.ok(final3.type === "state" && !final3.conversation.running, "the stopped run is idle");
    const after3 = convo.getConversation(ctx3);
    assert.equal(after3?.messages[1]?.content, "Before stop\n\n_Stopped._", "the saved reply is unchanged once the model call finishes");
    assert.equal(after3?.messages[1]?.pending, undefined, "the stopped turn's write is dropped, never shown for approval");
    assert.deepEqual(after3?.messages[1]?.tools, [], "no tool from after the stop is recorded");

    // 4. Throttled text saves send no state: with words spread past the save
    // interval, the only states are the opening one and the final one, and
    // the deltas plus the final state still give the reply exactly.
    const ctx4 = { ...ctx, convId: crypto.randomUUID() };
    const events4: LiveEvent[] = [];
    const off4 = bus.subscribe(bus.liveKey(tid, ctx4.convId), (e) => events4.push(JSON.parse(JSON.stringify(e)) as LiveEvent));
    let midRead4 = "";
    convo.setTurnRunnerForTests((async (args: RunAgentTurnArgs): Promise<TurnResult> => {
      const pause = () => new Promise((r) => setTimeout(r, 560));
      args.onText?.("One ");
      await pause();
      args.onText?.("two ");
      await pause();
      args.onText?.("three");
      midRead4 = convo.getConversation(ctx4)?.messages[1]?.content ?? "";
      return { text: "One two three", pendingWrites: [], artifacts: [] };
    }) as unknown as Parameters<typeof convo.setTurnRunnerForTests>[0]);
    convo.act(ctx4, { type: "message", text: "Count" });
    await waitFor(events4, (e) => e.type === "end");
    off4();
    const states4 = events4.filter((e) => e.type === "state");
    assert.equal(states4.length, 2, "only the opening and final states are sent while words stream");
    const texts4 = events4.filter((e): e is Extract<LiveEvent, { type: "text" }> => e.type === "text");
    assert.equal(texts4.map((e) => e.delta).join(""), "One two three", "the deltas carry every word");
    const final4 = events4[events4.length - 2];
    assert.ok(final4.type === "state" && final4.conversation.messages[1]?.content === "One two three", "the final state holds the whole reply");
    assert.equal(midRead4, "One two three", "a client connecting mid-run gets the words so far from the snapshot");

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
