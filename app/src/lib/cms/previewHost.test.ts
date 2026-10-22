// Run: npm test -- src/lib/cms/previewHost.test.ts
import assert from "node:assert/strict";

import { appHost, previewHost, shouldSendToPreview } from "./previewHost";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const prod = { APP_URL: "https://app.adonisagent.ie", RAILWAY_PUBLIC_DOMAIN: "www.adonisagent.ie" };
check("the app host comes from APP_URL", appHost(prod) === "app.adonisagent.ie");
check("without SITE_PREVIEW_HOST the Railway domain is the preview origin", previewHost(prod) === "www.adonisagent.ie");
check("SITE_PREVIEW_HOST wins, scheme or not", previewHost({ ...prod, SITE_PREVIEW_HOST: "https://preview.adonisagent.ie/" }) === "preview.adonisagent.ie");
check("a Railway domain that IS the app host is no preview origin", previewHost({ APP_URL: "https://x.up.railway.app", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }) === null);
check("local dev has no preview origin", previewHost({ APP_URL: "http://localhost:3000" }) === null);
check("the app host sends /site to the preview origin", shouldSendToPreview("app.adonisagent.ie", prod));
check("host compare ignores case", shouldSendToPreview("App.Adonisagent.ie", prod));
check("the preview host itself is left alone", !shouldSendToPreview("www.adonisagent.ie", prod));
check("a client domain is left alone", !shouldSendToPreview("www.gym.ie", prod));
check("nothing is sent anywhere without a preview origin", !shouldSendToPreview("localhost", { APP_URL: "http://localhost:3000" }));
check("nothing is sent anywhere without APP_URL", !shouldSendToPreview("app.adonisagent.ie", { RAILWAY_PUBLIC_DOMAIN: "www.adonisagent.ie" }));

console.log(`previewHost: ${passed} checks passed`);
