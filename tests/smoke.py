"""
Smoke-test every route in the Renova clinic system. For each route:
  - capture a full-page screenshot
  - record any console errors / page errors
  - check the response status

Run while the dev server is up:
    python tests/smoke.py

Optionally point at a different host:
    python tests/smoke.py --base http://localhost:3000
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


ROUTES = [
    ("/dashboard", "dashboard"),
    ("/clients", "clients"),
    ("/clients/new", "clients-new"),
    ("/appointments", "appointments"),
    ("/appointments/new", "appointments-new"),
    ("/packages", "packages"),
    ("/packages/new", "packages-new"),
    ("/vouchers", "vouchers"),
    ("/vouchers/new", "vouchers-new"),
    ("/reports", "reports"),
    ("/marketing/hbot/", "marketing-hbot"),
    ("/marketing/ir/", "marketing-ir"),
    ("/marketing/pemf/", "marketing-pemf"),
    ("/settings", "settings"),
    ("/settings/therapies", "settings-therapies"),
    ("/settings/schedule", "settings-schedule"),
    ("/settings/blocks", "settings-blocks"),
    ("/settings/inbox-ai", "settings-inbox-ai"),
    ("/communication", "communication"),
    ("/content-studio/videos", "content-studio-videos"),
    ("/content-studio/videos/1", "content-studio-video-editor"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3001")
    parser.add_argument(
        "--out",
        default=str(Path(__file__).parent / "screenshots"),
    )
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    failures: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})

        for route, slug in ROUTES:
            page = ctx.new_page()
            console_errors: list[str] = []
            page_errors: list[str] = []
            def on_console(msg, errs=console_errors):
                if msg.type not in ("error", "warning"):
                    return
                # recharts emits a transient measurement warning while its
                # ResponsiveContainer settles on a parent size. It does not
                # affect the rendered chart, so filter it out.
                if "should be greater than 0" in msg.text:
                    return
                errs.append(f"{msg.type}: {msg.text}")

            page.on("console", on_console)
            page.on(
                "pageerror",
                lambda err, errs=page_errors: errs.append(str(err)),
            )

            url = args.base.rstrip("/") + route
            t0 = time.time()
            try:
                resp = page.goto(url, wait_until="networkidle", timeout=30_000)
                ok = resp is not None and resp.ok
                code = resp.status if resp else "?"
            except Exception as exc:  # noqa: BLE001
                print(f"  [{slug}] navigation failed: {exc}")
                failures.append(slug)
                page.close()
                continue
            dt = (time.time() - t0) * 1000

            shot = out / f"{slug}.png"
            page.screenshot(path=str(shot), full_page=True)

            issues = []
            if not ok:
                issues.append(f"http={code}")
            if page_errors:
                issues.append(f"page-errors={len(page_errors)}")
            if console_errors:
                issues.append(f"console-errors={len(console_errors)}")

            tag = "FAIL" if issues else "OK  "
            print(f"  [{tag}] {route:32s}  {code}  {dt:6.0f}ms  {','.join(issues)}")
            if console_errors:
                for e in console_errors[:5]:
                    print(f"           console > {e}")
            if page_errors:
                for e in page_errors[:5]:
                    print(f"           page    > {e}")
            if issues:
                failures.append(slug)
            page.close()

        ctx.close()
        browser.close()

    print()
    print(f"Screenshots: {out}")
    if failures:
        print(f"\n{len(failures)} route(s) had issues: {', '.join(failures)}")
        return 1
    print("\nAll routes returned 200 with no errors.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
