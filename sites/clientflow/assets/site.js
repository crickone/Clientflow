/* ==========================================================================
   ClientFlow — site.js  (dependency-free vanilla, < 25KB)
   Reveal · sticky nav · mobile nav · FAQ · hero scene · timeline ·
   counters · pricing calculator · cookie banner. Respects reduced-motion.
   ========================================================================== */
(function () {
  'use strict';
  var doc = document;
  var win = window;
  var reduce = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) doc.documentElement.classList.add('no-motion');

  function $(s, c) { return (c || doc).querySelector(s); }
  function $all(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  function on(el, ev, fn, o) { el && el.addEventListener(ev, fn, o || false); }
  var raf = win.requestAnimationFrame || function (f) { return setTimeout(f, 16); };

  /* ---------------------------------------------------------------- Reveal */
  function initReveal() {
    var items = $all('.rv');
    if (!items.length) return;
    if (reduce || !('IntersectionObserver' in win)) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ------------------------------------------------------------ Sticky nav */
  function initNav() {
    var nav = $('.nav');
    if (nav) {
      var onScroll = function () {
        nav.classList.toggle('stuck', win.scrollY > 8);
      };
      onScroll();
      on(win, 'scroll', onScroll, { passive: true });
    }
    // mobile toggle
    var toggle = $('.nav-toggle');
    var links = $('.nav-links');
    if (toggle && links) {
      on(toggle, 'click', function () {
        var open = links.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      // close on link click
      $all('a', links).forEach(function (a) {
        on(a, 'click', function () {
          links.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        });
      });
      // close on escape
      on(doc, 'keydown', function (e) {
        if (e.key === 'Escape' && links.classList.contains('open')) {
          links.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
          toggle.focus();
        }
      });
    }
  }

  /* ------------------------------------------------------ FAQ (single-open) */
  function initFaq() {
    $all('.faq').forEach(function (faq) {
      var groups = $all('details', faq);
      groups.forEach(function (d) {
        on(d, 'toggle', function () {
          if (d.open && faq.dataset.single !== 'off') {
            groups.forEach(function (o) { if (o !== d) o.open = false; });
          }
        });
      });
    });
  }

  /* ------------------------------------------------------- Counter numbers */
  function initCounters() {
    var els = $all('.count');
    if (!els.length) return;
    if (reduce || !('IntersectionObserver' in win)) {
      els.forEach(function (el) { el.textContent = fmt(el, target(el)); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        animate(e.target);
      });
    }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });

    function target(el) { return parseFloat(el.getAttribute('data-to') || el.textContent) || 0; }
    function fmt(el, v) {
      var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
      var pre = el.getAttribute('data-prefix') || '';
      var suf = el.getAttribute('data-suffix') || '';
      return pre + v.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + suf;
    }
    function animate(el) {
      var to = target(el), dur = 1100, start = 0;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(el, to * eased);
        if (p < 1) raf(step);
      }
      raf(step);
    }
  }

  /* --------------------------------------------------- Day-in-life timeline */
  function initTimeline() {
    var tl = $('.timeline');
    if (!tl) return;
    var fill = $('.line-fill', tl);
    var items = $all('.tl-item', tl);
    if (reduce) {
      items.forEach(function (i) { i.classList.add('on'); });
      if (fill) fill.style.height = '100%';
      return;
    }
    var ticking = false;
    function update() {
      ticking = false;
      var r = tl.getBoundingClientRect();
      var vh = win.innerHeight;
      var total = r.height;
      // progress of viewport-center through the timeline
      var p = (vh * 0.55 - r.top) / total;
      p = Math.max(0, Math.min(1, p));
      if (fill) fill.style.height = (p * 100) + '%';
      var mark = r.top + total * p;
      items.forEach(function (it) {
        var ir = it.getBoundingClientRect();
        it.classList.toggle('on', ir.top <= vh * 0.6);
      });
    }
    on(win, 'scroll', function () {
      if (!ticking) { ticking = true; raf(update); }
    }, { passive: true });
    on(win, 'resize', update);
    update();
  }

  /* ----------------------------------------------------- Pricing calculator */
  function initCalc() {
    var calc = $('[data-calc]');
    if (!calc) return;
    var inputs = $all('[data-cost]', calc);
    var totalEl = $('[data-calc-total]', calc);
    var saveEl = $('[data-calc-save]', calc);
    var ours = parseFloat(calc.getAttribute('data-ours') || '200');
    function recalc() {
      var sum = 0;
      inputs.forEach(function (i) {
        var v = parseFloat(i.getAttribute('data-cost') || '0');
        var checked = i.type === 'checkbox' ? i.checked : true;
        var out = $('[data-cost-out]', i.closest('[data-cost-row]') || calc);
        if (out) out.textContent = checked ? '€' + v : '—';
        if (checked) sum += v;
      });
      if (totalEl) totalEl.textContent = '€' + sum.toLocaleString('en-IE');
      if (saveEl) {
        var save = sum - ours;
        saveEl.textContent = save > 0
          ? 'You save €' + save.toLocaleString('en-IE') + '/mo with ClientFlow'
          : 'ClientFlow covers all of this for €' + ours + '/mo';
      }
    }
    inputs.forEach(function (i) { on(i, 'change', recalc); on(i, 'input', recalc); });
    recalc();
  }

  /* ----------------------------------------------------- Savings calculator */
  /* Two sliders (members x avg fee) -> payment-fee saving vs a rival card    */
  /* rate, plus a flat researched software-stack saving. Pure data- attrs so  */
  /* markup stays declarative; static HTML already shows sane defaults.      */
  function initSavingsCalc() {
    var calc = $('[data-savings-calc]');
    if (!calc) return;
    var rateRival = parseFloat(calc.getAttribute('data-rate-rival') || '2.9') / 100;
    var rateUs = parseFloat(calc.getAttribute('data-rate-us') || '0.9') / 100;
    var stackSaving = parseFloat(calc.getAttribute('data-stack-saving') || '0');
    var members = $('[data-sc="members"]', calc);
    var fee = $('[data-sc="fee"]', calc);
    if (!members || !fee) return;

    function euro(n) { return '€' + Math.round(n).toLocaleString('en-IE'); }
    function setOut(key, text) {
      var el = calc.querySelector('[data-sc-out="' + key + '"]');
      if (el) el.textContent = text;
    }
    function recalc() {
      var m = parseFloat(members.value) || 0;
      var f = parseFloat(fee.value) || 0;
      var volume = m * f;
      var paymentSaving = volume * (rateRival - rateUs);
      var total = paymentSaving + stackSaving;
      setOut('members', m.toLocaleString('en-IE'));
      setOut('fee', euro(f));
      setOut('volume', euro(volume));
      setOut('payment-saving', euro(paymentSaving));
      setOut('stack-saving', euro(stackSaving));
      setOut('total', euro(total));
      setOut('annual', euro(total * 12));
    }
    [members, fee].forEach(function (i) {
      on(i, 'input', recalc);
      on(i, 'change', recalc);
    });
    recalc();
  }

  /* -------------------------------------------------------- Cookie consent */
  function initCookie() {
    var bar = $('.cookie');
    if (!bar) return;
    var KEY = 'cf_cookie_ok';
    var stored;
    try { stored = win.localStorage.getItem(KEY); } catch (e) { stored = '1'; }
    if (stored) return;
    setTimeout(function () { bar.classList.add('show'); }, 700);
    $all('[data-cookie-accept]', bar).forEach(function (b) {
      on(b, 'click', function () {
        try { win.localStorage.setItem(KEY, '1'); } catch (e) {}
        bar.classList.remove('show');
      });
    });
  }

  /* ============================================================ HERO SCENE */
  /* Pointer-tilt (lerped, max 6deg) + scroll-assemble on first viewport.    */
  function initHeroScene() {
    var scene = $('.hero-scene');
    if (!scene) return;
    // reduced-motion / no pointer: leave the CSS default (fully assembled, flat)
    if (reduce) {
      scene.style.setProperty('--assemble', '1');
      return;
    }

    var MAX = 6;                 // max tilt degrees
    var curX = 0, curY = 0;      // current (lerped) tilt
    var tgtX = 0, tgtY = 0;      // target tilt from pointer
    var assemble = 0;            // 0 = exploded, 1 = converged
    var running = false;
    var hovering = false;

    // ---- pointer target ----
    var finePointer = win.matchMedia && win.matchMedia('(pointer:fine)').matches;
    if (finePointer) {
      on(scene, 'pointermove', function (e) {
        var r = scene.getBoundingClientRect();
        var nx = (e.clientX - r.left) / r.width - 0.5;   // -0.5..0.5
        var ny = (e.clientY - r.top) / r.height - 0.5;
        tgtY = nx * MAX * 2;      // rotateY follows horizontal
        tgtX = -ny * MAX * 2;     // rotateX follows vertical (inverted)
        hovering = true;
        kick();
      });
      on(scene, 'pointerleave', function () {
        tgtX = 0; tgtY = 0; hovering = true; kick();
      });
    }

    // ---- scroll assemble (only meaningful while hero in view) ----
    function scrollProgress() {
      var r = scene.getBoundingClientRect();
      var vh = win.innerHeight;
      // 0 when scene top at bottom of viewport, ~1 when scrolled ~half a screen
      var p = 1 - (r.top / (vh * 0.9));
      return Math.max(0, Math.min(1, p));
    }
    function onScroll() {
      assemble = scrollProgress();
      kick();
    }
    on(win, 'scroll', onScroll, { passive: true });
    on(win, 'resize', onScroll);
    assemble = Math.max(assemble, scrollProgress());

    function kick() { if (!running) { running = true; raf(loop); } }

    function loop() {
      // lerp tilt toward target
      curX += (tgtX - curX) * 0.08;
      curY += (tgtY - curY) * 0.08;
      // ease assemble target (already 0..1) — smooth its render
      scene.style.setProperty('--tiltX', curX.toFixed(2) + 'deg');
      scene.style.setProperty('--tiltY', curY.toFixed(2) + 'deg');
      scene.style.setProperty('--assemble', assemble.toFixed(3));

      var settled = Math.abs(tgtX - curX) < 0.02 && Math.abs(tgtY - curY) < 0.02;
      if (settled) { curX = tgtX; curY = tgtY; running = false; hovering = false; }
      else raf(loop);
    }

    // dragging class kills the CSS transition while pointer-driven for snappiness
    on(scene, 'pointerdown', function () { scene.classList.add('dragging'); });
    on(win, 'pointerup', function () { scene.classList.remove('dragging'); });

    // initial paint
    kick();
  }

  /* -------------------------------------------------------------- Boot all */
  function boot() {
    initReveal();
    initNav();
    initFaq();
    initCounters();
    initTimeline();
    initCalc();
    initSavingsCalc();
    initCookie();
    initHeroScene();
  }
  if (doc.readyState === 'loading') on(doc, 'DOMContentLoaded', boot);
  else boot();
})();
