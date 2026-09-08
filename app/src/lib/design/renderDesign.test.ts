// Run: npm test -- src/lib/design/renderDesign.test.ts
//
// The renderer's normalisation layer, pinned against the shapes that actually
// broke. satori demands an explicit `display` on any element that is not simply
// holding text, and its error ("more than one child node") undersells the rule:
// an EMPTY div throws too. A model writes ordinary HTML, where none of that is
// required, so the renderer translates rather than expecting the prompt to hold.
//
// Every case here is markup a real generation produced.
import assert from "node:assert/strict";

import { loadDesignFonts } from "./fonts";
import { renderDesignToPng } from "./renderDesign";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SHELL = (body: string) =>
  `<div style="display:flex;position:relative;width:400px;height:300px;background:#f2f3ed;font-family:Inter">${body}</div>`;

async function renders(body: string): Promise<boolean> {
  const fonts = await loadDesignFonts("Inter");
  try {
    const png = await renderDesignToPng(SHELL(body), 400, 300, fonts);
    return png.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  // The accent bar that took down three of four slides in a real generation:
  // a positioned block of colour with no children and no display.
  check(
    "an empty div renders (a plain accent bar)",
    await renders(
      `<div style="position:absolute;bottom:20px;right:20px;width:10px;height:120px;background:#b0844f"></div>`,
    ),
  );

  check(
    "a div with several element children renders",
    await renders(
      `<div style="margin:20px"><div style="width:300px">first</div><div style="width:300px">second</div></div>`,
    ),
  );

  check(
    "a div holding only text still renders, and is left alone to wrap",
    await renders(`<div style="width:300px;margin:20px">a heading long enough to wrap onto two lines</div>`),
  );

  check(
    "an explicit display is respected, not overwritten",
    await renders(
      `<div style="display:flex;flex-direction:row;margin:20px"><div style="width:100px">a</div><div style="width:100px">b</div></div>`,
    ),
  );

  // Entities are decoded in text, so a middot is a middot and not six
  // characters -- and an escaped tag stays text rather than becoming markup.
  const fonts = await loadDesignFonts("Inter");
  const png = await renderDesignToPng(
    SHELL(`<div style="width:300px;margin:20px">OPTIMAL &middot; CLONMEL &amp; CO</div>`),
    400,
    300,
    fonts,
  );
  check("entity-bearing text renders", png.length > 0);

  const escaped = await renderDesignToPng(
    SHELL(`<div style="width:300px;margin:20px">&lt;div&gt; stays text</div>`),
    400,
    300,
    fonts,
  );
  check("an escaped tag stays text rather than becoming an element", escaped.length > 0);

  console.log(`\nrenderDesign: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
