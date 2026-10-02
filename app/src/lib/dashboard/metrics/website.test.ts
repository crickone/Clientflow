// Run: npm test -- src/lib/dashboard/metrics/website.test.ts
import assert from "node:assert/strict";
import { blogSlugFromPath, blogViewRows, groupViews, normalizePath, pathLabel, revisionSourceLabel } from "./website";

assert.equal(normalizePath("/site/optimal/blog/hbot"), "/blog/hbot");
assert.equal(normalizePath("/site/optimal"), "/");
assert.equal(normalizePath("/about/"), "/about");
assert.equal(normalizePath("/about?x=1"), "/about");
assert.equal(pathLabel("/"), "Home");
assert.equal(pathLabel("/site/optimal/"), "Home");
assert.equal(pathLabel("/pricing"), "/pricing");

assert.equal(blogSlugFromPath("/blog/hello-world"), "hello-world");
assert.equal(blogSlugFromPath("/site/x/blog/hello-world"), "hello-world");
assert.equal(blogSlugFromPath("/blog"), null);
assert.equal(blogSlugFromPath("/blog/a/b"), null);
assert.equal(blogSlugFromPath("/about"), null);

// Dev and prod paths for one page merge; ordered by views, capped.
assert.deepEqual(
  groupViews([{ path: "/", views: 3 }, { path: "/site/x", views: 2 }, { path: "/about", views: 4 }, { path: "/z", views: 1 }], 2),
  [{ label: "Home", value: 5 }, { label: "/about", value: 4 }],
);

const titles = new Map([["a", "Post A"], ["b", "Post B"]]);
assert.deepEqual(
  blogViewRows(
    [{ path: "/blog/a", views: 2 }, { path: "/site/x/blog/a", views: 1 }, { path: "/blog/b", views: 2 }, { path: "/blog/gone", views: 9 }, { path: "/about", views: 5 }],
    titles,
    6,
  ),
  [{ label: "Post A", value: 3 }, { label: "Post B", value: 2 }],
);

assert.equal(revisionSourceLabel("studio"), "Studio");
assert.equal(revisionSourceLabel("agent"), "Adonis");
assert.equal(revisionSourceLabel("deploy"), "Deploy");
assert.equal(revisionSourceLabel("restore"), "Restored");

console.log("website.test.ts: ok");
