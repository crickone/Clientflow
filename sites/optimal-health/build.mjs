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

/* ---- the chapter rail ------------------------------------------------
   Its own IIFE, deliberately: the motion one above returns early when GSAP
   is missing or the viewer prefers reduced motion, and the rail has to
   follow the reader in both of those cases. It is decoration for nobody.

   Progressive enhancement over a plain anchor list: with this script
   removed the rail still lists every section and every link still jumps
   to it. One handler drives both the desktop rail and the phone strip,
   because they are two renderings of the same anchor list.

   Position is decided by a line a quarter of the way down the viewport:
   the current chapter is the last one whose top has crossed it. That is
   deterministic, unlike ranking IntersectionObserver ratios, which
   reorder unpredictably when one section is much taller than another.
--------------------------------------------------------------------- */
(function () {
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  var railAnchors = [].slice.call(document.querySelectorAll('[data-rail]'));
  if (railAnchors.length) {
    var byId = {};
    railAnchors.forEach(function (a) {
      var id = a.getAttribute('data-rail');
      (byId[id] = byId[id] || []).push(a);
    });
    var ids = Object.keys(byId);
    var sections = ids.map(function (id) { return document.getElementById(id); })
                      .filter(Boolean);
    var current = null;
    var mark = function (id) {
      if (id === current) return;
      current = id;
      railAnchors.forEach(function (a) {
        a.classList.remove('is-on');
        a.removeAttribute('aria-current');
      });
      (byId[id] || []).forEach(function (a) {
        a.classList.add('is-on');
        a.setAttribute('aria-current', 'true');
        // The stylesheet gates its smooth scrolling on the same preference,
        // and a pan nobody asked for is worse than one they can follow: a
        // reduced-motion reader gets the jump, everyone else the glide.
        var how = calm.matches ? 'auto' : 'smooth';
        var strip = a.parentNode;
        if (strip && strip.classList && strip.classList.contains('strip__nav')) {
          strip.scrollTo({ left: Math.max(0, a.offsetLeft - 16), behavior: how });
          return;
        }
        // The rail is a scroll container of its own, and the later pages carry
        // six and seven chapters: on a short viewport the lit entry can sit
        // outside the rail's visible range, which is the one thing the rail
        // exists to prevent. Only when it is really overflowing, though -- on
        // a page whose index fits, this would be a no-op that still cancels
        // whatever scroll the reader is in the middle of.
        var rail = a.closest && a.closest('.rail');
        if (!rail || rail.scrollHeight <= rail.clientHeight + 1) return;
        var into = a.getBoundingClientRect().top - rail.getBoundingClientRect().top;
        rail.scrollTo({
          top: Math.max(0, rail.scrollTop + into - (rail.clientHeight - a.offsetHeight) / 2),
          behavior: how
        });
      });
    };
    var queued = false;
    var settle = function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        var line = window.innerHeight * 0.25;
        var pick = sections[0];
        sections.forEach(function (s) {
          if (s.getBoundingClientRect().top <= line) pick = s;
        });
        if (pick) mark(pick.id);
      });
    };
    window.addEventListener('scroll', settle, { passive: true });
    window.addEventListener('resize', settle);
    settle();
  }
}());
</script>`;

/* ---- the chapter rail -----------------------------------------------
   A partial opts a section into the page index with data-chapter="Label",
   and closes the documented column with <!-- /chapters -->. Everything
   before the first chapter (the hero) and everything after the marker (the
   closing call to action) stays full-bleed.

   The index is DERIVED from the same marks that number the sections, so a
   contents entry can never point at a section that is not there -- the
   failure mode of every hand-written table of contents.
--------------------------------------------------------------------- */
const BOOK = "https://optimalhealthatinspire.simplybook.it/v2";
const CHAPTER_RE = /<section\b([^>]*?)\sdata-chapter="([^"]+)"([^>]*)>/g;

// Deliberately looser than CHAPTER_RE: whatever this finds and CHAPTER_RE
// cannot match is exactly the mark that would be silently ignored.
const CHAPTER_ANY = /\sdata-chapter\s*=/g;

// The count below reads markup with the prose taken out. A partial that
// quotes the contract back at itself in an HTML comment is not declaring a
// chapter, and would otherwise fail a page that is entirely correct, with a
// message describing a fault it does not have.
const HTML_COMMENT = /<!--[\s\S]*?-->/g;

// Case-insensitive because HTML attribute names are: <section ID="intro"> is
// an id as far as the browser is concerned, and collides exactly the same.
const OWN_ATTR_RE = /\s(id|aria-label)\s*=/i;

// sNN is this function's own id space. Anything in a partial already wearing
// one of those ids is a duplicate waiting to happen.
const STRAY_ID_RE = /\sid\s*=\s*["']?(s\d\d)\b/i;

// The chapter sections as they stand after numbering, to find the first and
// the last of them in the rewritten body.
const MARKED_SECTION = /<section\b[^>]*\sdata-chapter=/g;

// The label reaches three markup contexts and the capture admits & and <, so
// a therapy called "Sleep & recovery" would otherwise emit invalid markup and
// a label with a tag in it would write into the rail. The & rule spares an
// ampersand that is already an entity, because "Sleep &amp; recovery" is the
// correct way to write that attribute and must not come out doubled.
const esc = (s) =>
  s.replace(/&(?![#\w]+;)/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Twelve later pages will write partials against this contract and none of
// them will read this function, so every way of getting it wrong throws with
// the page named. A mark that does not become an entry is worse than a build
// that stops: the page still renders, and the index quietly lies.
function documentise(body, page) {
  const chapters = [];
  const marked = body.replace(CHAPTER_RE, (_m, pre, label, post) => {
    // The id and the accessible name belong to this function. A section that
    // brings its own emits the attribute twice; the first one wins, so the
    // entry points at an element that does not answer to it, the spy drops it
    // and the build still reports success.
    const own = OWN_ATTR_RE.exec(` ${pre} ${post}`);
    if (own) {
      throw new Error(
        `${page}: chapter "${label}" already carries ${own[1]}=. documentise sets id ` +
          `and aria-label on every chapter -- remove it from the <section> tag.`,
      );
    }
    const n = String(chapters.length + 1).padStart(2, "0");
    chapters.push({ n, label, id: `s${n}` });
    return `<section${pre} data-chapter="${label}"${post} id="s${n}" aria-label="${esc(label)}">`;
  });
  // Above the early return, deliberately. When EVERY mark on a page fails
  // CHAPTER_RE -- all the values single-quoted, the marks put on <div> or
  // <article>, a `>` inside an earlier attribute on each marked tag -- there
  // are no chapters, and behind the early return the page would come back
  // untouched: no rail, no error, `9 pages built.` over a page that asked for
  // one. A page with genuinely no marks still returns early below, because
  // for it declared === 0 === chapters.length.
  const declared = (body.replace(HTML_COMMENT, "").match(CHAPTER_ANY) || []).length;
  if (declared !== chapters.length) {
    throw new Error(
      `${page}: ${declared} data-chapter marks in the body but ${chapters.length} became ` +
        `chapters. A chapter is a <section> whose data-chapter value is double-quoted.`,
    );
  }
  if (!chapters.length) return marked;

  // The own-attribute guard above only ever sees chapter tags. An sNN id
  // anywhere else in the partial is a duplicate, getElementById answers with
  // whichever came first, and the spy then follows the wrong element -- with
  // the build reporting success.
  const stray = STRAY_ID_RE.exec(body);
  if (stray) {
    throw new Error(
      `${page}: the body already carries id="${stray[1]}". documentise numbers the ` +
        `chapters s01, s02, ... and owns those ids -- name the element something else.`,
    );
  }

  const at = [...marked.matchAll(MARKED_SECTION)].map((m) => m.index);
  const start = at[0];
  const endMark = marked.indexOf("<!-- /chapters -->");
  // The marker closes the documented column, so it has to follow the LAST
  // chapter, not merely the first. Before the first it slices an empty column
  // and then re-emits the sections that follow -- a duplicated page carrying
  // duplicate ids. Between two, the later chapters fall outside .doc__body:
  // they keep their ids and their entries in the index, but lose the band
  // bleed and the scroll landing room while the rail goes on listing them.
  if (endMark !== -1 && endMark < at[at.length - 1]) {
    throw new Error(
      `${page}: <!-- /chapters --> comes before the last data-chapter section. ` +
        `The marker closes the documented column, so every chapter must precede it.`,
    );
  }
  const end = endMark === -1 ? marked.length : endMark;

  const rail = `<aside class="rail" aria-label="On this page">
  <div class="rail__in">
    <p class="rail__k">On this page</p>
    <nav class="rail__nav">
${chapters.map((c) => `      <a class="rail__a" href="#${c.id}" data-rail="${c.id}"><span class="rail__n">${c.n}</span><span class="rail__l">${esc(c.label)}</span></a>`).join("\n")}
    </nav>
    <a class="btn btn--rail" href="${BOOK}">Book a session</a>
  </div>
</aside>`;

  const strip = `<nav class="strip" aria-label="On this page">
  <div class="strip__nav">
${chapters.map((c) => `    <a class="strip__a" href="#${c.id}" data-rail="${c.id}"><span class="rail__n">${c.n}</span> ${esc(c.label)}</a>`).join("\n")}
  </div>
</nav>`;

  // The bar's ground is ink, so the default ink button has no edge on it.
  const bar = `<div class="bookbar"><a class="btn btn--light" href="${BOOK}">Book a session</a></div>`;

  return [
    marked.slice(0, start),
    `<div class="doc">`,
    rail,
    `<div class="doc__body">`,
    strip,
    marked.slice(start, end),
    `</div>`,
    `</div>`,
    bar,
    marked.slice(end),
  ].join("\n");
}

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

// Two passes, because documentise throws and the built pages are committed
// output. Writing as we go would leave the alphabetically earlier pages
// rewritten with the new stylesheet and the rest stale -- a half-rebuilt tree
// that someone can commit without ever re-running the build. Nothing is
// written until every page has composed.
const composed = [];
for (const name of readdirSync(join(here, "pages"))) {
  if (!name.endsWith(".html")) continue;
  const key = name.replace(/\.html$/, "");
  const meta = META[key];
  if (!meta) {
    console.warn(`  no metadata for pages/${name} - skipped`);
    continue;
  }
  const raw = readFileSync(join(here, "pages", name), "utf8");
  const body = documentise(raw, `pages/${name}`);
  composed.push({ file: meta.file, chars: body.length, html: shell({ ...meta, body }) });
}
for (const page of composed) {
  writeFileSync(join(here, page.file), page.html);
  console.log(`  ${page.file.padEnd(18)} ${page.chars} chars of content`);
}
console.log(`\n${composed.length} pages built.`);
