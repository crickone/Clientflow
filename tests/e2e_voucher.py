"""
End-to-end voucher partial-redemption test.

Walks through the operator's voucher flow entirely via the UI:
  1. Cleans previous test state so the run is idempotent.
  2. Creates a fresh €100 voucher through /vouchers/new.
  3. Verifies it appears on /vouchers with balance €100 and an Active badge.
  4. Clicks Redeem -> the redemption page shows €100 balance / Ready badge.
  5. Books a €65 Infrared session paid by voucher.
  6. Returns to /vouchers and verifies the balance is now €35 with a Partial
     badge (the voucher is still redeemable).
  7. Books another Infrared session worth €65 (would exceed balance) and
     verifies the API refuses with the balance-shortage message.
  8. Books a custom €35 session that drains the voucher.
  9. Verifies the voucher now shows Redeemed and no Redeem button.

Run while the dev server is up:
    python tests/e2e_voucher.py
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import Page, sync_playwright


CODE = "RCH-E2E-VCHR"
VOUCHER_VALUE = 100.0
DB_PATH = (Path(__file__).parent.parent / "app" / "data" / "clinic.db").resolve()


def clean_voucher(code: str) -> None:
    if not DB_PATH.exists():
        return
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute(
        "DELETE FROM payments WHERE voucher_id IN ("
        " SELECT id FROM gift_vouchers WHERE code = ?)",
        (code,),
    )
    conn.execute(
        "DELETE FROM appointments WHERE id IN ("
        " SELECT appointment_id FROM payments WHERE voucher_id IN ("
        "  SELECT id FROM gift_vouchers WHERE code = ?))",
        (code,),
    )
    conn.execute("DELETE FROM gift_vouchers WHERE code = ?", (code,))
    conn.commit()
    conn.close()


def voucher_balance(code: str) -> tuple[float, int] | None:
    if not DB_PATH.exists():
        return None
    conn = sqlite3.connect(str(DB_PATH))
    row = conn.execute(
        "SELECT balance_eur, is_redeemed FROM gift_vouchers WHERE code = ?",
        (code,),
    ).fetchone()
    conn.close()
    return (float(row[0]), int(row[1])) if row else None


def book_via_api(page: Page, base: str, payload: dict) -> tuple[bool, str]:
    fields = "\n".join(
        f'                form.append("{k}", "{v}");'
        for k, v in payload.items()
        if not isinstance(v, list)
    )
    therapy_lines = "\n".join(
        f'                form.append("therapyIds", "{tid}");'
        for tid in payload.get("therapyIds", [])
    )
    js = f"""
        async () => {{
            const form = new FormData();
{fields}
{therapy_lines}
            const res = await fetch("{base}/api/appointments", {{
                method: "POST",
                body: form,
            }});
            const data = await res.json();
            return {{ status: res.status, data }};
        }}
    """
    r = page.evaluate(js)
    if r["status"] == 200 and r["data"].get("ok"):
        return True, str(r["data"]["id"])
    return False, r["data"].get("error", f"http {r['status']}")


def fetch_clients(page: Page, base: str) -> list[dict]:
    return page.evaluate(
        f"async () => (await fetch('{base}/api/internal/clients')).json()"
    )


def fetch_therapies(page: Page, base: str) -> list[dict]:
    return page.evaluate(
        f"async () => (await fetch('{base}/api/internal/therapies')).json()"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3001")
    parser.add_argument(
        "--out", default=str(Path(__file__).parent / "screenshots" / "voucher")
    )
    args = parser.parse_args()
    base = args.base.rstrip("/")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    failures: list[str] = []
    today = date.today()

    # Idempotency: also wipe today's appointments so overlap detection doesn't
    # block the redemption bookings.
    clean_voucher(CODE)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute(
        "DELETE FROM payments WHERE appointment_id IN ("
        " SELECT id FROM appointments WHERE date = ?)",
        (today.isoformat(),),
    )
    conn.execute("DELETE FROM sessions WHERE date = ?", (today.isoformat(),))
    conn.execute("DELETE FROM appointments WHERE date = ?", (today.isoformat(),))
    conn.commit()
    conn.close()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1700, "height": 1000})
        page = ctx.new_page()
        page.on(
            "pageerror",
            lambda exc: failures.append(f"pageerror: {exc}"),
        )

        # ---------- Step 1: Create voucher via UI ----------
        print("\nStep 1 - create €100 voucher via /vouchers/new")
        page.goto(f"{base}/vouchers/new", wait_until="networkidle")
        page.fill('input[name="purchaserName"]', "E2E Tester")
        page.fill('input[name="purchaserEmail"]', "tester@example.ie")
        page.fill('input[name="recipientName"]', "Niamh Walsh")
        page.fill('input[name="valueEur"]', str(VOUCHER_VALUE))
        # Override the auto-generated code so the test is deterministic.
        # We can't via UI, so we POST through the form then patch the code in DB.
        page.click('button[type="submit"]:has-text("Create voucher")')
        page.wait_for_url("**/vouchers", timeout=10_000)
        # Patch the most recently created voucher's code to our test code.
        conn = sqlite3.connect(str(DB_PATH))
        conn.execute(
            "UPDATE gift_vouchers SET code = ? WHERE id = ("
            " SELECT id FROM gift_vouchers ORDER BY id DESC LIMIT 1)",
            (CODE,),
        )
        conn.commit()
        conn.close()
        print(f"  voucher seeded as {CODE} (€{VOUCHER_VALUE})")

        # ---------- Step 2: Verify the list shows it Active ----------
        print("\nStep 2 - voucher appears Active on /vouchers")
        page.goto(f"{base}/vouchers", wait_until="networkidle")
        page.screenshot(path=str(out / "01-list-fresh.png"), full_page=True)
        row_text = page.locator("tr", has_text=CODE).first.inner_text()
        if "€100.00" not in row_text or "Active" not in row_text:
            failures.append(f"fresh voucher row unexpected: {row_text!r}")
        else:
            print("  [OK  ] balance €100.00 · Active badge")

        # ---------- Step 3: Click Redeem -> book €65 IR ----------
        print("\nStep 3 - click Redeem, book €65 Infrared via voucher")
        page.locator("tr", has_text=CODE).locator(
            "a:has-text('Redeem')"
        ).click()
        page.wait_for_url(f"**/appointments/new?voucher={CODE}", timeout=10_000)
        # Wait for a real element on the redemption page (skip past skeleton)
        page.wait_for_selector('text="Voucher details"', timeout=20_000)
        page.wait_for_timeout(400)
        page.screenshot(path=str(out / "02-redeem-page.png"), full_page=True)
        body = page.locator("main").inner_text()
        if "REDEEM VOUCHER" not in body.upper() or "€100.00" not in body:
            failures.append("redeem page missing voucher details")
        if "Ready to redeem" not in body:
            failures.append("expected Ready badge on first redeem")
        else:
            print("  [OK  ] redeem page shows €100 / Ready")

        # Pick a client + therapy + book via the API (form submit needs a date)
        clients_list = fetch_clients(page, base)
        therapies = fetch_therapies(page, base)
        ir = next(t for t in therapies if t["name"] == "Infrared Therapy")
        c1 = clients_list[0]

        ok1, info1 = book_via_api(
            page,
            base,
            {
                "clientId": c1["id"],
                "date": today.isoformat(),
                "startTime": "10:00",
                "durationMinutes": ir["defaultDurationMinutes"],
                "totalPriceEur": ir["defaultPriceEur"],
                "paymentMethod": "voucher",
                "voucherCode": CODE,
                "therapyIds": [ir["id"]],
            },
        )
        print(f"  1st redeem: ok={ok1} info={info1}")
        if not ok1:
            failures.append(f"first redeem failed: {info1}")

        bal = voucher_balance(CODE)
        print(f"  DB balance after 1st: €{bal[0]:.2f}, redeemed={bal[1]}")
        if abs(bal[0] - 35.0) > 0.01 or bal[1] != 0:
            failures.append(f"expected balance €35 not redeemed, got {bal}")
        else:
            print("  [OK  ] balance dropped to €35, voucher still active")

        # ---------- Step 4: List shows Partial ----------
        print("\nStep 4 - list shows Partial badge")
        page.goto(f"{base}/vouchers", wait_until="networkidle")
        page.screenshot(path=str(out / "03-list-partial.png"), full_page=True)
        row_text = page.locator("tr", has_text=CODE).first.inner_text()
        if "€35.00" not in row_text or "Partial" not in row_text:
            failures.append(f"partial-state row unexpected: {row_text!r}")
        else:
            print("  [OK  ] balance €35.00 · Partial badge")

        # ---------- Step 5: API refuses €65 against €35 balance ----------
        print("\nStep 5 - second €65 attempt should refuse")
        c2 = clients_list[1]
        ok2, info2 = book_via_api(
            page,
            base,
            {
                "clientId": c2["id"],
                "date": today.isoformat(),
                "startTime": "10:30",
                "durationMinutes": ir["defaultDurationMinutes"],
                "totalPriceEur": ir["defaultPriceEur"],
                "paymentMethod": "voucher",
                "voucherCode": CODE,
                "therapyIds": [ir["id"]],
            },
        )
        if not ok2 and "balance" in info2.lower():
            print(f"  [OK  ] refused with: {info2}")
        else:
            failures.append(
                f"expected balance refusal, got ok={ok2} info={info2}"
            )

        bal = voucher_balance(CODE)
        if abs(bal[0] - 35.0) > 0.01:
            failures.append(f"balance changed unexpectedly: €{bal[0]}")
        else:
            print("  [OK  ] balance unchanged at €35")

        # ---------- Step 6: Drain the voucher with €35 manual session ----------
        print("\nStep 6 - drain remaining €35")
        ok3, info3 = book_via_api(
            page,
            base,
            {
                "clientId": c2["id"],
                "date": today.isoformat(),
                "startTime": "10:30",
                "durationMinutes": 15,
                "totalPriceEur": 35.0,
                "paymentMethod": "voucher",
                "voucherCode": CODE,
                "therapyIds": [ir["id"]],
            },
        )
        print(f"  3rd redeem (€35): ok={ok3} info={info3}")
        if not ok3:
            failures.append(f"final redeem failed: {info3}")

        bal = voucher_balance(CODE)
        print(f"  DB balance after drain: €{bal[0]:.2f}, redeemed={bal[1]}")
        if bal[0] > 0.01 or bal[1] != 1:
            failures.append(
                f"expected balance €0 + redeemed=1, got {bal}"
            )
        else:
            print("  [OK  ] balance €0, voucher marked redeemed")

        # ---------- Step 7: List shows Redeemed, no button ----------
        print("\nStep 7 - list shows Redeemed and no Redeem button")
        page.goto(f"{base}/vouchers", wait_until="networkidle")
        page.screenshot(path=str(out / "04-list-redeemed.png"), full_page=True)
        row = page.locator("tr", has_text=CODE).first
        row_text = row.inner_text()
        if "Redeemed" not in row_text or "€0.00" not in row_text:
            failures.append(f"redeemed-state row unexpected: {row_text!r}")
        button_count = row.locator("a:has-text('Redeem')").count()
        if button_count != 0:
            failures.append("Redeem button still showing on exhausted voucher")
        else:
            print("  [OK  ] balance €0.00 · Redeemed · no button")

        ctx.close()
        browser.close()

    print()
    print(f"Screenshots: {out}")
    if failures:
        print(f"\n{len(failures)} issue(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nVoucher partial-redemption test passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
