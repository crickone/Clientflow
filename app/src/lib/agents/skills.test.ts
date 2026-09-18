// Run: npm test -- src/lib/agents/skills.test.ts
//
// The allowlist on an agent's row. Everything here is read while composing a
// system prompt, so nothing may throw: a malformed column must cost the agent
// its skills, never its ability to answer.
import assert from "node:assert/strict";

import { parseEnabledSkills, serialiseEnabledSkills } from "./skills.parse";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}
const same = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------------------
// Reading it
// ---------------------------------------------------------------------------
check("a list of ids reads back", same(parseEnabledSkills("[1,4,9]"), [1, 4, 9]));
check("order is kept -- the operator's list order is what they see", same(parseEnabledSkills("[9,1,4]"), [9, 1, 4]));
check("duplicates collapse", same(parseEnabledSkills("[3,3,3]"), [3]));
check("an empty list is no skills", same(parseEnabledSkills("[]"), []));

// A column that has never been written. Every tenant that existed before
// skills did is in exactly this state, and must behave as it always has.
check("null is no skills, not a crash", same(parseEnabledSkills(null), []));
check("undefined likewise", same(parseEnabledSkills(undefined), []));
check("an empty string likewise", same(parseEnabledSkills(""), []));

// Nothing below may throw: this runs inside composeAgentSystem.
check("malformed JSON is no skills", same(parseEnabledSkills("[1,2"), []));
check("an object where an array belongs is no skills", same(parseEnabledSkills('{"a":1}'), []));
check("a bare string is no skills", same(parseEnabledSkills('"nope"'), []));
check("non-numeric entries are dropped, the rest survive", same(parseEnabledSkills('[1,"two",null,3]'), [1, 3]));
check("ids that cannot be real rows are dropped", same(parseEnabledSkills("[0,-2,1.5,7]"), [7]));

// ---------------------------------------------------------------------------
// Writing it
// ---------------------------------------------------------------------------
check("what goes in comes back", same(parseEnabledSkills(serialiseEnabledSkills([2, 5])), [2, 5]));
check("writing dedupes too", serialiseEnabledSkills([2, 2, 5]) === "[2,5]");
check("and refuses impossible ids rather than storing them", serialiseEnabledSkills([0, -1, 3.3, 4]) === "[4]");
check("nothing enabled writes an empty list, not null", serialiseEnabledSkills([]) === "[]");

// THE DEFAULT IS OFF. disabledTools next to it on the same row is a DENYlist,
// so a new tool is on for everyone; a new skill must not be, or adding one to
// the tenant would silently rewrite every agent's prompt.
check(
  "an agent that has never been touched has no skills",
  parseEnabledSkills(null).length === 0,
);

console.log(`\nskills: ${passed} checks passed`);
