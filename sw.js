// Keeps the app working offline and handles the buttons on voice-note notifications.
// Notes themselves live in the app's own storage and in your private repository, never in this cache.
const VERSION = "keep-notes-v3";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png",
  "./icon-mic-192.png", "./icon-mic-512.png", "./anthropic.min.js", "./voice-core.js",
  "./record/", "./record/index.html", "./record/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== VERSION + "-fonts").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "api.github.com" || url.hostname === "api.anthropic.com") return;

  if (url.origin === self.location.origin) {
    if (req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith(".html")) {
      // Network first so updates arrive; fall back to the cached copy of that page offline.
      const key = url.origin + (url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname);
      event.respondWith(
        fetch(req).then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(key, copy)); }
          return res;
        }).catch(() => caches.match(key).then((hit) => hit || caches.match(new URL("./index.html", self.registration.scope).href)))
      );
      return;
    }
    event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(VERSION + "-fonts").then((c) => c.match(req).then((hit) => {
        const net = fetch(req).then((res) => { c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }))
    );
  }
});

/* ---------- voice-note notifications ---------- */
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("keepnotes", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function markApproved(id) {
  const d = await openDb();
  await new Promise((res, rej) => {
    const t = d.transaction("kv", "readwrite"), st = t.objectStore("kv"), g = st.get("pending:" + id);
    g.onsuccess = () => { if (g.result) { g.result.approved = true; st.put(g.result, "pending:" + id); } };
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
async function notesWindow() {
  const scope = new URL(self.registration.scope).pathname;
  const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
  return all.find((c) => { const p = new URL(c.url).pathname; return p === scope || p === scope + "index.html"; });
}

self.addEventListener("notificationclick", (event) => {
  const n = event.notification, id = (n.data && n.data.id) || "";
  n.close();
  if (event.action === "save") {
    // Approved without opening: the Notes app adds it the next time it runs.
    event.waitUntil((async () => {
      await markApproved(id);
      const win = await notesWindow();
      if (win) win.postMessage({ type: "approved" });
      else await self.registration.showNotification("Voice note approved", {
        body: "It'll be added to your notes the next time you open Keep Notes.", tag: "voice-" + id, silent: true,
        icon: new URL("./icon-192.png", self.registration.scope).href
      });
    })());
    return;
  }
  event.waitUntil((async () => {
    const win = await notesWindow();
    if (win) { await win.focus(); win.postMessage({ type: "review", id }); return; }
    await clients.openWindow(new URL("./?review=" + encodeURIComponent(id), self.registration.scope).href);
  })());
});
