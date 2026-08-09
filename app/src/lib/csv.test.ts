// Run: npm test -- src/lib/csv.test.ts
//
// Batch 2d (CSV formula-injection guard, improvement-plan-2026-08.md Theme
// B5): api/export/route.ts's csvEscape quoted `",\n` but didn't neutralize a
// leading =, +, -, @, tab, or CR — a client name/email from public lead input
// could plant a formula that executes when an admin opens the export in
// Excel/Sheets. csvEscape now prefixes those with a defusing `'`.
import assert from "node:assert/strict";
import { csvEscape } from "./csv";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(
    actual,
    expected,
    `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
  passed++;
  console.log("  ✓", name);
}

// ── the formula-injection guard ──
check("= prefix defused", csvEscape("=cmd|'/c calc'!A1"), "'=cmd|'/c calc'!A1");
check("+ prefix defused", csvEscape("+1+1"), "'+1+1");
check("- prefix defused (string)", csvEscape("-2+3"), "'-2+3");
check("@ prefix defused", csvEscape("@cmd"), "'@cmd");
check("tab prefix defused", csvEscape("\tevil"), "'\tevil");
check("CR prefix defused", csvEscape("\revil"), "'\revil");

// ── normal values: unchanged (existing behaviour preserved) ──
check("plain name unchanged", csvEscape("John Doe"), "John Doe");
check("email unchanged (@ not leading)", csvEscape("john@example.com"), "john@example.com");
check("phone with leading + still readable as text", csvEscape("+353851234567"), "'+353851234567");
check("null -> empty", csvEscape(null), "");
check("undefined -> empty", csvEscape(undefined), "");
check("empty string unchanged", csvEscape(""), "");

// ── numbers: guard doesn't touch them — never attacker text, and mangling a
//    legitimate negative amount into quoted text would be a regression ──
check("negative number unchanged", csvEscape(-5), "-5");
check("positive number unchanged", csvEscape(5), "5");
check("zero unchanged", csvEscape(0), "0");

// ── existing comma/quote/newline quoting still applies, after the guard ──
check("comma still quoted", csvEscape("a,b"), '"a,b"');
check("quote still escaped+quoted", csvEscape('say "hi"'), '"say ""hi"""');
check("newline still quoted", csvEscape("a\nb"), '"a\nb"');
check("formula + comma: prefixed then quoted", csvEscape("=a,b"), `"'=a,b"`);

console.log(`\ncsv: ${passed} checks passed.`);
