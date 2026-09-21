import { chromium } from '../../../app/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const base = process.env.ADONIS_PREVIEW_URL || 'http://127.0.0.1:4173/sites/adonisagent/index.html';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Browser test is local-only; never send test leads to production.');
const cache = join(homedir(), 'Library/Caches/ms-playwright');
const cachedShell = existsSync(cache) ? readdirSync(cache).filter(name => name.startsWith('chromium_headless_shell-')).sort((a, b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)))[0] : null;
const executablePath = process.env.CHROME || (cachedShell ? join(cache, cachedShell, 'chrome-headless-shell-mac-arm64/chrome-headless-shell') : undefined);
const output = process.env.ADONIS_SCREENSHOT_DIR || '/tmp/adonis-review';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath });
const errors = [];
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${output}/desktop-hero.png` });
  assert.equal(await page.locator('h1').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#tab-marketing').click();
  await page.waitForFunction(() => document.querySelector('#preview-agent').textContent === 'Marketing agent');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#tab-marketing').getAttribute('aria-selected'), 'true');
  await page.locator('#tab-marketing').press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('#preview-agent').textContent === 'Operations agent');
  assert.equal(await page.locator('#tab-operations').getAttribute('aria-selected'), 'true');
  await page.waitForTimeout(500);
  await page.locator('#tab-sales').click();
  await page.waitForTimeout(600);
  await page.locator('.platform-section').screenshot({ path: `${output}/desktop-platform.png` });
  results.push('Desktop layout and keyboard workflow switching pass');

  await page.locator('[data-source="hero"]').click();
  assert.equal(await page.locator('#demo-dialog').evaluate(el => el.open), true);
  await page.locator('#demo-name').fill('Website test');
  await page.locator('#demo-email').fill('test@example.com');
  let submitted;
  await page.route('**/api/site-demo-lead', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' });
  });
  await page.locator('#demo-form button[type="submit"]').click();
  await page.waitForSelector('#form-error:not([hidden])');
  assert.equal(await page.locator('#demo-email').inputValue(), 'test@example.com');
  assert.equal(await page.locator('.demo-success').isVisible(), false);
  await page.unroute('**/api/site-demo-lead');
  await page.route('**/api/site-demo-lead', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.locator('#demo-form button[type="submit"]').click();
  await page.waitForSelector('.demo-success:not([hidden])');
  assert.equal(submitted.name, 'Website test');
  await page.screenshot({ path: `${output}/demo-success.png` });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#demo-dialog').evaluate(el => el.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.source), 'hero');
  results.push('Mocked request error/retry/success, preserved input and dialog focus restoration pass');

  // Reveal all sections by walking the page, then capture the actual composition.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 650) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${output}/desktop-full.png`, fullPage: true });

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const mobile = await mobileContext.newPage();
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(base);
  await mobile.evaluate(() => document.fonts.ready);
  await mobile.waitForTimeout(1300);
  await mobile.screenshot({ path: `${output}/mobile-hero.png` });
  const cta = await mobile.locator('[data-source="hero"]').boundingBox();
  assert.ok(cta.y + cta.height < 844, 'Primary CTA is above fold');
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.locator('.menu-toggle').click();
  assert.equal(await mobile.locator('#mobile-nav').isVisible(), true);
  await mobile.locator('#mobile-nav a[href="#platform"]').click();
  assert.equal(await mobile.locator('#mobile-nav').isVisible(), false);
  await mobile.waitForTimeout(800);
  await mobile.locator('.platform-section').screenshot({ path: `${output}/mobile-platform.png` });
  await mobile.locator('[data-source="workflow"]').click();
  await mobile.waitForTimeout(450);
  await mobile.screenshot({ path: `${output}/mobile-form.png` });
  await mobile.locator('#demo-dialog .dialog-close').click();
  for (const width of [320, 360, 430, 768, 1024]) {
    await mobile.setViewportSize({ width, height: 900 });
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal overflow at ${width}px`);
  }
  results.push('Mobile CTA above fold, navigation/form and 320–1024px overflow checks pass');

  const reducedContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(base);
  assert.equal(await reducedPage.locator('.sculpture').evaluate(el => getComputedStyle(el).animationName), 'none');
  await reducedPage.locator('#tab-marketing').click();
  assert.match(await reducedPage.locator('#workflow-label').innerText(), /MARKETING/);
  results.push('Reduced-motion mode and workflow fallback pass');
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const plain = await noJs.newPage();
  await plain.goto(base);
  assert.equal(await plain.locator('h1').isVisible(), true);
  assert.equal(await plain.locator('.section-heading').first().evaluate(el => getComputedStyle(el).opacity), '1');
  results.push('No-JavaScript content remains visible');
  assert.deepEqual(errors, []);
  console.log(results.join('\n'));
  writeFileSync(`${output}/results.json`, JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
