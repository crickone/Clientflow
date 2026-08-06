// Run: npm test -- src/lib/memberImport.test.ts
import assert from "node:assert/strict";
import {
  parseCsv,
  suggestMapping,
  mapRow,
  validateRow,
  dedupeKey,
  normalizeDate,
} from "./memberImport";

// Async IIFE (not top-level await): package.json has no "type":"module", so
// tsx compiles .ts to CJS where top-level await is unsupported. Mirrors
// apiKeys.test.ts. These are pure functions — no DB, no tenant context.
(async () => {
  // ── a quoted-comma CSV parses correctly ──
  {
    const csv = [
      "First Name,Last Name,Email,Notes",
      'Aoife,"Brennan, Jr.",aoife@example.com,"Loves HIIT, hates burpees"',
      'Cian,Murphy,cian@example.com,"Line one\nline two"',
    ].join("\n");
    const { headers, rows } = parseCsv(csv);
    assert.deepEqual(headers, ["First Name", "Last Name", "Email", "Notes"]);
    assert.equal(rows.length, 2, "two data rows");
    // The quoted comma stays inside one field (not split into two columns).
    assert.deepEqual(rows[0], [
      "Aoife",
      "Brennan, Jr.",
      "aoife@example.com",
      "Loves HIIT, hates burpees",
    ]);
    // A quoted newline stays inside the field (row not split).
    assert.equal(rows[1][3], "Line one\nline two");
  }

  // ── tab + semicolon delimiters are sniffed ──
  {
    assert.deepEqual(parseCsv("a\tb\tc\n1\t2\t3").headers, ["a", "b", "c"]);
    assert.deepEqual(parseCsv("a;b;c\n1;2;3").rows[0], ["1", "2", "3"]);
  }

  // ── a Mindbody-style header row auto-maps ──
  {
    const headers = ["Client ID", "First Name", "Last Name", "Email", "Mobile Phone"];
    const mapping = suggestMapping(headers);
    assert.equal(mapping.firstName, 1, "First Name → firstName");
    assert.equal(mapping.lastName, 2, "Last Name → lastName");
    assert.equal(mapping.email, 3, "Email → email");
    assert.equal(mapping.phone, 4, "Mobile Phone → phone");
    assert.equal(mapping.notes, undefined, "no notes column present");
  }

  // ── competitor variants (Glofox / LegitFit / TeamUp) auto-map ──
  {
    const mapping = suggestMapping([
      "Forename",
      "Surname",
      "Email Address",
      "Telephone",
      "Membership Type",
      "Date Joined",
    ]);
    assert.equal(mapping.firstName, 0);
    assert.equal(mapping.lastName, 1);
    assert.equal(mapping.email, 2);
    assert.equal(mapping.phone, 3);
    assert.equal(mapping.membershipPlan, 4);
    assert.equal(mapping.joinDate, 5);
  }

  // ── dedupe by email is case-insensitive ──
  {
    assert.equal(dedupeKey({ email: "Foo@Bar.COM" }).email, "foo@bar.com");
    assert.equal(
      dedupeKey({ email: "  MixedCase@X.ie " }).email,
      "mixedcase@x.ie",
    );
    // phone reduced to digits; absent values → null
    assert.equal(dedupeKey({ phone: "+353 (85) 123-4567" }).phone, "353851234567");
    assert.deepEqual(dedupeKey({}), { email: null, phone: null });
  }

  // ── validateRow: blocking vs warning ──
  {
    const good = validateRow(
      mapRow(["Aoife", "Brennan", "aoife@example.com", "0851234567"], {
        firstName: 0,
        lastName: 1,
        email: 2,
        phone: 3,
      }),
    );
    assert.equal(good.ok, true);
    assert.deepEqual(good.errors, []);

    // No name at all → blocking error.
    const noName = validateRow(mapRow(["", "", "x@y.ie"], { firstName: 0, lastName: 1, email: 2 }));
    assert.equal(noName.ok, false);
    assert.ok(noName.errors.includes("Missing name"));

    // Malformed email → blocking error.
    const badEmail = validateRow(mapRow(["A", "B", "not-an-email"], { firstName: 0, lastName: 1, email: 2 }));
    assert.equal(badEmail.ok, false);

    // Missing phone → non-blocking warning (still importable).
    const noPhone = validateRow(mapRow(["A", "B", "a@b.ie"], { firstName: 0, lastName: 1, email: 2 }));
    assert.equal(noPhone.ok, true);
    assert.ok(noPhone.warnings.includes("No phone"));
  }

  // ── normalizeDate: multiple shapes, IE-first ambiguity ──
  {
    assert.equal(normalizeDate("2024-03-07"), "2024-03-07");
    assert.equal(normalizeDate("07/03/2024"), "2024-03-07"); // DD/MM default
    assert.equal(normalizeDate("13/02/2024"), "2024-02-13"); // 13 forces DD/MM
    assert.equal(normalizeDate("02/13/2024"), "2024-02-13"); // 13 forces MM/DD
    assert.equal(normalizeDate("5 Jan 2024"), "2024-01-05");
    assert.equal(normalizeDate("garbage"), null);
    assert.equal(normalizeDate(""), null);
  }

  console.log("memberImport.test.ts: all assertions passed");
})();
