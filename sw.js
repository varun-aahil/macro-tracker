// app shell works offline. the clip library and wasm are cached the first time they load.
const SHELL = "macro-tracker-v7";
const FILES = ["./", "index.html", "manifest.json", "foods.json", "src/app.js", "src/embed.js",
  "src/learner.js", "src/logic.js", "src/store.js", "src/camera.js", "src/barcode.js", "src/ui.js", "src/plan.js", "src/onboarding.js", "src/me.js", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => e.waitUntil(
  caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const mine = url.origin === location.origin, cdn = url.hostname === "cdn.jsdelivr.net";
  if (!mine && !cdn) return;   // model weights are cached by transformers.js itself
  e.respondWith(caches.open(SHELL).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
