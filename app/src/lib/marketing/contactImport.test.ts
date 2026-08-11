// Run: npm test -- src/lib/marketing/contactImport.test.ts
import assert from "node:assert/strict";
import {
  parseCsv,
  suggestMapping,
  mapRow,
  validateRow,
  dedupeKey,
  parseTags,
} from "./contactImport";

// Async IIFE (not top-level await): package.json has no "type":"module", so
// tsx compiles .ts to CJS where top-level await is unsupported. Mirrors
// apiKeys.test.ts / memberImport.test.ts. These are pure functions — no DB,
// no tenant context.
(async () => {
  // ── a quoted-comma CSV parses correctly ──
  {
    const csv = [
      "Name,Email,Phone",
      '"Brennan, Aoife",aoife@example.com,"085 123 4567"',
      "Cian Murphy,cian@example.com,0851112222",
    ].join("\n");
    const { headers, rows } = parseCsv(csv);
    assert.deepEqual(headers, ["Name", "Email", "Phone"]);
    assert.equal(rows.length, 2, "two data rows");
    // The quoted comma stays inside one field (not split into two columns).
    assert.deepEqual(rows[0], ["Brennan, Aoife", "aoife@example.com", "085 123 4567"]);
  }

  // ── tab + semicolon delimiters are sniffed ──
  {
    assert.deepEqual(parseCsv("a\tb\tc\n1\t2\t3").headers, ["a", "b", "c"]);
    assert.deepEqual(parseCsv("a;b;c\n1;2;3").rows[0], ["1", "2", "3"]);
  }

  // ── a leading UTF-8 BOM is stripped from the header ──
  {
    const csv = "﻿Email,Name\nx@y.ie,X";
    const { headers, rows } = parseCsv(csv);
    assert.deepEqual(headers, ["Email", "Name"]);
    assert.deepEqual(rows[0], ["x@y.ie", "X"]);
  }

  // ── blank trailing records are dropped; empty input is safe ──
  {
    assert.deepEqual(parseCsv("Email,Name\nx@y.ie,X\n\n"), {
      headers: ["Email", "Name"],
      rows: [["x@y.ie", "X"]],
      delimiter: ",",
    });
    assert.deepEqual(parseCsv(""), { headers: [], rows: [], delimiter: "," });
  }

  // ── a GoHighLevel/Mailchimp-style header row auto-maps ──
  {
    const mapping = suggestMapping(["Contact Name", "Email Address", "Mobile Phone", "Tags"]);
    assert.equal(mapping.name, 0, "Contact Name → name");
    assert.equal(mapping.email, 1, "Email Address → email");
    assert.equal(mapping.phone, 2, "Mobile Phone → phone");
    assert.equal(mapping.tags, 3, "Tags → tags");
  }

  // ── "First Name" deliberately does NOT auto-map to `name` (no split first/
  // last slot in this field model — would silently drop the surname) ──
  {
    const mapping = suggestMapping(["First Name", "Last Name", "Email"]);
    assert.equal(mapping.name, undefined);
    assert.equal(mapping.email, 2);
  }

  // ── column + field are each claimed at most once ──
  {
    const mapping = suggestMapping(["Email", "Contact Email", "Name"]);
    assert.equal(mapping.email, 0);
    assert.equal(mapping.name, 2);
  }

  // ── mapRow + validateRow: blocking vs warning ──
  {
    const good = validateRow(
      mapRow(["aoife@example.com", "Aoife Brennan", "0851234567", "vip"], {
        email: 0,
        name: 1,
        phone: 2,
        tags: 3,
      }),
    );
    assert.equal(good.ok, true);
    assert.deepEqual(good.errors, []);
    assert.deepEqual(good.warnings, []);

    // Missing email → blocking error.
    const noEmail = validateRow(mapRow(["", "Aoife"], { email: 0, name: 1 }));
    assert.equal(noEmail.ok, false);
    assert.ok(noEmail.errors.includes("Missing email"));

    // Malformed email → blocking error.
    const badEmail = validateRow(mapRow(["not-an-email", "Aoife"], { email: 0, name: 1 }));
    assert.equal(badEmail.ok, false);
    assert.ok(badEmail.errors.includes("Invalid email address"));

    // Missing name/phone → non-blocking warnings (still importable — a
    // contact only strictly needs an email).
    const emailOnly = validateRow(mapRow(["a@b.ie"], { email: 0 }));
    assert.equal(emailOnly.ok, true);
    assert.ok(emailOnly.warnings.includes("No name"));
    assert.ok(emailOnly.warnings.includes("No phone"));
  }

  // ── dedupeKey: email only, case-insensitive, null when absent ──
  {
    assert.equal(dedupeKey({ email: "Foo@Bar.COM" }), "foo@bar.com");
    assert.equal(dedupeKey({ email: "  MixedCase@X.ie " }), "mixedcase@x.ie");
    assert.equal(dedupeKey({}), null);
    assert.equal(dedupeKey({ email: "" }), null);
  }

  // ── parseTags: multi-delimiter split, trimmed, case-insensitive de-dupe ──
  {
    assert.deepEqual(parseTags("vip, lead, newsletter"), ["vip", "lead", "newsletter"]);
    assert.deepEqual(parseTags("vip; lead; newsletter"), ["vip", "lead", "newsletter"]);
    assert.deepEqual(parseTags("vip|lead|newsletter"), ["vip", "lead", "newsletter"]);
    // Mixed delimiters, ragged whitespace.
    assert.deepEqual(parseTags(" VIP ,lead ;; newsletter"), ["VIP", "lead", "newsletter"]);
    // Case-insensitive de-dupe, first-seen casing wins.
    assert.deepEqual(parseTags("VIP, vip, Vip"), ["VIP"]);
    // Empty / whitespace-only → no tags.
    assert.deepEqual(parseTags(""), []);
    assert.deepEqual(parseTags("   "), []);
  }

  console.log("contactImport.test.ts: all assertions passed");
})();
