// Extract per-pane HTML blobs and chart data from the source HTML report
// into JSON files the Next.js app consumes via dangerouslySetInnerHTML.
//
// Strategy: keep the original heavily-styled inline markup as a string per pane.
// This preserves exact visual fidelity. The Next.js components render the blobs
// and rebuild show()/filter behaviours in React.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "OHR_HBOT_Ad_Library_Full_Report.html");
const OUT = path.join(ROOT, "app", "public", "data");
fs.mkdirSync(OUT, { recursive: true });

// The source report is an optional, one-off input. Its extracted output
// (app/public/data/*.json) is committed to the repo, so when the source HTML
// isn't present (e.g. a deploy build context that doesn't include it) we skip
// regeneration and keep the committed output rather than failing the build.
if (!fs.existsSync(SRC)) {
  console.warn(
    `[extract] source report not found at ${SRC} — skipping extraction; using committed output in ${OUT}.`,
  );
  process.exit(0);
}

const html = fs.readFileSync(SRC, "utf8");

/** Find the inner HTML of the first <div> matching the open-tag regex. */
function extractInner(openRe) {
  const m = openRe.exec(html);
  if (!m) throw new Error(`No match for ${openRe}`);
  const start = m.index + m[0].length;
  const divRe = /<\/?div\b[^>]*>/gi;
  divRe.lastIndex = start;
  let depth = 1;
  let n;
  while ((n = divRe.exec(html))) {
    const tok = n[0];
    if (/^<\//.test(tok)) {
      depth -= 1;
      if (depth === 0) return html.slice(start, n.index);
    } else if (!tok.endsWith("/>")) {
      depth += 1;
    }
  }
  throw new Error(`Unbalanced div for ${openRe}`);
}

const grabPane = (paneId) =>
  extractInner(new RegExp(`<div id="${paneId.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}"[^>]*>`));

const PANES = {
  hbot: [
    ["overview", "overview"],
    ["all-ads", "all-ads"],
    ["advertisers", "advertisers"],
    ["hooks", "hooks"],
    ["longevity", "longevity"],
    ["strategy", "strategy"],
    ["scripts", "scripts"],
  ],
  ir: [
    ["overview", "ir-overview"],
    ["all-ads", "ir-all-ads"],
    ["advertisers", "ir-advertisers"],
    ["hooks", "ir-hooks"],
    ["longevity", "ir-longevity"],
    ["scripts", "ir-scripts"],
  ],
  pemf: [
    ["overview", "pemf-overview"],
    ["all-ads", "pemf-all-ads"],
    ["advertisers", "pemf-advertisers"],
    ["hooks", "pemf-hooks"],
    ["longevity", "pemf-longevity"],
    ["strategy", "pemf-strategy"],
    ["scripts", "pemf-scripts"],
  ],
};

const THERAPY_META = {
  hbot: {
    id: "hbot",
    label: "HBOT",
    icon: "",
    fullName: "Hyperbaric Oxygen Therapy",
    accent: "#2c6ce0",
    accentBg: "rgba(44,108,224,0.10)",
    totalAds: 162,
    advertisers: 44,
    scripts: 30,
    subtitle: "Hyperbaric Oxygen Therapy",
    tabs: [
      { id: "overview", label: "Overview" },
      { id: "all-ads", label: "All Ads" },
      { id: "advertisers", label: "Advertisers" },
      { id: "hooks", label: "Hooks & Copy" },
      { id: "longevity", label: "Longevity" },
      { id: "strategy", label: "Strategy" },
      { id: "scripts", label: "Ad Copy" },
    ],
    charts: {
      format: {
        type: "doughnut",
        labels: ["DCO", "VIDEO", "CAROUSEL"],
        data: [27, 108, 27],
      },
      advertisers: {
        type: "bar",
        labels: [
          "OxyHealthCare",
          "Elements Health & Wellness Hub",
          "The Oxygen Temple",
          "Livbetter",
          "Hyperbaric Oxygen Therapy-UK",
          "Cotswold Hyperbarics & Wellness",
          "VitalTherapy Wellness",
          "Oakwood Wellbeing",
          "Shropshire floats",
          "X-CELLr8",
        ],
        data: [75, 10, 7, 7, 4, 4, 4, 3, 3, 2],
        color: "#2ed8c3",
      },
    },
  },
  ir: {
    id: "ir",
    label: "Infrared",
    icon: "",
    fullName: "Infrared Therapy",
    accent: "#d2691e",
    accentBg: "rgba(210,105,30,0.10)",
    totalAds: 716,
    advertisers: 106,
    scripts: 100,
    subtitle: "Infrared Therapy",
    tabs: [
      { id: "overview", label: "Overview" },
      { id: "all-ads", label: "All Ads" },
      { id: "advertisers", label: "Advertisers" },
      { id: "hooks", label: "Hooks & Copy" },
      { id: "longevity", label: "Longevity" },
      { id: "scripts", label: "Ad Copy" },
    ],
    charts: {
      format: {
        type: "doughnut",
        labels: ["DCO", "VIDEO", "CAROUSEL"],
        data: [206, 221, 289],
      },
      advertisers: {
        type: "bar",
        labels: [
          "Dr. Claire Williams",
          "Dr. Olivia Bennett",
          "Pavra",
          "Megelin",
          "VCare",
          "Megelin Global",
          "HealRay",
          "Maysama",
          "Helios",
          "RougeCare",
        ],
        data: [100, 95, 40, 34, 28, 24, 19, 17, 16, 15],
        color: "#f0883e",
      },
    },
  },
  pemf: {
    id: "pemf",
    label: "PEMF",
    icon: "",
    fullName: "Pulsed Electromagnetic Field Therapy",
    accent: "#8a3fd1",
    accentBg: "rgba(138,63,209,0.10)",
    totalAds: 93,
    advertisers: 18,
    scripts: 93,
    subtitle: "Pulsed Electromagnetic Field Therapy",
    tabs: [
      { id: "overview", label: "Overview" },
      { id: "all-ads", label: "All Ads" },
      { id: "advertisers", label: "Advertisers" },
      { id: "hooks", label: "Hooks & Copy" },
      { id: "longevity", label: "Longevity" },
      { id: "strategy", label: "Strategy" },
      { id: "scripts", label: "Ad Copy" },
    ],
    charts: null,
  },
};

/**
 * The Next.js TherapyView renders its own controlled search input for the
 * panes that need filtering. Strip the source input + its wrapping div so we
 * don't end up with two inputs on screen.
 */
const STRIP_SEARCH_INPUTS = ["all-ads", "scripts"];

function stripSearchInputs(htmlBlob, slug) {
  if (!STRIP_SEARCH_INPUTS.includes(slug)) return htmlBlob;
  let result = htmlBlob.replace(
    /<input[^>]*class="search-box"[^>]*>/gi,
    "",
  );
  // The scripts pane wraps the input in its own <div style="margin-bottom:16px">
  // — collapse that empty wrapper after stripping.
  result = result.replace(
    /<div[^>]*style="margin-bottom:16px"[^>]*>\s*<\/div>/gi,
    "",
  );
  return result;
}

/**
 * Replace a known opening tag with a balanced match for its closing tag,
 * returning [start, end] indices of the full element including tags.
 */
function findBalancedRange(html, start, tagName) {
  const open = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  const close = new RegExp(`</${tagName}\\s*>`, "gi");
  open.lastIndex = start;
  close.lastIndex = start;
  let depth = 1;
  while (depth > 0) {
    const nextOpen = open.exec(html);
    const nextClose = close.exec(html);
    if (!nextClose) return null;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      close.lastIndex = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      if (depth === 0) return [start, nextClose.index + nextClose[0].length];
      open.lastIndex = nextClose.index + nextClose[0].length;
    }
  }
  return null;
}

/**
 * Strip the show-more interaction:
 *   - delete <span class="tb" ...>...</span> and <button class="tb" ...>...</button>
 *   - delete <div class="bp" ...>...</div> (preview)
 *   - unhide <div class="bf" ...style="display:none"...>...</div> (full text)
 *
 * After this, every ad/script row shows its full copy with no toggle button.
 */
/**
 * Apply the rebrand to extracted HTML.
 *  - Replace the OHR location footer line with the literal "(location)".
 *  - Replace the website + phone with "(website)" / "(phone)".
 *  - Replace remaining "Optimal Health & Recovery" with "Renova Cellular
 *    Health" so any prose mentions get rebranded too.
 *  - Replace "OHR" (word-bounded) with "Renova".
 *  - Strip the 📍 🌐 ☎ emoji glyphs from the now-placeholder contact lines.
 */
function applyRebrand(htmlBlob) {
  let html = htmlBlob;

  // Long location line — handles both inline and prose variants.
  html = html.replace(
    /Optimal Health\s*&(?:amp;)?\s*Recovery\s*\|\s*Ard\s*Gaoithe\s*Business\s*Park,\s*Clonmel,\s*Co\.\s*Tipperary/gi,
    "(location)",
  );

  html = html.replace(/optimalhealthatinspire\.ie/gi, "(website)");
  html = html.replace(/083\s*867\s*2844/g, "(phone)");

  // Strip the contact-line emoji glyphs that become noise next to the
  // bracketed placeholders.
  html = html.replace(/📍\s*/g, "");
  html = html.replace(/🌐\s*/g, "");
  html = html.replace(/☎\s*/g, "");

  // Generic name replacements for any straggling references.
  html = html.replace(/Optimal Health\s*&(?:amp;)?\s*Recovery/gi, "Renova Cellular Health");
  html = html.replace(/Optimal Health/g, "Renova Cellular Health");
  html = html.replace(/\bOHR\b/g, "Renova");

  return html;
}

/**
 * Drop any inline <script>...</script> tags in extracted panes — the source
 * report has a few `new Chart(...)` calls that depended on a global Chart.js
 * CDN. Charts are rebuilt in React from the meta config, so these scripts
 * are dead and will throw a runtime ReferenceError if rendered.
 */
function stripInlineScripts(htmlBlob) {
  return htmlBlob.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

function expandAdCopy(htmlBlob) {
  let html = htmlBlob;

  // Remove .tb toggle spans/buttons — they carry the inline onclick="tog(...)"
  // that breaks in the React app.
  for (const tag of ["span", "button"]) {
    const opener = new RegExp(`<${tag}\\b[^>]*class="tb"[^>]*>`, "i");
    while (true) {
      const m = opener.exec(html);
      if (!m) break;
      const range = findBalancedRange(html, m.index + m[0].length, tag);
      if (!range) {
        html = html.slice(0, m.index) + html.slice(m.index + m[0].length);
        continue;
      }
      html = html.slice(0, m.index) + html.slice(range[1]);
    }
  }

  // Remove .bp preview divs.
  const bpOpen = /<div\b[^>]*class="bp"[^>]*>/i;
  while (true) {
    const m = bpOpen.exec(html);
    if (!m) break;
    const range = findBalancedRange(html, m.index + m[0].length, "div");
    if (!range) break;
    html = html.slice(0, m.index) + html.slice(range[1]);
  }

  // Unhide .bf full-text divs by stripping the inline display:none.
  html = html.replace(
    /(<div\b[^>]*class="bf"[^>]*style="[^"]*?)display:\s*none;?\s*([^"]*"[^>]*>)/gi,
    "$1$2",
  );

  return html;
}

/* ========================================================================
 * Ecommerce filter
 * ------------------------------------------------------------------------
 * OHR is a clinic, not an equipment seller. Drop ads from product/device
 * advertisers so the report only shows competing clinics.
 *
 * Strategy:
 *  - For HBOT and IR, the source advertisers pane already labels each card
 *    as CLINIC, B2B, DEVICE, or OTHER. We treat anything not CLINIC as
 *    ecommerce.
 *  - For PEMF the source has no labels, so we maintain a manual blocklist.
 *  - Secondary filter: drop ads whose CTA is Shop now / Buy now / Order now
 *    even if the advertiser would otherwise be unclassified.
 * ======================================================================== */

const PEMF_BLOCKLIST = new Set([
  "Therafy",
  "Petspemf",
  "HorseHalo",
  "Elaris Body",
  "MiraMate",
  "Megelin Global",
  "Omnipemf",
  "Spooky2",
  "Nurture your Pet",
  "Best Product Reviews",
  "She Choose Peace",
]);

// Manually-vetted IR clinic advertisers that didn't make the source's
// labeled top 25 but appear as legitimate clinics in HBOT/PEMF too.
const IR_EXTRA_CLINICS = [
  "HEAL Wellness Clinic",
  "X-CELLr8",
  "Foundry.fitness",
  "The Body Fix Coach LTD",
  "Blue Wave PEMF Therapy",
  "Scieneldn",
  "The Oxygen Temple",
  "Livbetter",
  "Rē Precision Health",
  "OxyHealthCare",
  "OxyClinic",
  "Wellvitas",
  "Cotswold Hyperbarics & Wellness",
  "VitalTherapy Wellness",
  "Oakwood Wellbeing",
  "Elements Health & Wellness Hub",
  "broganwatsonaesthetics",
  "Oxygen Room Bristol",
  "ReviveO₂ HBOT",
  "53 Aesthetics",
  "53 Aesthetics Sanderstead",
];

// Only the unambiguous ecommerce CTAs — "Sign up" / "Get offer" / "See
// details" are too ambiguous (clinics use them too).
const ECOMMERCE_CTAS = new Set([
  "shop now",
  "buy now",
  "order now",
]);

function decodeHtmlText(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—");
}

/**
 * Returns { mode: "blocklist", blocked: Set } or { mode: "allowlist",
 * allowed: Set }. Allowlist mode is used for therapies where the long-tail
 * of unlabeled advertisers is presumed to be ecommerce (IR market).
 */
function buildEcommerceFilter(therapy, advertisersHtml) {
  if (therapy === "pemf") {
    return { mode: "blocklist", blocked: new Set(PEMF_BLOCKLIST) };
  }

  // Read source labels from the advertisers pane.
  const labeled = new Map();
  const re =
    /<span[^>]*font-size:15px[^>]*>([^<]+)<\/span><span[^>]*>(B2B|DEVICE|OTHER|CLINIC)\b/g;
  let m;
  while ((m = re.exec(advertisersHtml))) {
    labeled.set(decodeHtmlText(m[1]), m[2]);
  }

  if (therapy === "ir") {
    // IR source labels only the top 25 advertisers; the long tail is mostly
    // product sellers. Use allowlist mode: keep only CLINIC-labeled names
    // plus an explicit safe list of clinics that appear in other therapies.
    const allowed = new Set(IR_EXTRA_CLINICS);
    for (const [name, label] of labeled) {
      if (label === "CLINIC") allowed.add(name);
    }
    return { mode: "allowlist", allowed };
  }

  // HBOT: source labels every advertiser. Blocklist mode.
  const blocked = new Set();
  for (const [name, label] of labeled) {
    if (label !== "CLINIC") blocked.add(name);
  }
  return { mode: "blocklist", blocked };
}

/**
 * Per-therapy table column layout for the all-ads table.
 *  - HBOT/IR: [Advertiser, Format, Platforms, Body, Duration, CTA]
 *  - PEMF:    [#, Advertiser, Body, CTA, Impressions]
 */
const TABLE_COLUMNS = {
  hbot: { advertiser: 0, cta: 5 },
  ir: { advertiser: 0, cta: 5 },
  pemf: { advertiser: 1, cta: 3 },
};

/**
 * Walk every <tr>...</tr> in the all-ads table; remove rows whose advertiser
 * cell matches a blocked advertiser, or whose CTA cell matches an ecommerce
 * CTA. Returns { html, kept, removed }.
 */
function filterAdsTable(htmlBlob, filter, therapy) {
  const cols = TABLE_COLUMNS[therapy];
  let kept = 0;
  let removed = 0;
  const result = htmlBlob.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g, (full, inner) => {
    if (!/<td/i.test(inner)) return full;
    const tdMatches = [...inner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)];
    if (!tdMatches.length) return full;
    const advCell = tdMatches[cols.advertiser];
    const advText = advCell
      ? decodeHtmlText(stripTags(advCell[1])).trim()
      : "";
    if (!isAllowed(advText, filter)) {
      removed += 1;
      return "";
    }
    const ctaCell = tdMatches[cols.cta];
    if (ctaCell) {
      const cta = decodeHtmlText(stripTags(ctaCell[1])).trim().toLowerCase();
      if (ECOMMERCE_CTAS.has(cta)) {
        removed += 1;
        return "";
      }
    }
    kept += 1;
    return full;
  });
  return { html: result, kept, removed };
}

function isAllowed(name, filter) {
  if (filter.mode === "blocklist") return !filter.blocked.has(name);
  return filter.allowed.has(name);
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
}

/**
 * Walk every advertiser card in the advertisers pane; drop cards whose name
 * is in the blocklist.
 */
function filterAdvertisersPane(htmlBlob, filter) {
  const cardRe =
    /<div\s+style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:10px">/g;
  return removeMatchingDivs(htmlBlob, cardRe, (cardHtml) => {
    const m = /<span[^>]*font-size:15px[^>]*>([^<]+)<\/span>/.exec(cardHtml);
    if (!m) return false;
    const name = decodeHtmlText(m[1]);
    return !isAllowed(name, filter);
  });
}

function filterAdvertisersTable(htmlBlob, filter) {
  return htmlBlob.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g, (full, inner) => {
    if (!/<td/i.test(inner)) return full;
    const tdMatches = [...inner.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)];
    if (!tdMatches.length) return full;
    const name = decodeHtmlText(stripTags(tdMatches[0][1])).trim();
    return isAllowed(name, filter) ? full : "";
  });
}

function filterHooksPane(htmlBlob, filter) {
  const opener = /<div\s+style="margin-bottom:28px">/g;
  return removeMatchingDivs(htmlBlob, opener, (chunk) => {
    const m = /<h3[^>]*>([^<]+?)\s*<span/.exec(chunk);
    if (!m) return false;
    return !isAllowed(decodeHtmlText(m[1]).trim(), filter);
  });
}

function filterLongevityPane(htmlBlob, filter) {
  return htmlBlob.replace(
    /<div\s+style="background:#161b22[^"]*"[^>]*>([\s\S]*?)(?=<div\s+style="background:#161b22|<\/div>\s*<\/div>\s*$)/g,
    (full) => {
      const m = /<span[^>]*font-weight:[67]00[^>]*>([^<]+)<\/span>/.exec(full);
      if (!m) return full;
      const name = decodeHtmlText(m[1]).trim();
      return isAllowed(name, filter) ? full : "";
    },
  );
}

/**
 * Generic helper: remove every <div> opened by `opener` whose inner HTML
 * makes `predicate` return true.
 */
function removeMatchingDivs(htmlBlob, opener, predicate) {
  let html = htmlBlob;
  // Run repeatedly because deletion shifts indices.
  while (true) {
    let changed = false;
    opener.lastIndex = 0;
    let m;
    while ((m = opener.exec(html))) {
      const range = findBalancedRange(html, m.index + m[0].length, "div");
      if (!range) break;
      const chunk = html.slice(m.index, range[1]);
      if (predicate(chunk)) {
        html = html.slice(0, m.index) + html.slice(range[1]);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  return html;
}

/**
 * Recount remaining ads + advertisers + KPIs after filtering. Returns the
 * updated meta object plus a recomputed top-10 advertisers chart.
 */
function recountTherapy(meta, allAdsHtml, therapy) {
  const cols = TABLE_COLUMNS[therapy];
  const adMatches = [...allAdsHtml.matchAll(/<tr\b[^>]*>[\s\S]*?<td\b[\s\S]*?<\/tr>/g)];
  const totalAds = adMatches.length;

  const counts = new Map();
  for (const row of adMatches) {
    const tds = [...row[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)];
    const cell = tds[cols.advertiser];
    if (!cell) continue;
    const name = decodeHtmlText(stripTags(cell[1])).trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const advertisers = counts.size;

  // Top 10 for the chart.
  const top10 = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const charts = meta.charts
    ? {
        ...meta.charts,
        advertisers: {
          ...meta.charts.advertisers,
          labels: top10.map(([n]) => n),
          data: top10.map(([, c]) => c),
        },
      }
    : meta.charts;

  const subtitle =
    `${meta.fullName} · ${totalAds} clinic ad${totalAds === 1 ? "" : "s"} · ` +
    `${advertisers} advertiser${advertisers === 1 ? "" : "s"}`;

  return { ...meta, totalAds, advertisers, charts, subtitle };
}

/**
 * Patch the overview pane KPI numbers to match the filtered counts so the
 * embedded markup doesn't lie about "162 ads".
 */
function patchOverviewKpis(html, meta) {
  // Replace the first KPI value (Total Ads) — find the .kpi block whose
  // .label contains "Total Ads".
  const re =
    /(<div class="kpi"><div class="val"[^>]*>)(\d[\d,]*)(<\/div><div class="label">Total Ads<\/div>)/;
  html = html.replace(re, `$1${meta.totalAds}$3`);
  const re2 =
    /(<div class="kpi"><div class="val"[^>]*>)(\d[\d,]*)(<\/div><div class="label">Advertisers<\/div>)/;
  html = html.replace(re2, `$1${meta.advertisers}$3`);
  return html;
}

/* ========================================================================
 * Irish Ads pane
 * ------------------------------------------------------------------------
 * Reads extract/ie-out/{therapy}.json (raw ads from HAR extraction) and
 * extract/ie-out/{therapy}-scripts.json (Claude-generated Renova scripts)
 * and renders a new "Irish Ads" pane + tab matching the existing visual
 * language (cards on light Swiss-style theme).
 * ======================================================================== */

const IE_OUT = path.join(ROOT, "extract", "ie-out");

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2br(s) {
  return escapeHtml(s).replace(/\n/g, "<br>");
}

function fmtDate(unix) {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Drop product / ecommerce ads from the Irish Ads pane. Renova is a service
 * (clinic) — competing product sellers (devices, supplements, at-home gadgets)
 * are noise. Layered filter:
 *   1. CTA is a known buy-now signal
 *   2. Body has product-y signals (free shipping, % off, restock, etc.)
 *   3. URL hostname matches an ecommerce platform or known device brand
 */
const IE_ECOMMERCE_CTAS = new Set([
  "shop now",
  "buy now",
  "order now",
  "see details",
]);

const IE_PRODUCT_BODY_SIGNALS = [
  "free shipping",
  "discount code",
  "use code",
  "% off",
  "limited time offer",
  "free gift",
  "restock",
  "sold out",
  "best seller",
  "wearable device",
  "starter pack",
  "save €",
  "save $",
  "save £",
  "buy 1 get",
  "buy one get",
  "ships from",
  "free delivery",
  // Strong "you take this home" product signals
  "home use",
  "at-home",
  "at home use",
  "for home",
  "from home",
  "bring it home",
  // Product warranty / refund language
  "money-back",
  "money back guarantee",
  "risk-free",
  "30-day",
  "60-day",
  "90-day",
  "lifetime warranty",
  // Product reference patterns
  "the device",
  "this device",
  "our device",
  "professional-grade",
  "medical-grade",
];

const IE_ECOM_URL_SIGNALS = [
  "shopify",
  "amazon.",
  "etsy.",
  "/products/",
  "/product/",
  "/shop/",
  "/store/",
  ".shop/",
  "/collections/",
  "/cart",
  // Shopify product landing pages
  "/pages/",
  // Known IR/PEMF device brands seen in Irish data
  "buyinfrabeam",
  "mitolight.com",
  "hydragun.com",
  "freyara.com",
  "megelin.com",
  "theonedevice.com",
  "rougecare",
  "lumired",
  "testolite",
  "infrabeam",
  // FB canvas docs are usually product creatives, not service ads
  "fb.com/canvas_doc",
  "facebook.com/canvas_doc",
];

const IE_PRODUCT_BRANDS = new Set([
  "PrimePath Solutions",
  "HealRay",
  "Hydragun",
  "MITO LIGHT Europe",
  "Shenzhen Idea Light Limited.",
  "Testolite",
  "LumiRed",
  "Project E Beauty",
  "Auroom Wellness",
  "Beverly Blair",
  "FREYARA Cosmetics",
  "The One Device",
  "Megelin Global",
  "Megelin",
  "Kickstarter Projects You Need Now",
]);

function isIrishProductAd(ad) {
  const cta = (ad.cta || "").trim().toLowerCase();
  if (IE_ECOMMERCE_CTAS.has(cta)) return true;

  if (IE_PRODUCT_BRANDS.has(ad.page || "")) return true;

  const body = (ad.body || "").toLowerCase();
  if (IE_PRODUCT_BODY_SIGNALS.some((s) => body.includes(s))) return true;

  const url = (ad.url || "").toLowerCase();
  if (IE_ECOM_URL_SIGNALS.some((s) => url.includes(s))) return true;

  return false;
}

function renderIrishAdsPane(therapy, accent) {
  const adsFile = path.join(IE_OUT, `${therapy}.json`);
  const scriptsFile = path.join(IE_OUT, `${therapy}-scripts.json`);
  if (!fs.existsSync(adsFile)) return null;

  const allAds = JSON.parse(fs.readFileSync(adsFile, "utf8"));
  const scriptsArr = fs.existsSync(scriptsFile)
    ? JSON.parse(fs.readFileSync(scriptsFile, "utf8"))
    : [];
  const scriptsById = Object.fromEntries(scriptsArr.map((s) => [s.id, s]));

  const ads = allAds.filter((ad) => !isIrishProductAd(ad));
  const dropped = allAds.length - ads.length;

  if (ads.length === 0) return null;

  const cards = ads
    .map((ad) => {
      const script = scriptsById[ad.id];
      const dates =
        ad.start_date || ad.end_date
          ? `${fmtDate(ad.start_date)} → ${fmtDate(ad.end_date) || "active"}`
          : "";
      const linkBtn = ad.url
        ? `<a href="${escapeHtml(ad.url)}" target="_blank" rel="noopener" style="color:${accent};font-size:12px;text-decoration:none;border:1px solid ${accent}55;padding:4px 10px;border-radius:4px">View landing page →</a>`
        : "";
      const scriptBlock = script
        ? `
        <div style="background:#faf8f3;border:1px solid ${accent}33;border-left:3px solid ${accent};border-radius:6px;padding:14px 16px;margin-top:14px">
          <div style="color:${accent};font-size:10px;font-weight:700;letter-spacing:.8px;margin-bottom:6px">RENOVA SCRIPT — ${escapeHtml(script.angle || "")}</div>
          <div style="color:#1a1a1a;font-size:13px;font-weight:600;margin-bottom:8px">${escapeHtml(script.hook || "")}</div>
          <div style="color:#3a3a3a;font-size:13px;line-height:1.55;white-space:pre-wrap;margin-bottom:10px">${nl2br(script.body || "")}</div>
          <div style="color:#1a1a1a;font-size:12px;font-weight:600;margin-bottom:10px">CTA: ${escapeHtml(script.cta || "")}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span style="background:#fff;border:1px solid #e8e4d9;color:#666;font-size:10px;padding:2px 8px;border-radius:10px">${escapeHtml(script.format || "Image")}</span>
            <span style="background:#fff;border:1px solid #e8e4d9;color:#666;font-size:10px;padding:2px 8px;border-radius:10px">${escapeHtml(script.audience || "General")}</span>
          </div>
          ${script.insight ? `<div style="color:#888;font-size:11px;margin-top:10px;font-style:italic">↳ ${escapeHtml(script.insight)}</div>` : ""}
        </div>`
        : `<div style="color:#999;font-size:12px;font-style:italic;margin-top:14px;padding:10px 14px;background:#faf8f3;border-radius:6px">Renova script not yet generated. Run <code>npm run generate:ie-scripts</code>.</div>`;

      return `
      <div data-script-card style="background:#ffffff;border:1px solid #e8e4d9;border-radius:8px;padding:18px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;flex-wrap:wrap">
          <div>
            <div style="color:${accent};font-weight:700;font-size:14px">${escapeHtml(ad.page || "Unknown advertiser")}</div>
            ${dates ? `<div style="color:#888;font-size:11px;margin-top:2px">${escapeHtml(dates)}${ad.impressions ? ` · ${escapeHtml(ad.impressions)}` : ""}</div>` : ""}
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            ${ad.cta ? `<span style="background:${accent}11;color:${accent};font-size:11px;padding:3px 10px;border-radius:10px;border:1px solid ${accent}33">${escapeHtml(ad.cta)}</span>` : ""}
            ${linkBtn}
          </div>
        </div>
        ${ad.title ? `<div style="color:#1a1a1a;font-size:14px;font-weight:600;margin-bottom:6px">${escapeHtml(ad.title)}</div>` : ""}
        <div style="color:#3a3a3a;font-size:13px;line-height:1.55;white-space:pre-wrap">${nl2br(ad.body || "")}</div>
        ${scriptBlock}
      </div>`;
    })
    .join("\n");

  const generated = ads.filter((a) => scriptsById[a.id]).length;
  return {
    html: `<div class="section">
  <h2>Irish Competitor Ads — ${ads.length}</h2>
  <p style="color:#666;margin-bottom:24px">Facebook Ad Library results filtered to Ireland, with product/ecommerce ads removed (${dropped} dropped from ${allAds.length} captured). ${generated} of ${ads.length} have a Renova-branded ad copy script generated by Claude.</p>
  <div>${cards}</div>
</div>`,
    count: ads.length,
    scriptsCount: generated,
    dropped,
  };
}

for (const [therapy, panes] of Object.entries(PANES)) {
  const meta = THERAPY_META[therapy];
  const rawPanes = {};
  for (const [slug, paneId] of panes) {
    const raw = grabPane(paneId).trim();
    rawPanes[slug] = applyRebrand(
      stripInlineScripts(expandAdCopy(stripSearchInputs(raw, slug))),
    );
  }

  const filter = buildEcommerceFilter(therapy, rawPanes.advertisers);

  const filtered = { ...rawPanes };
  filtered["all-ads"] = filterAdsTable(rawPanes["all-ads"], filter, therapy).html;
  filtered.advertisers = therapy === "pemf"
    ? filterAdvertisersTable(rawPanes.advertisers, filter)
    : filterAdvertisersPane(rawPanes.advertisers, filter);
  filtered.hooks = filterHooksPane(rawPanes.hooks, filter);
  filtered.longevity = filterLongevityPane(rawPanes.longevity, filter);

  const recountedMeta = recountTherapy(meta, filtered["all-ads"], therapy);
  filtered.overview = patchOverviewKpis(rawPanes.overview, recountedMeta);

  const filterDesc =
    filter.mode === "blocklist"
      ? `blocked ${filter.blocked.size}`
      : `allowlist of ${filter.allowed.size}`;
  console.log(
    `  ${therapy}: ${filterDesc}, ` +
      `${meta.totalAds} → ${recountedMeta.totalAds} ads, ` +
      `${meta.advertisers} → ${recountedMeta.advertisers} advertisers`,
  );

  // Add Irish Ads pane + tab if data exists.
  const tabs = [...recountedMeta.tabs];
  const irish = renderIrishAdsPane(therapy, recountedMeta.accent);
  if (irish) {
    filtered["irish-ads"] = irish.html;
    tabs.push({ id: "irish-ads", label: `🇮🇪 Irish Ads (${irish.count})` });
    console.log(
      `    + irish-ads: ${irish.count} ads, ${irish.scriptsCount} scripts`,
    );
  }

  // Mutate THERAPY_META so the final index.json reflects post-filter counts.
  THERAPY_META[therapy] = { ...recountedMeta, tabs };
  const payload = { ...recountedMeta, tabs, panes: filtered };
  const target = path.join(OUT, `${therapy}.json`);
  fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
  const sizeKb = (fs.statSync(target).size / 1024).toFixed(1);
  console.log(`  wrote app/public/data/${therapy}.json  (${sizeKb} KB)`);
}

const index = {
  therapies: Object.values(THERAPY_META).map((m) => ({
    id: m.id,
    label: m.label,
    icon: m.icon,
    accent: m.accent,
    accentBg: m.accentBg,
    totalAds: m.totalAds,
    advertisers: m.advertisers,
    scripts: m.scripts,
  })),
};
fs.writeFileSync(
  path.join(OUT, "index.json"),
  JSON.stringify(index, null, 2),
  "utf8",
);
console.log("  wrote app/public/data/index.json");
