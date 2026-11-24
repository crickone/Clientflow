/**
 * "Add to Home Screen" details for the staff app. iPhone only allows web
 * alerts for a site opened from the Home Screen as an app (iOS 16.4+), which
 * needs this manifest. Generic on purpose: it is fetched without a session.
 */
export function GET() {
  const manifest = {
    name: "AdonisAgent",
    short_name: "Adonis",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" },
  });
}
