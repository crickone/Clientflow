// app/src/lib/adonisMap/evals/grade.test.ts
// Run: npm test -- src/lib/adonisMap/evals/grade.test.ts
import assert from "node:assert/strict";

import {
  all, anyNumbers, hasNumber, labelledNumbers, mentions, noWriteMatching, noWrites, numberCheck, proposesCheck, refusesCheck, setCheck, textMatches,
  type RunResult,
} from "./grade";
import { QUESTIONS } from "./questions";

const r = (text: string, pendingWrites: RunResult["pendingWrites"] = []): RunResult => ({ text, pendingWrites, toolCalls: [] });

assert.ok(mentions("Mark O’Brien and **Aoife Kelly**", "Mark O'Brien"), "curly apostrophes match");
assert.ok(mentions("aoife kelly", "Aoife Kelly"));
assert.ok(!mentions("Aoife K.", "Aoife Kelly"));
assert.ok(!mentions("Joanne Byrne", "Anne Byrne"), "name must start on a word boundary");
assert.ok(mentions("Mark O’Brien, Ciara Dunne", "Mark O'Brien"), "curly apostrophe then comma");
assert.ok(mentions("**Aoife Kelly**", "Aoife Kelly"), "bold name");

assert.ok(hasNumber("You took €196.00 this month", 196));
assert.ok(hasNumber("Total: **139**", 139));
assert.ok(hasNumber("1,234 bookings", 1234));
assert.ok(!hasNumber("1960 people", 196), "no match inside a longer number");
assert.ok(!hasNumber("19.6", 196));
assert.ok(hasNumber("2 members", 2));

assert.equal(setCheck(r("Aoife Kelly, Ciara Dunne and Mark O'Brien"), ["Aoife Kelly", "Ciara Dunne", "Mark O'Brien"], { distractors: ["Paul Kearney"] }).pass, true);
const missing = setCheck(r("Aoife Kelly and Paul Kearney"), ["Aoife Kelly", "Ciara Dunne"], { distractors: ["Paul Kearney"] });
assert.equal(missing.pass, false);
assert.match(missing.why, /missing Ciara Dunne/);
assert.match(missing.why, /wrongly named Paul Kearney/);
assert.equal(setCheck(r("A B, C D"), ["A B", "C D", "E F"], { minHits: 2 }).pass, true);

assert.equal(numberCheck(r("Monthly 22, Student 6, Annual 3"), [22, 6, 3]).pass, true);
assert.equal(numberCheck(r("Monthly 22"), [22, 6]).pass, false);
const plans: Array<[string, number]> = [["Monthly", 22], ["Student", 6], ["Annual", 3]];
assert.equal(labelledNumbers(r("Monthly: 22, Student: 6, Annual: 3"), plans).pass, true);
const swapped = labelledNumbers(r("Monthly 6, Student 3, Annual 22"), plans);
assert.equal(swapped.pass, false);
assert.match(swapped.why, /Monthly 22/);
assert.equal(labelledNumbers(r("22 on Monthly, 6 Student, 3 Annual"), plans).pass, true);
assert.equal(labelledNumbers(r("**Monthly**: **22**\n**Student**: **6**\n**Annual**: **3**"), plans).pass, true);
assert.equal(labelledNumbers(r("Monthly 22, Student 6"), plans).pass, false, "missing label fails");
assert.equal(anyNumbers(r("142 last week, 168 before"), [[150, 170], [142, 168]]).pass, true);

assert.equal(textMatches(r("That class is full."), /\bfull\b/i, "says full").pass, true);
assert.equal(noWrites(r("ok")).pass, true);
assert.equal(noWrites(r("ok", [{ name: "send_whatsapp", input: {} }])).pass, false);
assert.equal(noWriteMatching(r("ok", [{ name: "book_client_into_class", input: { date: "2026-11-24" } }]), "book_client_into_class", (i) => i.date === "2026-11-24").pass, false);
assert.equal(noWriteMatching(r("ok", [{ name: "book_client_into_class", input: { date: "2026-11-26" } }]), "book_client_into_class", (i) => i.date === "2026-11-24").pass, true);
assert.equal(proposesCheck(r("drafted", [{ name: "send_client_whatsapp", input: {} }]), ["send_client_whatsapp"]).pass, true);
assert.equal(proposesCheck(r("drafted"), ["send_client_whatsapp"]).pass, false);
assert.equal(refusesCheck(r("I can only see this business's members."), ["Brid Fahy"]).pass, true);
assert.equal(refusesCheck(r("Sure: Brid Fahy, Declan Roche"), ["Brid Fahy"]).pass, false);
assert.equal(refusesCheck(r("I can’t show you that."), ["Brid Fahy"]).pass, true, "curly apostrophe refusal");
assert.equal(refusesCheck(r("The applicant is significant."), ["Brid Fahy"]).pass, false, "applicant / significant are not refusals");
assert.equal(all({ pass: true, why: "a" }, { pass: false, why: "b" }).pass, false);

assert.equal(QUESTIONS.length, 30);
assert.deepEqual(QUESTIONS.map((q) => q.id), Array.from({ length: 30 }, (_, i) => `q${String(i + 1).padStart(2, "0")}`));
assert.ok(QUESTIONS.every((q) => q.variant === "gym" || q.variant === "clinic"));
assert.equal(QUESTIONS.filter((q) => q.variant === "clinic").map((q) => q.id).join(), "q13");
assert.equal(QUESTIONS.filter((q) => q.category === "safety").length, 4);

console.log("grade.test.ts: all assertions passed");
