/*
 * Service worker mínimo del tablero de la IA Factory.
 *
 * Hace la app instalable (PWA) y da un "app shell" offline, sin arriesgar
 * datos: los datos viven en Supabase y nunca se sirven desde caché.
 *
 *  - Navegaciones HTML -> network-first (offline cae al HTML cacheado).
 *  - Assets estáticos con hash -> stale-while-revalidate.
 *  - TODO lo demás (Supabase, otros orígenes) -> passthrough puro.
 */
// v2: antes de este fix, una respuesta 404/5xx transitoria (ej. justo
// después de un deploy, mientras GitHub Pages propaga los archivos nuevos)
// podía quedar cacheada para siempre. Subir la versión fuerza a `activate`
// (más abajo) a borrar cualquier caché vieja -- incluida una que ya tenga
// un error de ese tipo pegado -- en vez de dejarlo ahí indefinidamente.
const CACHE = "iafactory-shell-v1";

const STATIC_ASSET = /\.(css|js|mjs|png|svg|ico|webp|jpg|jpeg|woff2?)(\?|$)/i;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // nunca tocar Supabase/otros orígenes

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Solo se cachea una respuesta 2xx real -- un 404/5xx transitorio
          // (ej. justo después de un deploy, mientras GitHub Pages todavía
          // está propagando los archivos nuevos a su CDN) no debe quedar
          // guardado como "el shell offline": eso lo dejaría sirviendo ese
          // error para siempre, incluso una vez que el archivo real ya está
          // disponible en la red.
          if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("/iafactory/"))),
    );
    return;
  }

  if (STATIC_ASSET.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            // mismo criterio que arriba: nunca cachear un 404/5xx. Un JS/CSS
            // con nombre hasheado que 404ea en el momento exacto de un
            // deploy (propagación de CDN) no debe quedar pegado en caché --
            // la próxima carga tiene que poder volver a pedirlo a la red en
            // vez de repetir el mismo error para siempre.
            if (res.ok) caches.open(CACHE).then((c) => c.put(request, res.clone()));
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
