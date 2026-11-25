// Run: npm test -- src/lib/booking/clientSearch.test.ts
import assert from "node:assert/strict";

import { clientSubline, displayName, initials, searchClients, splitName } from "./clientSearch";

const people = Array.from({ length: 14 }, (_, i) => ({
  id: i + 1,
  firstName: `Test${i + 1}`,
  lastName: "Person",
  email: i === 3 ? "four@example.com" : null,
  phone: `0800 000 ${String(i + 1).padStart(3, "0")}`,
}));

assert.equal(searchClients(people, "").length, 10, "an empty search lists the first ten");
assert.equal(searchClients(people, "   ").length, 10, "a blank search is an empty search");
assert.deepEqual(searchClients(people, "test1").map((c) => c.id), [1, 10, 11, 12, 13, 14], "name match, case-insensitive");
assert.deepEqual(searchClients(people, "FOUR@").map((c) => c.id), [4], "email match");
assert.deepEqual(searchClients(people, "000 007").map((c) => c.id), [7], "phone match");
assert.deepEqual(searchClients(people, "nobody"), [], "no matches");
assert.equal(searchClients(people, "person", 3).length, 3, "limit applies");

assert.deepEqual(splitName("Mary Anne Smith"), ["Mary", "Anne Smith"]);
assert.deepEqual(splitName("  Mary  "), ["Mary", ""]);
assert.deepEqual(splitName(undefined), ["", ""]);
assert.deepEqual(splitName(""), ["", ""]);

assert.equal(initials("Mary", "Smith"), "MS");
assert.equal(initials("mary", "—"), "M", "a walk-in's placeholder last name is not an initial");
assert.equal(initials("", ""), "?");

assert.equal(displayName("Mary", "Smith"), "Mary Smith");
assert.equal(displayName("Mary", "—"), "Mary");

assert.equal(clientSubline("0800 000 001", new Date("2026-11-24T10:00:00Z"), "Client"), "0800 000 001 · Client since 24 Nov 2026");
assert.equal(clientSubline("—", new Date("2026-11-24T10:00:00Z"), "Member"), "Member since 24 Nov 2026", "no placeholder phone");
assert.equal(clientSubline("0800 000 001", null, "Client"), "0800 000 001");
assert.equal(clientSubline("0800 000 001", "not a date", "Client"), "0800 000 001");

console.log("booking clientSearch: all checks passed.");
