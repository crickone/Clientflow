// Build the Optimal Health site.
//
// Each page ships as standalone HTML with its own <style> in the head,
// because that is the shape the CMS importer files correctly: styles and
// font links become the page's head zone, the markup becomes the editable
// content zone, and the scripts at the end of the body become the tail zone
// the visual editor never runs. Keeping one stylesheet here rather than
// eight copies means a change lands everywhere at once.
//
//   node build.mjs
//
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "_style.css"), "utf8");

const NAV_LINKS = [
  ["therapies.html", "Therapies"],
  ["pricing.html", "Pricing"],
  ["about.html", "About"],
  ["contact.html", "Contact"],
];

const nav = () => `<header class="nav">
  <a href="index.html" aria-label="Optimal Health and Recovery at Inspire, home">
    <img class="nav__logo" src="assets/logo-ink.png" alt="Optimal Health and Recovery at Inspire" />
  </a>
  <nav class="nav__links" aria-label="Primary">
${NAV_LINKS.map(([h, t]) => `    <a href="${h}">${t}</a>`).join("\n")}
  </nav>
</header>`;

const footer = () => `<footer class="foot on-ink">
  <div class="foot__top">
    <p class="foot__say">Recovery you can fit around a working week.</p>
    <div>
      <p class="foot__k">Find us</p>
      <p class="foot__v">Unit 12m, Ard Gaoithe Business Park,<br />Clonmel, Co. Tipperary, E91 E049</p>
    </div>
    <div>
      <p class="foot__k">Get in touch</p>
      <p class="foot__v"><a href="tel:+353838672844">083 867 2844</a><a href="mailto:info@optimalhealthatinspire.ie">info@optimalhealthatinspire.ie</a></p>
    </div>
    <div>
      <p class="foot__k">Therapies</p>
      <p class="foot__v"><a href="hbot.html">Hyperbaric oxygen</a><a href="infrared.html">Infrared</a><a href="pemf.html">PEMF</a><a href="massage.html">Massage</a></p>
    </div>
  </div>
  <div class="foot__bar">
    <span>Optimal Health &amp; Recovery at Inspire</span>
    <span>&copy; 2026</span>
  </div>
  <p class="wordmark foot__mark"><span>Optimal Health</span></p>
</footer>`;

// GSAP lives at the very end of the body so the importer files it in the
// tail zone. Every pre-animation state is gated on the `js` flag set in the
// head: no flag, no hiding, so the page reads fine without JavaScript and
// the visual editor (which strips head scripts) shows every section.
const scripts = () => `<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
<script>
(function () {
  var root = document.documentElement;
  if (!window.gsap) { root.className = root.className.replace(/\\bjs\\b/, ''); return; }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.className = root.className.replace(/\\bjs\\b/, ''); return;
  }
  gsap.registerPlugin(ScrollTrigger);
  var EASE = 'power3.out';

  if (document.querySelector('.hero')) {
    var tl = gsap.timeline();
    tl.to('.hero__media img', { scale: 1, duration: 2.2, ease: 'power2.out' }, 0)
      .to('.hero__mark > span', { y: '0%', duration: 1.15, ease: 'power4.out' }, 0.12)
      .to('.hero [data-rise]', { opacity: 1, y: 0, duration: .9, ease: EASE, stagger: 0.1 }, 0.3);
    gsap.to('.hero__media img', {
      yPercent: 10, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
    });
  }

  // Photographs wipe up as they are reached, and drift a little
  // while they are on screen.
  gsap.utils.toArray('.duo__img img, .tile__img img').forEach(function (img) {
    gsap.to(img, {
      clipPath: 'inset(0% 0 0 0)', scale: 1, duration: 1.3, ease: 'power3.out',
      scrollTrigger: { trigger: img, start: 'top 88%' }
    });
  });
  gsap.utils.toArray('.duo__img').forEach(function (box) {
    gsap.fromTo(box.querySelector('img'), { yPercent: -3 }, {
      yPercent: 3, ease: 'none',
      scrollTrigger: { trigger: box, start: 'top bottom', end: 'bottom top', scrub: true }
    });
  });

  // Section titles and list rows arrive in sequence.
  gsap.utils.toArray('.band__head .title').forEach(function (t) {
    gsap.to(t, { opacity: 1, y: 0, duration: .7, ease: EASE,
      scrollTrigger: { trigger: t, start: 'top 92%' } });
  });
  gsap.utils.toArray('.roll').forEach(function (roll) {
    gsap.to(roll.querySelectorAll('.roll__row'), {
      opacity: 1, y: 0, duration: .8, ease: EASE, stagger: 0.09,
      scrollTrigger: { trigger: roll, start: 'top 84%' }
    });
  });

  // The closing wordmark lifts into place like the one at the top.
  if (document.querySelector('.foot__mark > span')) {
    gsap.to('.foot__mark > span', {
      y: '0%', duration: 1.15, ease: 'power4.out',
      scrollTrigger: { trigger: '.foot__mark', start: 'top 95%' }
    });
  }

  gsap.utils.toArray('[data-stagger]').forEach(function (group) {
    gsap.to(group.children, {
      opacity: 1, y: 0, duration: 0.85, ease: EASE, stagger: 0.09,
      scrollTrigger: { trigger: group, start: 'top 85%' }
    });
  });
}());
</script>`;

const shell = ({ title, description, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${description}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<script>document.documentElement.className+=' js';</script>
<style>
${css.trim()}
</style>
</head>
<body>

${nav()}

${body.trim()}

${footer()}

${scripts()}
</body>
</html>
`;

const META = {
  home: {
    file: "index.html",
    title: "Optimal Health & Recovery at Inspire | Infrared, HBOT & PEMF, Clonmel",
    description:
      "A recovery clinic in Clonmel. Infrared, hyperbaric oxygen and PEMF sessions, guided from start to finish, in a room built to be calm.",
  },
  therapies: {
    file: "therapies.html",
    title: "The three therapies | Optimal Health & Recovery at Inspire",
    description:
      "Hyperbaric oxygen, infrared and PEMF at our Clonmel clinic. What each one is, what it supports, and how long a session takes.",
  },
  hbot: {
    file: "hbot.html",
    title: "Hyperbaric oxygen therapy | Optimal Health & Recovery at Inspire",
    description:
      "Hyperbaric oxygen sessions in Clonmel. Higher oxygen levels to support recovery, mental clarity and steady daily energy.",
  },
  infrared: {
    file: "infrared.html",
    title: "Infrared therapy | Optimal Health & Recovery at Inspire",
    description:
      "Infrared sessions in Clonmel. Deep, gentle warmth to support muscle release, joint comfort, circulation and rest.",
  },
  pemf: {
    file: "pemf.html",
    title: "PEMF therapy | Optimal Health & Recovery at Inspire",
    description:
      "PEMF sessions in Clonmel, including pelvic floor support. Supports cellular energy, circulation and everyday movement.",
  },
  pricing: {
    file: "pricing.html",
    title: "Pricing | Optimal Health & Recovery at Inspire",
    description:
      "Session and block pricing for infrared, hyperbaric oxygen and PEMF at our Clonmel clinic.",
  },
  about: {
    file: "about.html",
    title: "About the clinic | Optimal Health & Recovery at Inspire",
    description:
      "Who we are, where we are, and what a session at our Clonmel recovery clinic is actually like.",
  },
  massage: {
    file: "massage.html",
    title: "Massage, reflexology and lymphatic drainage | Optimal Health & Recovery at Inspire",
    description:
      "Hands-on bodywork from clinical therapists in Clonmel: therapeutic massage, reflexology and lymphatic drainage.",
  },
  contact: {
    file: "contact.html",
    title: "Contact | Optimal Health & Recovery at Inspire",
    description:
      "Find us at Ard Gaoithe Business Park, Clonmel. Call 083 867 2844 or send us a message.",
  },
};

let built = 0;
for (const name of readdirSync(join(here, "pages"))) {
  if (!name.endsWith(".html")) continue;
  const key = name.replace(/\.html$/, "");
  const meta = META[key];
  if (!meta) {
    console.warn(`  no metadata for pages/${name} - skipped`);
    continue;
  }
  const body = readFileSync(join(here, "pages", name), "utf8");
  writeFileSync(join(here, meta.file), shell({ ...meta, body }));
  console.log(`  ${meta.file.padEnd(18)} ${body.length} chars of content`);
  built++;
}
console.log(`\n${built} pages built.`);
