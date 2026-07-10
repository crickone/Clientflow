"""
Extract per-pane HTML blobs and chart data from OHR_HBOT_Ad_Library_Full_Report.html
into JSON files the Next.js app can consume via dangerouslySetInnerHTML + Chart.js.

Strategy: keep the original heavily-styled inline markup as a string per pane.
This preserves exact visual fidelity. The Next.js components render the blobs
and rebuild the show/filter behaviours in React + refs.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "OHR_HBOT_Ad_Library_Full_Report.html"
OUT = ROOT / "app" / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

html = SRC.read_text(encoding="utf-8")


def extract_inner(open_tag_pattern: str) -> str:
    """Return the inner HTML of the first <div ...> matching open_tag_pattern,
    by walking forward and balancing div tags."""
    m = re.search(open_tag_pattern, html)
    if not m:
        raise ValueError(f"No match for {open_tag_pattern}")
    start = m.end()
    depth = 1
    i = start
    div_re = re.compile(r"</?div\b", re.IGNORECASE)
    while i < len(html):
        n = div_re.search(html, i)
        if not n:
            raise ValueError(f"Unbalanced div for {open_tag_pattern}")
        token = html[n.start():n.end()]
        if token.lower().startswith("</"):
            depth -= 1
            if depth == 0:
                return html[start:n.start()]
            i = n.end()
        else:
            full = html[n.start():html.index(">", n.start()) + 1]
            if not full.endswith("/>"):
                depth += 1
            i = html.index(">", n.start()) + 1
    raise ValueError(f"Unterminated div for {open_tag_pattern}")


def grab_pane(pane_id: str) -> str:
    return extract_inner(rf'<div id="{re.escape(pane_id)}"[^>]*>')


# Per-therapy pane lists
PANES = {
    "hbot": [
        ("overview", "overview"),
        ("all-ads", "all-ads"),
        ("advertisers", "advertisers"),
        ("hooks", "hooks"),
        ("longevity", "longevity"),
        ("strategy", "strategy"),
        ("scripts", "scripts"),
    ],
    "ir": [
        ("overview", "ir-overview"),
        ("all-ads", "ir-all-ads"),
        ("advertisers", "ir-advertisers"),
        ("hooks", "ir-hooks"),
        ("longevity", "ir-longevity"),
        ("scripts", "ir-scripts"),
    ],
    "pemf": [
        ("overview", "pemf-overview"),
        ("all-ads", "pemf-all-ads"),
        ("advertisers", "pemf-advertisers"),
        ("hooks", "pemf-hooks"),
        ("longevity", "pemf-longevity"),
        ("strategy", "pemf-strategy"),
        ("scripts", "pemf-scripts"),
    ],
}

THERAPY_META = {
    "hbot": {
        "id": "hbot",
        "label": "HBOT",
        "icon": "🫁",
        "fullName": "Hyperbaric Oxygen Therapy",
        "accent": "#58a6ff",
        "accentBg": "#1c3a5c",
        "totalAds": 162,
        "advertisers": 44,
        "scripts": 30,
        "subtitle": "Hyperbaric Oxygen Therapy · 162 ads · 44 advertisers · Generated 08 May 2026",
        "tabs": [
            {"id": "overview", "label": "Overview"},
            {"id": "all-ads", "label": "All 162 Ads"},
            {"id": "advertisers", "label": "Advertisers"},
            {"id": "hooks", "label": "Hooks & Copy"},
            {"id": "longevity", "label": "Longevity Ranking"},
            {"id": "strategy", "label": "OHR Strategy"},
            {"id": "scripts", "label": "✏ OHR Ad Copy (30)"},
        ],
        "charts": {
            "format": {
                "type": "doughnut",
                "labels": ["DCO", "VIDEO", "CAROUSEL"],
                "data": [27, 108, 27],
            },
            "advertisers": {
                "type": "bar",
                "labels": [
                    "OxyHealthCare",
                    "Elements Health & Wellness Hub",
                    "The Oxygen Temple",
                    "Livbetter",
                    "Hyperbaric Oxygen Therapy-UK",
                    "Cotswold Hyperbarics & Wellness",
                    "VitalTherapy Wellness",
                    "Oakwood Wellbeing",
                    "Shropshire floats",
                    "X-CELLr8",
                ],
                "data": [75, 10, 7, 7, 4, 4, 4, 3, 3, 2],
                "color": "#2ed8c3",
            },
        },
    },
    "ir": {
        "id": "ir",
        "label": "Infrared Therapy",
        "icon": "🔴",
        "fullName": "Infrared Therapy",
        "accent": "#f0883e",
        "accentBg": "#3a1c0d",
        "totalAds": 716,
        "advertisers": 106,
        "scripts": 100,
        "subtitle": "Infrared · 716 ads · 106 advertisers",
        "tabs": [
            {"id": "overview", "label": "Overview"},
            {"id": "all-ads", "label": "All 716 Ads"},
            {"id": "advertisers", "label": "Advertisers"},
            {"id": "hooks", "label": "Hooks & Copy"},
            {"id": "longevity", "label": "Longevity"},
            {"id": "scripts", "label": "✏ Ad Copy (100)"},
        ],
        "charts": {
            "format": {
                "type": "doughnut",
                "labels": ["DCO", "VIDEO", "CAROUSEL"],
                "data": [206, 221, 289],
            },
            "advertisers": {
                "type": "bar",
                "labels": [
                    "Dr. Claire Williams",
                    "Dr. Olivia Bennett",
                    "Pavra",
                    "Megelin",
                    "VCare",
                    "Megelin Global",
                    "HealRay",
                    "Maysama",
                    "Helios",
                    "RougeCare",
                ],
                "data": [100, 95, 40, 34, 28, 24, 19, 17, 16, 15],
                "color": "#f0883e",
            },
        },
    },
    "pemf": {
        "id": "pemf",
        "label": "PEMF Therapy",
        "icon": "⚡",
        "fullName": "Pulsed Electromagnetic Field Therapy",
        "accent": "#a855f7",
        "accentBg": "#1c0a33",
        "totalAds": 93,
        "advertisers": 18,
        "scripts": 93,
        "subtitle": "PEMF · 93 ads · 18 advertisers",
        "tabs": [
            {"id": "overview", "label": "Overview"},
            {"id": "all-ads", "label": "All 93 Ads"},
            {"id": "advertisers", "label": "Advertisers"},
            {"id": "hooks", "label": "Hooks & Copy"},
            {"id": "longevity", "label": "Longevity Ranking"},
            {"id": "strategy", "label": "OHR Strategy"},
            {"id": "scripts", "label": "✏ Ad Copy (93)"},
        ],
        "charts": None,
    },
}


def main() -> None:
    for therapy, panes in PANES.items():
        meta = THERAPY_META[therapy]
        out_panes = {}
        for slug, pane_id in panes:
            inner = grab_pane(pane_id).strip()
            out_panes[slug] = inner
        payload = {**meta, "panes": out_panes}
        target = OUT / f"{therapy}.json"
        target.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        size_kb = target.stat().st_size / 1024
        print(f"  wrote {target.relative_to(ROOT)}  ({size_kb:.1f} KB)")

    index = {
        "therapies": [
            {
                "id": meta["id"],
                "label": meta["label"],
                "icon": meta["icon"],
                "accent": meta["accent"],
                "accentBg": meta["accentBg"],
                "totalAds": meta["totalAds"],
                "advertisers": meta["advertisers"],
                "scripts": meta["scripts"],
            }
            for meta in THERAPY_META.values()
        ],
    }
    (OUT / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  wrote app/public/data/index.json")


if __name__ == "__main__":
    main()
