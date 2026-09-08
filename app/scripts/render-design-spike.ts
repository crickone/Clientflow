// Run: NODE_OPTIONS="--conditions=react-server" npx tsx scripts/render-design-spike.ts
//
// The `react-server` condition resolves the `server-only` guard to its no-op
// export, the same way scripts/test.mjs runs the test files. A plain .ts file
// (not .mts) because tsx compiles this project's modules as CJS, and an ESM
// entry point cannot statically read their named exports.
//
// A smoke test you LOOK at, not an assertion. It proves the three things that
// must line up for a designed slide to exist at all: real font bytes load,
// satori lays the markup out, and sharp rasterises it. A SERIF heading in the
// output means the font did not load -- satori falls back silently.
import { writeFileSync } from "node:fs";

import { loadDesignFonts } from "../src/lib/design/fonts";
import { renderDesignToPng } from "../src/lib/design/renderDesign";

async function main() {
  const fonts = await loadDesignFonts("Inter");
  const png = await renderDesignToPng(
    `<div style="display:flex;width:1080px;height:1080px;background:#c7d2bb;font-family:Inter;position:relative">
       <div style="display:flex;flex-direction:column;position:absolute;left:76px;top:180px;width:820px">
         <div style="display:flex;width:132px;height:3px;background:#b0844f;margin-bottom:30px"></div>
         <div style="display:flex;font-size:15px;font-weight:600;letter-spacing:3px;color:#5e6b4e;margin-bottom:26px">HYPERBARIC OXYGEN</div>
         <div style="display:flex;font-size:104px;font-weight:600;color:#24231f;letter-spacing:-0.042em;line-height:0.97">It's not the oxygen. It's the pressure.</div>
       </div>
       <div style="display:flex;position:absolute;left:76px;bottom:64px;font-size:15px;font-weight:600;letter-spacing:3px;color:#5e6b4e">OPTIMAL HEALTH &middot; CLONMEL</div>
     </div>`,
    1080,
    1080,
    fonts,
  );
  writeFileSync("/tmp/design-spike.png", png);
  console.log("wrote /tmp/design-spike.png", (png.length / 1024).toFixed(0) + "KB");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
