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
      <p class="foot__v"><a href="hbot.html">Hyperbaric oxygen</a><a href="infrared.html">Infrared</a><a href="hifem.html">HIFEM</a><a href="massage.html">Massage</a></p>
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
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/CustomEase.min.js"></script>
<script>
(function () {
  var root = document.documentElement;
  if (!window.gsap) { root.className = root.className.replace(/\\bjs\\b/, ''); return; }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.className = root.className.replace(/\\bjs\\b/, ''); return;
  }
  gsap.registerPlugin(ScrollTrigger);
  if (window.CustomEase) gsap.registerPlugin(CustomEase);

  /* ---- one easing vocabulary, used by everything ----------------------
     "Smooth but with a snap" is a curve that leaves fast and lands slow:
     most of the distance is covered in the first third, then it settles
     without bouncing. cubic-bezier(.16,1,.3,1) is that curve. Built-in
     power/expo eases are close but symmetrical-feeling by comparison --
     they ramp rather than launch.

     SNAP   the house ease. Entrances, panels, anything that arrives.
     GLIDE  softer, for things already on screen that shift position.
     PRESS  short and tight, for hover and other direct responses.

     Durations matter as much as the curve: a snappy ease over 1.4s still
     reads as slow, and over 0.2s reads as a jump. These are tuned to the
     distances actually travelled on this site.
  --------------------------------------------------------------------- */
  var SNAP = window.CustomEase ? CustomEase.create('snap', '.16,1,.3,1') : 'expo.out';
  var GLIDE = window.CustomEase ? CustomEase.create('glide', '.22,.78,.24,1') : 'power3.out';
  var PRESS = window.CustomEase ? CustomEase.create('press', '.3,.9,.2,1') : 'power2.out';
  var EASE = SNAP;

  if (document.querySelector('.hero')) {
    var tl = gsap.timeline();
    tl.to('.hero__media img', { scale: 1, duration: 2.4, ease: GLIDE }, 0)
      .to('.hero__mark > span', { y: '0%', duration: 1.05, ease: SNAP }, 0.1)
      .to('.hero [data-rise]', { opacity: 1, y: 0, duration: .85, ease: SNAP, stagger: 0.08 }, 0.28);
    gsap.to('.hero__media img', {
      yPercent: 10, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
    });
  }

  // Photographs wipe up as they are reached, and drift a little
  // while they are on screen.
  gsap.utils.toArray('.duo__img img, .tile__img img').forEach(function (img) {
    gsap.to(img, {
      clipPath: 'inset(0% 0 0 0)', scale: 1, duration: 1.15, ease: SNAP,
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
    gsap.to(t, { opacity: 1, y: 0, duration: .8, ease: SNAP,
      scrollTrigger: { trigger: t, start: 'top 92%' } });
  });
  gsap.utils.toArray('.roll').forEach(function (roll) {
    gsap.to(roll.querySelectorAll('.roll__row'), {
      opacity: 1, y: 0, duration: .85, ease: SNAP, stagger: 0.07,
      scrollTrigger: { trigger: roll, start: 'top 84%' }
    });
  });

  // The closing wordmark lifts into place like the one at the top.
  if (document.querySelector('.foot__mark > span')) {
    gsap.to('.foot__mark > span', {
      y: '0%', duration: 1.05, ease: SNAP,
      scrollTrigger: { trigger: '.foot__mark', start: 'top 95%' }
    });
  }

  /* ---- the therapies: hover to reveal, tap to open --------------------
     One panel open at a time. On a fine pointer the row opens on hover and
     the whole list closes when the pointer leaves it, so browsing the four
     is a single continuous movement rather than four clicks. On touch --
     where there is no hover -- the head toggles, which is also what a
     keyboard gets, and the link to the full page sits inside the panel so a
     press never navigates by surprise.

     Height is animated to a measured pixel value rather than 'auto': auto
     forces a layout read mid-tween and the first frame stutters, which is
     exactly the jolt this is meant to avoid.
  --------------------------------------------------------------------- */
  var rolls = gsap.utils.toArray('.roll--therapies');
  rolls.forEach(function (roll) {
    var rows = gsap.utils.toArray('[data-therapy]', roll);
    var open = null;

    rows.forEach(function (row) {
      var head = row.querySelector('.roll__head');
      var panel = row.querySelector('.roll__panel');
      var img = row.querySelector('.roll__media img');
      var copy = row.querySelectorAll('.roll__body, .roll__go');
      if (!head || !panel) return;

      row._close = function (now) {
        if (!row.classList.contains('is-open')) return;
        row.classList.remove('is-open');
        head.setAttribute('aria-expanded', 'false');
        gsap.killTweensOf([panel, img, copy]);
        gsap.to(panel, {
          height: 0, duration: now ? 0 : 0.42, ease: GLIDE,
          onComplete: function () { panel.hidden = true; }
        });
        gsap.to(copy, { opacity: 0, y: 8, duration: now ? 0 : 0.2, ease: PRESS });
      };

      row._open = function () {
        if (row.classList.contains('is-open')) return;
        if (open && open !== row) open._close();
        open = row;
        row.classList.add('is-open');
        head.setAttribute('aria-expanded', 'true');
        panel.hidden = false;
        gsap.killTweensOf([panel, img, copy]);

        // Measure the natural height with the panel laid out but not painted
        // at that size yet, then animate to the number.
        gsap.set(panel, { height: 'auto' });
        var target = panel.offsetHeight;
        gsap.fromTo(panel, { height: 0 }, { height: target, duration: 0.62, ease: SNAP });

        // The photograph wipes up and settles out of a slight overscale --
        // the same move the section images make when they scroll in, so the
        // panel feels like part of the page rather than a widget.
        gsap.fromTo(img,
          { clipPath: 'inset(0 0 100% 0)', scale: 1.06 },
          { clipPath: 'inset(0 0 0% 0)', scale: 1, duration: 0.85, ease: SNAP, delay: 0.05 });
        gsap.fromTo(copy,
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.6, ease: SNAP, stagger: 0.07, delay: 0.12 });
      };

      head.addEventListener('click', function () {
        if (row.classList.contains('is-open')) row._close();
        else row._open();
      });
      head.addEventListener('focus', function () { row._open(); });
    });

    // Hover only where hovering is real. A coarse pointer that reports hover
    // (some hybrids) would otherwise open a panel on the tap that was meant
    // to close it.
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      rows.forEach(function (row) {
        row.addEventListener('mouseenter', function () { row._open(); });
      });
      roll.addEventListener('mouseleave', function () {
        if (open) { open._close(); open = null; }
      });
    }
  });

  gsap.utils.toArray('[data-stagger]').forEach(function (group) {
    gsap.to(group.children, {
      opacity: 1, y: 0, duration: 0.85, ease: SNAP, stagger: 0.07,
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
    title: "Optimal Health & Recovery at Inspire | Infrared, HBOT & HIFEM, Clonmel",
    description:
      "A recovery clinic in Clonmel. Infrared, hyperbaric oxygen and HIFEM sessions, guided from start to finish, in a room built to be calm.",
  },
  therapies: {
    file: "therapies.html",
    title: "The three therapies | Optimal Health & Recovery at Inspire",
    description:
      "Hyperbaric oxygen, infrared and HIFEM at our Clonmel clinic. What each one is, what it supports, and how long a session takes.",
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
  hifem: {
    file: "hifem.html",
    title: "HIFEM therapy | Optimal Health & Recovery at Inspire",
    description:
      "HIFEM sessions in Clonmel, including pelvic floor support. Supports cellular energy, circulation and everyday movement.",
  },
  pricing: {
    file: "pricing.html",
    title: "Pricing | Optimal Health & Recovery at Inspire",
    description:
      "Session and block pricing for infrared, hyperbaric oxygen and HIFEM at our Clonmel clinic.",
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
