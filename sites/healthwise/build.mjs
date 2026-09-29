// Build the Healthwise site.
//
// Each page ships as standalone HTML with one <style> in the head, because
// that is the shape the CMS importer files correctly: fonts + style become
// the page's head zone, the markup becomes the editable content zone, and
// the scripts at the end of the body become the tail zone the visual editor
// never runs. One stylesheet here means a change lands everywhere at once.
//
//   node build.mjs
//
// Partials in pages/ may use these substitutions:
//   {{PULSE}}            the hero pulse line (draws on with JS)
//   {{RULE}}             a full-width pulse rule before a section title
//   {{STRIP:vitality}}   the booking block, programme carried into the form
//   {{FORM}}             the enquiry form on its own (contact page)
//   {{TOKEN}}            the literal enquiry-token placeholder
//   {{MAPS}}             the Google Maps link for the studio
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "_style.css"), "utf8");

// The one literal the CMS's verbatim template replaces at render time with a
// token naming this tenant and site (app/src/lib/cms/enquiryToken.ts).
const TOKEN = "__ADONIS_ENQUIRY_TOKEN__";
const MAPS = "https://www.google.com/maps/search/?api=1&query=52.36408485468106%2C-7.711582681662141";
const PHONE_DISPLAY = "086 242 2388";
const PHONE_TEL = "+353862422388";
const EMAIL = "dj@healthwiseclonmel.ie";

// Four programmes would make seven top-level nav items, which crowds the row
// long before the mobile menu takes over, so they live under one "Programmes"
// disclosure. It opens on hover and on focus in CSS, so it works with no
// JavaScript at all; the tail script only adds click, Escape and click-away.
const PROGRAMMES = [
  ["livewell.html", "Livewell 40–60", "livewell"],
  ["vitality.html", "Vitality 60+", "vitality"],
  ["studio60.html", "Studio 60", "studio60"],
  ["heartwise.html", "Heartwise", "heartwise"],
];

const NAV_LINKS = [
  ["classes.html", "Classes", "classes"],
  ["about.html", "About", "about"],
  ["blog.html", "Blog", "blog"],
];

const pulseSvg = (cls) =>
  `<svg class="pulse ${cls}" viewBox="0 0 140 20" aria-hidden="true"><path d="M0 10 H48 L56 3 L64 17 L72 10 H140"/></svg>`;
const ruleSvg = () =>
  `<svg class="pulse pulse--rule" viewBox="0 0 1200 20" preserveAspectRatio="none" aria-hidden="true"><path d="M0 10 H140 L148 3 L156 17 L164 10 H1200"/></svg>`;

const nav = (key) => `<header class="nav">
  <a class="skip" href="#main">Skip to content</a>
  <div class="nav__in">
    <a class="nav__logo" href="index.html" aria-label="Healthwise, home"><img src="assets/logo.png" alt="Healthwise — Educate, Motivate, Activate" width="819" height="168" /></a>
    <nav class="nav__links" id="nav-links" aria-label="Primary">
      <div class="nav__group${PROGRAMMES.some(([, , k]) => k === key) ? " nav__group--current" : ""}">
        <button class="nav__grouptop" type="button" aria-expanded="false" aria-controls="nav-programmes">Programmes</button>
        <div class="nav__sub" id="nav-programmes">
${PROGRAMMES.map(([h, t, k]) => `          <a href="${h}"${k === key ? ' aria-current="page"' : ""}>${t}</a>`).join("\n")}
        </div>
      </div>
${NAV_LINKS.map(([h, t, k]) => `      <a href="${h}"${k === key ? ' aria-current="page"' : ""}>${t}</a>`).join("\n")}
    </nav>
    <div class="nav__cta">
      <a class="nav__tel" href="tel:${PHONE_TEL}">${PHONE_DISPLAY}</a>
      <a class="btn" href="contact.html#book">Book a consultation</a>
      <button class="nav__menu" type="button" aria-expanded="false" aria-controls="nav-links">Menu</button>
    </div>
  </div>
</header>`;

const footer = () => `<footer class="foot">
  <div class="wrap">
    <div class="foot__grid">
      <div>
        <img class="foot__logo" src="assets/logo-white.png" alt="Healthwise" />
        <p>Unit 12E Ard Gaoithe Business Park,<br />Clonmel, Co. Tipperary, E91 A6F4</p>
        <p style="margin-top:10px"><a href="${MAPS}" rel="noopener">Directions</a></p>
      </div>
      <div class="foot__links">
        <b>Talk to us</b>
        <a href="tel:${PHONE_TEL}">${PHONE_DISPLAY}</a>
        <a href="mailto:${EMAIL}">${EMAIL}</a>
        <p style="margin-top:10px">Classes from 7am, mornings and evenings. See the <a href="classes.html">timetable</a>.</p>
      </div>
      <div class="foot__links">
        <b>Programmes</b>
        <a href="livewell.html">Livewell 40–60</a>
        <a href="vitality.html">Vitality 60+</a>
        <a href="studio60.html">Studio 60</a>
        <a href="heartwise.html">Heartwise</a>
        <a href="drivewise.html">Drivewise for companies</a>
        <a href="blog.html">Blog</a>
      </div>
      <div class="foot__links">
        <b>Also at Ard Gaoithe</b>
        <a href="https://inspirehealthandfitness.ie" rel="noopener">Inspire Health &amp; Fitness</a>
        <a href="https://bodegacafeatinspire.ie" rel="noopener">Bodega Cafe at Inspire</a>
        <b style="margin-top:16px">Follow</b>
        <a href="https://www.facebook.com/healthwiseclonmel/" rel="noopener">Facebook</a>
        <a href="https://www.instagram.com/healthwise_clonmel" rel="noopener">Instagram</a>
      </div>
    </div>
    <div class="foot__bar">
      <span>Healthwise Ltd. Educate, Motivate, Activate.</span>
      <span>Clonmel, since 2011</span>
    </div>
  </div>
</footer>`;

// Healthwise run their enquiries through GoHighLevel, so for now THEIR form is
// the enquiry form and this embeds the live one. The native form and its
// /api/site/enquiry endpoint are untouched in git, so moving enquiries back
// onto the platform's leads board later is a revert, not a rebuild.
//
// Consequence to keep in mind: a submission here reaches GoHighLevel and
// nothing else. It does not appear on the Healthwise leads board.
const GHL_FORM_ID = "deWzd4mniNdSM7H84TiJ";

// Their form has no programme field, so the programme a visitor was reading
// about is carried in the message, which GoHighLevel prefills from the query
// string. The visitor can edit it; DJ still sees which page they came from.
const PROGRAMME_LABEL = {
  livewell: "Livewell, 40 to 60",
  vitality: "Vitality, 60 and over",
  studio60: "Studio 60, 60 and over",
  heartwise: "Heartwise, after a cardiac event",
};

const ghlForm = ({ title, prefill }) => {
  const query = prefill ? `?message=${encodeURIComponent(prefill)}` : "";
  // Deliberately NOT loading="lazy". form_embed.js hides the iframe while it
  // wraps it, and the browser will not load a lazy iframe it considers hidden,
  // so the two together left the form permanently blank on the longer pages.
  return `<iframe class="ghl" src="https://api.leadconnectorhq.com/widget/form/${GHL_FORM_ID}${query}"
    title="${title}"
    id="inline-${GHL_FORM_ID}" data-layout="{'id':'INLINE'}"
    data-trigger-type="alwaysShow" data-trigger-value=""
    data-activation-type="alwaysActivated" data-activation-value=""
    data-deactivation-type="neverDeactivate" data-deactivation-value=""
    data-form-name="${title}" data-height="636"
    data-layout-iframe-id="inline-${GHL_FORM_ID}" data-form-id="${GHL_FORM_ID}"></iframe>
  <p class="frame__note">Form not loading? Ring us on <a class="link" href="tel:+353862422388">${PHONE_DISPLAY}</a> or email <a class="link" href="mailto:dj@healthwiseclonmel.ie">dj@healthwiseclonmel.ie</a>.</p>`;
};

// The booking block on programme pages, at the #book anchor every "Book a
// consultation" button on those pages points at.
const strip = (programme) => `<div class="strip" id="book">
  <h2 class="h3">Book a consultation</h2>
  ${ghlForm({
    title: `Book a consultation — ${PROGRAMME_LABEL[programme] ?? "Healthwise"}`,
    prefill: PROGRAMME_LABEL[programme] ? `I am interested in ${PROGRAMME_LABEL[programme]}.` : "",
  })}
</div>`;

// Scripts sit at the very end of the body so the importer files them in the
// tail zone. Every pre-animation state is gated on the `js` flag set in the
// head: no flag, no hiding, so the page reads fully without JavaScript and
// the visual editor (which never runs the tail) shows every section.
const scripts = () => `<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/CustomEase.min.js"></script>
<script>
(function () {
  // Menu button (mobile).
  var nav = document.querySelector('.nav');
  var menu = document.querySelector('.nav__menu');
  if (nav && menu) {
    menu.addEventListener('click', function () {
      var open = nav.classList.toggle('nav--open');
      menu.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.textContent = open ? 'Close' : 'Menu';
    });
  }

  // Programmes disclosure. CSS already opens it on hover and focus, so this
  // only adds what CSS cannot: a click target for touch, Escape to close, and
  // closing when the pointer goes elsewhere. Below the mobile breakpoint the
  // sheet shows every programme already, so the button does nothing there.
  var group = document.querySelector('.nav__group');
  var groupTop = group && group.querySelector('.nav__grouptop');
  if (group && groupTop) {
    var setOpen = function (open) {
      group.classList.toggle('nav__group--open', open);
      groupTop.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    groupTop.addEventListener('click', function (e) {
      if (window.matchMedia('(max-width:980px)').matches) return;
      e.preventDefault();
      setOpen(!group.classList.contains('nav__group--open'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && group.classList.contains('nav__group--open')) {
        setOpen(false);
        groupTop.focus();
      }
    });
    document.addEventListener('click', function (e) {
      if (!group.contains(e.target)) setOpen(false);
    });
  }

  // Enquiry forms: post as JSON and show the answer in place. Without this
  // the form still posts natively and the route redirects back with ?ok=1.
  var forms = document.querySelectorAll('form[data-enquiry]');
  Array.prototype.forEach.call(forms, function (form) {
    var ret = form.querySelector('input[name="return"]');
    if (ret) ret.value = location.pathname;
    var ok = form.querySelector('.form__ok');
    var err = form.querySelector('.form__err');
    var btn = form.querySelector('button[type="submit"]');
    form.addEventListener('submit', function (e) {
      if (!window.fetch) return;
      e.preventDefault();
      if (err) err.hidden = true;
      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      fetch(form.getAttribute('action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.ok) {
          if (ok) ok.hidden = false;
          Array.prototype.forEach.call(form.querySelectorAll('.field, button[type="submit"]'), function (el) { el.hidden = true; });
        } else if (err) {
          err.textContent = (j && j.error) || 'Something went wrong. Please ring us instead.';
          err.hidden = false;
        }
      }).catch(function () {
        if (err) { err.textContent = 'Something went wrong. Please ring us instead.'; err.hidden = false; }
      }).then(function () {
        if (btn) { btn.disabled = false; btn.textContent = label; }
      });
    });
  });
  // The no-JS path lands back here with a flag in the query string.
  var q = new URLSearchParams(location.search);
  if (q.get('ok') === '1' || q.get('err')) {
    var first = document.querySelector('form[data-enquiry]');
    if (first) {
      var fok = first.querySelector('.form__ok'), ferr = first.querySelector('.form__err');
      if (q.get('ok') === '1' && fok) fok.hidden = false;
      if (q.get('err') && ferr) { ferr.textContent = q.get('err'); ferr.hidden = false; }
      first.scrollIntoView();
    }
  }

  // Motion.
  var root = document.documentElement;
  if (!window.gsap) { root.className = root.className.replace(/\\bjs\\b/, ''); return; }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.className = root.className.replace(/\\bjs\\b/, ''); return;
  }
  gsap.registerPlugin(ScrollTrigger);
  if (window.CustomEase) gsap.registerPlugin(CustomEase);
  var SNAP = window.CustomEase ? CustomEase.create('snap', '.16,1,.3,1') : 'expo.out';

  var hero = document.querySelector('.hero, .phero');
  if (hero) {
    var tl = gsap.timeline();
    tl.to(hero.querySelectorAll('[data-rise]'), { opacity: 1, y: 0, duration: .85, ease: SNAP, stagger: 0.09 }, 0.05);
    var draw = hero.querySelector('.pulse--draw path');
    if (draw) tl.to(draw, { strokeDashoffset: 0, duration: .9, ease: 'power2.out' }, 0.35);
  }
  gsap.utils.toArray('[data-rise]').forEach(function (el) {
    if (hero && hero.contains(el)) return;
    gsap.to(el, { opacity: 1, y: 0, duration: .8, ease: SNAP, scrollTrigger: { trigger: el, start: 'top 90%' } });
  });
  gsap.utils.toArray('.wipe img').forEach(function (img) {
    gsap.to(img, { clipPath: 'inset(0% 0 0 0)', scale: 1, duration: 1.1, ease: SNAP, scrollTrigger: { trigger: img, start: 'top 88%' } });
  });
  gsap.utils.toArray('[data-stagger]').forEach(function (group) {
    gsap.to(group.children, { opacity: 1, y: 0, duration: .8, ease: SNAP, stagger: 0.08, scrollTrigger: { trigger: group, start: 'top 85%' } });
  });
}());
</script>`;

const jsonLd = () => `<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "HealthClub",
  name: "Healthwise",
  alternateName: "Healthwise Clonmel",
  url: "https://www.healthwiseclonmel.ie",
  telephone: "+353-86-242-2388",
  email: EMAIL,
  founder: { "@type": "Person", name: "DJ O'Dwyer" },
  foundingDate: "2011",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Unit 12E, Ard Gaoithe Business Park",
    addressLocality: "Clonmel",
    addressRegion: "Tipperary",
    postalCode: "E91 A6F4",
    addressCountry: "IE",
  },
  geo: { "@type": "GeoCoordinates", latitude: 52.36408485468106, longitude: -7.711582681662141 },
  sameAs: ["https://www.facebook.com/healthwiseclonmel/", "https://www.instagram.com/healthwise_clonmel"],
}, null, 1)}
</script>`;

// The `js` flag script and the JSON-LD open the BODY, not the head: the
// importer (tools/lib/siteHtml.cjs) keeps only the font <link>s and the
// <style> from the head and drops every other head token, so anything that
// must reach the CMS render has to be inside <body>. Placed first, they are
// leading <script> tokens and the zone splitter (lib/cms/pageBody.ts) files
// them in the head zone: rendered on the public page, stripped from the
// Studio canvas — which is exactly right, since without the flag the canvas
// hides nothing.
const shell = ({ key, title, description, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${description}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@700;800&family=Open+Sans:wght@400;600&display=swap" rel="stylesheet" />
<style>
${css.trim()}
</style>
</head>
<body>
<script>document.documentElement.className+=' js';</script>
${jsonLd()}

${nav(key)}

<main id="main">
${body.trim()}
</main>

${footer()}

${scripts()}
${body.includes("leadconnectorhq") ? `<script src="https://link.msgsndr.com/js/form_embed.js"></script>\n` : ""}</body>
</html>
`;

const META = {
  home: { file: "index.html", title: "Healthwise Clonmel | Coached exercise for over 40s, over 60s and after a cardiac event",
    description: "Small-group coached exercise in Clonmel for adults over 40, over 60, and after a cardiac event. Livewell, Vitality and Heartwise, coached in small groups since 2011." },
  livewell: { file: "livewell.html", title: "Livewell 40–60 | Strength, mobility and cardio classes in Clonmel | Healthwise",
    description: "Five coached classes a week for adults aged 40 to 60: Women's Cardio Tone, MoveWell Strength, Men's Gym, MoveWell Mobility and Women's Circuit, at Healthwise in Clonmel." },
  vitality: { file: "vitality.html", title: "Vitality 60+ | Gentle group exercise for over 60s in Clonmel | Healthwise",
    description: "Gentle, coached group exercise for men and women over 60 in Clonmel. For beginners, limited mobility, and anyone coming back after a health event. Morning and afternoon classes." },
  studio60: { file: "studio60.html", title: "Studio 60 | Coached strength training for active over 60s | Healthwise Clonmel",
    description: "Coached strength and conditioning in Clonmel for men and women over 60 who are already active. Free weights, machines and conditioning work in a small group, with the load progressed as you get stronger." },
  heartwise: { file: "heartwise.html", title: "Heartwise | Supervised exercise after a cardiac event | Healthwise Clonmel",
    description: "Supervised exercise and lifestyle coaching in Clonmel for people who have had a cardiac procedure, and for managing type 2 diabetes, blood pressure and weight. BACPR-certified, since 2013." },
  classes: { file: "classes.html", title: "Classes and timetable | Healthwise Clonmel",
    description: "Every Healthwise class described, who it is for, and the live timetable. Classes from 7am, mornings and evenings, at Ard Gaoithe Business Park, Clonmel." },
  about: { file: "about.html", title: "About Healthwise | Exercise and lifestyle studio, Clonmel",
    description: "Healthwise is an exercise and lifestyle management studio in Clonmel, open since 2011: three coached programmes, small groups, and coaching built on an MSc in Performance Coaching and BACPR cardiac rehabilitation." },
  contact: { file: "contact.html", title: "Book a consultation | Healthwise Clonmel",
    description: "Book a consultation at Healthwise, Unit 12E Ard Gaoithe Business Park, Clonmel. Ring 086 242 2388 or send your details and we'll be in touch." },
  drivewise: { file: "drivewise.html", title: "Drivewise | Driver safety and wellness for companies | Healthwise",
    description: "Drivewise by Healthwise: driver wellness screening, functional movement testing, classroom education and on-road evaluation for company drivers." },
};

const substitute = (html) =>
  html
    .replace(/\{\{PULSE\}\}/g, pulseSvg("pulse--draw"))
    .replace(/\{\{RULE\}\}/g, ruleSvg())
    .replace(/\{\{STRIP:([a-z0-9]+)\}\}/g, (_m, p) => strip(p))
    .replace(/\{\{FORM\}\}/g, ghlForm({ title: "Book a consultation with Healthwise", prefill: "" }))
    .replace(/\{\{TOKEN\}\}/g, TOKEN)
    .replace(/\{\{MAPS\}\}/g, MAPS);

let built = 0;
for (const name of readdirSync(join(here, "pages"))) {
  if (!name.endsWith(".html")) continue;
  const key = name.replace(/\.html$/, "");
  const meta = META[key];
  if (!meta) {
    console.warn(`  no metadata for pages/${name} - skipped`);
    continue;
  }
  const body = substitute(readFileSync(join(here, "pages", name), "utf8"));
  writeFileSync(join(here, meta.file), shell({ key, ...meta, body }));
  console.log(`  ${meta.file.padEnd(16)} ${body.length} chars of content`);
  built++;
}
console.log(`${built} page(s) built`);
