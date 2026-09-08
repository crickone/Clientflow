// Run: npm test -- src/lib/design/htmlAudit.test.ts
//
// The audit on AI-authored design markup. It is DELIBERATELY NARROW: it catches
// colours that are not in the tenant's palette, and the system's
// forbidden-as-type value used as text. It does NOT resolve which ground a text
// node sits over -- that needs layout, not parsing, and the real check on a
// free-form design is looking at the rendered image.
import assert from "node:assert/strict";

import { auditDesignHtml, extractColours } from "./htmlAudit";
import { OPTIMAL_HEALTH_DESIGN_SYSTEM as SYSTEM } from "./presets";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const onPalette = `<div style="display:flex;background:#c7d2bb">
  <div style="color:#24231f">Recovery is a practice</div>
  <div style="width:132px;height:3px;background:#b0844f"></div>
</div>`;

check("a design in palette passes", auditDesignHtml(onPalette, SYSTEM).ok);
check(
  "every colour is found",
  extractColours(onPalette).sort().join() === "#24231f,#b0844f,#c7d2bb",
);
check(
  "case is normalised",
  extractColours('<i style="color:#C7D2BB">x</i>')[0] === "#c7d2bb",
);
check(
  "rgba is read as well as hex",
  extractColours('<i style="background:rgba(36,35,31,0.6)">x</i>').length === 1,
);

// The drift a closed palette exists to prevent.
const offPalette = `<div style="display:flex;background:#ff00ff"><span style="color:#24231f">x</span></div>`;
const off = auditDesignHtml(offPalette, SYSTEM);
check("an off-palette colour fails", !off.ok);
check(
  "and the violation names the colour and says the palette is closed",
  !off.ok && off.violations.some((v) => v.includes("#ff00ff") && v.includes("closed")),
);

// The document's own gotcha: timber is the prettiest value and fails as text.
const timberType = `<div style="display:flex;background:#c7d2bb"><span style="color:#b0844f">x</span></div>`;
const timber = auditDesignHtml(timberType, SYSTEM);
check("the forbidden-as-type value fails as a color", !timber.ok);
check("and the violation names it", !timber.ok && timber.violations.some((v) => v.includes("timber")));
check(
  "but timber as a BACKGROUND is fine, which is what an accent is for",
  auditDesignHtml(
    `<div style="display:flex;background:#b0844f;width:132px;height:3px"></div>`,
    SYSTEM,
  ).ok,
);

// A scrim over a photograph is not palette drift.
check(
  "rgba overlays are exempt",
  auditDesignHtml(
    `<div style="display:flex;background:rgba(36,35,31,0.55)"><span style="color:#f2f3ed">x</span></div>`,
    SYSTEM,
  ).ok,
);
check(
  "including in a gradient, which is how a scrim is actually built",
  auditDesignHtml(
    `<div style="display:flex;background:linear-gradient(180deg, rgba(36,35,31,0.1), rgba(36,35,31,0.9))"></div>`,
    SYSTEM,
  ).ok,
);

// A hex inside a data URI is image bytes, not a colour. Base64 payloads are
// long strings of exactly the characters a hex matcher looks for.
check(
  "a base64 photo payload does not produce phantom colours",
  auditDesignHtml(
    `<div style="display:flex;background:#f2f3ed"><img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD128abcdef0099ff/2wCEAAkGBw==" style="width:100px;height:100px" /></div>`,
    SYSTEM,
  ).ok,
);

check(
  "auditing never throws, whatever it is handed",
  (() => {
    try {
      auditDesignHtml("<<<not html", SYSTEM);
      auditDesignHtml("", SYSTEM);
      extractColours("");
      return true;
    } catch {
      return false;
    }
  })(),
);

console.log(`\nhtmlAudit: ${passed} checks passed`);
