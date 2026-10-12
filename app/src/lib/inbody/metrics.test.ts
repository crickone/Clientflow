// Run: npm test -- src/lib/inbody/metrics.test.ts
//
// One measurement arrives under three spellings (abbreviated API, full API,
// LookinBody CSV), and the scanner stamps scans in Irish local time with no
// zone. These checks pin both, since a wrong alias reads a scan as empty and
// a wrong zone shifts every scan an hour in summer.
import assert from "node:assert/strict";

import {
  formatChange,
  formatInBodyDatetime,
  parseInBodyDatetime,
  parseLooseDate,
  readMetrics,
  scansFromCsv,
} from "./metrics";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log(`  ✓ ${name}`);
}

const abbreviated = readMetrics({ WT: "72.4", SMM: 31.2, PBF: "24.1", VFL: "7", BMR: "1580" });
check("abbreviated API fields are read", abbreviated.weight === 72.4 && abbreviated.smm === 31.2 && abbreviated.pbf === 24.1 && abbreviated.vfl === 7 && abbreviated.bmr === 1580);

const full = readMetrics({ "Weight": "80.0", "SMM(SkeletalMuscleMass)": "35.5", "PBF(PercentBodyFat)": "18.2", "LeanMassofRightArm": "3.41" });
check("full API fields are read", full.weight === 80 && full.smm === 35.5 && full.pbf === 18.2 && full.leanRightArm === 3.41);

const nested = readMetrics([{ Data: { BFM: "15.1kg" } }]);
check("a nested array result is read, and units are stripped", nested.bfm === 15.1);

check("unknown fields are ignored", Object.keys(readMetrics({ Name: "Aoife", Age: 40 })).length === 0);

// 12 Oct 2026 is Irish Summer Time (UTC+1); 12 Jan is UTC+0.
check("a summer scan converts from Irish time to UTC", parseInBodyDatetime("20261012083000") === Date.UTC(2026, 9, 12, 7, 30, 0));
check("a winter scan has no offset", parseInBodyDatetime("20260112083000") === Date.UTC(2026, 0, 12, 8, 30, 0));
check("formatting round-trips", formatInBodyDatetime(parseInBodyDatetime("20261012083005")!) === "20261012083005");
check("a nonsense datetime is refused", parseInBodyDatetime("2026") === null && parseInBodyDatetime("20261340") === null);
check("day-first dates read as Irish", parseLooseDate("12/10/2026 08:30") === Date.UTC(2026, 9, 12, 7, 30, 0));
check("ISO-style dates read", parseLooseDate("2026-01-12 08:30") === Date.UTC(2026, 0, 12, 8, 30, 0));

const csv = scansFromCsv(
  ["Name", "Mobile Number", "Test Date / Time", "Weight", "SMM(Skeletal Muscle Mass)", "PBF(Percent Body Fat)", "Visceral Fat Level"],
  [
    ["Aoife Brennan", "085 123 4567", "12.10.2026 08:30", "72.4", "31.2", "24.1", "7"],
    ["No date", "085 000 0000", "", "70", "30", "20", "5"],
  ],
);
check("a LookinBody CSV row becomes a scan", csv.scans.length === 1 && csv.scans[0].metrics.smm === 31.2 && csv.scans[0].metrics.vfl === 7 && csv.scans[0].phone === "085 123 4567");
check("a row without a date is skipped and counted", csv.skipped === 1);

check("muscle going up is good", formatChange("smm", 32, 31)?.tone === "good" && formatChange("smm", 32, 31)?.text === "+1.0 kg");
check("body fat going up is bad, in points", formatChange("pbf", 25, 24)?.tone === "bad" && formatChange("pbf", 25, 24)?.text === "+1.0 pts");
check("weight has no direction", formatChange("weight", 70, 72)?.tone === "flat");

console.log(`\ninbody metrics: ${passed} checks passed`);
