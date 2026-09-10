// Run: npm test -- src/lib/content-studio/ideaTopic.test.ts
//
// Picking an idea must hand the generator the SUBSTANCE, not just the
// headline. The bug this pins: the picker passed `idea.hook` alone, so the
// generator re-derived the content from a title and landed shallower than the
// idea it came from.
import assert from "node:assert/strict";

import { ideaToTopic } from "./ideaTopic";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const FULL = {
  hook: "Infrared isn't a sauna with the volume turned down",
  teaches: "Traditional saunas heat the air; infrared heats tissue directly through radiant energy.",
  basis: "Difference between convective and radiant heat transfer.",
};

const topic = ideaToTopic(FULL);

check("the hook leads", topic.startsWith(FULL.hook));
check("what it teaches survives the pick", topic.includes(FULL.teaches));
check("what it rests on survives the pick", topic.includes(FULL.basis));
check("each part is its own paragraph", topic.split("\n\n").length === 3);

// needsSource is a note to the OPERATOR. In the prompt it would invite the
// model to reach for the statistic it is forbidden to invent.
const withSource = ideaToTopic({ ...FULL, ...({ needsSource: "typical session temperature" } as object) });
check("a needs-source note never reaches the generator", !withSource.includes("typical session temperature"));

// A sparse idea must not produce dangling labels.
check("a hook alone is just the hook", ideaToTopic({ hook: "Just a headline" }) === "Just a headline");
check(
  "an empty teaches is omitted, not labelled",
  !ideaToTopic({ hook: "H", teaches: "   ", basis: "B" }).includes("What it should teach"),
);
check("whitespace is trimmed", ideaToTopic({ hook: "  H  " }) === "H");

console.log(`\nideaToTopic: ${passed} checks passed`);
