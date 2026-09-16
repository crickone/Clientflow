"""
Mobile layout checks for the screens that get used on a phone.

Run a dev server, seed a local login, then:
    cd app && node scripts/dev-user.mjs
    cd app && npm run dev
    python tests/mobile_layout.py

Why a browser test and not a unit test: every defect this catches is a
LAYOUT fact -- a grid track sized by its content, a flex row that will not
wrap, a focus trap -- and none of them are visible in the source. The
Content Studio editor looked fine in the markup while slicing its own slide
preview in half at 390px.

The two cases pinned here are the ones that actually broke:

  1. NOTHING IS CLIPPED. `.app-main` sets overflow-x:hidden, so content wider
     than the screen is not scrolled to -- it is cut off silently, with the
     document still measuring exactly the viewport width. The editor's outer
     stack is a grid with no explicit columns, whose single implicit track is
     sized `auto` (by content, not by its box); the filmstrip's min-content
     was 680px, so the whole column became 680px inside a 358px screen and
     everything in it lost its right-hand edge.

  2. THE DRAWER IS A DIALOG. It is the only navigation a phone has.
"""
from __future__ import annotations

import argparse
import sys

from playwright.sync_api import sync_playwright

EMAIL = "dev@local.test"
PASSWORD = "dev-local-only"
TENANT = "Optimal Health"
PHONE = {"width": 390, "height": 844}

failures: list[str] = []


def check(cond: bool, name: str) -> None:
    print(("  PASS  " if cond else "  FAIL  ") + name)
    if not cond:
        failures.append(name)


def login(pg, base: str) -> None:
    pg.goto(f"{base}/login")
    pg.fill('input[type="email"]', EMAIL)
    pg.fill('input[type="password"]', PASSWORD)
    with pg.expect_navigation(wait_until="networkidle", timeout=30000):
        pg.click('button[type="submit"]')
    if "select-account" in pg.url:
        with pg.expect_navigation(wait_until="networkidle", timeout=30000):
            pg.click(f'text="{TENANT}"')


# Elements allowed to be wider than their box: a deliberate scroll container
# (the filmstrip) and the 1px screen-reader-only labels.
CLIPPED_JS = """
() => {
  const bad = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;
    if (el.classList.contains('sr-only')) continue;
    if (el.closest('[style*="overflow-x:auto"], [style*="overflow-x: auto"]')) continue;
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      bad.push(`${el.tagName.toLowerCase()}.${(typeof el.className === 'string' ? el.className : '').slice(0, 30)} ${el.scrollWidth}>${el.clientWidth}`);
    }
  }
  return bad.slice(0, 8);
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:3000")
    args = ap.parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        pg = browser.new_page(viewport=PHONE, is_mobile=True, has_touch=True)
        login(pg, args.base)

        pg.goto(f"{args.base}/content-studio")
        pg.wait_for_load_state("networkidle")
        links = pg.eval_on_selector_all(
            'a[href*="/content-studio/images/"]',
            "els => els.map(e => e.getAttribute('href'))",
        )
        design = next(
            (h for h in links if h.rstrip("/").split("/")[-1].isdigit()), None
        )

        print("\nNo screen clips its own content at 390px")
        routes = [("/content-studio", "hub")]
        if design:
            routes.append((design, "designer"))
        for route, name in routes:
            pg.goto(f"{args.base}{route}")
            pg.wait_for_load_state("networkidle")
            pg.wait_for_timeout(1200)
            width = pg.evaluate("document.documentElement.scrollWidth")
            check(width <= PHONE["width"] + 2, f"{name}: no horizontal page scroll ({width}px)")
            clipped = pg.evaluate(CLIPPED_JS)
            check(not clipped, f"{name}: nothing clipped" + (f" -- {clipped}" if clipped else ""))

        print("\nThe mobile drawer behaves like a dialog")
        pg.goto(f"{args.base}/content-studio")
        pg.wait_for_load_state("networkidle")
        pg.wait_for_timeout(600)
        ham = pg.query_selector(".app-hamburger")
        box = ham.bounding_box()
        check(
            box["width"] >= 44 and box["height"] >= 44,
            f"the hamburger is a 44px target ({round(box['width'])}x{round(box['height'])})",
        )
        check(ham.get_attribute("aria-expanded") == "false", "aria-expanded is false when closed")

        ham.click()
        pg.wait_for_timeout(400)
        check(
            pg.query_selector(".app-hamburger").get_attribute("aria-expanded") == "true",
            "aria-expanded is true when open",
        )
        check(
            pg.eval_on_selector(".app-sidebar", "e => e.getAttribute('role')") == "dialog",
            "the drawer announces itself as a dialog",
        )
        check(
            pg.evaluate("document.activeElement.classList.contains('app-sidebar')"),
            "focus moves into the drawer on open",
        )
        check(
            pg.evaluate("getComputedStyle(document.body).overflow") == "hidden",
            "the page behind the drawer cannot scroll",
        )
        for _ in range(40):
            pg.keyboard.press("Tab")
        check(
            pg.evaluate("!!document.activeElement.closest('.app-sidebar')"),
            "Tab stays inside the drawer after 40 presses",
        )
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(400)
        check(
            pg.eval_on_selector(".app-sidebar", "e => e.getAttribute('role')") is None,
            "Escape closes the drawer",
        )
        check(
            pg.evaluate("document.activeElement.classList.contains('app-hamburger')"),
            "focus returns to the hamburger it was opened from",
        )
        check(
            pg.evaluate("getComputedStyle(document.body).overflow") != "hidden",
            "body scroll is restored",
        )
        browser.close()

    print(f"\n{'FAILED: ' + str(len(failures)) if failures else 'All checks passed'}")
    for f in failures:
        print("  - " + f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
