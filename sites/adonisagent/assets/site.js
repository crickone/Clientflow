(() => {
  'use strict';
  const root = document.getElementById('adonis-site');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let paused = reduced.matches;
  const track = (event, details = {}) => {
    // Integration hook only. No analytics service or personal details sent.
    root.dispatchEvent(new CustomEvent('adonis:conversion', { bubbles: true, detail: { event, ...details } }));
  };

  // Content stays readable if scripting fails or is disabled.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.07, rootMargin: '0px 0px 35px 0px' });
    $$('[data-reveal]').forEach((element) => observer.observe(element));
    root.classList.add('motion-ready');
  }
  const motionButton = $('.motion-toggle');
  function applyMotionPreference() {
    root.classList.toggle('motion-paused', paused);
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.innerHTML = paused ? 'Resume motion <span aria-hidden="true">▷</span>' : 'Pause motion <span aria-hidden="true">Ⅱ</span>';
    motionButton.disabled = reduced.matches;
    if (reduced.matches) motionButton.textContent = 'Reduced motion';
  }
  applyMotionPreference();
  motionButton.addEventListener('click', () => { paused = !paused; applyMotionPreference(); });
  reduced.addEventListener('change', () => { paused = reduced.matches; applyMotionPreference(); });

  const menuButton = $('.menu-toggle');
  const mobileNav = $('#mobile-nav');
  function closeMenu(restoreFocus = false) {
    mobileNav.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
    if (restoreFocus) menuButton.focus();
  }
  menuButton.addEventListener('click', () => {
    const opening = mobileNav.hidden;
    mobileNav.hidden = !opening;
    menuButton.setAttribute('aria-expanded', String(opening));
    menuButton.setAttribute('aria-label', opening ? 'Close navigation' : 'Open navigation');
  });
  mobileNav.addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !mobileNav.hidden) closeMenu(true); });
  document.addEventListener('click', (event) => { if (!event.target.closest('.site-header')) closeMenu(); });
  window.matchMedia('(min-width: 601px)').addEventListener('change', (event) => { if (event.matches) closeMenu(); });

  const scenarios = {
    sales: {
      label: 'YOUR SALES AGENT', title: ['A new enquiry.', 'A reply in your words.'],
      description: 'Every enquiry lands in one pipeline. Adonis drafts the reply from that client’s own history with you, and you read it before it sends.',
      steps: ['Enquiry lands', 'Reply drafted', 'You approve it'],
      heading: 'Your next opportunity', status: 'Ready to review', avatar: 'JD', person: 'Jamie D.', meta: 'New enquiry · Website',
      incoming: '“I’d love to try a class. What’s the best way to get started?”', agent: 'Sales agent',
      response: 'A welcome, a note on which class suits a beginner, and an invitation to book it.',
      chips: ['Personalised reply', 'Client context included']
    },
    marketing: {
      label: 'YOUR MARKETING AGENT', title: ['One brief in.', 'A week of posts out.'],
      description: 'Give Adonis a one-line brief. Get a campaign outline, an email and designed posts, all in your brand, all waiting for your approval.',
      steps: ['Send the brief', 'Review the direction', 'Approve the assets'],
      heading: 'Your next campaign', status: 'Draft for review', avatar: 'YOU', person: 'Your campaign brief', meta: 'Marketing · New project',
      incoming: '“Help me plan a campaign for our new beginner strength programme.”', agent: 'Marketing agent',
      response: 'A campaign outline, a welcome email and a week of posts, all built around the first session.',
      chips: ['Campaign outline', 'Email & social drafts']
    },
    operations: {
      label: 'YOUR OPERATIONS AGENT', title: ['What needs you today,', 'in one answer.'],
      description: 'Ask what needs you today. Adonis pulls the classes, the bookings and the follow-ups into one answer, without you opening anything else.',
      steps: ['Ask about the day', 'See it pulled together', 'Pick the next thing'],
      heading: 'A clearer picture', status: 'Overview prepared', avatar: 'YOU', person: 'Your morning check-in', meta: 'Operations · Daily overview',
      incoming: '“Help me get a clear picture of what needs my attention today.”', agent: 'Operations agent',
      response: 'Your schedule, the bookings that need chasing, and what to deal with first.',
      chips: ['Your own data', 'One answer']
    }
  };
  const tabs = $$('[data-scenario]');
  let selected = 'sales';
  let activeTransition;
  const setText = (id, text) => { $(id).textContent = text; };
  function selectScenario(key, focus = false) {
    if (!scenarios[key]) return;
    if (focus) tabs.find((tab) => tab.dataset.scenario === key).focus();
    if (selected === key) return;
    selected = key;
    const render = () => {
      const scene = scenarios[key];
      tabs.forEach((tab) => {
        const active = tab.dataset.scenario === key;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      $('#workflow-panel').setAttribute('aria-labelledby', `tab-${key}`);
      setText('#workflow-label', scene.label);
      $('#workflow-title').replaceChildren(document.createTextNode(scene.title[0]), document.createElement('br'), document.createTextNode(scene.title[1]));
      setText('#workflow-description', scene.description);
      $('#workflow-steps').replaceChildren(...scene.steps.map((text, index) => {
        const span = document.createElement('span');
        const marker = document.createElement('i'); marker.textContent = String(index + 1);
        span.append(marker, document.createTextNode(text)); return span;
      }));
      ['heading', 'status', 'avatar', 'person', 'meta', 'incoming', 'agent', 'response'].forEach((field) => setText(`#preview-${field}`, scene[field]));
      $('#preview-chips').replaceChildren(...scene.chips.map((text) => { const span = document.createElement('span'); span.textContent = text; return span; }));
    };
    if (document.startViewTransition && !paused) {
      activeTransition?.skipTransition();
      activeTransition = document.startViewTransition(render);
      activeTransition.finished.catch(() => {});
    } else render();
    track('workflow_view', { workflow: key });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectScenario(tab.dataset.scenario));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectScenario(tabs[next].dataset.scenario, true); }
    });
  });

  // Native dialogs provide Escape, focus containment and focus restoration.
  const demo = $('#demo-dialog');
  const privacy = $('#privacy-dialog');
  const form = $('#demo-form');
  let submissionPending = false;
  let entrySource = 'direct';
  function syncScrollLock() {
    document.documentElement.classList.toggle('adonis-dialog-open', !!root.querySelector('dialog[open]'));
  }
  $$('[data-demo]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    entrySource = link.dataset.source || 'unknown';
    demo.showModal(); syncScrollLock();
    track('demo_open', { source: entrySource });
  }));
  $$('[data-privacy]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault(); privacy.showModal(); syncScrollLock();
  }));
  $$('dialog').forEach((dialog) => {
    dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('close', syncScrollLock);
    dialog.addEventListener('click', (event) => {
      const box = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
    });
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submissionPending || !form.reportValidity()) return;
    submissionPending = true;
    const button = form.querySelector('button[type="submit"]');
    const error = $('#form-error');
    const status = $('.form-status');
    error.hidden = true;
    button.disabled = true;
    button.querySelector('span').textContent = 'Sending your request…';
    status.textContent = 'Sending your request…';
    form.setAttribute('aria-busy', 'true');
    const fields = Object.fromEntries(new FormData(form).entries());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/site-demo-lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields), signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(response.status === 429
          ? 'You’ve made a few requests recently. Please wait 10 minutes, then try again.'
          : 'We couldn’t save your request. Your details are still here — please try again in a moment.');
      }
      $('.demo-form-view').hidden = true;
      const success = $('.demo-success');
      success.hidden = false;
      demo.setAttribute('aria-labelledby', 'demo-success-title');
      success.querySelector('h2').id = 'demo-success-title';
      if (demo.open) success.focus();
      form.reset();
      track('demo_request_success', { source: entrySource });
    } catch (err) {
      error.textContent = err.name === 'AbortError'
        ? 'The connection took too long. Your request may have arrived; please wait a moment before trying again.'
        : err.message || 'Unable to connect. Please check your connection and try again.';
      error.hidden = false;
      if (demo.open) error.focus();
      track('demo_request_error', { source: entrySource });
    } finally {
      clearTimeout(timeout);
      submissionPending = false;
      button.disabled = false;
      button.querySelector('span').textContent = 'Request my demo';
      status.textContent = '';
      form.removeAttribute('aria-busy');
    }
  });

  // Animate only while needed. Preserve native scrolling and the system cursor.
  const aura = $('.cursor-aura');
  let pointerFrame = 0;
  let pointerX = 0, pointerY = 0;
  root.addEventListener('pointermove', (event) => {
    if (!finePointer.matches || paused) return;
    pointerX = event.clientX; pointerY = event.clientY;
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      aura.style.transform = `translate3d(${pointerX}px,${pointerY}px,0)`;
      aura.style.opacity = '1'; pointerFrame = 0;
    });
  }, { passive: true });
  root.addEventListener('pointerover', (event) => { aura.classList.toggle('over-control', !!event.target.closest('a,button,summary')); });
  root.addEventListener('pointerleave', () => { aura.style.opacity = '0'; });
  $$('[data-magnetic]').forEach((element) => {
    element.addEventListener('pointermove', (event) => {
      if (!finePointer.matches || paused) return;
      const box = element.getBoundingClientRect();
      const x = (event.clientX - box.left - box.width / 2) * .08;
      const y = (event.clientY - box.top - box.height / 2) * .12;
      element.style.translate = `${x}px ${y}px`;
    }, { passive: true });
    element.addEventListener('pointerleave', () => { element.style.translate = '0px 0px'; });
  });
  const progress = $('.reading-progress');
  const header = $('.site-header');
  const art = $('.sculpture-track');
  let scrollFrame = 0;
  function updateScroll() {
    scrollFrame = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    header.classList.toggle('is-scrolled', window.scrollY > 60);
    progress.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    if (!paused && finePointer.matches && window.scrollY < window.innerHeight) {
      art.style.translate = `0 ${window.scrollY * .08}px`;
    } else art.style.translate = '';
  }
  window.addEventListener('scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll); }, { passive: true });
  window.addEventListener('resize', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll); }, { passive: true });
  updateScroll();

  // Stop ambient work when it cannot be seen.
  const sculpture = $('.sculpture');
  let heroVisible = true;
  const setAmbientState = () => {
    sculpture.style.animationPlayState = heroVisible && !document.hidden ? 'running' : 'paused';
  };
  if ('IntersectionObserver' in window) {
    const heroObserver = new IntersectionObserver(([entry]) => {
      heroVisible = entry.isIntersecting;
      setAmbientState();
    });
    heroObserver.observe($('.hero'));
  }
  document.addEventListener('visibilitychange', setAmbientState);
})();
