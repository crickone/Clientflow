#!/usr/bin/env node
// The Healthwise photography: an art-directed set generated with FLUX 1.1 Pro
// (the platform's own image model, fal.ai), reviewed by eye, then graded so
// generated and real photographs sit together.
//
//   railway run node ../sites/healthwise/photos.mjs list         (from app/)
//   railway run node ../sites/healthwise/photos.mjs generate     all shots, 4 candidates each
//   railway run node ../sites/healthwise/photos.mjs generate hero-portrait vitality
//   node photos.mjs pick hero-portrait:2 livewell:1 ...          copy + grade the keepers
//
// `railway run` injects the linked service's variables, which is how FAL_KEY
// reaches this script without ever being written down. Candidates land in
// assets/ai/ (gitignored); only picks are committed, with their prompts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const AI = join(here, "assets", "ai");
const ASSETS = join(here, "assets");
const ENDPOINT = "https://fal.run/fal-ai/flux-pro/v1.1";
const CANDIDATES = 4;

const ROOM =
  "Setting: a small bright exercise studio in Ireland; pale blue-grey painted walls; white and maroon resistance machines; black treadmills and recumbent bikes; a thin blue LED strip along one wall; a drop ceiling; large front windows with soft daylight; grey rubber floor.";
const PEOPLE =
  "Realistic Irish adults, ordinary gym clothes (plain t-shirts, leggings, trainers), natural skin, grey and white hair where the age calls for it, no stock smile, caught mid-movement or mid-conversation.";
const STYLE =
  "Documentary photograph, 35mm lens, natural window light, shallow depth of field, muted colour, quiet composition. No text, no logos, no signage, no watermark.";

const SHOTS = [
  { name: "hero-portrait", w: 1152, h: 1440, brief: "A woman in her mid-forties and a man in his sixties on neighbouring resistance machines, both mid-effort, a coach's arm reaching in from the side to adjust a setting; the younger person nearer the camera. Waist-up, three-quarter view." },
  { name: "livewell", w: 1440, h: 1088, brief: "A woman around fifty resting a kettlebell at her side between sets, breathing, focused, looking down. Three-quarter length." },
  { name: "vitality", w: 1440, h: 1088, brief: "Three people over sixty-five seated on white resistance machines, a coach in a plain navy t-shirt standing beside one of them, talking. Wide shot." },
  { name: "studio60", w: 1440, h: 1088, brief: "Two people in their sixties working with free weights in the studio, one mid-press with a dumbbell in each hand, the other steady on a bench alongside; both capable and unhurried, no coach in frame. Three-quarter length." },
  { name: "studio60-hero", w: 1440, h: 960, brief: "A man and a woman in their late sixties training side by side with barbells and dumbbells in the free-weight corner, moving confidently, a coach watching from a few steps back. Wide shot." },
  { name: "heartwise", w: 1440, h: 1088, brief: "A man around seventy walking steadily on a treadmill, a coach beside him with one hand near the console, both calm. Side view." },
  { name: "livewell-hero", w: 1440, h: 960, brief: "A small group of four adults between forty-five and sixty working through a circuit with resistance bands, spaced across the room. Wide shot." },
  { name: "vitality-hero", w: 1440, h: 960, brief: "A woman around seventy on a seated leg press, smiling at a coach who is crouched beside the machine. Medium shot." },
  { name: "heartwise-hero", w: 1440, h: 960, brief: "A man in his mid-sixties on a recumbent bike, glancing down at a chest-strap heart monitor display, composed and unhurried. Medium shot." },
  { name: "classes-hero", w: 1440, h: 960, brief: "The room mid-morning: four people moving between stations, one on a rower, one with light dumbbells, sunlight across the floor. Wide shot from the doorway." },
  { name: "detail-hands", w: 1152, h: 1152, brief: "Close-up of an older person's hands adjusting a light dumbbell on a rack. Square." },
  { name: "detail-band", w: 1152, h: 1152, brief: "Close-up of a resistance band around two ankles in trainers on the grey rubber floor. Square." },
  { name: "detail-chat", w: 1152, h: 1152, brief: "Two women in their sixties talking after a class, water bottles in hand, one laughing, machines soft in the background. Square, medium shot." },
  { name: "detail-floor", w: 1152, h: 1152, brief: "A pair of trainers on the grey rubber floor with a band of window light across it, nothing else in frame. Square." },
];

const prompt = (s) => `${s.brief} ${PEOPLE} ${ROOM} ${STYLE}`;

async function generateOne(shot, i) {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new Error("FAL_KEY is not set. Run this through `railway run` from app/.");
  // A seed per candidate, logged with the prompt, so a keeper can be re-run
  // at another size or with a one-word change to the brief.
  const seed = Math.floor(Math.random() * 2_000_000_000);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${key}` },
    body: JSON.stringify({
      prompt: prompt(shot),
      image_size: { width: shot.w, height: shot.h },
      num_images: 1,
      output_format: "jpeg",
      enable_safety_checker: true,
      seed,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const url = json.images?.[0]?.url;
  if (!url) throw new Error("fal returned no image");
  const img = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  const out = join(AI, `${shot.name}-${i}.jpg`);
  writeFileSync(out, Buffer.from(await img.arrayBuffer()));
  return { out, seed };
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "list") {
  for (const s of SHOTS) console.log(`${s.name.padEnd(16)} ${s.w}x${s.h}\n  ${prompt(s)}\n`);
} else if (cmd === "generate") {
  mkdirSync(AI, { recursive: true });
  const wanted = args.length ? SHOTS.filter((s) => args.includes(s.name)) : SHOTS;
  const logPath = join(AI, "prompts.json");
  const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, "utf8")) : {};
  const failed = [];
  for (const shot of wanted) {
    for (let i = 1; i <= CANDIDATES; i++) {
      try {
        const { out, seed } = await generateOne(shot, i);
        log[`${shot.name}-${i}`] = { prompt: prompt(shot), seed };
        console.log("wrote", out, "seed", seed);
      } catch (err) {
        // One bad request must not cost the shots that already succeeded:
        // record what we have, name the failure, carry on.
        failed.push(`${shot.name}-${i}`);
        console.error(`failed ${shot.name}-${i}: ${err instanceof Error ? err.message : String(err)}`);
      }
      writeFileSync(logPath, JSON.stringify(log, null, 2));
    }
  }
  const done = wanted.length * CANDIDATES - failed.length;
  console.log(`${done} candidates in assets/ai/ — now look at every one.`);
  if (failed.length) {
    console.error(`${failed.length} failed: ${failed.join(", ")} — re-run \`generate <name>\` for those shots.`);
    process.exitCode = 1;
  }
} else if (cmd === "pick") {
  const picks = existsSync(join(ASSETS, "photos.json")) ? JSON.parse(readFileSync(join(ASSETS, "photos.json"), "utf8")) : {};
  const log = JSON.parse(readFileSync(join(AI, "prompts.json"), "utf8"));
  for (const a of args) {
    const [name, n] = a.split(":");
    const shot = SHOTS.find((s) => s.name === name);
    if (!shot || !n) throw new Error(`bad pick "${a}" — use name:n`);
    const src = join(AI, `${name}-${n}.jpg`);
    const out = join(ASSETS, `${name}.jpg`);
    // Grade: saturation down a tenth, a touch warm, progressive JPEG around q4.
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-vf", "eq=saturation=0.9,colorbalance=rs=0.02:bs=-0.02", "-q:v", "4", out]);
    picks[name] = { candidate: Number(n), ...log[`${name}-${n}`], width: shot.w, height: shot.h };
    console.log("picked", name, "<-", `${name}-${n}.jpg`);
  }
  writeFileSync(join(ASSETS, "photos.json"), JSON.stringify(picks, null, 2));
} else {
  console.error("usage: photos.mjs list | generate [name ...] | pick name:n [name:n ...]");
  process.exit(1);
}
