/**
 * The member app's service worker: shows push notifications and opens the
 * right screen when one is tapped. Served from /app/pwa/sw with
 * Service-Worker-Allowed so it can control all of /app. Deliberately no
 * caching of pages: the app always loads live.
 */
const SW = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "Reminder", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Reminder", {
    body: d.body || "",
    icon: "/app/pwa/icon?s=192",
    badge: "/app/pwa/icon?s=192",
    data: { url: d.url || "/app" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/app";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).pathname.startsWith("/app")) { await c.focus(); return c.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
`;

export function GET() {
  return new Response(SW, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/app",
      "Cache-Control": "no-cache",
    },
  });
}
