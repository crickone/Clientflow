// Parse Facebook Ad Library HAR exports under extract/har-ie/ and emit one JSON
// of unique Irish ads per therapy at extract/ie-out/{therapy}.json.
//
// HAR shape (truncated): each entry holds a GraphQL response whose body decodes
// to one or more lines. Most lines have either:
//   data.ad_library_main.search_results_connection.edges[].node.collated_results[]
//   data.ad_library_main.search_results_connection.edges[].node.snapshot
// We walk the response, collect every ad node we find, then normalise the same
// shape used by pemf_ads.json so the rest of the pipeline stays uniform.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HAR_DIR = path.join(__dirname, "har-ie");
const OUT_DIR = path.join(__dirname, "ie-out");
fs.mkdirSync(OUT_DIR, { recursive: true });

const THERAPIES = ["hbot", "ir", "pemf"];

function readHarEntries(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return raw?.log?.entries ?? [];
}

function parseResponseText(text) {
  // FB returns one JSON object per line in many GraphQL responses.
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // ignore parse failures — partial chunks are common
    }
  }
  return out;
}

// Walk an arbitrary object and collect anything that looks like an ad node.
function collectAdNodes(node, sink) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectAdNodes(item, sink);
    return;
  }
  if (node.snapshot && (node.ad_archive_id || node.adArchiveID)) {
    sink.push(node);
  }
  if (Array.isArray(node.collated_results)) {
    for (const r of node.collated_results) sink.push(r);
  }
  for (const key of Object.keys(node)) {
    if (key === "snapshot") continue;
    collectAdNodes(node[key], sink);
  }
}

function pickText(maybe) {
  if (!maybe) return "";
  if (typeof maybe === "string") return maybe;
  if (typeof maybe === "object" && typeof maybe.text === "string")
    return maybe.text;
  return "";
}

function normalise(node) {
  const snap = node.snapshot ?? {};
  const id = String(node.ad_archive_id ?? node.adArchiveID ?? snap.id ?? "");
  if (!id) return null;
  const impressions =
    pickText(node.impressions_with_index?.impressions_text) ||
    pickText(snap.impressions_with_index?.impressions_text) ||
    "";
  return {
    id,
    page: snap.page_name ?? "",
    body: pickText(snap.body),
    title: pickText(snap.title),
    headline: pickText(snap.caption) || pickText(snap.link_description) || "",
    cta: snap.cta_text ?? "",
    url: snap.link_url ?? "",
    impressions,
    start_date: node.start_date ?? snap.creation_time ?? null,
    end_date: node.end_date ?? null,
  };
}

function harFilesFor(therapy) {
  if (!fs.existsSync(HAR_DIR)) return [];
  return fs
    .readdirSync(HAR_DIR)
    .filter(
      (f) =>
        f.toLowerCase().endsWith(".har") &&
        (f === `${therapy}.har` || f.startsWith(`${therapy}-`)),
    )
    .map((f) => path.join(HAR_DIR, f));
}

function extractTherapy(therapy) {
  const files = harFilesFor(therapy);
  if (files.length === 0) {
    console.log(`[${therapy}] no HAR files — skipping`);
    return null;
  }
  console.log(`[${therapy}] ${files.length} HAR file(s)`);

  const seen = new Map();
  for (const file of files) {
    const entries = readHarEntries(file);
    for (const entry of entries) {
      const url = entry?.request?.url ?? "";
      if (!url.includes("/api/graphql/")) continue;
      const body = entry?.response?.content?.text;
      if (!body) continue;
      for (const obj of parseResponseText(body)) {
        const sink = [];
        collectAdNodes(obj, sink);
        for (const node of sink) {
          const ad = normalise(node);
          if (ad && !seen.has(ad.id)) seen.set(ad.id, ad);
        }
      }
    }
  }

  const ads = [...seen.values()];
  const outFile = path.join(OUT_DIR, `${therapy}.json`);
  fs.writeFileSync(outFile, JSON.stringify(ads, null, 2));
  console.log(`[${therapy}] ${ads.length} unique ads → ${outFile}`);
  return ads;
}

for (const t of THERAPIES) extractTherapy(t);
