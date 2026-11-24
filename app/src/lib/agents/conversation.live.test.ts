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
