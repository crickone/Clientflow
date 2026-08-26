// Run: npm test -- src/components/research/matchExamplePage.test.ts
//
// The Content gaps UI's "example competitor page" matcher — pure, so plain
// literals cover it end-to-end (no DB, no network). Mirrors gaps.test.ts's
// own style for the sibling pure module this one builds on
// (normaliseTopic). See matchExamplePage.ts's header comment for why the
// type-only imports it carries (StoredCompetitorPage, ContentGapPerCompetitor
// — both from `server-only` modules) are safe to load under this runner.
import { test } from "node:test";
import assert from "node:assert/strict";

import { findExamplePage, findExampleLink } from "./matchExamplePage";
import type { StoredCompetitorPage } from "@/lib/research/store";
import type { ContentGapPerCompetitor } from "@/lib/research/contentScan";

function page(overrides: Partial<StoredCompetitorPage> = {}): StoredCompetitorPage {
  return {
    id: 1,
    competitorId: 1,
    url: "https://example.com/",
    path: "/",
    title: null,
    metaDescription: null,
    h1: null,
    h2s: [],
    wordCount: 0,
    topic: null,
    fetchedAt: Date.now(),
    ...overrides,
  };
}

test("findExamplePage: matches on title first, even when h1/h2 would also match a different page", () => {
  const titleMatch = page({ id: 1, title: "Sports Massage Clonmel", h1: "Welcome" });
  const h1Match = page({ id: 2, title: "Home", h1: "Sports Massage" });
  const result = findExamplePage([h1Match, titleMatch], "sports massage");
  assert.equal(result?.id, 1);
});

test("findExamplePage: falls back to h1 when no title matches", () => {
  const p = page({ id: 2, title: "Home", h1: "Deep Tissue Massage" });
  const result = findExamplePage([p], "deep tissue massage");
  assert.equal(result?.id, 2);
});

test("findExamplePage: falls back to h2s when neither title nor h1 match", () => {
  const p = page({ id: 3, title: "Home", h1: "Welcome", h2s: ["Our services", "Nutrition coaching"] });
  const result = findExamplePage([p], "nutrition coaching");
  assert.equal(result?.id, 3);
});

test("findExamplePage: no match anywhere -> null", () => {
  const p = page({ title: "Home", h1: "Welcome", h2s: ["Contact us"] });
  assert.equal(findExamplePage([p], "sports massage"), null);
});

test("findExamplePage: empty pages array -> null", () => {
  assert.equal(findExamplePage([], "sports massage"), null);
});

test("findExamplePage: empty/whitespace topic -> null, never throws", () => {
  const p = page({ title: "Sports Massage" });
  assert.doesNotThrow(() => findExamplePage([p], ""));
  assert.equal(findExamplePage([p], ""), null);
  assert.equal(findExamplePage([p], "   "), null);
});

test("findExamplePage: case-insensitive and loose-plural (reuses gaps.ts's normaliseTopic)", () => {
  const p = page({ title: "Our Memberships" });
  assert.equal(findExamplePage([p], "MEMBERSHIP")?.title, "Our Memberships");
});

test("findExamplePage: a topic that's a substring of the page title still matches", () => {
  const broadTitle = page({ id: 2, title: "Sports Massage Therapy Clinic" });
  assert.equal(findExamplePage([broadTitle], "massage")?.id, 2);
});

test("findExamplePage: a page title that's a substring of the (broader) topic still matches", () => {
  const narrowTitle = page({ id: 1, title: "Massage" });
  assert.equal(findExamplePage([narrowTitle], "sports massage")?.id, 1);
});

test("findExamplePage: genuinely unrelated title/topic -> no match", () => {
  const p = page({ id: 1, title: "Massage" });
  assert.equal(findExamplePage([p], "opening hours"), null);
});

test("findExamplePage: first page in array order wins among equally-good title matches", () => {
  const first = page({ id: 10, title: "Sports Massage" });
  const second = page({ id: 11, title: "Sports Massage Deluxe" });
  assert.equal(findExamplePage([first, second], "sports massage")?.id, 10);
});

function competitor(overrides: Partial<ContentGapPerCompetitor> = {}): ContentGapPerCompetitor {
  return {
    competitorId: 1,
    competitorName: "Iron Gym Clonmel",
    isSelf: false,
    websiteUri: null,
    lastScannedAt: null,
    topics: [],
    pages: [],
    ...overrides,
  };
}

test("findExampleLink: no exampleCompetitorName -> null", () => {
  assert.equal(findExampleLink([competitor()], undefined, "sports massage"), null);
});

test("findExampleLink: exampleCompetitorName not found in perCompetitor -> null (stale data, never throws)", () => {
  assert.doesNotThrow(() => findExampleLink([competitor({ competitorName: "Other Gym" })], "Ghost Gym", "sports massage"));
  assert.equal(findExampleLink([competitor({ competitorName: "Other Gym" })], "Ghost Gym", "sports massage"), null);
});

test("findExampleLink: a matching page wins -> links to that exact page, isFallback false", () => {
  const p = page({ id: 5, url: "https://irongym.ie/sports-massage", title: "Sports Massage" });
  const c = competitor({ competitorName: "Iron Gym Clonmel", websiteUri: "https://irongym.ie", pages: [p] });
  const link = findExampleLink([c], "Iron Gym Clonmel", "sports massage");
  assert.deepEqual(link, { competitorName: "Iron Gym Clonmel", url: "https://irongym.ie/sports-massage", isFallback: false });
});

test("findExampleLink: no matching page but a websiteUri on file -> falls back to the site root, isFallback true", () => {
  const p = page({ id: 6, url: "https://irongym.ie/contact", title: "Contact" });
  const c = competitor({ competitorName: "Iron Gym Clonmel", websiteUri: "https://irongym.ie", pages: [p] });
  const link = findExampleLink([c], "Iron Gym Clonmel", "sports massage");
  assert.deepEqual(link, { competitorName: "Iron Gym Clonmel", url: "https://irongym.ie", isFallback: true });
});

test("findExampleLink: no matching page and no websiteUri -> null", () => {
  const c = competitor({ competitorName: "Iron Gym Clonmel", websiteUri: null, pages: [] });
  assert.equal(findExampleLink([c], "Iron Gym Clonmel", "sports massage"), null);
});
