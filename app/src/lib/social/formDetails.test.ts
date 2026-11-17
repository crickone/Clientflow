// Run: npm test -- src/lib/social/formDetails.test.ts
import assert from "node:assert/strict";

import { hasFormDetails, parseFormDetails } from "./formDetails";

// The real shape Meta sends for a click-to-Messenger ad form (from Optimal Health's inbox).
const marina = parseFormDetails(
  [
    "Hello! I filled out your form and would like to know more about your business.",
    "What town are you living?: clonmel",
    "Full name: marinahewitt",
    "Have you used these therapies before?: No",
    "Which treatment are you interested in?: Infrared Therapy",
    "Phone number: 089 401 8010",
    "Email: MarinaGHewitt@gmail.com",
  ].join("\n"),
);
assert.deepEqual(marina, { firstName: "Marinahewitt", lastName: null, email: "marinaghewitt@gmail.com", phone: "089 401 8010" });

assert.deepEqual(parseFormDetails("Full name: sean o'brien\nE-mail: sean@x.ie"), { firstName: "Sean", lastName: "O'brien", email: "sean@x.ie", phone: null });
assert.deepEqual(parseFormDetails("First name: Aoife\nSurname: McCarthy\nMobile: +353 87 123 4567"), { firstName: "Aoife", lastName: "McCarthy", email: null, phone: "+353 87 123 4567" });

// Questions that merely contain a keyword are not names or numbers.
const noise = parseFormDetails("What town are you living?: clonmel\nHow many sessions a week?: 3\nMembership number: 12345678\nEmail: not an email");
assert.deepEqual(noise, { firstName: null, lastName: null, email: null, phone: null });
assert.equal(hasFormDetails(noise), false);

// A plain chat message gives nothing.
assert.equal(hasFormDetails(parseFormDetails("Wherer are ye")), false);
assert.equal(hasFormDetails(parseFormDetails("I will ring when ime ready ty")), false);

console.log("social/formDetails: ok");
