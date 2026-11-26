// v6: se renueva la precache tras el lote de UX del 2026-11-25 (zoom
// escalonado en 3 momentos, metro unificado, bomberos separados, cuadro de
// mensaje en vez de panel inferior, gestión de puntos del admin, muro naranja
// y agenda sin scroll lateral). También se precachea el nuevo icono de
// bomberos.
// v7: arreglo de los iconos del metro (fontstack explícito "Noto Sans Regular"
// en `metro-nombres`: el fontstack por defecto daba 404 y tumbaba los tiles de
// la fuente).
// v8: calibración final del tamaño de icono (ICONO_MAX 0,45 → 0,375 = 24 px
// como máximo; marcadores HTML 22→34 px = 16→24 px, el mismo techo).
// v9: vuelve el medidor de zoom temporal, ahora con las marcas de los tres
// umbrales que faltan por calibrar (texto bajo icono, icono ↔ punto, punto
// desaparece).
// v10: calibración de los momentos con el medidor (2026-11-26): punto de
// color en 3 saltos (12,5 → 11,8 → 11) que desaparece en el zoom 10,5; textos
// con corte nítido en 12,5 y tamaño en 2 saltos (9 → 10 → 11 px); grupos sin
// número (1 punto); líneas del metro con corte en 9,3. Se elimina el medidor.
// v11: −15 % proporcional en los puntos que reemplazan a los iconos
// (ESCALA_PUNTO=0.85 sobre los 3 saltos: radio 2,975 / 4,25 / 5,95 px).
// v12: controles del mapa en columna vertical a la derecha (botón de colapso
// arriba y la columna desplegándose hacia abajo).
// v13: Fase 1 de UPDATE.md: grupos, login con grupo (usuario + contraseña +
// grupo) y agenda/muro filtrados por el grupo activo.
const CACHE_NAME = "app-santiago-2026-v13";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/config.js",
  "./src/supabase.js",
  "./src/pwa.js",
  "./src/main.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/bomberos.svg",
  "./data/comunas-rm.geojson",
  // Etapa 3: datos geográficos. Los archivos de transporte son pequeños
  // y se pre-cachean; los de lugares (data/lugares/*.geojson) NO entran
  // en el precache: cada capa se cachea en su primer uso vía el handler
  // de fetch de abajo (§11: se descarga una sola vez y después se sirve
  // desde caché).
  "./data/transporte-estaciones.geojson",
  "./data/transporte-lineas.geojson"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin || request.headers.has("range")) {
    return;
  }

  // Iconos SVG del mapa: son inmutables y pesan ~1 MB en total. Se sirven
  // cache-first (una sola descarga) para no repetir la petición en cada
  // apertura (§11: caché y rendimiento).
  if (url.pathname.includes("/icons/") && url.pathname.endsWith(".svg")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const fallback = await caches.match("./index.html");
          if (fallback) return fallback;
        }
        return new Response("Recurso no disponible sin conexión.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      })
  );
});
