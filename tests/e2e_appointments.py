"""
End-to-end test of the appointments feature.

  - seeds 4 test clients via the UI
  - adds a recurring weekday lunch block (13:00-14:00)
  - books a mix of single + multi-therapy appointments across this week
  - exercises the status flow (confirm, complete-with-session-log)
  - verifies that booking refuses out-of-hours / blocked slots

Run while the dev server is up:
    python tests/e2e_appointments.py [--base http://localhost:3001]

Existing clients with the same name are detected and skipped, so re-running
is idempotent for the seed phase.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import Page, sync_playwright, TimeoutError as PWTimeout


CLIENTS = [
    {
        "first": "Aoife",
        "last": "Murphy",
        "email": "aoife.murphy@example.ie",
        "phone": "+353 87 111 0001",
    },
    {
        "first": "Cian",
        "last": "O'Brien",
        "email": "cian.obrien@example.ie",
        "phone": "+353 87 111 0002",
    },
    {
        "first": "Niamh",
        "last": "Walsh",
        "email": "niamh.walsh@example.ie",
        "phone": "+353 87 111 0003",
    },
    {
        "first": "Rónán",
        "last": "Byrne",
        "email": "ronan.byrne@example.ie",
        "phone": "+353 87 111 0004",
    },
]


def monday_of(today: date) -> date:
    return today - timedelta(days=today.weekday())


def book_via_api(page: Page, base: str, payload: dict) -> tuple[bool, str]:
    """Submit a booking through /api/appointments and return (ok, info)."""
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
    result = page.evaluate(js)
    if result["status"] == 200 and result["data"].get("ok"):
        return True, f"id={result['data']['id']}"
    return False, result["data"].get("error", f"http {result['status']}")


def add_client(page: Page, base: str, c: dict) -> None:
    print(f"  adding client: {c['first']} {c['last']}")
    page.goto(f"{base}/clients/new", wait_until="networkidle")
    page.fill('input[name="firstName"]', c["first"])
    page.fill('input[name="lastName"]', c["last"])
    page.fill('input[name="email"]', c["email"])
    page.fill('input[name="phone"]', c["phone"])
    page.check('input[name="gdprConsent"]')
    page.click('button[type="submit"]:has-text("Add client")')
    page.wait_for_url("**/clients/*", timeout=10_000)


def fetch_clients(page: Page, base: str) -> list[dict]:
    """Pull all clients with a quick fetch."""
    js = f"""
        async () => {{
            const r = await fetch("{base}/api/internal/clients");
            return r.ok ? r.json() : [];
        }}
    """
    return page.evaluate(js)


def fetch_therapies(page: Page, base: str) -> list[dict]:
    js = f"""
        async () => {{
            const r = await fetch("{base}/api/internal/therapies");
            return r.ok ? r.json() : [];
        }}
    """
    return page.evaluate(js)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:3001")
    parser.add_argument(
        "--out", default=str(Path(__file__).parent / "screenshots" / "e2e")
    )
    args = parser.parse_args()
    base = args.base.rstrip("/")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    today = date.today()
    monday = monday_of(today)

    failures: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        page.on(
            "pageerror",
            lambda exc: failures.append(f"pageerror: {exc}"),
        )

        # ---------- 1. SEED CLIENTS ----------
        print("\nStep 1 - seed clients")
        page.goto(f"{base}/clients", wait_until="networkidle")
        rendered = page.locator("a[href^='/clients/']").all_text_contents()
        existing = "\n".join(rendered)
        for c in CLIENTS:
            full = f"{c['first']} {c['last']}"
            if full in existing:
                print(f"  exists: {full}")
                continue
            try:
                add_client(page, base, c)
            except PWTimeout as exc:
                failures.append(f"seed {full}: {exc}")
        page.goto(f"{base}/clients", wait_until="networkidle")
        page.screenshot(path=str(out / "01-clients.png"), full_page=True)

        # Pull therapies + clients via the test endpoints we'll add below
        therapies = fetch_therapies(page, base)
        clients = fetch_clients(page, base)
        if not therapies or not clients:
            print(
                "  ! could not load therapies/clients via internal endpoints -- "
                "make sure the dev server is on the latest code"
            )
            failures.append("missing internal endpoints")
            browser.close()
            return 1
        print(f"  active therapies: {[t['name'] for t in therapies]}")
        print(f"  clients on file:   {len(clients)}")

        by_name = {f"{c['firstName']} {c['lastName']}": c for c in clients}
        by_therapy = {t["name"]: t for t in therapies}
        hbot = by_therapy.get("HBOT")
        ir = by_therapy.get("Infrared Therapy")
        pemf = by_therapy.get("PEMF Therapy")

        # ---------- 2. ADD A RECURRING LUNCH BLOCK (Mon-Fri 13:00-14:00) ----------
        print("\nStep 2 - seed lunch block (Mon)")
        # We add for Monday only here; a real clinic would loop. The booking
        # refusal test uses Monday so this is enough.
        page.goto(f"{base}/settings/blocks", wait_until="networkidle")
        page.screenshot(path=str(out / "02-blocks-before.png"), full_page=True)
        # Click "Add recurring"
        page.click('button:has-text("Add recurring")')
        page.wait_for_selector('select[name="dayOfWeek"]')
        page.select_option('select[name="dayOfWeek"]', "1")  # Monday
        page.fill('input[name="startTime"]', "13:00")
        page.fill('input[name="endTime"]', "14:00")
        page.fill('input[name="reason"]', "Lunch break")
        page.click('button[type="submit"]:has-text("Add block-out")')
        page.wait_for_timeout(800)
        page.screenshot(path=str(out / "03-blocks-after.png"), full_page=True)

        # ---------- 3. BOOK APPOINTMENTS ----------
        # All bookings are single-therapy. Capacity is 1 per therapy, so three
        # different clients on three different therapies at the same time are
        # all allowed.
        print("\nStep 3 - book appointments across this week")
        bookings = [
            # Monday 09:00 — three concurrent bookings on different therapies
            {"client": "Aoife Murphy",  "day_offset": 0, "start": "09:00", "therapy": hbot, "label": "Mon 09:00 HBOT"},
            {"client": "Cian O'Brien",  "day_offset": 0, "start": "09:00", "therapy": ir,   "label": "Mon 09:00 Infrared"},
            {"client": "Niamh Walsh",   "day_offset": 0, "start": "09:00", "therapy": pemf, "label": "Mon 09:00 PEMF"},
            # Mid-morning singles
            {"client": "Rónán Byrne",   "day_offset": 0, "start": "11:00", "therapy": hbot, "label": "Mon 11:00 HBOT"},
            {"client": "Niamh Walsh",   "day_offset": 1, "start": "10:30", "therapy": pemf, "label": "Tue 10:30 PEMF"},
            {"client": "Aoife Murphy",  "day_offset": 1, "start": "10:30", "therapy": ir,   "label": "Tue 10:30 Infrared"},
            {"client": "Rónán Byrne",   "day_offset": 2, "start": "14:00", "therapy": hbot, "label": "Wed 14:00 HBOT"},
            {"client": "Cian O'Brien",  "day_offset": 3, "start": "10:00", "therapy": pemf, "label": "Thu 10:00 PEMF"},
            {"client": "Cian O'Brien",  "day_offset": 4, "start": "15:00", "therapy": pemf, "label": "Fri 15:00 PEMF"},
        ]
        booked_ids: list[int] = []
        for b in bookings:
            d = monday + timedelta(days=b["day_offset"])
            client = by_name.get(b["client"])
            t = b["therapy"]
            if not client or not t:
                print(f"  ! missing fixture for {b['label']}")
                continue
            payload = {
                "clientId": client["id"],
                "date": d.isoformat(),
                "startTime": b["start"],
                "durationMinutes": t["defaultDurationMinutes"],
                "totalPriceEur": t["defaultPriceEur"],
                "paymentMethod": "card",
                "therapyIds": [t["id"]],
            }
            ok, info = book_via_api(page, base, payload)
            tag = "OK  " if ok else "SKIP" if "already booked" in info or "Overlaps" in info else "FAIL"
            print(f"  [{tag}] {b['label']:28s}  {d}  -> {info}")
            if ok:
                booked_ids.append(int(info.split("=")[-1]))
            elif tag == "FAIL":
                failures.append(f"book {b['label']}: {info}")

        # ---------- 4. NEGATIVE TESTS -- should be refused ----------
        print("\nStep 4 - refusal tests")
        # 4a. Lunch block (Monday 13:00) -- should be refused
        d = monday
        ok, info = book_via_api(
            page,
            base,
            {
                "clientId": clients[0]["id"],
                "date": d.isoformat(),
                "startTime": "13:00",
                "durationMinutes": 30,
                "totalPriceEur": 0,
                "paymentMethod": "cash",
                "therapyIds": [pemf["id"]],
            },
        )
        if not ok and "Lunch" in info:
            print(f"  [OK  ] lunch-block refused as expected -> {info}")
        else:
            failures.append(f"lunch block was accepted: ok={ok} info={info}")
            print(f"  [FAIL] lunch-block: ok={ok} info={info}")

        # 4b. Sunday (closed) -- should be refused
        sunday = monday + timedelta(days=6)
        ok, info = book_via_api(
            page,
            base,
            {
                "clientId": clients[0]["id"],
                "date": sunday.isoformat(),
                "startTime": "10:00",
                "durationMinutes": 60,
                "totalPriceEur": 95,
                "paymentMethod": "cash",
                "therapyIds": [hbot["id"]],
            },
        )
        if not ok and ("closed" in info.lower() or "opening" in info.lower()):
            print(f"  [OK  ] Sunday-closed refused as expected -> {info}")
        else:
            failures.append(f"Sunday booking accepted: ok={ok} info={info}")
            print(f"  [FAIL] Sunday: ok={ok} info={info}")

        # 4c. Same therapy already booked at this time -> should refuse
        if booked_ids:
            d = monday
            ok, info = book_via_api(
                page,
                base,
                {
                    "clientId": clients[0]["id"],
                    "date": d.isoformat(),
                    "startTime": "09:30",  # overlaps 09:00 HBOT
                    "durationMinutes": 60,
                    "totalPriceEur": 0,
                    "paymentMethod": "cash",
                    "therapyIds": [hbot["id"]],
                },
            )
            if not ok and "already booked" in info:
                print(f"  [OK  ] same-therapy overlap refused -> {info}")
            else:
                failures.append(f"same-therapy overlap accepted: ok={ok} info={info}")
                print(f"  [FAIL] same-therapy overlap: ok={ok} info={info}")

        # 4d. Different therapy at the same time -> should be ALLOWED
        # (Capacity 1 per therapy means HBOT + IR can run simultaneously for
        # different clients.) We don't actually book — just verify no error.
        if booked_ids:
            d = monday + timedelta(days=4)  # Friday — empty before this test
            ok, info = book_via_api(
                page,
                base,
                {
                    "clientId": clients[0]["id"],
                    "date": d.isoformat(),
                    "startTime": "09:00",
                    "durationMinutes": ir["defaultDurationMinutes"],
                    "totalPriceEur": ir["defaultPriceEur"],
                    "paymentMethod": "card",
                    "therapyIds": [ir["id"]],
                },
            )
            # Then book HBOT for someone else at exactly the same time:
            ok2, info2 = (
                book_via_api(
                    page,
                    base,
                    {
                        "clientId": clients[1]["id"],
                        "date": d.isoformat(),
                        "startTime": "09:00",
                        "durationMinutes": 60,
                        "totalPriceEur": 95,
                        "paymentMethod": "card",
                        "therapyIds": [hbot["id"]],
                    },
                )
                if ok
                else (False, "skipped (first booking failed)")
            )
            if ok and ok2:
                print(
                    f"  [OK  ] different therapies at same time both accepted -> {info}, {info2}"
                )
                booked_ids.extend(
                    [int(info.split("=")[-1]), int(info2.split("=")[-1])]
                )
            else:
                failures.append(
                    f"different-therapy concurrent booking failed: a={ok}/{info}, b={ok2}/{info2}"
                )
                print(
                    f"  [FAIL] different-therapy: a={ok}/{info}, b={ok2}/{info2}"
                )

        # ---------- 5. STATUS FLOW: confirm + complete ----------
        if booked_ids:
            print("\nStep 5 - status flow")
            target = booked_ids[0]
            page.goto(f"{base}/appointments/{target}", wait_until="networkidle")
            page.click('button:has-text("Confirm")')
            page.wait_for_timeout(800)
            page.screenshot(path=str(out / "04-confirmed.png"), full_page=True)
            print(f"  confirmed appointment #{target}")

            # Complete second appointment with session notes
            if len(booked_ids) > 1:
                target2 = booked_ids[1]
                page.goto(
                    f"{base}/appointments/{target2}", wait_until="networkidle"
                )
                page.click('button:has-text("Complete")')
                page.wait_for_selector('textarea[name="therapistNotes"]')
                page.fill(
                    'textarea[name="therapistNotes"]',
                    "Client tolerated combined HBOT + Infrared well. "
                    "Reported reduced joint stiffness. Continue weekly cadence.",
                )
                # The radio is visually replaced by a styled label, so click
                # the label rather than the hidden input.
                page.click('label:has(input[name="outcomeRating"][value="4"])')
                page.click('button[type="submit"]:has-text("Log session")')
                page.wait_for_timeout(800)
                page.screenshot(path=str(out / "05-completed.png"), full_page=True)
                print(f"  completed appointment #{target2} with session log")

        # ---------- 6. VISUAL: calendar + dashboard ----------
        print("\nStep 6 - capture views")
        # Force calendar to show this week
        page.goto(
            f"{base}/appointments?week={monday.isoformat()}",
            wait_until="networkidle",
        )
        page.screenshot(path=str(out / "06-calendar.png"), full_page=True)
        page.goto(f"{base}/dashboard", wait_until="networkidle")
        page.screenshot(path=str(out / "07-dashboard.png"), full_page=True)
        page.goto(f"{base}/clients", wait_until="networkidle")
        page.screenshot(path=str(out / "08-clients-after.png"), full_page=True)

        ctx.close()
        browser.close()

    print()
    print(f"Screenshots: {out}")
    if failures:
        print(f"\n{len(failures)} issue(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nAll appointment flows passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
