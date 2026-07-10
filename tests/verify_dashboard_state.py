"""
Read live DB state, compute expected dashboard KPIs, fetch the rendered
dashboard, and assert every value matches.

Run while the dev server is up:
    python tests/verify_dashboard_state.py
"""
from __future__ import annotations

import re
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright


DB_PATH = (Path(__file__).parent.parent / "app" / "data" / "clinic.db").resolve()
BASE = "http://localhost:3001"


def server_today(page) -> str:
    """Use the same date the Node server is using, fetched in the same
    Playwright session — avoids race conditions if midnight ticks between
    the Python query and the dashboard render."""
    return page.evaluate("() => new Date().toISOString().slice(0, 10)")


def expected_kpis(today: str) -> dict:
    today_d = date.fromisoformat(today)
    cutoff = (today_d - timedelta(days=90)).isoformat()
    in30 = (today_d + timedelta(days=30)).isoformat()

    conn = sqlite3.connect(str(DB_PATH))

    todays_appts = conn.execute(
        "SELECT status, total_price_eur FROM appointments WHERE date = ?",
        (today,),
    ).fetchall()
    earnings = sum(
        row[1] for row in todays_appts if row[0] == "completed"
    )
    confirmed = sum(1 for row in todays_appts if row[0] == "confirmed")
    pending = sum(1 for row in todays_appts if row[0] == "scheduled")

    cash = (
        conn.execute(
            "SELECT COALESCE(SUM(amount_eur), 0) FROM payments "
            "WHERE date(created_at/1000, 'unixepoch') = ?",
            (today,),
        ).fetchone()[0]
        or 0
    )

    voucher_deferred = (
        conn.execute(
            "SELECT COALESCE(SUM(balance_eur), 0) FROM gift_vouchers "
            "WHERE is_redeemed = 0 AND expiry_date >= ? AND balance_eur > 0",
            (today,),
        ).fetchone()[0]
        or 0
    )
    pkg_rows = conn.execute(
        "SELECT total_sessions, sessions_used, price_paid_eur "
        "FROM packages WHERE is_active = 1 AND expiry_date >= ? AND sessions_used < total_sessions",
        (today,),
    ).fetchall()
    pkg_deferred = sum(
        (total - used) * (price / total) for total, used, price in pkg_rows
    )

    active_clients = conn.execute(
        "SELECT COUNT(DISTINCT client_id) FROM appointments WHERE date >= ?",
        (cutoff,),
    ).fetchone()[0]

    expiring = conn.execute(
        "SELECT COUNT(*) FROM packages "
        "WHERE is_active = 1 AND expiry_date >= ? AND expiry_date <= ?",
        (today, in30),
    ).fetchone()[0]
    conn.close()

    return {
        "todays_appts": len(todays_appts),
        "confirmed": confirmed,
        "pending": pending,
        "earnings": float(earnings),
        "cash": float(cash),
        "deferred": float(voucher_deferred + pkg_deferred),
        "active_clients": int(active_clients),
        "expiring": int(expiring),
    }


def parse_dashboard(body: str) -> dict:
    """Each KPI renders as LABEL\\n[VALUE]\\nsubtext. Anchor on label, grab
    the next number/EUR from the following ~30 chars."""

    def grab(label_pattern: str, want: str) -> float | int:
        m = re.search(label_pattern, body, re.IGNORECASE)
        if not m:
            return -1
        tail = body[m.end() : m.end() + 60]
        if want == "eur":
            n = re.search(r"€([\d,]+\.\d{2})", tail)
            return float(n.group(1).replace(",", "")) if n else -1
        n = re.search(r"\b(\d+)\b", tail)
        return int(n.group(1)) if n else -1

    return {
        "todays_appts": grab(r"TODAY.{0,5}S APPOINTMENTS", "int"),
        "earnings": grab(r"TODAY.{0,5}S EARNINGS", "eur"),
        "cash": grab(r"CASH TODAY", "eur"),
        "deferred": grab(r"DEFERRED REVENUE", "eur"),
        "active_clients": grab(r"ACTIVE CLIENTS", "int"),
        "expiring": grab(r"PACKAGES EXPIRING", "int"),
    }


def main() -> int:
    failures: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1100})
        page.goto(f"{BASE}/dashboard", wait_until="networkidle")
        page.wait_for_selector("text=Revenue", timeout=15_000)
        page.wait_for_timeout(400)
        today = server_today(page)
        print(f"Server's 'today': {today}")
        expected = expected_kpis(today)
        body = page.locator("main").inner_text()
        page.screenshot(
            path=str(
                Path(__file__).parent / "screenshots" / "dashboard-current.png"
            ),
            full_page=True,
        )
        browser.close()

    print("\nExpected KPIs from live DB:")
    for k, v in expected.items():
        print(f"  {k:18s} {v}")

    actual = parse_dashboard(body)
    print("\nDashboard values:")
    for k, v in actual.items():
        print(f"  {k:18s} {v}")

    print("\nComparison:")
    for k in actual:
        e = expected[k]
        a = actual[k]
        match = (
            abs(e - a) < 0.01 if isinstance(e, float) else e == a
        )
        tag = "OK  " if match else "FAIL"
        print(f"  [{tag}] {k:18s} expected={e}, got={a}")
        if not match:
            failures.append(f"{k}: expected {e}, got {a}")

    if failures:
        print(f"\n{len(failures)} mismatch(es):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nDashboard reflects DB state correctly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
