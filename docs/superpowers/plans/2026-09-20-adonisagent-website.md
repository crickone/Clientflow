# AdonisAgent website redesign

Goal: deliver the authorised cinematic dark marketing redesign with a working demo enquiry journey.

Architecture: editable HTML, scoped CSS and progressive-enhancement JavaScript in sites/adonisagent; a small build script inlines the assets into app/public/sites/adonisagent/index.html for the existing revisioned CMS publisher. No framework or animation dependency added. Existing POST /api/site-demo-lead handles enquiries; no live submissions during testing.

Design: midnight and graphite surfaces, silver typography, ice-blue activity accents, local Space Grotesk / Manrope fonts. One dimensional geometric sculpture anchors the hero. Interactive illustrative workflows show sales, marketing and operations. Repeated Request a demo CTA opens a native accessible dialog with name, email and optional business. No fabricated testimonials or performance claims.

- [x] Build semantic responsive homepage, workflow previews, agent section, FAQs and request dialog.
- [x] Add scoped styles, perspective sculpture, focus states, mobile layouts and motion fallbacks.
- [x] Add cursor halo, magnetic controls, scroll reveals, progressive hero lighting, workflow view transitions and honest form states. Keep native scrolling and cursor.
- [x] Build a self-contained public HTML artifact and increment marketing site revision for a future deployment.
- [x] Inspect desktop/mobile screenshots and test workflow switching, keyboard navigation, dialog focus/close, form success/failure with mocked endpoint, reduced motion and no-JavaScript readability.
- [x] Check source/build parity, syntax and repository diff. Record remaining production measurement/deployment limits.

Conversion checks: specific product/audience above fold; primary CTA visible on mobile; three form fields, of which two required; no dead-end CTAs; explicit successful-request state rather than claiming an appointment is booked. Emit local custom events for CTA and confirmed submission so analytics can be connected without adding a tracker or transmitting personal data. Traffic/ad/conversion data not available, so no conversion-lift claims.

Verification: main app typecheck passed; JavaScript syntax and git diff checks passed. Browser checks passed on Chromium with desktop/mobile screenshots, mocked submission outcomes, keyboard workflow switching, focus restoration, motion preferences and no-JavaScript content. Live application deployment and real CRM submissions were not performed.
