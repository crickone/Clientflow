# AdonisAgent marketing website

Dark, responsive marketing homepage with an animated brand sculpture, progressive scroll reveals, pointer effects, native workflow view transitions, and a demo-request dialog.

## Edit and build

- `index.html`: content, semantic structure and illustrative product previews.
- `assets/site.css`: scoped design system, responsive layout and motion fallbacks.
- `assets/site.js`: navigation, workflow tabs, animation controls and form requests.
- `build.mjs`: copies local font assets and inlines CSS/JS into the CMS deployment artifact.

From the repository root:

```sh
node sites/adonisagent/build.mjs
python3 -m http.server 4173 --bind 127.0.0.1 --directory app/public
```

Preview: http://127.0.0.1:4173/sites/adonisagent/index.html

The static preview has no backend. The form posts to the existing same-origin `/api/site-demo-lead` endpoint when served by the application. The browser tests intercept all form submissions; they never create real leads. An actual static-preview submission correctly shows a failure, rather than a false confirmation.

Both fonts are self-hosted; their licenses are included. There are no runtime CDN or animation-library dependencies. The source uses absolute `/sites/adonisagent/assets/` font paths to work on the mapped CMS domain and under `/site/adonisagent`.

## Browser verification

Start the preview server, then run:

```sh
node sites/adonisagent/tests/browser.mjs
```

Set `CHROME` to a Chromium executable if the locally cached browser is elsewhere. Optional `ADONIS_SCREENSHOT_DIR` controls screenshots (default `/tmp/adonis-review`). `ADONIS_PREVIEW_URL` accepts only a local URL to guard against production test submissions.

Checks cover desktop/mobile screenshots, keyboard tab navigation, request failure/retry/success, dialog focus restoration, 320–1024 px overflow, mobile CTA visibility, reduced motion and content with JavaScript disabled.

## Publishing

Generated file: `app/public/sites/adonisagent/index.html`.

The existing `seedMarketingSite` publisher owns the AdonisAgent site in the `clientflow` tenant. Revision 4 stages this redesign for its next application deployment. No database import or live deployment was run during this work. Follow the repository's normal Railway release checks before deployment. A revision update replaces the stored homepage body; review any intervening Studio edits before publishing.

## Conversion and motion notes

- One primary action: Request a demo. Name/email required, business optional.
- Success is only shown after a successful endpoint response. It confirms an enquiry, not a scheduled appointment.
- Product previews are explicitly illustrative. There are no invented customer logos, testimonials, revenue numbers or response-time guarantees.
- `adonis:conversion` custom events bubble from the site root for `demo_open`, `workflow_view`, `demo_request_success`, and `demo_request_error`. Their payloads contain only event/source/workflow labels, not form values. These are integration hooks, not an installed analytics destination.
- No traffic, ad or conversion data was available. Conversion improvements are hypotheses; measure confirmed demo requests per session after release.
- Pointer decoration keeps the native cursor. Touch devices have no cursor effect. Native scrolling is preserved, with a visible motion-pause control and reduced-motion support.
- Transitions currently connect workflow states and the demo dialog on this single-page website; this does not add unrelated routes merely to demonstrate page transitions.

Implementation references: [native view transitions](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition) and [native dialog semantics](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog).
