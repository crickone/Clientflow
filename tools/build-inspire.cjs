#!/usr/bin/env node
/**
 * Builds every page of the Inspire Health & Fitness site into sites/inspire/*.html
 * with a single shared chrome (header/footer/CSS/GSAP). Black + gold, Bebas Neue.
 *
 * Copy is matched as close to word-for-word to the live site
 * (www.inspirehealthandfitness.ie) as possible because it is SEO-optimised —
 * EXCEPT two deliberate omissions per client instruction:
 *   1. NO Optimal Health / HBOT / PEMF / Infrared / recovery content (pure gym),
 *      even though the live home page features it.
 *   2. NO "free first class / free trial" claim (the live sign-up FAQ mentions it;
 *      the client confirmed it does not exist), so that FAQ answer is dropped.
 *
 * Then run: node tools/import-site.cjs --slug inspire --name "Inspire Health & Fitness"
 */
const fs = require("fs");
const path = require("path");
const OUT = path.resolve(__dirname, "..", "sites", "inspire");

const CSS = `
:root{--bg:#08080a;--surface:#101012;--surface-2:#16161a;--ink:#f3f1ec;--ink-dim:rgba(243,241,236,.58);--ink-faint:rgba(243,241,236,.34);--line:rgba(243,241,236,.10);--line-strong:rgba(243,241,236,.2);--gold:#c9a24c;--gold-2:#e6cd8b;--gold-grad:linear-gradient(135deg,#e6cd8b,#c9a24c 55%,#a9842f);--ink-on-gold:#0a0a0c;--pad:clamp(20px,5vw,72px);--maxw:1280px;--ease:cubic-bezier(.16,1,.3,1)}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);font-family:"Inter",system-ui,sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit;text-decoration:none}img{display:block;max-width:100%}
.shell{max-width:var(--maxw);margin:0 auto;padding-inline:var(--pad)}
.display{font-family:"Bebas Neue",sans-serif;font-weight:400;line-height:.9;letter-spacing:.01em;text-transform:uppercase}
h1,h2,h3,h4{font-family:"Bebas Neue",sans-serif;font-weight:400;letter-spacing:.02em;text-transform:uppercase;line-height:.92}
.eyebrow{display:inline-flex;align-items:center;gap:10px;color:var(--gold);text-transform:uppercase;letter-spacing:.22em;font-size:12px;font-weight:600}
.eyebrow::before{content:"";width:26px;height:2px;background:var(--gold)}
.gold{color:var(--gold)}
.btn{display:inline-flex;align-items:center;gap:10px;font-weight:600;font-size:13px;letter-spacing:.04em;text-transform:uppercase;padding:15px 26px;border-radius:2px;border:1px solid var(--line-strong);background:transparent;color:var(--ink);cursor:pointer;transition:.4s var(--ease);white-space:nowrap}
.btn .arw{transition:transform .4s var(--ease)}
.btn:hover{border-color:var(--gold);color:var(--gold)}.btn:hover .arw{transform:translateX(5px)}
.btn--gold{background:var(--gold-grad);color:var(--ink-on-gold);border:none;font-weight:700}
.btn--gold:hover{color:var(--ink-on-gold);box-shadow:0 0 0 1px var(--gold),0 14px 40px -10px rgba(201,162,76,.55)}
.head{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;padding:18px var(--pad);transition:top .4s var(--ease),background .4s var(--ease),backdrop-filter .4s var(--ease)}
.head.is-stuck{background:rgba(8,8,10,.74);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.head.is-hidden{top:-100px}
.brand img{height:34px;width:auto;display:block}
.nav{display:flex;align-items:center;gap:28px}
.nav a.lk{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-dim);transition:color .25s}
.nav a.lk:hover,.nav a.lk.active{color:var(--gold)}
.menu-btn{display:none;position:relative;z-index:60;background:none;border:1px solid var(--line-strong);color:var(--ink);width:46px;height:46px;border-radius:4px;font-size:22px;line-height:1;cursor:pointer}
.section{padding:clamp(80px,12vw,150px) 0;position:relative}
.sec-head{display:grid;grid-template-columns:1.1fr 1fr;gap:30px;align-items:end;margin-bottom:54px}
.sec-head h2{font-size:clamp(44px,6.5vw,104px)}.sec-head p{color:var(--ink-dim);font-size:17px}
.hero{position:relative;min-height:100svh;display:flex;align-items:flex-end;padding:0 0 92px;overflow:hidden}
.hero-media{position:absolute;inset:0;z-index:0}
.hero-media img{width:100%;height:100%;object-fit:cover;filter:grayscale(.25) brightness(.46)}
.hero::after{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(8,8,10,.5) 0%,rgba(8,8,10,.18) 38%,rgba(8,8,10,.92) 100%)}
.hero-inner{position:relative;z-index:2;width:100%}
.hero h1{font-size:clamp(50px,8.6vw,148px);margin:18px 0 0}
.hero h1 .ln{display:block;overflow:hidden}
.hero h1 .ln span{display:block}
.hero-sub{color:var(--ink-dim);font-size:clamp(16px,1.5vw,20px);max-width:62ch;margin-top:24px}
.hero-cta{display:flex;gap:14px;flex-wrap:wrap;margin-top:30px}
.marquee{border-block:1px solid var(--line);overflow:hidden;white-space:nowrap;padding:18px 0;background:var(--surface)}
.marquee .track{display:inline-flex;will-change:transform}
.marquee span{font-family:"Bebas Neue",sans-serif;font-size:30px;letter-spacing:.08em;color:var(--gold);padding-right:30px}
.marquee .star{color:var(--gold-2);font-style:normal;margin:0 10px}
.page-hero{position:relative;padding:170px var(--pad) 70px;border-bottom:1px solid var(--line);overflow:hidden}
.page-hero .crumb{color:var(--ink-faint);text-transform:uppercase;letter-spacing:.16em;font-size:12px;margin-bottom:18px}
.page-hero h1{font-size:clamp(48px,9vw,150px)}
.page-hero p{color:var(--ink-dim);font-size:clamp(16px,1.5vw,20px);max-width:60ch;margin-top:22px}
.prose{max-width:64ch}.prose p{color:var(--ink-dim);font-size:17px;margin-bottom:18px}.prose h3{font-size:32px;margin:34px 0 12px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}
@media(max-width:860px){.grid2{grid-template-columns:1fr;gap:34px}}
.media{border-radius:8px;overflow:hidden;border:1px solid var(--line)}
.media img{width:100%;height:100%;object-fit:cover;display:block;filter:grayscale(.12)}
.feat{list-style:none;display:grid;gap:11px;margin-top:18px}
.feat li{position:relative;padding-left:30px;color:var(--ink-dim);font-size:15.5px}
.feat li::before{content:"✓";position:absolute;left:0;top:0;color:var(--gold);font-weight:700}
.svc{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.svc-card{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:30px;min-height:240px;display:flex;flex-direction:column;transition:.45s var(--ease);overflow:hidden}
.svc-card::before{content:"";position:absolute;left:0;top:0;height:2px;width:0;background:var(--gold-grad);transition:width .5s var(--ease)}
.svc-card:hover{transform:translateY(-6px);border-color:var(--line-strong)}.svc-card:hover::before{width:100%}
.svc-card .idx{font-family:"Bebas Neue",sans-serif;color:var(--gold);font-size:18px;letter-spacing:.08em}
.svc-card h3{font-size:26px;margin:14px 0 10px;letter-spacing:.02em}.svc-card p{color:var(--ink-dim);font-size:15px;margin-bottom:16px}
.svc-card .more{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);margin-top:auto}
@media(max-width:980px){.svc{grid-template-columns:repeat(2,1fr)}}@media(max-width:620px){.svc{grid-template-columns:1fr}}
.gallery{display:grid;grid-template-columns:1.4fr 1fr 1fr;grid-template-rows:repeat(2,minmax(200px,32vh));gap:14px}
.gallery figure{overflow:hidden;border-radius:6px;border:1px solid var(--line)}
.gallery figure:first-child{grid-row:span 2}
.gallery img{width:100%;height:100%;object-fit:cover;transition:transform 1.1s var(--ease);filter:grayscale(.15)}
.gallery figure:hover img{transform:scale(1.06)}
@media(max-width:760px){.gallery{grid-template-columns:1fr 1fr;grid-auto-rows:32vw}}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line)}
.stat{background:var(--bg);padding:34px 26px}
.stat .n{font-family:"Bebas Neue",sans-serif;font-size:clamp(52px,6vw,86px);line-height:.9;letter-spacing:.02em}
.stat .n .u{color:var(--gold);font-size:.5em;vertical-align:super;margin-left:2px}
.stat .l{color:var(--ink-dim);font-size:14px;margin-top:10px}
@media(max-width:760px){.stats{grid-template-columns:repeat(2,1fr)}}
.classes{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.cls{border:1px solid var(--line);border-radius:6px;padding:26px;background:var(--surface);transition:.4s var(--ease)}
.cls:hover{background:var(--surface-2);border-color:var(--gold);transform:translateY(-4px)}
.cls .k{font-family:"Bebas Neue",sans-serif;color:var(--gold);font-size:18px;letter-spacing:.08em}
.cls h4{font-size:26px;margin:12px 0 8px;letter-spacing:.02em}.cls p{color:var(--ink-dim);font-size:14px}
@media(max-width:980px){.classes{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){.classes{grid-template-columns:1fr}}
.plans{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.plan{border:1px solid var(--line);border-radius:8px;padding:30px;background:var(--surface);display:flex;flex-direction:column;transition:.4s var(--ease)}
.plan:hover{border-color:var(--gold);transform:translateY(-5px)}
.plan h4{font-size:30px;letter-spacing:.02em}.plan .price{color:var(--gold);font-family:"Bebas Neue",sans-serif;font-size:28px;margin:8px 0 14px}
.plan ul{list-style:none;display:grid;gap:8px;margin:0 0 20px;color:var(--ink-dim);font-size:14px}
.plan li{padding-left:18px;position:relative}.plan li::before{content:"◇";position:absolute;left:0;color:var(--gold);font-size:10px;top:3px}
.plan .btn{margin-top:auto}
@media(max-width:900px){.plans{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){.plans{grid-template-columns:1fr}}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.step{border:1px solid var(--line);border-radius:6px;padding:30px;background:var(--surface)}
.step .num{font-family:"Bebas Neue",sans-serif;font-size:44px;color:var(--gold);line-height:1}
.step h4{font-size:24px;margin:10px 0 8px}.step p{color:var(--ink-dim);font-size:15px}
@media(max-width:760px){.steps{grid-template-columns:1fr}}
.hours{display:grid;gap:10px;max-width:420px}
.hours .row{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--line)}
.hours .row span:last-child{color:var(--gold)}
.faqs{display:grid;gap:12px;max-width:920px}
.faq{border:1px solid var(--line);border-radius:6px;background:var(--surface);overflow:hidden}
.faq summary{list-style:none;cursor:pointer;padding:22px 26px;display:flex;justify-content:space-between;gap:18px;align-items:center;font-family:"Bebas Neue",sans-serif;font-size:23px;letter-spacing:.02em}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";color:var(--gold);font-size:26px;line-height:1;flex:none}
.faq[open] summary::after{content:"–"}
.faq .a{padding:0 26px 24px;color:var(--ink-dim);font-size:15.5px;max-width:80ch}
.band{background:var(--gold-grad);color:var(--ink-on-gold);border-radius:10px;padding:clamp(40px,6vw,76px);display:grid;grid-template-columns:1.3fr 1fr;gap:30px;align-items:center}
.band h2{font-size:clamp(44px,6vw,90px);line-height:.9;letter-spacing:.02em}
.band p{margin-top:14px;font-weight:500;max-width:42ch}
.band .b-cta{display:flex;gap:12px;flex-wrap:wrap;justify-content:flex-end}
.band .btn{border-color:rgba(10,10,12,.3);color:var(--ink-on-gold)}.band .btn:hover{border-color:var(--ink-on-gold);color:var(--ink-on-gold)}
.band .btn--dark{background:var(--ink-on-gold);color:var(--gold);border:none}
@media(max-width:820px){.band{grid-template-columns:1fr}.band .b-cta{justify-content:flex-start}}
.quotes{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.quote{border:1px solid var(--line);border-radius:6px;padding:30px;background:var(--surface)}
.quote .stars{color:var(--gold);letter-spacing:3px;margin-bottom:14px}.quote p{font-size:18px;line-height:1.5}
.quote .who{margin-top:18px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.1em;font-size:12px}
@media(max-width:880px){.quotes{grid-template-columns:1fr}}
.values{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
.val{border:1px solid var(--line);border-radius:100px;padding:11px 20px;text-transform:uppercase;letter-spacing:.06em;font-size:13px;font-weight:600}
.val b{color:var(--gold)}
.contact{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:start}
.info{display:grid;gap:16px}.info .row{display:grid;grid-template-columns:120px 1fr;gap:16px;padding-bottom:16px;border-bottom:1px solid var(--line)}
.info .k{color:var(--ink-faint);text-transform:uppercase;letter-spacing:.14em;font-size:12px}.info .v{font-size:16px}.info .v a:hover{color:var(--gold)}
.mapwrap{border:1px solid var(--line);border-radius:8px;overflow:hidden;aspect-ratio:16/10}
.mapwrap iframe{width:100%;height:100%;border:0;filter:grayscale(.4) invert(.92) contrast(.9)}
@media(max-width:880px){.contact{grid-template-columns:1fr;gap:30px}}
.foot{border-top:1px solid var(--line);padding:36px var(--pad);display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px;color:var(--ink-faint);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
.foot a:hover{color:var(--gold)}
.js [data-rise]{opacity:0;transform:translateY(34px)}.js [data-stagger]>*{opacity:0;transform:translateY(28px)}
.head.nav-open::before{content:"";position:fixed;inset:0;z-index:48;background:rgba(0,0,0,.55);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
@media(max-width:760px){
  .menu-btn{display:grid;place-items:center}
  .nav{position:fixed;top:0;right:0;bottom:0;width:min(82vw,340px);height:100vh;flex-direction:column;align-items:flex-start;justify-content:center;gap:26px;padding:96px var(--pad) 40px;background:var(--surface);border-left:1px solid var(--line);transform:translateX(100%);transition:transform .45s var(--ease);box-shadow:-30px 0 60px -20px rgba(0,0,0,.6);z-index:49}
  .head.nav-open .nav{transform:translateX(0)}
  .nav a.lk{font-size:26px;color:var(--ink)}
  .nav .btn--gold{margin-top:14px}
  .sec-head{margin-bottom:34px;grid-template-columns:1fr}
  .hero{min-height:92svh;padding-bottom:64px}
}
`;

const NAVITEMS = [
  ["classes.html", "Classes"],
  ["nutrition.html", "Nutrition"],
  ["timetable.html", "Timetable"],
  ["about.html", "About"],
  ["blog.html", "Blog"],
  ["contact.html", "Contact"],
];
function header(active) {
  const links = NAVITEMS.map(
    ([h, l]) =>
      `<a class="lk${active === h ? " active" : ""}" href="${h}">${l}</a>`,
  ).join("");
  return `<header class="head" id="head">
  <a class="brand" href="index.html"><img src="assets/logo.avif" alt="Inspire Health & Fitness" /></a>
  <button class="menu-btn" id="menuBtn" aria-label="Menu" aria-expanded="false">≡</button>
  <nav class="nav" id="nav">${links}
    <a class="btn btn--gold" href="sign-up.html"><span>Sign Up</span><span class="arw">→</span></a>
  </nav>
</header>`;
}
const FOOT = `<footer class="foot">
  <span>© <span id="yr">2026</span> Inspire Health &amp; Fitness · Ard Gaoithe Business Park, Clonmel</span>
  <span>Strength · Conditioning · Real Results</span>
</footer>`;

const SCRIPTS = `<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
<script src="https://unpkg.com/lenis@1.3.23/dist/lenis.min.js"></script>
<script>
(function(){
  var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var yr=document.getElementById('yr');if(yr)yr.textContent=new Date().getFullYear();
  var head=document.getElementById('head'),lastY=0;
  window.addEventListener('scroll',function(){var y=window.pageYOffset||0;head.classList.toggle('is-stuck',y>20);if(head.classList.contains('nav-open'))return;if(y>lastY+6&&y>200)head.classList.add('is-hidden');else if(y<lastY-6)head.classList.remove('is-hidden');lastY=y;},{passive:true});
  var mb=document.getElementById('menuBtn');
  function closeNav(){head.classList.remove('nav-open');if(mb){mb.setAttribute('aria-expanded','false');mb.textContent='≡';}document.body.style.overflow='';}
  if(mb){
    mb.addEventListener('click',function(e){e.stopPropagation();var open=head.classList.toggle('nav-open');mb.setAttribute('aria-expanded',open?'true':'false');mb.textContent=open?'×':'≡';document.body.style.overflow=open?'hidden':'';});
    document.querySelectorAll('.nav a').forEach(function(a){a.addEventListener('click',closeNav);});
    head.addEventListener('click',function(e){if(e.target===head)closeNav();});
    window.addEventListener('keydown',function(e){if(e.key==='Escape')closeNav();});
  }
  if(reduce||typeof gsap==='undefined'){document.querySelectorAll('[data-rise],[data-stagger]>*').forEach(function(el){el.style.opacity=1;el.style.transform='none';});return;}
  gsap.registerPlugin(ScrollTrigger);
  var lenis=new Lenis({lerp:.12,smoothWheel:true});
  lenis.on('scroll',ScrollTrigger.update);gsap.ticker.add(function(t){lenis.raf(t*1000);});gsap.ticker.lagSmoothing(0);
  document.querySelectorAll('a[href^="#"]').forEach(function(a){a.addEventListener('click',function(e){var id=a.getAttribute('href');if(id.length>1){var el=document.querySelector(id);if(el){e.preventDefault();lenis.scrollTo(el,{offset:-10,duration:1});}}});});
  if(document.querySelector('.hero h1 .ln')){
    gsap.set('.hero h1 .ln span',{yPercent:120});
    gsap.set('.hero .eyebrow,.hero-sub,.hero-cta',{opacity:0,y:22});
    var tl=gsap.timeline({defaults:{ease:'power4.out'},delay:.12});
    tl.to('.hero h1 .ln span',{yPercent:0,duration:1.15,stagger:.13})
      .to('.hero .eyebrow',{opacity:1,y:0,duration:.7},'-=.85')
      .to('.hero-sub',{opacity:1,y:0,duration:.7},'-=.65')
      .to('.hero-cta',{opacity:1,y:0,duration:.7},'-=.55');
    gsap.to('.hero-media img',{yPercent:12,ease:'none',scrollTrigger:{trigger:'.hero',start:'top top',end:'bottom top',scrub:true}});
  }
  if(document.querySelector('.page-hero h1')){gsap.from('.page-hero h1, .page-hero .crumb, .page-hero p',{y:28,opacity:0,duration:1,ease:'power4.out',stagger:.08});}
  gsap.utils.toArray('[data-rise]').forEach(function(el){gsap.to(el,{opacity:1,y:0,duration:.9,ease:'power3.out',scrollTrigger:{trigger:el,start:'top 86%'}});});
  gsap.utils.toArray('[data-stagger]').forEach(function(grp){gsap.to(grp.children,{opacity:1,y:0,duration:.8,ease:'power3.out',stagger:.08,scrollTrigger:{trigger:grp,start:'top 84%'}});});
  gsap.utils.toArray('[data-count]').forEach(function(el){var end=+el.getAttribute('data-count');var obj={v:0};ScrollTrigger.create({trigger:el,start:'top 88%',once:true,onEnter:function(){gsap.to(obj,{v:end,duration:1.4,ease:'power2.out',onUpdate:function(){el.childNodes[0].nodeValue=Math.round(obj.v);}});}});});
  var track=document.querySelector('.marquee .track');if(track)gsap.to(track,{xPercent:-50,duration:20,ease:'none',repeat:-1});
})();
</script>`;

function wrap(slug, title, desc, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${desc}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>${CSS}</style>
</head>
<body>
<script>document.documentElement.className+=' js';</script>
${header(slug)}
${body}
${FOOT}
${SCRIPTS}
</body>
</html>`;
}

const ADDRESS = `Unit 12M, Ard Gaoithe Business Park,<br/>Clonmel, Co. Tipperary`;
const CONTACT_ROWS = `<div class="row"><span class="k">Gym</span><span class="v">${ADDRESS}</span></div>
        <div class="row"><span class="k">Phone</span><span class="v"><a href="tel:0838897736">083 889 7736</a></span></div>
        <div class="row"><span class="k">Email</span><span class="v"><a href="mailto:djinspireclonmel@gmail.com">djinspireclonmel@gmail.com</a></span></div>
        <div class="row"><span class="k">Hours</span><span class="v">Mon–Thu 6–11am &amp; 4–8pm · Fri 6–11am &amp; 4–7pm · Sat 8am–12pm · Sun closed</span></div>
        <div class="row"><span class="k">Social</span><span class="v"><a href="https://instagram.com/inspireclonmel">Instagram</a> · <a href="https://facebook.com/profile.php?id=61572668319681">Facebook</a></span></div>`;

/* ---------- helpers ---------- */
function pageHero(crumb, h1, p, bg) {
  const media = bg
    ? `<div style="position:absolute;inset:0;z-index:0"><img src="${bg}" alt="" style="width:100%;height:100%;object-fit:cover;filter:grayscale(.3) brightness(.5)"/></div><div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,8,10,.5),rgba(8,8,10,.92))"></div>`
    : "";
  return `<section class="page-hero">${media}<div class="shell" style="position:relative;z-index:2"><div class="crumb">${crumb}</div><h1 class="display">${h1}</h1>${p ? `<p>${p}</p>` : ""}</div></section>`;
}
function ctaBand(h, p) {
  return `<section class="section"><div class="shell"><div class="band" data-rise><div><h2>${h}</h2><p>${p}</p></div><div class="b-cta"><a class="btn btn--dark" href="sign-up.html"><span>Sign Up</span><span class="arw">→</span></a><a class="btn" href="tel:0838897736"><span>083 889 7736</span><span class="arw">↗</span></a></div></div></div></section>`;
}
const feat = (items) =>
  `<ul class="feat">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const faq = (items) =>
  `<div class="faqs" data-stagger>${items
    .map(
      ([q, a]) =>
        `<details class="faq"><summary>${q}</summary><div class="a">${a}</div></details>`,
    )
    .join("")}</div>`;
// Alternating text/image feature row.
function splitRow(eyebrow, h2, bodyHtml, img, alt, reverse) {
  const media = `<div class="media" data-rise style="aspect-ratio:4/5"><img src="${img}" alt="${alt}" loading="lazy"/></div>`;
  const text = `<div><span class="eyebrow" data-rise>${eyebrow}</span><h2 class="display" data-rise style="margin-top:14px;font-size:clamp(34px,4.8vw,72px)">${h2}</h2>${bodyHtml}</div>`;
  return `<section class="section" style="padding-top:0"><div class="shell"><div class="grid2">${reverse ? media + text : text + media}</div></div></section>`;
}

/* ---------- shared FAQ copy (verbatim from live sign-up / referral pages; free-trial answer omitted) ---------- */
const SIGNUP_FAQ = faq([
  [
    "What membership options do you offer?",
    "We offer various membership options including Monthly, Student, Off-Peak, and Couple plans. Each option provides unlimited class access and gym facilities. Choose the one that best fits your lifestyle.",
  ],
  [
    "Is there a joining fee?",
    "No, we currently do not charge a joining fee for new members. This allows you to start your fitness journey without any initial financial burden. Join us today and experience the Inspire community!",
  ],
  [
    "What are your opening hours?",
    "Our gym is open Monday to Thursday from 6 AM to 11 AM and 4 PM to 8 PM, Fridays from 6 AM to 11 AM and 4 PM to 7 PM, and Saturdays from 8 AM to 12 PM. We're closed on Sundays and bank holidays. Check our website for any holiday hours.",
  ],
  [
    "How do I sign up?",
    "Signing up is easy! Simply fill out our online form or visit us at the gym. Our friendly staff will assist you through the process.",
  ],
]);

/* ---------------- HOME ---------------- */
const HOME = `
<section class="hero" id="top">
  <div class="hero-media"><img src="assets/gym-interior.jpg" alt="Inside Inspire Health & Fitness gym, Ard Gaoithe Business Park, Clonmel" /></div>
  <div class="hero-inner shell">
    <span class="eyebrow">Clonmel · Ard Gaoithe Business Park</span>
    <h1 class="display"><span class="ln"><span>Clonmel's Best Gym</span></span><span class="ln"><span>for Strength, Conditioning</span></span><span class="ln"><span class="gold">&amp; Real Results.</span></span></h1>
    <p class="hero-sub">Looking for a friendly, results-driven gym in Clonmel? Inspire Health and Fitness is your community-focused gym in Ard Gaoithe Business Park — welcoming both men and women of all fitness levels. Whether you're just starting your journey or building serious strength, we offer expert coaching, modern equipment, and inclusive workouts to help you train with purpose and get real results.</p>
    <div class="hero-cta"><a class="btn btn--gold" href="sign-up.html"><span>Sign Up</span><span class="arw">→</span></a><a class="btn" href="timetable.html"><span>Timetable</span><span class="arw">↗</span></a></div>
  </div>
  <div class="hero-foot" style="position:absolute;left:var(--pad);right:var(--pad);bottom:24px;z-index:2;display:flex;justify-content:space-between;gap:14px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.16em;font-size:11px"><span>Strength · Conditioning · Nutrition · Community</span><span>Men &amp; women · all levels welcome</span></div>
</section>
<div class="marquee" aria-hidden="true"><div class="track"><span>Strength <i class="star">✦</i> Conditioning <i class="star">✦</i> Nutrition <i class="star">✦</i> InBody <i class="star">✦</i> Community <i class="star">✦</i> Coaching <i class="star">✦</i> </span><span>Strength <i class="star">✦</i> Conditioning <i class="star">✦</i> Nutrition <i class="star">✦</i> InBody <i class="star">✦</i> Community <i class="star">✦</i> Coaching <i class="star">✦</i> </span></div></div>

<section class="section"><div class="shell"><div class="grid2">
  <div>
    <span class="eyebrow" data-rise>6-Week Program</span>
    <h2 class="display" data-rise style="margin-top:14px;font-size:clamp(40px,5.6vw,92px)">Join Our 6-Week Health &amp; Fitness Transformation Program.</h2>
    <p class="prose" data-rise style="color:var(--ink-dim);font-size:17px;margin-top:18px">Kickstart your fitness this year! Coach-led training, simple nutrition support, and weekly accountability — all designed to help you get consistent, feel stronger, and build momentum that lasts.</p>
    <div data-rise style="margin-top:26px"><a class="btn btn--gold" href="sign-up.html"><span>Sign Up</span><span class="arw">→</span></a></div>
  </div>
  <div data-rise>
    <span class="eyebrow">What's included</span>
    ${feat([
      "Coach-Led Small Group Training",
      "Personalised Nutrition Guidance",
      "Weekly Accountability Check-Ins",
      "InBody Progress Tracking",
      "Flexible Morning &amp; Evening Session Times",
      "Supportive Community Environment",
    ])}
  </div>
</div></div></section>

<section class="section" style="padding-top:0"><div class="shell"><div class="stats" data-stagger>
  <div class="stat"><div class="n" data-count="6">0</div><div class="l">Week transformation program</div></div>
  <div class="stat"><div class="n" data-count="60">0</div><div class="l">Second full-body InBody scan</div></div>
  <div class="stat"><div class="n" data-count="6">0</div><div class="l">Days a week, open</div></div>
  <div class="stat"><div class="n">ALL</div><div class="l">Levels &amp; abilities welcome</div></div>
</div></div></section>

<section class="section" id="program"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>What we do</span><h2 class="display" data-rise style="margin-top:14px">Your All-in-One Strength &amp; Conditioning Program.</h2></div><p data-rise>At Inspire Health and Fitness, we provide a welcoming space for everyone. Our expert-led workouts, personal training sessions, and strength-based exercise programs cater to all fitness levels. Whether you're lifting weights for the first time or looking to improve performance, our supportive community is here to help you unlock your potential.</p></div>
  <div class="svc" data-stagger>
    <a class="svc-card" href="nutrition.html"><span class="idx">01</span><h3>Nutrition Plans</h3><p>Get expert nutrition coaching that teaches you exactly how to balance carbohydrates, protein, and healthy fats to fuel your workouts, maximise recovery, and achieve your goals. We create simple, science-backed meal plans tailored to you — whether your focus is building lean muscle, losing weight, boosting performance, or improving overall health.</p><span class="more">Learn More →</span></a>
    <a class="svc-card" href="sign-up.html"><span class="idx">02</span><h3>Memberships</h3><p>Flexible membership options that give you full access to all coach-led workouts, tailored training plans, and progress tracking. No hidden fees — just expert coaching, personalised support, and real results.</p><span class="more">Sign Up →</span></a>
    <a class="svc-card" href="classes.html"><span class="idx">03</span><h3>Workouts</h3><p>Coach-led strength, cardio, and conditioning workouts for all fitness levels — combining free weights, resistance machines, and aerobic training to build lean muscle, boost endurance, and improve overall fitness. Every session is designed to keep you motivated, challenged, and progressing.</p><span class="more">Learn More →</span></a>
  </div>
</div></section>

<section class="section" style="padding-top:0"><div class="shell"><div class="gallery" data-rise>
  <figure><img src="assets/gym-weights.avif" alt="Free weights area at Inspire gym Clonmel" loading="lazy" /></figure>
  <figure><img src="assets/gym-cardio.jpg" alt="Cardio machines at Inspire gym Clonmel" loading="lazy" /></figure>
  <figure><img src="assets/strength.jpg" alt="Strength training at Inspire" loading="lazy" /></figure>
  <figure style="grid-column:span 2"><img src="assets/action.jpg" alt="Coach-led training at Inspire gym" loading="lazy" /></figure>
</div></div></section>

${splitRow(
  "Why Inspire",
  "Why Inspire's Strength-Focused Coaching Delivers Real Results",
  `<p class="prose" data-rise style="color:var(--ink-dim);font-size:17px">If you're searching for results-driven gyms in Clonmel, Inspire Health &amp; Fitness goes far beyond fitness classes. Our floor is kitted out with free weights, squat racks, SkiErgs, and Concept2 rowing machines, so you can lift heavy, push your conditioning, and track real progress. Add expert coaching, clear programming, and genuine accountability, and you have everything you need to build strength, drop body-fat, or boost all-round health and fitness. Men and women of every level — from first-timers to seasoned lifters — find a home here. Ready for something better than "just a gym"? Join the community that turns hard work into real-world results.</p><div style="margin-top:26px" data-rise><a class="btn btn--gold" href="sign-up.html"><span>Sign Up</span><span class="arw">→</span></a></div>`,
  "assets/gym-weights.avif",
  "Free weights and squat racks at Inspire gym, Clonmel",
  true,
)}

<section class="section" style="padding-top:0" id="inbody"><div class="shell"><div class="grid2">
  <div>
    <span class="eyebrow" data-rise>Train with data</span>
    <h2 class="display" data-rise style="margin-top:14px;font-size:clamp(38px,5.2vw,84px)">What Is an InBody Scan — and Why It Matters</h2>
    <p class="prose" data-rise style="color:var(--ink-dim);font-size:17px;margin-top:16px">At Inspire Health &amp; Fitness, we don't guess — we measure. Every new member gets a full InBody body composition scan to see exactly what your body is made of. An InBody scan goes far beyond your weight or BMI. In under 60 seconds, it gives you a detailed breakdown of:</p>
    ${feat([
      "Body fat percentage — track fat loss accurately.",
      "Lean muscle mass — see how much muscle you have and where.",
      "Visceral fat level — assess health risks linked to fat around your organs.",
      "Basal metabolic rate (BMR) — know how many calories your body burns at rest.",
      "Hydration and body water levels — check if you're properly fuelled and recovered.",
      "Segmental analysis — spot muscle imbalances left vs right, upper vs lower body.",
    ])}
    <p class="prose" data-rise style="color:var(--ink-dim);font-size:17px;margin-top:18px">No guesswork. Just data, direction and results. If you've only ever stepped on a basic scale, the InBody scan will change how you see progress.</p>
  </div>
  <div class="media" data-rise style="aspect-ratio:4/5"><img src="assets/inbody.avif" alt="InBody body composition scan at Inspire" loading="lazy" /></div>
</div></div></section>

${splitRow(
  "Nutrition",
  "Personalised Nutrition Plans That Fuel Real Results.",
  `<p class="prose" data-rise style="color:var(--ink-dim);font-size:17px">Training is only half the story — your nutrition is what drives real change. At Inspire Health &amp; Fitness, we offer personalised meal plans and coaching to match your goals, whether you're aiming to lose body fat, build muscle, or boost energy. Led by qualified coaches, our nutrition support includes:</p>${feat(
    [
      "One-to-one consultations",
      "Custom meal plans based on your lifestyle",
      "Goal-focused guidance for fat loss or performance",
      "Ongoing check-ins and accountability",
      "Optional InBody scan tracking to monitor progress",
    ],
  )}<p class="prose" data-rise style="color:var(--ink-dim);font-size:17px;margin-top:16px">No crash diets. No fads. Just smart, sustainable habits tailored to your body and your training. Ready to fuel your training with real results?</p><div style="margin-top:24px" data-rise><a class="btn" href="nutrition.html"><span>Nutrition coaching</span><span class="arw">→</span></a></div>`,
  "assets/nutrition.avif",
  "Personalised nutrition coaching at Inspire",
  false,
)}

${ctaBand(
  "Your transformation<br/>starts here.",
  "Six weeks. Coach-led training, simple nutrition support and weekly accountability — built to help you get consistent, feel stronger, and build momentum that lasts.",
)}

<section class="section"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>Member Testimonials</span><h2 class="display" data-rise style="margin-top:14px">Hear what our<br/>members say.</h2></div><p data-rise>Hear what our members have to say!</p></div>
  <div class="quotes" data-stagger>
    <div class="quote"><div class="stars">★★★★★</div><p>"Inspire gym has transformed my fitness journey completely!"</p><div class="who">Inspire Member</div></div>
    <div class="quote"><div class="stars">★★★★★</div><p>"The community here is incredibly supportive and motivating!"</p><div class="who">Inspire Member</div></div>
    <div class="quote"><div class="stars">★★★★★</div><p>"I love the variety of the workouts available!"</p><div class="who">Inspire Member</div></div>
  </div>
  <div class="values" data-stagger><span class="val"><b>◇</b> Community</span><span class="val"><b>◇</b> Consistency</span><span class="val"><b>◇</b> Support</span><span class="val"><b>◇</b> Everyone belongs</span></div>
</div></section>

<section class="section" style="padding-top:0"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>FAQs</span><h2 class="display" data-rise style="margin-top:14px">Frequently<br/>asked.</h2></div><p data-rise>Some of our most frequently asked questions.</p></div>
  ${faq([
    [
      "What kind of training do you offer?",
      "We offer structured small-group training focused on strength, conditioning, and mobility — all led by expert coaches and designed to suit every level.",
    ],
    [
      "What is an InBody scan?",
      "The InBody scan gives a detailed breakdown of body fat, muscle mass, visceral fat and hydration. It helps us personalise your training and track real progress over time.",
    ],
    [
      "I'm a complete beginner — is that okay?",
      "Yes — every session is scaled to your level. Whether you're completely new or experienced in the gym, our coaches will guide and adapt the session for you.",
    ],
    [
      "How do I get started?",
      "You can book a consultation directly on our website. We'll walk you through everything.",
    ],
    [
      "What's included in my membership?",
      "Your membership includes coach-led training sessions, InBody scans, strength assessments, performance tracking, and access to our private support community.",
    ],
    [
      "Do you sell gym equipment?",
      "We don't sell equipment on-site, but we'll guide you on the essentials. If you're searching for gym gear in Clonmel, our coaches can recommend budget-friendly picks and what to prioritise for strength training.",
    ],
  ])}
</div></section>

<section class="section" style="padding-top:0"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>From the blog</span><h2 class="display" data-rise style="margin-top:14px">Fitness tips,<br/>training &amp; nutrition.</h2></div><p data-rise>Explore expert-backed articles on training, fat loss, and fuelling your workouts — written by the coaching team at Inspire Health &amp; Fitness, Clonmel's leading strength and conditioning gym.</p></div>
  <div class="svc" data-stagger>
    <a class="svc-card" href="blog.html"><span class="idx">Article</span><h3 style="font-size:23px">Why the Modern Fitness Industry Fails and How We Do It Differently in Clonmel</h3><span class="more">Read →</span></a>
    <a class="svc-card" href="blog.html"><span class="idx">Article</span><h3 style="font-size:23px">Why Midlife Feels So Overwhelming: Understanding Perimenopause, Hormones, and Stress</h3><span class="more">Read →</span></a>
    <a class="svc-card" href="blog.html"><span class="idx">Article</span><h3 style="font-size:23px">Strength Training Pain Explained: A Guide to Injury, Soreness, and Recovery</h3><span class="more">Read →</span></a>
    <a class="svc-card" href="blog.html"><span class="idx">Article</span><h3 style="font-size:23px">The 3 Pillars of Smarter Training for Lasting Fitness Results</h3><span class="more">Read →</span></a>
    <a class="svc-card" href="blog.html"><span class="idx">Article</span><h3 style="font-size:23px">Over-40s &amp; The Unspoken Panic: Why You Must Lift Weights (It's Not For Looks)</h3><span class="more">Read →</span></a>
    <a class="svc-card" href="blog.html"><span class="idx">Article</span><h3 style="font-size:23px">The "Restart Every Monday" Cycle: Why Your Willpower Isn't the Problem</h3><span class="more">Read →</span></a>
  </div>
</div></section>`;

/* ---------------- ABOUT ---------------- */
const ABOUT =
  pageHero(
    "Inspire · About",
    "About Inspire Health.",
    "Helping real people achieve their fitness goals in a supportive and motivating environment.",
    "assets/gym-weights.avif",
  ) +
  `
<section class="section"><div class="shell"><div class="grid2">
  <div class="prose" data-rise><span class="eyebrow">Our commitment</span><h3 style="margin-top:14px">Our Commitment to Your Fitness Journey</h3><p>At Inspire, we are dedicated to helping real people achieve their fitness goals in a supportive and welcoming environment. Our values of community, consistency, and support drive everything we do.</p></div>
  <div class="media" data-rise style="aspect-ratio:4/3"><img src="assets/action.jpg" alt="Training at Inspire" loading="lazy"/></div>
</div></div></section>
<section class="section" style="padding-top:0"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>Where everyone belongs</span><h2 class="display" data-rise style="margin-top:14px">Welcome to a Gym Where Everyone Belongs and Thrives Together</h2></div><p data-rise>At Inspire Health and Fitness, we pride ourselves on creating a supportive atmosphere. Our gym is designed for everyone, from beginners to seasoned athletes, ensuring a positive experience for all.</p></div>
  <div class="svc" data-stagger>
    <div class="svc-card"><span class="idx">01</span><h3>Our Ethos</h3><p>A clean, friendly environment where egos are left at the door.</p></div>
    <div class="svc-card"><span class="idx">02</span><h3>Join Us</h3><p>Everyone is welcome to pursue their fitness goals with us.</p></div>
    <div class="svc-card"><span class="idx">03</span><h3>Community, Consistency &amp; Support</h3><p>The three values that drive everything we do — every session, every member, every day.</p></div>
  </div>
</div></section>
<section class="section" style="padding-top:0"><div class="shell"><div class="grid2">
  <div class="media" data-rise style="aspect-ratio:4/5"><img src="assets/coach-dj.jpg" alt="DJ O'Dwyer, head coach at Inspire" loading="lazy"/></div>
  <div><span class="eyebrow" data-rise>Location</span><h2 class="display" data-rise style="margin-top:14px;font-size:clamp(40px,5.4vw,84px)">Clonmel</h2><p class="prose" data-rise style="color:var(--ink-dim);font-size:17px">Find us at Unit 12M, Ard Gaoithe Business Park, Clonmel, Co. Tipperary — your community-focused gym for strength, conditioning and real results.</p><div style="margin-top:26px" data-rise><a class="btn" href="contact.html"><span>Get directions</span><span class="arw">→</span></a></div></div>
</div></div></section>
${ctaBand(
  "Join Our Inspiring<br/>Community Today",
  "Take the first step towards your fitness journey with us. Your transformation starts here!",
)}`;

/* ---------------- CLASSES ---------------- */
const CLASSES =
  pageHero(
    "Inspire · Classes",
    "Explore Our Workouts.",
    "Find the perfect workout for your fitness journey, no matter your level or goals.",
    "assets/gym-cardio.jpg",
  ) +
  `
<section class="section"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>What we offer</span><h2 class="display" data-rise style="margin-top:14px">Explore Our Diverse Range Of Workouts</h2></div><p data-rise>At Inspire Health and Fitness, we offer a variety of workouts designed to cater to all fitness levels. Whether you're looking to boost your cardio, build strength, or enhance your mobility, we have something for everyone. Join us to discover a fun and supportive environment that motivates you to reach your goals.</p></div>
  <div class="svc" data-stagger>
    <div class="svc-card"><span class="idx">01</span><h3>Cardio Workouts for All Levels</h3><p>Get your heart pumping and improve endurance.</p></div>
    <div class="svc-card"><span class="idx">02</span><h3>Strength Training for Everyone</h3><p>Build muscle and increase your overall strength.</p></div>
    <div class="svc-card"><span class="idx">03</span><h3>Mobility Classes to Enhance Flexibility</h3><p>Improve your flexibility and reduce the risk of injury.</p></div>
  </div>
</div></section>
${splitRow(
  "Cardio",
  "Elevate Your Heart Health with Our Energizing Cardio Workouts",
  `<p class="prose" data-rise style="color:var(--ink-dim);font-size:17px">Our cardio workouts are designed to boost your heart health while burning calories. Join us to enhance your endurance and feel great!</p>${feat(
    ["Perfect for all fitness levels and abilities.", "Get ready to sweat and have fun!"],
  )}`,
  "assets/gym-cardio.jpg",
  "Cardio workouts at Inspire gym, Clonmel",
  true,
)}
${splitRow(
  "Strength",
  "Unleash Your Power with Our Dynamic Strength Workouts",
  `<p class="prose" data-rise style="color:var(--ink-dim);font-size:17px">Our strength workouts are designed to help you build muscle and enhance your overall fitness. Join us to boost your metabolism and achieve your strength goals in a supportive environment.</p><div class="prose" data-rise><h3 style="font-size:26px;margin:24px 0 6px">Build Muscle</h3><p style="margin-bottom:12px">Increase your muscle mass and improve your physical performance with targeted workouts.</p><h3 style="font-size:26px;margin:14px 0 6px">Boost Metabolism</h3><p>Rev up your metabolism and burn calories effectively with our expert-led sessions.</p></div>`,
  "assets/strength.jpg",
  "Strength training at Inspire gym, Clonmel",
  false,
)}
${splitRow(
  "Mobility",
  "Enhance Your Flexibility and Prevent Injuries",
  `<p class="prose" data-rise style="color:var(--ink-dim);font-size:17px">Our Mobility Classes are designed to improve your flexibility and range of motion. Join us to prevent injuries and enhance your overall performance.</p><div class="prose" data-rise><h3 style="font-size:26px;margin:24px 0 6px">Flexibility Focus</h3><p style="margin-bottom:12px">Perfect for all fitness levels, our classes promote safe and effective movement.</p><h3 style="font-size:26px;margin:14px 0 6px">Join Us</h3><p>Experience the benefits of improved mobility in a supportive environment.</p></div>`,
  "assets/action.jpg",
  "Mobility class at Inspire gym, Clonmel",
  true,
)}
<section class="section" style="padding-top:0"><div class="shell"><div class="grid2">
  <div><span class="eyebrow" data-rise>Circuit</span><h2 class="display" data-rise style="margin-top:14px;font-size:clamp(34px,4.8vw,72px)">Transform Your Body with Our Dynamic Circuit Workouts for All Fitness Levels</h2></div>
  <p class="prose" data-rise style="color:var(--ink-dim);font-size:17px">Our circuit workouts are expertly designed to deliver full-body workouts that blend strength and cardio for optimal results. Join us to boost your fitness, enhance endurance, and achieve your goals in a supportive environment.</p>
</div></div></section>
<section class="section" style="padding-top:0"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>The benefits</span><h2 class="display" data-rise style="margin-top:14px">Unlock Your Potential with Our Workouts</h2></div><p data-rise>Joining our workouts enhances your heart health, aids in fat loss, and builds strength and flexibility. Experience the supportive community that motivates you to achieve your fitness goals.</p></div>
  <div class="svc" data-stagger>
    <div class="svc-card"><span class="idx">01</span><h3>Community Support</h3><p>Join a community that celebrates every achievement, big or small, together.</p></div>
    <div class="svc-card"><span class="idx">02</span><h3>Health Benefits</h3><p>Improve your overall well-being through our diverse range of fitness classes.</p></div>
  </div>
</div></section>
${ctaBand(
  "Join Our Exciting<br/>Workouts Today",
  "Find the perfect workout for your fitness journey.",
)}`;

/* ---------------- NUTRITION ---------------- */
const NUTRITION =
  pageHero(
    "Inspire · Nutrition",
    "Fuel Your Fitness.",
    "Personalized guidance to help you achieve your health and fitness goals through sustainable habits.",
    "assets/nutrition.avif",
  ) +
  `
<section class="section"><div class="shell"><div class="grid2">
  <div class="prose" data-rise><span class="eyebrow">Coaching</span><h3 style="margin-top:14px">Personalized Nutrition Coaching for Your Goals</h3><p>Our one-on-one nutrition coaching offers tailored advice and support from experienced nutritionists. Together, we'll help you develop and maintain healthy eating habits that fit your lifestyle.</p></div>
  <div class="media" data-rise style="aspect-ratio:4/3"><img src="assets/nutrition.avif" alt="Nutrition coaching at Inspire" loading="lazy"/></div>
</div></div></section>
<section class="section" style="padding-top:0"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>Meal plans</span><h2 class="display" data-rise style="margin-top:14px">Personalized Meal Plans for Your Goals</h2></div><p data-rise>Our customized meal plans are tailored to fit your unique fitness goals and dietary preferences. Enjoy a balanced approach to nutrition that supports your lifestyle.</p></div>
  <div class="svc" data-stagger>
    <div class="svc-card"><span class="idx">01</span><h3>Tailored Plans</h3><p>Achieve your fitness goals with meal plans designed just for you.</p></div>
    <div class="svc-card"><span class="idx">02</span><h3>Expert Guidance</h3><p>Receive support from our nutrition coaches to stay on track.</p></div>
    <div class="svc-card"><span class="idx">03</span><h3>Build Lasting Healthy Eating Habits</h3><p>Discover how to develop sustainable eating habits that align with your fitness goals. Our expert nutrition coaching will guide you every step of the way.</p></div>
  </div>
</div></section>
${splitRow(
  "Expert guidance",
  "Empower Your Health with Expert Guidance",
  `<p class="prose" data-rise style="color:var(--ink-dim);font-size:17px">Our nutrition coaching provides personalized support to help you achieve your health goals. With tailored meal plans and ongoing guidance, you'll learn to make sustainable choices that fit your lifestyle.</p><div class="prose" data-rise><h3 style="font-size:24px;margin:22px 0 6px">Comprehensive Tools for Your Nutrition Journey</h3><p style="margin-bottom:12px">We offer food diary reviews to keep you accountable.</p><h3 style="font-size:24px;margin:14px 0 6px">Educational Resources for Lasting Change</h3><p style="margin-bottom:12px">Our nutritional education empowers you with knowledge.</p><h3 style="font-size:24px;margin:14px 0 6px">Ongoing Support to Keep You on Track</h3><p>Receive continuous guidance to maintain your progress.</p></div>`,
  "assets/inbody.avif",
  "Tracking nutrition progress at Inspire",
  false,
)}
${ctaBand(
  "Transform Your<br/>Nutrition Today",
  "Unlock your potential with personalized nutrition coaching tailored to your fitness goals and lifestyle.",
)}`;

/* ---------------- TIMETABLE ---------------- */
const TIMETABLE =
  pageHero(
    "Inspire · Timetable",
    "Workout Schedule.",
    "Explore our diverse range of workouts designed to cater to every fitness level. Whether you're looking to build strength, improve flexibility, or boost your cardio, we have something for you.",
    "assets/gym-interior.jpg",
  ) +
  `
<section class="section"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>Timetable</span><h2 class="display" data-rise style="margin-top:14px">Explore Our Dynamic Workout Offerings for Every Fitness Level</h2></div><p data-rise>Join us for invigorating workouts designed to enhance your fitness journey. Whether you're looking to boost your cardio, build strength, or improve flexibility, we have something for everyone.</p></div>
  <div class="grid2">
  <div>
    <span class="eyebrow" data-rise>Opening hours</span>
    <h2 class="display" data-rise style="margin-top:14px;font-size:clamp(40px,5.4vw,84px)">When we're<br/>open.</h2>
    <div class="hours" data-rise style="margin-top:26px">
      <div class="row"><span>Monday – Thursday</span><span>6:00–11:00 · 16:00–20:00</span></div>
      <div class="row"><span>Friday</span><span>6:00–11:00 · 16:00–19:00</span></div>
      <div class="row"><span>Saturday</span><span>8:00–12:00</span></div>
      <div class="row"><span>Sunday</span><span>Closed</span></div>
    </div>
  </div>
  <div>
    <span class="eyebrow" data-rise>On the timetable</span>
    <h2 class="display" data-rise style="margin-top:14px;font-size:clamp(40px,5.4vw,84px)">Classes<br/>this week.</h2>
    <div class="classes" data-stagger style="grid-template-columns:1fr 1fr;margin-top:24px">
      <div class="cls"><div class="k">Strength</div><p>Build muscle &amp; strength</p></div>
      <div class="cls"><div class="k">Cardio</div><p>Heart health &amp; endurance</p></div>
      <div class="cls"><div class="k">Mobility</div><p>Flexibility &amp; movement</p></div>
      <div class="cls"><div class="k">Circuit</div><p>Full-body sessions</p></div>
    </div>
    <p class="prose" data-rise style="color:var(--ink-dim);margin-top:24px">Times vary through the week — message us on Instagram or call for the current schedule and to book in.</p>
    <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap" data-rise><a class="btn btn--gold" href="sign-up.html"><span>Sign Up</span><span class="arw">→</span></a><a class="btn" href="https://instagram.com/inspireclonmel"><span>DM @inspireclonmel</span><span class="arw">↗</span></a></div>
  </div>
  </div>
</div></section>
${ctaBand(
  "Find Your<br/>Perfect Workout",
  "Explore our diverse range of workouts tailored for every fitness level and goal.",
)}`;

/* ---------------- SIGN UP ---------------- */
const SIGNUP =
  pageHero(
    "Inspire · Sign Up",
    "Join Inspire Now.",
    "Take the first step towards your fitness journey today with our supportive community.",
    "assets/strength.jpg",
  ) +
  `
<section class="section"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>Get Started</span><h2 class="display" data-rise style="margin-top:14px">Pick your<br/>plan.</h2></div><p data-rise>Sign up today to begin your fitness journey! We offer various membership options including Monthly, Student, Off-Peak, and Couple plans — each with unlimited class access and gym facilities.</p></div>
  <div class="plans" data-stagger>
    <div class="plan"><h4>Monthly</h4><div class="price">Contact for pricing</div><ul><li>Unlimited class access</li><li>Full gym facilities</li><li>Community &amp; support</li></ul><a class="btn btn--gold" href="tel:0838897736"><span>Get started</span><span class="arw">→</span></a></div>
    <div class="plan"><h4>Student</h4><div class="price">Contact for pricing</div><ul><li>Unlimited class access</li><li>Full gym facilities</li><li>Student rate</li></ul><a class="btn" href="tel:0838897736"><span>Get started</span><span class="arw">→</span></a></div>
    <div class="plan"><h4>Off-Peak</h4><div class="price">Contact for pricing</div><ul><li>Off-peak access</li><li>Unlimited class access</li><li>Great value</li></ul><a class="btn" href="tel:0838897736"><span>Get started</span><span class="arw">→</span></a></div>
    <div class="plan"><h4>Couple</h4><div class="price">Contact for pricing</div><ul><li>Two memberships</li><li>Train together</li><li>Shared rate</li></ul><a class="btn" href="tel:0838897736"><span>Get started</span><span class="arw">→</span></a></div>
  </div>
</div></section>
<section class="section" style="padding-top:0"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>FAQs</span><h2 class="display" data-rise style="margin-top:14px">Before you<br/>join.</h2></div><p data-rise>Find answers to common questions about our memberships and the sign-up process.</p></div>
  ${SIGNUP_FAQ}
  <div class="prose" data-rise style="margin-top:30px"><h3 style="margin-top:0">Still have questions?</h3><p>We're here to help! <a class="gold" href="contact.html">Get in touch</a> and our friendly team will look after you.</p></div>
</div></section>
${ctaBand(
  "Ready to start?",
  "Signing up is easy — simply fill out our online form or visit us at the gym, and our friendly staff will assist you through the process.",
)}`;

/* ---------------- REFERRAL ---------------- */
const REFERRAL =
  pageHero(
    "Inspire · Referral",
    "Refer A Friend, Get €50 Cash Back.",
    "Bring a friend to Inspire and you'll both save money while getting fitter together.",
    "assets/action.jpg",
  ) +
  `
<section class="section"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>How it works</span><h2 class="display" data-rise style="margin-top:14px">Train together.<br/>Both save.</h2></div><p data-rise>Bring a friend to Inspire and you'll both save money while getting fitter together. Your friend gets €50 off our 6-Week Program — and when they sign up after the 6 weeks, you get €50 back.</p></div>
  <div class="steps" data-stagger>
    <div class="step"><div class="num">01</div><h4>Refer a friend</h4><p>Bring a friend to Inspire and get them booked onto our 6-Week Program.</p></div>
    <div class="step"><div class="num">02</div><h4>Your friend gets €50 off</h4><p>They get €50 off our 6-Week Program to kickstart their journey.</p></div>
    <div class="step"><div class="num">03</div><h4>You get €50 back</h4><p>When they sign up after the 6 weeks, you get €50 back.</p></div>
  </div>
</div></section>
<section class="section" style="padding-top:0"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>Referral Sign Up</span><h2 class="display" data-rise style="margin-top:14px">Get<br/>started.</h2></div><p data-rise>Sign up today to begin your fitness journey!</p></div>
  <div data-rise><a class="btn btn--gold" href="sign-up.html"><span>Sign Up</span><span class="arw">→</span></a></div>
</div></section>
<section class="section" style="padding-top:0"><div class="shell">
  <div class="sec-head"><div><span class="eyebrow" data-rise>FAQs</span><h2 class="display" data-rise style="margin-top:14px">Before you<br/>join.</h2></div><p data-rise>Find answers to common questions about our memberships and the sign-up process.</p></div>
  ${SIGNUP_FAQ}
</div></section>
${ctaBand(
  "Refer a friend,<br/>get €50 cash back.",
  "Sign up today to begin your fitness journey — and bring a friend along for the ride.",
)}`;

/* ---------------- CONTACT ---------------- */
const CONTACT =
  pageHero(
    "Inspire · Contact",
    "Get in Touch with Clonmel's Leading Strength &amp; Conditioning Gym.",
    "We're here to help you connect with us!",
  ) +
  `
<section class="section"><div class="shell"><div class="contact">
  <div>
    <span class="eyebrow" data-rise>Get in touch</span>
    <h2 class="display" data-rise style="margin-top:14px;font-size:clamp(44px,6vw,96px)">Say hello.</h2>
    <div class="info" data-stagger style="margin-top:28px">${CONTACT_ROWS}</div>
    <div style="margin-top:26px" data-rise><a class="btn btn--gold" href="sign-up.html"><span>Sign Up</span><span class="arw">→</span></a></div>
  </div>
  <div class="mapwrap" data-rise><iframe loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=Ard%20Gaoithe%20Business%20Park%20Clonmel&output=embed"></iframe></div>
</div></div></section>`;

/* ---------------- PRIVACY ---------------- */
const PRIVACY =
  pageHero(
    "Inspire · Legal",
    "Privacy policy.",
    "How we collect, use and protect your information at Inspire Health & Fitness.",
  ) +
  `
<section class="section"><div class="shell"><div class="prose" data-rise>
  <p>Inspire Health &amp; Fitness ("we", "us") respects your privacy. This policy explains how we handle the personal information you share with us.</p>
  <h3>Information we collect</h3><p>We collect details you provide when you enquire, sign up, book a class or scan, or contact us — such as your name, email, phone number and goals. We may also collect basic usage information from our website.</p>
  <h3>How we use it</h3><p>We use your information to respond to enquiries, manage your membership and bookings, deliver coaching and nutrition support, track progress (e.g. InBody results), and keep you updated about the gym.</p>
  <h3>Sharing</h3><p>We do not sell your personal information. We only share it with trusted providers who help us operate (such as booking or payment systems), and where required by law.</p>
  <h3>Your rights</h3><p>You can request access to, correction of, or deletion of your personal information at any time. Contact us at <a href="mailto:djinspireclonmel@gmail.com" class="gold">djinspireclonmel@gmail.com</a>.</p>
  <h3>Contact</h3><p>Inspire Health &amp; Fitness, Unit 12M Ard Gaoithe Business Park, Clonmel, Co. Tipperary · 083 889 7736 · djinspireclonmel@gmail.com</p>
</div></div></section>`;

const PAGES = {
  "index.html": [
    "Inspire Health & Fitness — Clonmel's Gym for Strength, Conditioning & Real Results",
    "Looking for a friendly, results-driven gym in Clonmel? Inspire Health & Fitness offers expert coaching, modern equipment and inclusive workouts for men & women of all levels. No joining fee.",
    HOME,
  ],
  "about.html": [
    "About — Inspire Health & Fitness, Clonmel",
    "Helping real people achieve their fitness goals in a supportive and motivating environment. A gym in Clonmel built on community, consistency and support.",
    ABOUT,
  ],
  "classes.html": [
    "Classes — Inspire Health & Fitness, Clonmel",
    "Explore our workouts — cardio, strength, mobility and circuit classes for all fitness levels at Inspire Health & Fitness, Clonmel.",
    CLASSES,
  ],
  "nutrition.html": [
    "Nutrition Coaching — Inspire Health & Fitness",
    "Personalized nutrition coaching and custom meal plans to help you reach your goals through sustainable habits at Inspire Health & Fitness, Clonmel.",
    NUTRITION,
  ],
  "timetable.html": [
    "Timetable — Inspire Health & Fitness, Clonmel",
    "Workout schedule and opening hours at Inspire Health & Fitness — diverse workouts for every fitness level in Clonmel.",
    TIMETABLE,
  ],
  "sign-up.html": [
    "Sign Up — Inspire Health & Fitness, Clonmel",
    "Join Inspire now. Monthly, Student, Off-Peak and Couple memberships with unlimited class access and gym facilities. No joining fee for new members.",
    SIGNUP,
  ],
  "referral-program.html": [
    "Referral Program — Inspire Health & Fitness",
    "Refer a friend to Inspire and you'll both save — they get €50 off our 6-Week Program, and you get €50 cash back when they join.",
    REFERRAL,
  ],
  "contact.html": [
    "Contact — Inspire Health & Fitness, Clonmel",
    "Get in touch with Clonmel's leading strength & conditioning gym. Visit, call or message Inspire Health & Fitness at Ard Gaoithe Business Park, Clonmel.",
    CONTACT,
  ],
  "privacy-policy.html": [
    "Privacy Policy — Inspire Health & Fitness",
    "Privacy policy for Inspire Health & Fitness, Clonmel.",
    PRIVACY,
  ],
};

let n = 0;
for (const [file, [title, desc, body]] of Object.entries(PAGES)) {
  fs.writeFileSync(path.join(OUT, file), wrap(file, title, desc, body));
  n++;
}
console.log(`wrote ${n} pages to sites/inspire/`);
