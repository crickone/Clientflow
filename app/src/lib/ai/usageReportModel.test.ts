// Run: npm test -- src/lib/ai/usageReportModel.test.ts
//
// The AI usage page: each account sees what its AI spend went on. These
// check the plain feature names and how calls group into pieces of work.
import assert from "node:assert/strict";

import { byFeature, featureOf, formatSpend, groupActivity, type UsageRow } from "./usageReportModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

check("Adonis's keys all read as Adonis", featureOf("orchestrator") === "Adonis" && featureOf("marketing") === "Adonis");
check("post designs have a plain name", featureOf("carousel") === "Post designs");
check("an unknown key is still readable", featureOf("new_thing") === "New thing");

const d = (iso: string) => Date.parse(iso);
const rows: UsageRow[] = [
  { at: d("2026-10-14T10:00:00Z"), agentKey: "orchestrator", cents: 12, ref: "campaign:2", label: "Black Friday" },
  { at: d("2026-10-14T10:05:00Z"), agentKey: "carousel", cents: 40, ref: "campaign:2", label: "Black Friday Massage 2026" },
  { at: d("2026-10-14T09:00:00Z"), agentKey: "orchestrator", cents: 3, ref: "chat:abc", label: "Adonis: How many clients" },
  { at: d("2026-10-13T08:00:00Z"), agentKey: "brief", cents: 1, ref: null, label: null },
  { at: d("2026-10-13T09:00:00Z"), agentKey: "brief", cents: 1, ref: null, label: null },
  { at: d("2026-10-12T09:00:00Z"), agentKey: "brief", cents: 1, ref: null, label: null },
];
const groups = groupActivity(rows);
check("one line per piece of work", groups.length === 4);
const camp = groups[0];
check("newest first, and a campaign groups all its calls", camp.key === "campaign:2" && camp.calls === 2 && camp.cents === 52);
check("a campaign is named by its latest label", camp.title === "Black Friday Massage 2026");
check("its parts are split by feature, biggest first", camp.parts[0].feature === "Post designs" && camp.parts[1].feature === "Adonis");
check("a chat is its own line", groups[1].kind === "chat" && groups[1].title === "Adonis: How many clients");
const briefs = groups.filter((g) => g.title === "Daily brief");
check("untagged calls group by feature and day", briefs.length === 2 && briefs[0].calls === 2);

const feats = byFeature(rows);
check("by feature merges keys and sorts biggest first", feats[0].feature === "Post designs" && feats[1].feature === "Adonis" && feats[1].cents === 15);

check("euros from cents", formatSpend(243) === "€2.43");
check("fractions of a cent round", formatSpend(1072.4) === "€10.72");
check("tiny costs say so", formatSpend(0.2) === "under €0.01");
check("nothing is €0.00", formatSpend(0) === "€0.00");

console.log(`usageReportModel: ${passed} checks passed`);
