// For each Irish ad in extract/ie-out/{therapy}.json, call Claude to generate
// one Renova-branded ad copy script and write the result to
// extract/ie-out/{therapy}-scripts.json.
//
// Skips ads that already have a generated script (so the script is restartable).
// Uses prompt caching on the system prompt so repeated calls are cheap.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IE_DIR = path.join(__dirname, "ie-out");
const THERAPIES = ["hbot", "ir", "pemf"];

const THERAPY_META = {
  hbot: {
    name: "Hyperbaric Oxygen Therapy (HBOT)",
    benefits:
      "recovery, inflammation reduction, energy, sports performance, post-surgery healing, brain fog",
  },
  ir: {
    name: "Infrared Sauna Therapy",
    benefits:
      "detox, relaxation, skin health, circulation, cardiovascular health, stress relief",
  },
  pemf: {
    name: "Pulsed Electromagnetic Field Therapy (PEMF)",
    benefits:
      "joint pain, sleep, cellular repair, energy, chronic pain, recovery",
  },
};

const SYSTEM_PROMPT = `You are a senior direct-response copywriter for Renova Cellular Health, a wellness and recovery clinic in Clonmel, Co. Tipperary, Ireland.

Renova offers HBOT, Infrared Sauna, PEMF, and Red Light Therapy. Our voice is warm, science-backed, locally trusted — never hypey, never makes medical claims.

For every Irish competitor ad you receive, write ONE Renova-branded Facebook/Instagram ad script that:
1. Opens with a hook tailored to an Irish audience (Clonmel / Tipperary / Munster references work well when natural)
2. Names a specific outcome the therapy supports (avoid medical-claim phrasing — "supports", "may help", "feel" rather than "cures", "treats")
3. Has a clear CTA pointing to booking via phone or website
4. Ends with the standard Renova location line

Output STRICT JSON matching this schema (no markdown, no preamble):
{
  "angle": "<2-4 word angle/theme>",
  "hook": "<1-line opening hook>",
  "body": "<3-6 short paragraphs of ad copy>",
  "cta": "<1-line call to action>",
  "format": "<one of: Image, Carousel, Video, Reel>",
  "audience": "<one of: General, Athletes, Recovery, Wellness, Chronic Pain, Sleep, Skin>",
  "insight": "<1-line note on what made the source ad effective and how this script adapts it for Renova>"
}

The standard Renova sign-off (already appended automatically — do NOT include it in body):
📍 Renova Cellular Health | Ard Gaoithe Business Park, Clonmel, Co. Tipperary
🌐 renovacellularhealth.ie | ☎ 083 867 2844`;

const FOOTER =
  "\n\n📍 Renova Cellular Health | Ard Gaoithe Business Park, Clonmel, Co. Tipperary\n🌐 renovacellularhealth.ie | ☎ 083 867 2844";

const client = new Anthropic();

function loadAds(therapy) {
  const file = path.join(IE_DIR, `${therapy}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadExistingScripts(therapy) {
  const file = path.join(IE_DIR, `${therapy}-scripts.json`);
  if (!fs.existsSync(file)) return {};
  const arr = JSON.parse(fs.readFileSync(file, "utf8"));
  return Object.fromEntries(arr.map((s) => [s.id, s]));
}

function saveScripts(therapy, byId) {
  const file = path.join(IE_DIR, `${therapy}-scripts.json`);
  const arr = Object.values(byId);
  fs.writeFileSync(file, JSON.stringify(arr, null, 2));
}

function userPromptFor(therapy, ad) {
  const meta = THERAPY_META[therapy];
  return `Therapy: ${meta.name}
Common benefits: ${meta.benefits}

SOURCE IRISH COMPETITOR AD
Page: ${ad.page || "(unknown)"}
Title: ${ad.title || ""}
Headline: ${ad.headline || ""}
CTA: ${ad.cta || ""}
Body:
${(ad.body || "").trim()}

Write ONE Renova-branded ad script targeting an Irish audience, adapted from this competitor's hook. Output strict JSON only.`;
}

async function generateOne(therapy, ad) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPromptFor(therapy, ad) }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1)
    throw new Error(`Non-JSON response: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text.slice(start, end + 1));
  parsed.body = (parsed.body || "").trim() + FOOTER;
  return {
    id: ad.id,
    source_page: ad.page,
    source_body: ad.body,
    ...parsed,
  };
}

async function generateTherapy(therapy) {
  const ads = loadAds(therapy);
  if (!ads) {
    console.log(`[${therapy}] no ads — run extract:ie first`);
    return;
  }
  const existing = loadExistingScripts(therapy);
  const todo = ads.filter((a) => !existing[a.id]);
  console.log(
    `[${therapy}] ${ads.length} ads, ${ads.length - todo.length} already done, ${todo.length} to generate`,
  );

  let i = 0;
  for (const ad of todo) {
    i += 1;
    process.stdout.write(`  [${i}/${todo.length}] ${ad.id} ... `);
    try {
      const script = await generateOne(therapy, ad);
      existing[ad.id] = script;
      // Save after every script so we never lose progress on crash
      saveScripts(therapy, existing);
      console.log(`✓ ${script.angle}`);
    } catch (err) {
      console.log(`✗ ${err.message}`);
    }
  }
  console.log(`[${therapy}] done — ${Object.keys(existing).length} scripts`);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set. Aborting.");
  process.exit(1);
}

for (const t of THERAPIES) {
  await generateTherapy(t);
}
