// Service worker — hace que la app sea instalable como PWA (ícono propio, pantalla completa)
// y que funcione offline en modo consulta. La app SIGUE funcionando igual como web normal.
//
// Estrategia NETWORK-FIRST para el "shell" (HTML/JS/CSS/íconos):
//   - online  → se sirve siempre la última versión de la red (no hace falta Ctrl+Shift+R)
//               y de paso se guarda en cache.
//   - offline → se sirve la última versión cacheada (si no hay nada, cae a index.html).
// Las llamadas al proxy de GitHub (odfjell-stock-proxy...) y a otros orígenes (xlsx CDN,
// Google GSI) son cross-origin → el SW NO las intercepta: van directo a la red. Si no hay
// red, fallan, que es lo correcto (no queremos servir datos de stock viejos cacheados).

const CACHE = "stock-tagsa-v14";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/data.js",
  "./js/app.js",
  "./img/logo-arca.svg",
  "./img/icon-192.png",
  "./img/icon-512.png",
  "./img/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // no tocar cross-origin (proxy, CDNs, OAuth)

  // cache:"reload" → ignora la cache HTTP del navegador y va siempre a la red.
  // Así, online, SIEMPRE se sirve la última versión del código (sin esperar el
  // TTL de GitHub Pages ni hacer Ctrl+Shift+R). Offline cae a la cache del SW.
  const fresco = new Request(req.url, { cache: "reload", credentials: "same-origin" });
  event.respondWith(
    fetch(fresco)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match("./index.html"))
      )
  );
});
