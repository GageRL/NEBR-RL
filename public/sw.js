/* Nebraska Esports service worker: shows push notifications and opens the app when one is tapped.
   No page caching here on purpose, so every update to the site shows up right away. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (_) { m = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(m.title || "Nebraska Esports", {
      body: m.body || "",
      tag: m.tag || undefined,
      icon: m.icon || "/bp/icon-192.png",
      badge: "/bp/badge-96.png",
      data: { url: m.url || "/" }
    });
    // An open copy of the app reloads its data so it matches the notification.
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    wins.forEach(w => w.postMessage({ type: "refresh" }));
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin);
  if (url.origin !== self.location.origin) return;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin !== self.location.origin) continue;
      await w.focus();
      w.postMessage({ type: "go", url: url.pathname + url.search });
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});
