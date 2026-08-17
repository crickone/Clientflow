# AdonisAgent — Brand Kit

Single-file logo assets + the full brand system. Everything here is black & white,
built on one continuous **Greek-key meander** mark and **Familjen Grotesk**.

## Files

```
brand/
  brand-pack.html          Full visual brand system (open in a browser)
  favicon.svg              App / browser-tab icon (black tile, white mark)
  mark/
    mark-black.svg         Mark only — black line, transparent bg
    mark-white.svg         Mark only — white line, transparent bg (for dark grounds)
    mark-tile-black.svg    Mark in a black square (app icon)
    mark-tile-white.svg    Mark in a white square (inverse)
  logo/
    lockup-black.svg       Mark + "AdonisAgent" wordmark — on light
    lockup-white.svg       Mark + "AdonisAgent" wordmark — on dark
    wordmark-black.svg     Wordmark only — on light
    wordmark-white.svg     Wordmark only — on dark
```

## The mark

One continuous meander spiralling into a square — right angles only, one stroke
weight, balanced ~50/50 stroke-to-gap so it holds from a header down to a 16px
favicon. Vector path (viewBox `0 0 120 120`):

```
M20 20 L100 20 L100 100 L20 100 L20 40 L80 40 L80 80 L40 80 L40 60 L60 60
```

Stroke: `9` for the line marks, `11` inside the tiles. Caps square, joins miter.

## Colour

| Name     | Hex       | Use                          |
|----------|-----------|------------------------------|
| Black    | `#0E0E0E` | Text, mark, ground           |
| White    | `#FFFFFF` | Surface, reverse mark        |
| Graphite | `#6B6B6B` | Secondary text               |
| Mist     | `#F4F4F4` | Panels, fills                |
| Hairline | `#DCDCDC` | Rules, grid, borders         |

No accent — the brand is strictly black & white; rhythm comes from inverting
(black on white / white on black), not colour.

## Typeface

**Familjen Grotesk** — the display/logo face (open-source, on Google Fonts, so it
self-hosts in the app and site). Used for the wordmark and headings.

> ⚠️ **Wordmark & lockup SVGs** render their text with `<text font-family="Familjen
> Grotesk">`, so they display correctly only where the font is installed. For print
> or fully portable files, open the SVG in a vector editor and **outline the text to
> paths** (the `mark-*.svg` files have no font dependency — they're pure vector).

## Usage

- **Favicon / app icon** → `favicon.svg` (or `mark/mark-tile-black.svg`).
- **On light backgrounds** → the `*-black.svg` files.
- **On dark backgrounds** → the `*-white.svg` files.
- **Full logo** → `logo/lockup-*.svg`. **Icon-only** → `mark/mark-*.svg`.
- Keep clear space ≥ the mark's inner square on all sides. Never recolour, rotate,
  stretch, add gradients, or place the mark on a busy background.
