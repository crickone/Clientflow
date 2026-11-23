// Run: npm test -- src/lib/cms/sitePhotosModel.test.ts
//
// Campaign landing pages use the client's own photographs, from the website
// page that matches what the campaign is about.
import assert from "node:assert/strict";

import { photosIn, pickPhotos, topicWords } from "./sitePhotosModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const home = { path: "/", title: "Optimal Health", html: '<img src="/sites/oh/assets/logo-ink.png"><img src="/sites/oh/assets/reception.jpg"><img src="/sites/oh/assets/hbot.jpg">' };
const massage = { path: "/massage", title: "Massage in Clonmel", html: '<img src="/sites/oh/assets/massage-room.jpg"><img src="/sites/oh/assets/massage-back.jpg"><img src="/sites/oh/assets/massage-room.jpg"><img src="data:image/png;base64,xx">' };
const blog = { path: "/blog/massage-after-training", title: "Massage after training", html: '<img src="/sites/oh/assets/blog-massage.jpg">' };
const icons = { path: "/contact", title: "Contact", html: '<img src="/sites/oh/assets/phone-icon.svg">' };

check("logos, icons and inline images are not photos", photosIn(home.html).join() === "/sites/oh/assets/reception.jpg,/sites/oh/assets/hbot.jpg");
check("repeats are dropped", photosIn(massage.html).length === 2);
check("svgs are not photos", photosIn(icons.html).length === 0);

check("a campaign's topic words skip the season", topicWords("Black Friday Massage 2026").join() === "massage");
check("service names count too", topicWords("Black Friday", "Deep tissue massage 60 min").includes("tissue"));

const picks = pickPhotos([home, blog, icons, massage], topicWords("Black Friday Massage 2026"), 4);
check("the matching service page comes first", picks[0] === "/sites/oh/assets/massage-room.jpg" && picks[1] === "/sites/oh/assets/massage-back.jpg");
check("a matching blog post ranks below the service page", picks[2] === "/sites/oh/assets/blog-massage.jpg");
check("then the home page fills the rest", picks[3] === "/sites/oh/assets/reception.jpg");
check("nothing matching falls back to the home page", pickPhotos([home, massage], ["yoga"], 2)[0] === "/sites/oh/assets/reception.jpg");
check("no pages, no photos", pickPhotos([], ["massage"]).length === 0);

const hbot = { path: "/hbot", title: "HBOT in Clonmel", html: '<img src="/a/hbot-1.jpg"><img src="/a/hbot-2.jpg"><img src="/a/hbot-3.jpg"><img src="/a/hbot-4.jpg">' };
const infrared = { path: "/infrared", title: "Infrared in Clonmel", html: '<img src="/a/ir-1.jpg"><img src="/a/ir-2.jpg"><img src="/a/ir-3.jpg">' };
const irBlog = { path: "/blog-infrared-and-aches", title: "Infrared and aches", html: '<img src="/a/ir-blog.jpg">' };
const two = pickPhotos([home, hbot, irBlog, infrared], topicWords("Black Friday Infrared + HBOT 2026"), 4);
check("a campaign about two things shows photos of both, in turn", two.join() === "/a/ir-1.jpg,/a/hbot-1.jpg,/a/ir-2.jpg,/a/hbot-2.jpg");
check("one subject still fills from its own page", pickPhotos([home, hbot, infrared], ["hbot"], 3).join() === "/a/hbot-1.jpg,/a/hbot-2.jpg,/a/hbot-3.jpg");

console.log(`sitePhotosModel: ${passed} checks passed`);
