// Run: npm test -- src/lib/research/distance.test.ts
//
// Task 2 (Market Research P1) — haversine great-circle distance (pure).
import assert from "node:assert/strict";

import { haversineKm } from "./distance";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

(async () => {
  // Identical point → exactly 0.
  check(
    "identical point = 0 km",
    haversineKm({ lat: 52.355, lng: -7.704 }, { lat: 52.355, lng: -7.704 }) === 0,
  );

  // Clonmel → Dublin ≈ 146 km great-circle.
  const clonmelDublin = haversineKm(
    { lat: 52.355, lng: -7.704 },
    { lat: 53.349, lng: -6.26 },
  );
  check(
    `Clonmel→Dublin ≈ 146 km (got ${clonmelDublin.toFixed(1)})`,
    Math.abs(clonmelDublin - 146) < 15,
  );

  // London → Paris ≈ 344 km great-circle (well-known reference distance).
  const londonParis = haversineKm(
    { lat: 51.5074, lng: -0.1278 },
    { lat: 48.8566, lng: 2.3522 },
  );
  check(
    `London→Paris ≈ 344 km (got ${londonParis.toFixed(1)})`,
    Math.abs(londonParis - 344) < 15,
  );

  // Symmetric: a→b equals b→a.
  const a = { lat: 52.35, lng: -7.7 };
  const b = { lat: 53.0, lng: -7.0 };
  check(
    "symmetric a→b == b→a",
    Math.abs(haversineKm(a, b) - haversineKm(b, a)) < 1e-9,
  );

  // ~0.009° of latitude ≈ 1 km (sanity on the near field, where the radius
  // filter matters most).
  const near = haversineKm({ lat: 52.35, lng: -7.7 }, { lat: 52.359, lng: -7.7 });
  check(`~1 km for 0.009° lat (got ${near.toFixed(3)})`, Math.abs(near - 1) < 0.15);

  console.log(`distance: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
