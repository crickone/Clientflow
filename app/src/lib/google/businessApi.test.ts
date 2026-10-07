// Run: npx tsx src/lib/google/businessApi.test.ts
import assert from "node:assert/strict";

import {
  buildLocalPost,
  dailyMetricsUrl,
  googleErrorMessage,
  parseDailyMetrics,
  parseGaProperties,
  parseGaReport,
  parseKeywords,
  parseReviews,
  parseScRows,
  parseScSites,
  profileTotals,
  viewsByDay,
} from "./businessApi";

// Daily metrics URL carries every metric and the inclusive range.
const url = dailyMetricsUrl("locations/123", Date.UTC(2026, 8, 1), Date.UTC(2026, 8, 30));
assert.ok(url.startsWith("https://businessprofileperformance.googleapis.com/v1/locations/123:fetchMultiDailyMetricsTimeSeries?"));
assert.ok(url.includes("dailyMetrics=CALL_CLICKS") && url.includes("dailyRange.endDate.day=30") && url.includes("dailyRange.startDate.month=9"));

// The documented response shape, with a day Google left without a value.
const series = parseDailyMetrics({
  multiDailyMetricTimeSeries: [
    {
      dailyMetricTimeSeries: [
        { dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 1 }, value: "40" }, { date: { year: 2026, month: 9, day: 2 } }] } },
        { dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_MAPS", timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 1 }, value: "10" }] } },
        { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 2 }, value: "3" }] } },
        { dailyMetric: "SOMETHING_NEW", timeSeries: { datedValues: [{ date: { year: 2026, month: 9, day: 2 }, value: "9" }] } },
      ],
    },
  ],
});
const t = profileTotals(series);
assert.equal(t.searchViews, 40);
assert.equal(t.mapsViews, 10);
assert.equal(t.views, 50);
assert.equal(t.calls, 3);
assert.equal(t.websiteClicks, 0);
const byDay = viewsByDay(series, Date.UTC(2026, 8, 1), 3);
assert.deepEqual(byDay.map((d) => d.search), [40, 0, 0]);
assert.equal(byDay[0].day, "2026-09-01");

// Keywords: exact counts first, thresholded ones after.
const kw = parseKeywords({
  searchKeywordsCounts: [
    { searchKeyword: "hyperbaric clonmel", insightsValue: { threshold: "15" } },
    { searchKeyword: "optimal health", insightsValue: { value: "84" } },
  ],
});
assert.deepEqual(kw.map((k) => k.keyword), ["optimal health", "hyperbaric clonmel"]);
assert.equal(kw[1].under, true);

// Reviews: star words, the Google translation block, replies, anonymous.
const r = parseReviews({
  averageRating: 4.8,
  totalReviewCount: 31,
  reviews: [
    { name: "accounts/1/locations/2/reviews/a", reviewer: { displayName: "Mary Ryan" }, starRating: "FIVE", comment: "Brilliant.\n\n(Translated by Google)\nBrilliant.", createTime: "2026-09-30T10:00:00Z", reviewReply: { comment: "Thanks Mary", updateTime: "2026-10-01T09:00:00Z" } },
    { name: "accounts/1/locations/2/reviews/b", reviewer: { isAnonymous: true }, starRating: "THREE", createTime: "2026-09-29T10:00:00Z" },
  ],
});
assert.equal(r.average, 4.8);
assert.equal(r.reviews[0].rating, 5);
assert.equal(r.reviews[0].comment, "Brilliant.");
assert.equal(r.reviews[0].reply, "Thanks Mary");
assert.equal(r.reviews[1].reviewer, "A Google user");
assert.equal(r.reviews[1].reply, null);

// Local post: hashtags dropped, capped, call button when there is a phone.
const post = buildLocalPost({ caption: "Infrared, explained.\n\nCall to book.\n\n#recovery #clonmel", imageUrl: "https://x/y.png", phone: "083 867 2844" });
assert.equal(post.summary, "Infrared, explained.\n\nCall to book.");
assert.deepEqual(post.callToAction, { actionType: "CALL" });
assert.deepEqual(post.media, [{ mediaFormat: "PHOTO", sourceUrl: "https://x/y.png" }]);
const long = buildLocalPost({ caption: "a".repeat(2000), imageUrl: null, websiteUrl: "https://example.ie" });
assert.equal((long.summary as string).length, 1500);
assert.deepEqual(long.callToAction, { actionType: "LEARN_MORE", url: "https://example.ie" });
assert.equal(long.media, undefined);

// Search Console + GA4.
assert.deepEqual(parseScSites({ siteEntry: [{ siteUrl: "sc-domain:example.ie", permissionLevel: "siteOwner" }, { siteUrl: "https://x/", permissionLevel: "siteUnverifiedUser" }] }), ["sc-domain:example.ie"]);
assert.equal(parseScRows({ rows: [{ keys: ["hbot clonmel"], clicks: 4, impressions: 90, ctr: 0.044, position: 6.2 }] })[0].impressions, 90);
assert.deepEqual(parseGaProperties({ accountSummaries: [{ displayName: "Optimal", propertySummaries: [{ property: "properties/9", displayName: "Website" }] }] }), [{ property: "properties/9", name: "Optimal / Website" }]);
assert.deepEqual(parseGaReport({ rows: [{ dimensionValues: [{ value: "20261001" }], metricValues: [{ value: "12" }, { value: "9" }] }] }), [{ dims: ["2026-10-01"], values: [12, 9] }]);

// Errors read as a sentence.
assert.match(googleErrorMessage(403, JSON.stringify({ error: { message: "My Business API has not been used in project 1 before or it is disabled." } })), /not switched on/);
assert.match(googleErrorMessage(401, "{}"), /Reconnect/);

console.log("businessApi: all checks passed.");
