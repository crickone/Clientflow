// Run: npm test -- src/lib/cms/siteHostsEnv.test.ts
import assert from "node:assert/strict";
import { envSiteSlugForHost, parseSiteHosts } from "./siteHostsEnv";

const env = "www.adonisagent.ie=adonisagent, adonisagent.ie=adonisagent,bad,=x";
assert.deepEqual(parseSiteHosts(env), { "www.adonisagent.ie": "adonisagent", "adonisagent.ie": "adonisagent" });
assert.equal(envSiteSlugForHost("WWW.AdonisAgent.ie:443", env), "adonisagent", "case and port ignored");
assert.equal(envSiteSlugForHost("app.adonisagent.ie", env), null, "unmapped host");
assert.equal(envSiteSlugForHost(null, env), null);
assert.equal(envSiteSlugForHost("x.ie", undefined), null, "no env");
console.log("siteHostsEnv: 5 checks passed.");
