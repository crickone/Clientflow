# Condition Pillar Pages + Mega Menu — Design

**Date:** 2026-06-07
**Status:** approved (brainstorm)
**Site:** static Renova marketing site (index.html + hbot/infrared/pemf.html), self-contained HTML, dark editorial design, Renova orange.

## Goal
SEO "pillar" pages — one per high-value condition — that explain the condition and how Renova's therapies can help, internally linked to the therapy pages and surfaced through a new **Conditions** mega menu in the navbar.

## Scope (phase 1)
The app's **Top-10 most-common conditions** (from `src/lib/training/content.ts`), each a substantial (~400–700 word) unique page. Expand to the full ~50 later.

| Slug | Condition | Lead therapies | Category |
|------|-----------|----------------|----------|
| post-surgery-recovery | Post-surgery recovery | HBOT, Infrared | Recovery |
| arthritis | Arthritis | Infrared, PEMF (+HBOT) | Pain & joints |
| back-neck-pain | Chronic back & neck pain | PEMF, Infrared | Pain & joints |
| incontinence | Bladder leakage & incontinence | PEMF | Women's health |
| long-covid-fatigue | Long COVID & fatigue | HBOT (+Infrared) | Recovery |
| sleep-fatigue | Sleep & exhaustion | Infrared, PEMF | Sleep & energy |
| psoriasis-eczema | Psoriasis & eczema | Infrared, PEMF (+HBOT) | Skin |
| osteoporosis | Osteoporosis | PEMF | Bone & circulation |
| slow-healing-wounds | Slow-healing wounds | HBOT, Infrared | Recovery |
| brain-fog | Brain fog & memory | HBOT, PEMF | Brain & focus |

## Architecture
- **Generated** from a content data file + a shared template (Node script, same pattern as the therapy pages). Editing happens in the data file; regenerate to rebuild all pages. The template reuses the existing therapy-page chrome (CSS, embedded logo, header, footer, scripts: Lenis, mobile menu, text-anim, reveals) by deriving from `hbot.html`.
- **Root-level slug files** (`arthritis.html`, `incontinence.html`, …) so every internal link is identical site-wide (no `../` path bugs). URLs like `/arthritis.html`.

## Page content model (each pillar page)
1. **Hero** — breadcrumb (Conditions / X), H1 (condition + "in Clonmel"), empathetic lead, recommended-therapy chip row, CTA (Book / Call).
2. **What is [condition]** — plain-English, empathetic explainer (~80 words).
3. **How we help** — one block per recommended therapy: *how that therapy helps this condition* (from the app condition→therapy map + lead-with notes, reframed responsibly), each linking to its therapy page.
4. **What to expect** — typical approach/course, what a visit feels like.
5. **Why Renova** — local (Clonmel), non-invasive, guided.
6. **FAQ** — 3–5 condition-specific Q&As → FAQPage JSON-LD.
7. **Related** — links to the therapies used + 2–3 related conditions (cluster linking).
8. **CTA band + footer** with "we support, not diagnose/treat" disclaimer.

All claims marked `[confirm]` for clinical sign-off. Clinical conditions (long COVID, slow-healing wounds, osteoporosis) carry the stronger "alongside your GP" framing.

## Mega menu (new "Conditions" nav item)
- **Desktop:** hover/focus opens a wide panel — columns grouped by category listing the built conditions, plus a "Browse by therapy" column (HBOT · Infrared · PEMF) and a small "Not sure? Talk to us" CTA. Added to all root pages + condition pages. "Therapies" dropdown stays.
- **Mobile:** hamburger gains an expandable "Conditions" group (built from the menu data).

## SEO
- Per page: keyword + local `<title>`/meta, single H1, **FAQPage JSON-LD**.
- Internal linking: mega menu → pillar pages; pillar pages → therapy pages + related conditions; the condition **chips already on the therapy pages link to the matching pillar page** where one exists (cluster linking).

## Out of scope (phase 1)
The remaining ~40 conditions; a `/conditions/` folder with rewritten clean URLs; MedicalCondition schema beyond FAQ.
