# Logos that suit light and dark mode

Date: 2026-11-21
Status: approved in brainstorm

## Problem

A business's logo shows exactly as uploaded in every mode. A white logo, such as Inspire's white-and-gold one, disappears on the light theme. A black logo disappears on the dark one.

## Decisions

- **Always one colour:** in the places below, the logo is shown in a single colour.
  - In light mode it is the theme's text colour (near-black).
  - In dark mode it is the theme's text colour (near-white).
  - The logo's own colours are not shown there.
- **Where:**
  - **Staff app:** the sidebar, the top bar and the account picker.
  - **Member app (`/app`):** the header.
  - **Unchanged:** websites, campaign pages, social posts (designed slides already flatten the logo with `stampLogo`), video cards, ads and app icons keep the logo as uploaded. They sit on the business's own backgrounds.

## How it works

### 1. The shape file

A copy of the logo where only its outline counts. It is a PNG whose alpha channel is the logo and whose colour is ignored. It is made server-side with sharp and stored next to the logo as `data/tenants/<slug>/branding/logo.shape.png`.

The shape is made like this:

- **Input:**
  - Raster logos are read as RGBA.
  - SVG logos are first rasterised, the way `resolveRasterLogoPath` already does, at enough size for a 2x sidebar logo.
  - Images are capped at 1024px on the long side.
- **Has real transparency** (any pixel's alpha below 250):
  - shape alpha = the logo's alpha.
- **No transparency:**
  - Sample the four corner patches.
  - If they all match one colour within a small tolerance, that colour is the background. Each pixel's shape alpha comes from its colour distance to the background, ramped over a soft band so edges stay smooth: 0 near the background, 255 when clearly different.
  - The result is trimmed to the logo's bounding box, with a small margin.
- **Corners don't agree** (a photo or busy background): no shape is made, and the logo shows as uploaded, as today.
- **Pure function:** the pixel step takes raw RGBA plus width and height, and returns raw alpha or null. It does no file input or output, so it can be unit tested.

### 2. When the shape is made

- **On upload:** right after the logo is saved (`POST /api/branding/logo`). A failure here never fails the upload.
- **For logos already uploaded:** made the first time the shape is asked for, then cached. It is re-made when the logo file is newer than the shape, using the same mtime check `resolveRasterLogoPath` uses.
- **When a logo is removed:** the shape is deleted with it.
- **Served by:** `GET /api/branding/logo?shape=1`. It returns 404 when no shape can be made, so the caller falls back to the original.

### 3. Painting it

`components/ui/Logo.tsx` gains a one-colour mode:

- **The paint:** an element sized like the current `<img>` uses the shape as a CSS mask (`mask-image` and `-webkit-mask-image`, `mask-size: contain`, no repeat, positioned the same as the image today) over `background: currentColor`.
- **The colour:**
  - **Staff app:** `color: var(--text-primary)`. It follows the per-viewer `ui-theme` toggle instantly, with no second file.
  - **Member app:** its own text colour variable, so a dark brand app gets a light logo and a light brand app a dark one.
- **Sizing:** the element's aspect ratio is the shape's real width and height, read when the shape is made and passed down through the logo source helper (`getChromeLogoSrc` or a sibling). The logo never stretches.
- **Accessibility:** the element keeps the business name as an accessible label (`role="img"` and `aria-label`).
- **Fallback:** with no shape, the plain `<img>` of the original is shown, exactly as today.

The account picker (`select-account`) uses the same one-colour treatment for each business's thumbnail. That means a shape-thumbnail variant alongside `tenantLogoThumb`.

### 4. Branding preview

Settings > Branding shows the uploaded logo twice, one-colour on a light panel and on a dark panel, so the business sees the result straight after upload.

When no shape could be made, it says so: "Shown as uploaded. Use a transparent PNG for a logo that suits light and dark." If the logo has lettering cut out of a solid badge, it comes out solid, and the preview makes that visible.

## Known limit

One colour cannot show detail inside a filled shape. For example, white text inside a gold circle becomes a solid circle.

If a business needs that detail, the later option is a second upload for the other mode. It is not part of this build.

## Rules

- **No emojis.**
- **Colours:** theme variables only.
- **Controls and layout:** 44px controls, and phone width of 320px with no horizontal scroll.
- **Fail-soft:** any processing failure leaves today's behaviour.

## Testing

- **Unit tests for the pure shape function:**
  - **Transparent PNG:** alpha passes through.
  - **Dark logo on a white JPG-style background:** the background is removed and the edges stay soft.
  - **Light logo on a dark background:** the background is removed.
  - **Corners that disagree:** a photo-like image returns null.
  - **Trimming:** the result is trimmed to the bounding box.
- **Route test:**
  - `?shape=1` returns a PNG for a raster logo and for an SVG logo.
  - It returns 404 for a photo.
  - It is re-made after a new upload.
- **Browser check** (dev data, restored afterwards):
  - Inspire (white-and-gold logo) and Optimal Health, in the light and dark staff themes.
  - The member app header.
  - The account picker.
  - Branding settings, at 320px and desktop width.
