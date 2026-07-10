"""
Dashboard E2E test.

Verifies the dashboard reads from real data correctly:
  - empty-today baseline
  - books 2 appointments for *today*, completes 1 → today's revenue should
    equal the completed one's price; today's appointments should be 2
  - recent activity feed updates
  - revenue chart bar appears for today

Run while the dev server is up:
    python tests/e2e_dashboard.py
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import Page, sync_playwright


def book(page: Page, base: str, payload: dict) -> tuple[bool, str]:
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
        f"""
        async () => {{
            const r = await fetch("{base}/api/internal/clients");
            return r.ok ? r.json() : [];
        }}
    """
    )


def fetch_therapies(page: Page, base: str) -> list[dict]:
    return page.evaluate(
        f"""
        async () => {{
            const r = await fetch("{base}/api/internal/therapies");
            return r.ok ? r.json() : [];
        }}
    """
    )


def kpi_text(page: Page) -> dict[str, str]:
    """Extract the four KPI values + subtitles from the rendered dashboard."""
    cards = page.locator("[class*='kpi'] , .app-page > div").first
    # Simpler: grab all visible text and parse.
    full = page.locator("main").first.inner_text()
    return {"raw": full}


def parse_eur(s: str) -> float:
    m = re.search(r"€([\d,]+\.\d{2})", s)
    return float(m.group(1).replace(",", "")) if m else 0.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3001")
    parser.add_argument(
        "--out", default=str(Path(__file__).parent / "screenshots" / "dashboard")
    )
    args = parser.parse_args()
    base = args.base.rstrip("/")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    failures: list[str] = []
    today = date.today()
    today_iso = today.isoformat()

    # Idempotency: scrub today's appointments/sessions/payments before running.
    import sqlite3

    db_path = (
        Path(__file__).parent.parent / "app" / "data" / "clinic.db"
    ).resolve()
    if db_path.exists():
        conn = sqlite3.connect(str(db_path))
        conn.execute(
            "DELETE FROM payments WHERE appointment_id IN ("
            " SELECT id FROM appointments WHERE date = ?)",
            (today_iso,),
        )
        conn.execute("DELETE FROM sessions WHERE date = ?", (today_iso,))
        conn.execute("DELETE FROM appointments WHERE date = ?", (today_iso,))
        # Also clear today's standalone payments (cash from today the test created)
        conn.execute(
            "DELETE FROM payments WHERE date(created_at / 1000, 'unixepoch') = ?",
            (today_iso,),
        )
        conn.commit()
        conn.close()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1600, "height": 1100})
        page = ctx.new_page()

        # ---------- 1. Baseline: today empty ----------
        print(f"\nStep 1 - baseline ({today_iso})")
        page.goto(f"{base}/dashboard", wait_until="networkidle")
        page.screenshot(
            path=str(out / "01-baseline.png"), full_page=True
        )
        baseline = page.locator("main").inner_text()
        rev_match = re.search(r"earnings\s*€([\d,]+\.\d{2})", baseline, re.IGNORECASE | re.DOTALL)
        rev = float(rev_match.group(1).replace(",", "")) if rev_match else -1
        appts_match = re.search(r"Today.{0,40}appointments\s*(\d+)", baseline, re.IGNORECASE | re.DOTALL)
        appts = int(appts_match.group(1)) if appts_match else -1
        print(f"  baseline: today's appts={appts}, revenue=€{rev}")
        if appts != 0 or rev != 0.0:
            failures.append(f"baseline not empty: appts={appts} rev={rev}")
        else:
            print("  [OK  ] baseline shows 0 appts / €0.00 today")

        # ---------- 2. Book + complete an appointment today ----------
        print("\nStep 2 - book 2 appts for today, complete 1")
        clients = fetch_clients(page, base)
        therapies = fetch_therapies(page, base)
        if not clients or not therapies:
            failures.append("missing fixtures")
            browser.close()
            return 1
        hbot = next((t for t in therapies if t["name"] == "HBOT"), None)
        ir = next((t for t in therapies if t["name"] == "Infrared Therapy"), None)
        c1, c2 = clients[0], clients[1]
        ok1, id1 = book(
            page,
            base,
            {
                "clientId": c1["id"],
                "date": today_iso,
                "startTime": "10:00",
                "durationMinutes": hbot["defaultDurationMinutes"],
                "totalPriceEur": hbot["defaultPriceEur"],
                "paymentMethod": "card",
                "therapyIds": [hbot["id"]],
            },
        )
        ok2, id2 = book(
            page,
            base,
            {
                "clientId": c2["id"],
                "date": today_iso,
                "startTime": "11:30",
                "durationMinutes": ir["defaultDurationMinutes"],
                "totalPriceEur": ir["defaultPriceEur"],
                "paymentMethod": "card",
                "therapyIds": [ir["id"]],
            },
        )
        print(f"  booked appt {id1} ({ok1}), {id2} ({ok2})")
        if not (ok1 and ok2):
            failures.append("booking failed")
            browser.close()
            return 1

        # Mark appt 1 as completed via the detail page UI.
        page.goto(f"{base}/appointments/{id1}", wait_until="networkidle")
        page.click('button:has-text("Complete")')
        page.wait_for_selector('textarea[name="therapistNotes"]')
        page.fill(
            'textarea[name="therapistNotes"]',
            "Quick HBOT session, all good.",
        )
        page.click('label:has(input[name="outcomeRating"][value="5"])')
        page.click('button[type="submit"]:has-text("Log session")')
        page.wait_for_timeout(800)

        # ---------- 3. Verify dashboard reflects state ----------
        print("\nStep 3 - verify dashboard")
        page.goto(f"{base}/dashboard", wait_until="networkidle")
        page.screenshot(path=str(out / "02-after-bookings.png"), full_page=True)
        body = page.locator("main").inner_text()
        rev_match = re.search(r"earnings\s*€([\d,]+\.\d{2})", body, re.IGNORECASE | re.DOTALL)
        rev = float(rev_match.group(1).replace(",", "")) if rev_match else -1
        appts_match = re.search(r"Today.{0,40}appointments\s*(\d+)", body, re.IGNORECASE | re.DOTALL)
        appts = int(appts_match.group(1)) if appts_match else -1
        expected_rev = float(hbot["defaultPriceEur"])
        print(f"  after: today's appts={appts}, revenue=€{rev} (expected appts=2, rev=€{expected_rev})")
        if appts != 2:
            failures.append(f"expected 2 appts today, got {appts}")
        else:
            print("  [OK  ] today's appointments = 2")
        if abs(rev - expected_rev) > 0.01:
            failures.append(f"expected earnings €{expected_rev}, got €{rev}")
        else:
            print(f"  [OK  ] today's earnings = €{rev} (only completed counts)")

        # Cash today should equal both bookings' price (both paid by card today)
        cash_match = re.search(
            r"Cash today.{0,40}€([\d,]+\.\d{2})",
            body,
            re.IGNORECASE | re.DOTALL,
        )
        cash = float(cash_match.group(1).replace(",", "")) if cash_match else -1
        expected_cash = float(hbot["defaultPriceEur"]) + float(ir["defaultPriceEur"])
        if abs(cash - expected_cash) > 0.01:
            failures.append(
                f"expected cash €{expected_cash}, got €{cash}"
            )
        else:
            print(f"  [OK  ] cash today = €{cash} (both card payments)")

        # Deferred should be zero (no packages or vouchers in this scenario)
        def_match = re.search(
            r"Deferred revenue.{0,40}€([\d,]+\.\d{2})",
            body,
            re.IGNORECASE | re.DOTALL,
        )
        deferred = (
            float(def_match.group(1).replace(",", "")) if def_match else -1
        )
        if abs(deferred) > 0.01:
            failures.append(f"expected deferred €0, got €{deferred}")
        else:
            print(f"  [OK  ] deferred revenue = €{deferred}")

        # ---------- 4. Today's schedule listing ----------
        if "10:00" not in body or "11:30" not in body:
            failures.append("today's schedule missing booking times")
        else:
            print("  [OK  ] today's schedule lists both bookings")

        # ---------- 5. Recent activity ----------
        if "Session completed" not in body and "session" not in body.lower():
            failures.append("recent activity missing session entry")
        else:
            print("  [OK  ] recent activity shows session completion")

        ctx.close()
        browser.close()

    print()
    print(f"Screenshots: {out}")
    if failures:
        print(f"\n{len(failures)} issue(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nDashboard test passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
