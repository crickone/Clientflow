/**
 * The staff app's service worker: shows phone and desktop alerts for staff
 * notifications (lib/notifications) and opens the right page when one is
 * clicked. Served at /notifications-sw.js with scope "/". No caching of
 * pages: the app always loads live.
 *
 * While an app window is visible the in-app pop-up already shows the
 * notification, so the alert is skipped -- except in Safari, which revokes a
 * push subscription that receives pushes without showing anything, and
 * except for the "Alerts are on" test (force).
 */
const SW = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
const ua = (self.navigator && self.navigator.userAgent) || "";
const mustShow = /iPhone|iPad|iPod/.test(ua) || (/Safari\\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|FxiOS|Firefox|Android/.test(ua));
const isStaffWindow = (c) => !new URL(c.url).pathname.startsWith("/app");
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "New notification", body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    if (!d.force && !mustShow) {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (all.some((c) => isStaffWindow(c) && c.visibilityState === "visible")) return;
    }
    await self.registration.showNotification(d.title || "New notification", {
      body: d.body || "",
      icon: "/icon.svg",
      tag: d.tag || undefined,
      data: { url: d.url || "/dashboard" },
    });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/dashboard";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (isStaffWindow(c) && "focus" in c) {
        await c.focus();
        if ("navigate" in c) return c.navigate(url);
        return;
      }
    }
    return self.clients.openWindow(url);
  })());
});
`;

export function GET() {
  return new Response(SW, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "Cache-Control": "no-cache",
    },
  });
}
