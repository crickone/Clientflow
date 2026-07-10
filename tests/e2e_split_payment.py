"""
End-to-end test of split-payment voucher redemption.

Walks through the case where a voucher's remaining balance is *less than* the
session price, so the operator has to top up by card / cash:

  1. Cleans previous state.
  2. Seeds a €40 voucher.
  3. Hits the booking API for a €65 Infrared session WITHOUT a secondary
     method -> expect 400 with the split-payment instruction.
  4. Hits the API again WITH secondaryPaymentMethod=card -> expect 200.
  5. Verifies the DB:
       - voucher balance now €0, is_redeemed=1
       - two payment rows tied to the appointment:
           * €40 via 'voucher'
           * €25 via 'card'
  6. Captures the booking-form UI showing the split picker for visual proof.

Run while the dev server is up:
    python tests/e2e_split_payment.py
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CODE = "RCH-SPLIT"
VOUCHER_VALUE = 40.0
SESSION_PRICE = 65.0
DB_PATH = (Path(__file__).parent.parent / "app" / "data" / "clinic.db").resolve()


def post_form(base: str, body: str) -> tuple[int, dict]:
    req = Request(
        f"{base}/api/appointments",
        data=body.encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urlopen(req) as r:
            return r.status, json.loads(r.read())
    except HTTPError as e:
        return e.code, json.loads(e.read())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3001")
    parser.add_argument(
        "--out",
        default=str(Path(__file__).parent / "screenshots" / "split"),
    )
    args = parser.parse_args()
    base = args.base.rstrip("/")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    failures: list[str] = []
    today = date.today()
    # Pick a non-Sunday weekday for booking
    target = today + timedelta(days=1)
    while target.weekday() == 6:
        target = target + timedelta(days=1)

    # ---------- 1. Cleanup + seed ----------
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute(
        "DELETE FROM payments WHERE voucher_id IN ("
        " SELECT id FROM gift_vouchers WHERE code = ?)",
        (CODE,),
    )
    conn.execute(
        "DELETE FROM appointments WHERE id IN ("
        " SELECT appointment_id FROM payments WHERE voucher_id IN ("
        "  SELECT id FROM gift_vouchers WHERE code = ?))",
        (CODE,),
    )
    conn.execute("DELETE FROM gift_vouchers WHERE code = ?", (CODE,))
    conn.execute(
        "DELETE FROM appointments WHERE date = ? AND start_time = ?",
        (target.isoformat(), "16:00"),
    )
    conn.commit()

    expiry = (today + timedelta(days=180)).isoformat()
    conn.execute(
        """INSERT INTO gift_vouchers
           (code, purchaser_name, recipient_name, value_eur, balance_eur,
            is_redeemed, purchase_date, expiry_date)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)""",
        (
            CODE,
            "Split Tester",
            "Niamh Walsh",
            VOUCHER_VALUE,
            VOUCHER_VALUE,
            today.isoformat(),
            expiry,
        ),
    )
    conn.commit()
    voucher_id = conn.execute(
        "SELECT id FROM gift_vouchers WHERE code = ?", (CODE,)
    ).fetchone()[0]
    client_id = conn.execute(
        "SELECT id FROM clients ORDER BY id LIMIT 1"
    ).fetchone()[0]
    ir_id = conn.execute(
        "SELECT id FROM therapies WHERE name = 'Infrared Therapy'"
    ).fetchone()[0]
    conn.close()
    print(
        f"seeded voucher #{voucher_id} ({CODE}) at €{VOUCHER_VALUE} balance"
    )

    # ---------- 2. Booking without secondary method => refused ----------
    print("\nStep 2 - booking without secondary method (should refuse)")
    body = (
        f"clientId={client_id}&date={target.isoformat()}&startTime=16:00"
        f"&durationMinutes=15&totalPriceEur={SESSION_PRICE}"
        f"&paymentMethod=voucher&voucherCode={CODE}"
        f"&therapyIds={ir_id}"
    )
    status, data = post_form(base, body)
    if status == 400 and "remainder" in (data.get("error") or "").lower():
        print(f"  [OK  ] refused: {data['error']}")
    else:
        failures.append(
            f"expected 400 with remainder hint, got {status} {data}"
        )
        print(f"  [FAIL] got {status}: {data}")

    # voucher balance should be unchanged
    conn = sqlite3.connect(str(DB_PATH))
    bal = conn.execute(
        "SELECT balance_eur FROM gift_vouchers WHERE code = ?",
        (CODE,),
    ).fetchone()[0]
    conn.close()
    if abs(bal - VOUCHER_VALUE) > 0.01:
        failures.append(f"balance changed unexpectedly to €{bal}")
    else:
        print("  [OK  ] balance unchanged at €40.00")

    # ---------- 3. Booking with secondary method => succeeds ----------
    print("\nStep 3 - booking with secondaryPaymentMethod=card (should succeed)")
    body_with_secondary = body + "&secondaryPaymentMethod=card"
    status, data = post_form(base, body_with_secondary)
    if status == 200 and data.get("ok"):
        appt_id = data["id"]
        print(f"  [OK  ] booked appointment #{appt_id}")
    else:
        failures.append(f"split booking failed: {status} {data}")
        print(f"  [FAIL] {status}: {data}")
        return 1

    # ---------- 4. Verify state ----------
    print("\nStep 4 - verify voucher + payments")
    conn = sqlite3.connect(str(DB_PATH))
    v = conn.execute(
        "SELECT balance_eur, is_redeemed FROM gift_vouchers WHERE code = ?",
        (CODE,),
    ).fetchone()
    print(f"  voucher: balance €{v[0]:.2f}, is_redeemed={v[1]}")
    if abs(v[0]) > 0.01 or v[1] != 1:
        failures.append(f"expected balance 0 + redeemed=1, got {v}")
    else:
        print("  [OK  ] voucher exhausted to €0 and marked redeemed")

    pays = conn.execute(
        "SELECT amount_eur, payment_method, voucher_id, notes "
        "FROM payments WHERE appointment_id = ? ORDER BY id",
        (appt_id,),
    ).fetchall()
    print(f"  payments ({len(pays)} rows):")
    for p in pays:
        print(
            f"    €{p[0]:.2f} via {p[1]}"
            + (f" (voucher #{p[2]})" if p[2] else "")
            + (f" — {p[3]}" if p[3] else "")
        )
    conn.close()

    if len(pays) != 2:
        failures.append(f"expected 2 payment rows, got {len(pays)}")
    else:
        v_row = next((r for r in pays if r[1] == "voucher"), None)
        c_row = next((r for r in pays if r[1] == "card"), None)
        if not v_row or abs(v_row[0] - VOUCHER_VALUE) > 0.01:
            failures.append(f"voucher payment row wrong: {v_row}")
        else:
            print(f"  [OK  ] €{VOUCHER_VALUE:.2f} voucher row recorded")
        if not c_row or abs(c_row[0] - (SESSION_PRICE - VOUCHER_VALUE)) > 0.01:
            failures.append(f"card top-up row wrong: {c_row}")
        else:
            print(
                f"  [OK  ] €{SESSION_PRICE - VOUCHER_VALUE:.2f} card "
                "top-up row recorded"
            )
        if c_row and c_row[3] and "Top-up" in c_row[3]:
            print("  [OK  ] top-up note present for audit trail")
        else:
            failures.append("card row missing 'Top-up' note")

    # ---------- 5. UI screenshot of split picker ----------
    print("\nStep 5 - UI screenshot of split-payment picker")
    # Reset voucher so the form will re-show the picker with €40 balance
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute(
        "UPDATE gift_vouchers SET balance_eur = ?, is_redeemed = 0 "
        "WHERE code = ?",
        (VOUCHER_VALUE, CODE),
    )
    conn.commit()
    conn.close()

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1300})
        try:
            page.goto(
                f"{base}/appointments/new?voucher={CODE}",
                wait_until="networkidle",
            )
            page.wait_for_selector('text="Voucher details"', timeout=20_000)
            page.click('div[role="tablist"] button:has-text("Existing")')
            page.wait_for_timeout(200)
            page.fill('input[placeholder*="Search client"]', "Aoife")
            page.wait_for_timeout(200)
            page.click('button:has-text("Aoife Murphy")')
            page.click('button:has-text("Infrared Therapy")')
            # Wait for split picker to render after voucher API resolves
            page.wait_for_selector("text=Split payment", timeout=10_000)
            page.screenshot(
                path=str(out / "split-picker.png"), full_page=True
            )
            print("  [OK  ] split picker rendered + captured")
        except Exception as exc:  # noqa: BLE001
            failures.append(f"UI capture failed: {exc}")
            page.screenshot(
                path=str(out / "split-picker-error.png"), full_page=True
            )
        browser.close()

    print()
    print(f"Screenshots: {out}")
    if failures:
        print(f"\n{len(failures)} issue(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nSplit-payment test passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
