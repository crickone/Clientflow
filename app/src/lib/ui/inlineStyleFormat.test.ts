// Run: npm test -- src/lib/ui/inlineStyleFormat.test.ts
//
// globals.css collapses two-column layouts to one on a phone by matching the
// inline style attribute itself:
//
//   [style*="grid-template-columns:1fr 1fr"] { grid-template-columns: 1fr !important; }
//
// That is the only way to reach ~65 grids written as inline styles, which
// cannot carry a media query of their own. It works because React serialises
// inline styles as `prop:value` with NO space after the colon — an
// implementation detail of react-dom, not something React promises.
//
// So it is pinned here. If a React upgrade ever emits `prop: value` instead,
// this fails loudly on the next run rather than every phone quietly going back
// to two cramped columns with nothing in the diff to explain it.
import assert from "node:assert/strict";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// Rendered in a CHILD process, deliberately.
//
// scripts/test.mjs runs every test under `--conditions=react-server`, where
// the `react` entry point throws outright -- which is why the rest of the
// suite stubs React away entirely. A stub cannot answer the only question
// this file asks, so the render happens in a plain Node process with that
// condition stripped (it inherits through NODE_OPTIONS, hence the explicit
// removal), using the real react-dom serialiser the browser also uses.
const { execFileSync } = require("node:child_process") as typeof import("node:child_process");

function styleFor(style: Record<string, string | number>): string {
  const script = `
    const React = require("react");
    const { renderToStaticMarkup } = require("react-dom/server");
    const html = renderToStaticMarkup(
      React.createElement("div", { style: ${JSON.stringify(style)} }),
    );
    process.stdout.write((/style="([^"]*)"/.exec(html) || ["", ""])[1]);
  `;
  const env = { ...process.env };
  env.NODE_OPTIONS = (env.NODE_OPTIONS ?? "")
    .split(" ")
    .filter((f) => !f.startsWith("--conditions"))
    .join(" ")
    .trim();
  return execFileSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
  });
}

{
  const s = styleFor({ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 });
  // THE SELECTOR'S EXACT SUBSTRING. If this assertion is what broke, the fix
  // is to update the selector in globals.css to whatever React now emits.
  check(
    'a two-column grid contains "grid-template-columns:1fr 1fr" verbatim',
    s.includes("grid-template-columns:1fr 1fr"),
  );
  check("camelCase is hyphenated", s.includes("grid-template-columns"));
  check("there is no space after the colon", !s.includes("grid-template-columns: "));
  check("a numeric gap still gains its px unit", s.includes("gap:16px"));
}

check(
  "a three-column grid is caught by the same substring, which is wanted",
  styleFor({ gridTemplateColumns: "1fr 1fr 1fr" }).includes("grid-template-columns:1fr 1fr"),
);
check(
  "the weighted split the selector lists separately is emitted as written",
  styleFor({ gridTemplateColumns: "1.4fr 1fr" }).includes("grid-template-columns:1.4fr 1fr"),
);

// These must NOT be caught: a photo library stays three across on a phone
// (113px tiles is a picker, not a cramped form) and a week is seven days
// whatever the screen.
{
  const photos = styleFor({ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" });
  const week = styleFor({ gridTemplateColumns: "repeat(7, 1fr)" });
  check(
    "a repeat() photo grid does not contain the collapsing substring",
    !photos.includes("grid-template-columns:1fr 1fr"),
  );
  check(
    "nor does a seven-day week",
    !week.includes("grid-template-columns:1fr 1fr"),
  );
  check(
    "and repeat() values are passed through unchanged, so the exclusion is stable",
    photos.includes("repeat(3, minmax(0, 1fr))"),
  );
}

console.log(`\ninlineStyleFormat: ${passed} checks passed`);
