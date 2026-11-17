/* MTB Inbox service worker: offline fallback + Web Push. */
const CACHE = "mtb-inbox-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

self.addEventListener("push", (event) => {
  let data = { title: "MTB Inbox", body: "", url: "/inbox", tag: "mtb" };
  try { data = { ...data, ...event.data.json() }; } catch { /* plain text */ }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, tag: data.tag, data: { url: data.url }, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/inbox";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if ("focus" in w) { w.navigate(url); return w.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
