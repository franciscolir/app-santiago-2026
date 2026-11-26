// =============================================================================
// scripts/verificar-mapa.mjs
// Etapa 6 de mapas.txt §13/§14: verificación automática de datos, coordenadas,
// referencias del frontend y ausencia de credenciales privadas.
//
// Uso:  node scripts/verificar-mapa.mjs
// Salida: 0 = todo OK · 1 = hay fallos
//
// No requiere dependencias: solo Node.js (>= 18).
// =============================================================================
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Bounding box amplio de la Región Metropolitana (incluye holgura para evitar
// falsos positivos en el borde).
const RM = { lonMin: -72.0, lonMax: -69.5, latMin: -34.3, latMax: -32.8 };

let fallos = 0, avisos = 0, pruebas = 0;
const detalle = [];

function ok(nombre, extra = "") { pruebas++; detalle.push(`  OK   ${nombre}${extra ? " · " + extra : ""}`); }
function fail(nombre, motivo) { pruebas++; fallos++; detalle.push(`  FALLA ${nombre} · ${motivo}`); }
function aviso(nombre, motivo) { pruebas++; avisos++; detalle.push(`  AVISO ${nombre} · ${motivo}`); }
function check(cond, nombre, motivo, extra) { cond ? ok(nombre, extra) : fail(nombre, motivo); return cond; }

function leerJSON(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { return { __error: "JSON inválido: " + e.message }; }
}
function leerTexto(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

// Recorre todas las coordenadas de cualquier geometría GeoJSON.
function coordenadas(f) {
  const out = [];
  const Push = (c) => { if (Array.isArray(c) && typeof c[0] === "number") out.push(c); };
  const g = f.geometry;
  if (!g) return out;
  if (g.type === "Point") Push(g.coordinates);
  else if (g.type === "LineString" || g.type === "MultiPoint") g.coordinates.forEach(Push);
  else if (g.type === "MultiLineString" || g.type === "Polygon") g.coordinates.forEach((l) => l.forEach(Push));
  else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => p.forEach((l) => l.forEach(Push)));
  return out;
}
const dentroRM = ([lon, lat]) => lon >= RM.lonMin && lon <= RM.lonMax && lat >= RM.latMin && lat <= RM.latMax;

console.log("\n=== Verificación del módulo de mapa (Etapa 6) ===\n");

// ---------------------------------------------------------------- 1. comunas --
console.log("[1] Límites comunales (data/comunas-rm.geojson)");
{
  const fc = leerJSON("data/comunas-rm.geojson");
  if (!fc) fail("comunas: archivo", "no existe data/comunas-rm.geojson");
  else if (fc.__error) fail("comunas: JSON", fc.__error);
  else {
    check(fc.type === "FeatureCollection", "comunas: FeatureCollection", "tipo " + fc.type);
    check(fc.features.length === 52, "comunas: 52 comunas", "hay " + fc.features.length);
    const sinNombre = fc.features.filter((f) => !f.properties?.nombre).length;
    check(sinNombre === 0, "comunas: todas con nombre", `${sinNombre} sin properties.nombre`);
    const nombres = fc.features.map((f) => f.properties?.nombre);
    check(new Set(nombres).size === nombres.length, "comunas: nombres únicos", "hay nombres repetidos");
    const malas = fc.features.filter((f) => {
      const cs = coordenadas(f);
      return cs.length === 0 || !cs.every(dentroRM);
    });
    check(malas.length === 0, "comunas: dentro de la RM", `${malas.length} geometrías fuera del bbox`,
      malas.slice(0, 3).map((f) => f.properties?.nombre).join(", "));
    const tipos = [...new Set(fc.features.map((f) => f.geometry?.type))];
    ok("comunas: geometrías", tipos.join("/"));
  }
}

// ------------------------------------------------------------- 2. transporte --
console.log("[2] Transporte público (GTFS DTPM)");
{
  const est = leerJSON("data/transporte-estaciones.geojson");
  if (!est) fail("estaciones: archivo", "falta data/transporte-estaciones.geojson");
  else {
    check(est.features.length >= 150, "estaciones: >= 150", "hay " + est.features.length, est.features.length + " estaciones");
    const tipos = [...new Set(est.features.map((f) => f.properties?.tipo))];
    check(tipos.includes("metro") && tipos.includes("metrotren"), "estaciones: metro y metrotren", tipos.join("/"));
    const fuera = est.features.filter((f) => !coordenadas(f).every(dentroRM));
    check(fuera.length === 0, "estaciones: coordenadas en la RM", `${fuera.length} fuera del bbox`);
    const sinLineas = est.features.filter((f) => !f.properties?.lineas?.length).length;
    check(sinLineas === 0, "estaciones: todas con líneas", `${sinLineas} sin líneas`);
    const sinFuente = est.features.filter((f) => !f.properties?.fuente).length;
    check(sinFuente === 0, "estaciones: todas con fuente", `${sinFuente} sin fuente`);
  }
  const lin = leerJSON("data/transporte-lineas.geojson");
  if (!lin) fail("líneas: archivo", "falta data/transporte-lineas.geojson");
  else {
    check(lin.features.length === 9, "líneas: 9 líneas", "hay " + lin.features.length);
    const fuera = lin.features.filter((f) => !coordenadas(f).every(dentroRM));
    check(fuera.length === 0, "líneas: trazados dentro de la RM", `${fuera.length} fuera del bbox`);
  }
  check(!existsSync(join(ROOT, "data/transporte-paraderos.geojson")),
    "paraderos: archivo no versionado", "existe data/transporte-paraderos.geojson (el usuario pidió solo terminales)");
}

// --------------------------------------------------------------- 3. lugares --
console.log("[3] Lugares de OSM (data/lugares/*.geojson)");
const CAPAS = ["parques", "plazas", "comercio", "salud", "seguridad", "bomberos", "servicios"];
const REQUERIDOS = ["nombre", "categoria", "subcategoria", "fuente", "actualizado"];
// Subcategorías permitidas por capa: son las del importador y reflejan los
// filtros pedidos (parques grandes, malls, salud pública, etc.).
const SUBCATEGORIAS = {
  parques:    ["Parque grande", "Cerro parque", "Zoológico"],
  plazas:     ["Plaza de Armas"],
  comercio:   ["Centro comercial"],
  salud:      ["Hospital público", "SAPU / SAR", "Hospital público / SAR"],
  seguridad:  ["Comisaría o tenencia"],
  bomberos:   ["Cuartel de bomberos"],
  servicios:  ["Municipalidad"],
};
for (const capa of CAPAS) {
  const fc = leerJSON(`data/lugares/${capa}.geojson`);
  if (!fc) { fail(`lugares/${capa}: archivo`, "no existe"); continue; }
  if (fc.__error) { fail(`lugares/${capa}: JSON`, fc.__error); continue; }
  check(fc.type === "FeatureCollection", `lugares/${capa}: FeatureCollection`, "tipo " + fc.type);
  check(fc.features.length > 0, `lugares/${capa}: tiene puntos`, "archivo vacío");
  const geomMal = fc.features.filter((f) => f.geometry?.type !== "Point").length;
  check(geomMal === 0, `lugares/${capa}: solo Point`, `${geomMal} con otra geometría`);
  const fuera = fc.features.filter((f) => !coordenadas(f).every(dentroRM));
  check(fuera.length === 0, `lugares/${capa}: dentro de la RM`, `${fuera.length} fuera del bbox`,
    fuera.slice(0, 2).map((f) => f.properties?.nombre).join(", "));
  const faltan = REQUERIDOS.filter((k) => fc.features.some((f) => !f.properties?.[k]));
  check(faltan.length === 0, `lugares/${capa}: campos §8 completos`, "faltan: " + faltan.join(", "));
  const claves = fc.features.map((f) => `${f.properties.categoria}|${f.properties.nombre}|${f.properties.comuna}`);
  const dup = claves.length - new Set(claves).size;
  check(dup === 0, `lugares/${capa}: sin duplicados`, `${dup} duplicados (categoría+nombre+comuna)`);
  const cats = [...new Set(fc.features.map((f) => f.properties?.categoria))];
  check(cats.length === 1 && cats[0] === capa, `lugares/${capa}: categoría coherente`, cats.join(","));
  // Filtros estrictos del usuario: solo las subcategorías permitidas.
  const subs = [...new Set(fc.features.map((f) => f.properties?.subcategoria))];
  const noPermitidas = subs.filter((s) => !SUBCATEGORIAS[capa].includes(s));
  check(noPermitidas.length === 0, `lugares/${capa}: subcategorías filtradas`, "no permitidas: " + noPermitidas.join(", "),
    subs.join(" / "));
  const educ = fc.features.filter((f) => /escuela|colegio|educa|universidad/i.test(
    `${f.properties.nombre} ${f.properties.subcategoria}`)).length;
  if (educ) aviso(`lugares/${capa}: nombres con connotation educativa`, `${educ} (verificar que no sean educacionales)`);
  const paraderos = fc.features.filter((f) => /paradero|stop/i.test(
    `${f.properties.nombre} ${f.properties.subcategoria}`)).length;
  if (paraderos) aviso(`lugares/${capa}: nombres con "paradero"`, `${paraderos}`);
  ok(`lugares/${capa}: puntos`, fc.features.length + " pts");
}

// ------------------------------------------------- 4. referencias del código --
console.log("[4] Referencias del frontend");
{
  const main = leerTexto("src/main.js") || "";
  const sw = leerTexto("sw.js") || "";
  const html = leerTexto("index.html") || "";

  // --- iconos SVG del mapa --------------------------------------------------
  // Catálogo: clave -> {svg, label}
  const catalogo = [...main.matchAll(/([a-z_]+):\{svg:"([^"]+)"/g)].map((m) => ({ clave: m[1], svg: m[2] }));
  check(catalogo.length >= 10, "catálogo de iconos del mapa", "solo " + catalogo.length + " iconos");
  const svgsUsados = [...new Set(catalogo.map((c) => c.svg))];
  const faltanSvg = svgsUsados.filter((n) => !existsSync(join(ROOT, "icons", n)));
  check(faltanSvg.length === 0, "iconos SVG existen en /icons", "faltan: " + faltanSvg.join(", "));
  const sinViewBox = svgsUsados.filter((n) => {
    const t = leerTexto("icons/" + n) || "";
    return !/viewBox\s*=/i.test(t) || !/<svg[\s>]/i.test(t);
  });
  check(sinViewBox.length === 0, "iconos SVG con viewBox (escalables)", "sin viewBox: " + sinViewBox.join(", "));
  const pesados = svgsUsados.filter((n) => (leerTexto("icons/" + n) || "").length > 400 * 1024);
  check(pesados.length === 0, "iconos SVG optimizados (< 400 KB)", "muy pesados: " + pesados.join(", "));
  const sinPng = svgsUsados.filter((n) => !existsSync(join(ROOT, "icons", "png", n.replace(/\.svg$/, ".png"))));
  check(sinPng.length === 0, "PNG de respaldo de cada icono", "faltan: " + sinPng.join(", "));

  // Cada capa de lugares debe tener icono en el catálogo.
  const bloqueLugares = (main.match(/const ICONO_LUGAR=\{([^}]+)\}/) || [])[1] || "";
  const clavesLugares = [...bloqueLugares.matchAll(/([a-z]+):"([a-z_]+)"/g)].map((m) => m[2]);
  const clavesCatalogo = new Set(catalogo.map((c) => c.clave));
  const iconosSinCatalogo = clavesLugares.filter((k) => !clavesCatalogo.has(k));
  check(iconosSinCatalogo.length === 0, "iconos de capa en el catálogo", "no existen: " + iconosSinCatalogo.join(", "));

  // Selector visual de iconos del formulario (§9).
  check(/id="point-icon-grid"/.test(html), "selector visual de iconos en el HTML", "falta #point-icon-grid");
  check(/type="hidden" id="point-icon"/.test(html), "campo oculto #point-icon", "falta el input hidden");
  check(/renderSelectorIconos/.test(main), "el selector se construye desde el catálogo", "falta renderSelectorIconos");

  // --- carga de iconos ------------------------------------------------------
  // Se ignoran los comentarios: mencionan map.loadImage a propósito.
  const codigoMain = main.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  check(!/map\.loadImage/.test(codigoMain), "iconos cargados sin map.loadImage", "usa map.loadImage (se cuelga)");
  check(/rasterizarSVG/.test(main), "SVG rasterizado para MapLibre", "no rasteriza el SVG");
  check(/createImageBitmap/.test(main), "PNG de respaldo con createImageBitmap", "no usa createImageBitmap");

  const capasMain = [...main.matchAll(/^  "([a-z]+)":\s*\{color/gm)].map((m) => m[1]);
  const capasFaltan = capasMain.filter((c) => !existsSync(join(ROOT, `data/lugares/${c}.geojson`)));
  check(capasFaltan.length === 0, "cada capa del panel tiene su GeoJSON", "faltan: " + capasFaltan.join(", "));
  // Los datos de cada capa del panel deben coincidir con la lista del importador.
  const capasImportador = [...(leerTexto("scripts/importar-lugares.mjs") || "").matchAll(/^\s{4}id:\s*"([a-z]+)",/gm)].map((m) => m[1]);
  const sinImportador = capasMain.filter((c) => !capasImportador.includes(c));
  check(sinImportador.length === 0, "cada capa del panel existe en el importador", "no importadas: " + sinImportador.join(", "));
  check(capasImportador.includes("bomberos") && !capasImportador.includes("paraderos"),
    "importador: bomberos en capa propia y sin paraderos", "revisa las categorías de importar-lugares.mjs");

  const precache = [...sw.matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]);
  const faltan = precache.filter((p) => !existsSync(join(ROOT, p)));
  check(faltan.length === 0, "precache del service worker existe", "faltan: " + faltan.join(", "));
  check(!precache.some((p) => p.includes("paraderos")), "paraderos fuera del precache", "el precache incluye paraderos");
  check(/CACHE_NAME\s*=\s*"app-santiago-2026-v\d+"/.test(sw), "service worker con versión de caché", "sin CACHE_NAME versionado");

  check(!/onclick\s*=/.test(html) && !/onclick\s*=/.test(main),
    "sin handlers inline", "quedan atributos onclick (los módulos no exponen funciones globales)");
  check(!/window\.__cargarLugares/.test(main), "sin hooks de depuración temporales", "quedó window.__cargarLugares");
}

// ------------------------------------------------------------ 5. seguridad ---
console.log("[5] Credenciales y SQL");
{
  const archivos = ["index.html", "src/main.js", "src/config.js", "src/supabase.js", "src/pwa.js", "sw.js"];
  const serviceKey = [];
  for (const a of archivos) {
    const t = leerTexto(a); if (!t) continue;
    // Se ignoran los comentarios: pueden LEGÍTIMAMENTE mencionar service_role.
    const codigo = t.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    if (/service_role|SUPABASE_SERVICE|eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}/.test(codigo)) serviceKey.push(a);
  }
  check(serviceKey.length === 0, "sin service_role en el frontend", "en: " + serviceKey.join(", "));

  const config = leerTexto("src/config.js") || "";
  check(/sb_publishable_/.test(config), "config.js usa publishable key", "no se encontró sb_publishable_");
  check(!/supabase\.co\/rest\/v1\/.*service_role/.test(config), "config.js sin endpoint privilegiado", "");

  const sql06 = leerTexto("sql/06_map_points.sql") || "";
  check(/create policy "Usuarios consultan puntos del mapa"/.test(sql06), "sql/06: política de lectura", "");
  check(/create policy "Usuarios gestionan sus puntos personales"/.test(sql06), "sql/06: política de puntos personales", "");
  check(/create policy "Admin gestiona puntos generales"/.test(sql06), "sql/06: política de puntos generales", "");
  check(/enable row level security/.test(sql06), "sql/06: RLS activado", "");

  const sql07 = leerTexto("sql/07_terminales.sql") || "";
  check(!!sql07, "sql/07_terminales.sql existe", "falta el archivo");
  const terminales = [...new Set(sql07.match(/'(?:way|node)\/\d+'/g) || [])];
  check(terminales.length === 4, "sql/07: 4 terminales con external_id OSM", "hay " + terminales.length);
  check(/tipo\s*=\s*'general'/.test(sql07) || /'general'/.test(sql07), "sql/07: puntos generales", "");
  // Regresión del error 42P10: el índice de external_id es PARCIAL, así que el
  // ON CONFLICT debe repetir el predicado o PostgreSQL no puede inferirlo.
  check(/on conflict \(external_id\) where external_id is not null/i.test(sql07),
    "sql/07: ON CONFLICT con el predicado del índice parcial", "falta 'where external_id is not null' (error 42P10)");
  check(/create unique index if not exists map_points_external_id_idx/i.test(sql07),
    "sql/07: crea el índice único parcial", "no crea el índice map_points_external_id_idx");
  const sql06b = leerTexto("sql/06_map_points.sql") || "";
  check(/create unique index if not exists map_points_external_id_idx\s*\n?\s*on public\.map_points \(external_id\) where external_id is not null/i.test(sql06b),
    "sql/06: índice único parcial de external_id", "no coincide con el índice parcial esperado");
}

// --------------------------------------------- 6. vista mapa (2026-11-25) -----
console.log("[6] Vista de mapa: espacio, controles y comportamiento de los puntos");
{
  const main = leerTexto("src/main.js") || "";
  const html = leerTexto("index.html") || "";
  const css = leerTexto("styles.css") || "";

  // --- el mapa usa todo el espacio y oculta el header -----------------------
  check(/body\.vista-mapa #app > header\s*\{[^}]*display:\s*none/i.test(css),
    "vista mapa: oculta el header de la app", "falta la regla del header en styles.css");
  check(/body\.vista-mapa #view-mapa/.test(css) && /100dvh/.test(css),
    "vista mapa: altura completa (100dvh)", "no se calcula la altura con dvh");
  check(/classList\.toggle\("vista-mapa",\s*name\s*===\s*"mapa"\)/.test(main),
    "vista mapa: la clase se activa al abrir la pestaña", "no se alterna body.vista-mapa");
  check(/h-full/.test(html) && !/h-\[62vh\]/.test(html),
    "vista mapa: el marco ocupa el alto disponible", "sigue con una altura fija (62vh)");

  // --- buscador colapsable (lupa arriba a la izquierda) ----------------------
  check(/id="map-search-toggle"/.test(html), "buscador: botón lupa", "falta #map-search-toggle");
  check(/id="map-search-wrap"/.test(html), "buscador: contenedor del input", "falta #map-search-wrap");
  check(/id="map-search-close"/.test(html), "buscador: botón cerrar", "falta #map-search-close");
  check(/function abrirBuscador|const abrirBuscador/.test(main), "buscador: función de apertura", "no abre el buscador");

  // --- controles del mapa a la derecha, colapsables y en columna vertical ----
  check(/id="map-controls-toggle"/.test(html), "controles: botón colapsable", "falta #map-controls-toggle");
  check(/id="map-controls-row"/.test(html), "controles: contenedor de botones", "falta #map-controls-row");
  check(/id="map-controls-row"[^>]*flex flex-col/.test(html),
    "controles: los botones se apilan VERTICALMENTE (flex-col)", "la columna no es flex-col");
  check(/id="map-controls"[^>]*flex flex-col items-end/.test(html),
    "controles: el conjunto es una columna alineada a la derecha", "#map-controls no es flex-col items-end");
  const posToggle = html.indexOf('id="map-controls-toggle"');
  const posFila = html.indexOf('id="map-controls-row"');
  check(posToggle > -1 && posFila > posToggle,
    "controles: el botón de colapso queda ARRIBA de la columna", "el toggle no va antes que la fila");
  check(/id="map-controls-row"[^>]*max-h-\[calc\(100dvh-7rem\)\]/.test(html),
    "controles: la columna no desborda en pantallas bajas (max-h + scroll)", "falta el max-h de la columna");
  check(/keyboard_arrow_down/.test(html), "controles: flecha hacia abajo", "el botón no usa keyboard_arrow_down");
  check(/rotate-180/.test(main), "controles: la flecha rota al desplegar", "no rota la flecha");
  const bloqueControles = (html.match(/<div id="map-controls"[^>]*>/) || [""])[0];
  check(/absolute right-3 top-3/.test(bloqueControles), "controles: anclados arriba a la derecha", "no están a la derecha");

  // --- panel inferior ELIMINADO: los detalles van al cuadro de mensaje -------
  check(!/id="mapa-panel-inferior"/.test(html), "panel inferior: eliminado del HTML", "sigue el panel inferior colapsable");
  check(!/id="mapa-panel-toggle"/.test(html) && !/id="mapa-panel-cuerpo"/.test(html),
    "panel inferior: sin botón ni cuerpo de colapso", "quedaron los controles del panel");
  check(!/colapsarPanelMapa/.test(main), "panel inferior: sin función de colapso", "quedó colapsarPanelMapa");
  check(/id="toast-msg"/.test(html) && /id="toast-text"/.test(html) && /id="toast-title"/.test(html),
    "cuadro de mensaje: existe y tiene título y texto", "falta #toast-msg / #toast-text / #toast-title");
  check(/function mostrarMensaje/.test(main), "cuadro de mensaje: función mostrarMensaje", "no existe mostrarMensaje");
  check(/function selectVenue[\s\S]{0,1600}mostrarMensaje/.test(main),
    "cuadro de mensaje: los detalles del evento se muestran ahí", "selectVenue no usa mostrarMensaje");
  check(/function renderMapList[\s\S]{0,1400}mostrarMensaje/.test(main),
    "cuadro de mensaje: los resultados de búsqueda se muestran ahí", "renderMapList no usa mostrarMensaje");

  // --- iconos al acercar / punto de color al alejar -------------------------
  check(/const ZOOM_PUNTO_MIN\s*=/.test(main) && /const ZOOM_ICONO\s*=/.test(main),
    "puntos: umbrales de zoom definidos", "faltan ZOOM_PUNTO_MIN / ZOOM_ICONO");
  check(/-puntos-mini/.test(main), "puntos: capa de punto de color", "falta la capa -puntos-mini");
  check(/circle-radius.*interpolate/s.test(main), "puntos: el radio se interpola con el zoom", "el radio no depende del zoom");
  check(/function actualizarPuntosSegunZoom/.test(main), "puntos: función de actualización por zoom", "no existe actualizarPuntosSegunZoom");
  check(/map\.on\("zoom",actualizarPuntosSegunZoom\)/.test(main), "puntos: se actualiza al hacer zoom", "no escucha el evento zoom");
  check(/dataset\.fijo/.test(main), "puntos: marca de vista fija por punto", "no guarda dataset.fijo");
  check(/\.map-point-punto/.test(css) && /\.map-point-oculto/.test(css),
    "puntos: estilos de punto y de ocultamiento", "faltan las clases CSS de los puntos");
  check(/\.map-pin\.modo-punto/.test(css), "pines de actividad: modo punto", "falta .map-pin.modo-punto");

  // --- opción "vista fija" al agregar un punto ------------------------------
  check(/id="point-fijo"/.test(html), "formulario: opción vista fija", "falta #point-fijo");
  check(/type="checkbox"[^>]*id="point-fijo"|id="point-fijo"[^>]*type="checkbox"/.test(html),
    "formulario: la vista fija es un checkbox", "#point-fijo no es un checkbox");
  check(/fijo\s*:\s*(bloqueado\?true:)?\$\("#point-fijo"\)\.checked/.test(main), "formulario: se guarda el valor fijo", "no se envía fijo");

  // --- SQL de la columna fijo -----------------------------------------------
  const sql06 = leerTexto("sql/06_map_points.sql") || "";
  check(/add column if not exists fijo boolean not null default false/i.test(sql06),
    "sql/06: columna fijo", "falta la columna fijo");
  const sql08 = leerTexto("sql/08_puntos_fijos.sql") || "";
  check(!!sql08, "sql/08_puntos_fijos.sql existe", "falta el archivo");
  check(/add column if not exists fijo boolean not null default false/i.test(sql08),
    "sql/08: crea la columna fijo", "no crea la columna fijo");

  // --- regresión 42703: las consultas de verificación usan columnas reales ---
  // Las columnas se extraen del propio `create table` de sql/06 (así la prueba
  // no se desincroniza si la tabla cambia).
  const bloqueTabla = (sql06.match(/create table if not exists public\.map_points\s*\(([\s\S]*?)\n\);/) || ["", ""])[1];
  const columnas = new Set([...bloqueTabla.matchAll(/^\s{2}([a-z_]+)\s+(?:uuid|text|boolean|double precision|timestamptz)\b/gm)].map((m) => m[1]));
  check(columnas.size >= 15, "SQL: columnas de map_points detectadas", "solo " + columnas.size);
  check(columnas.has("fijo") && columnas.has("active") && !columnas.has("activo"),
    "SQL: la columna de publicación se llama 'active'", "revisa active/activo/fijo");
  const columnasMalas = [];
  for (const rel of ["sql/06_map_points.sql", "sql/07_terminales.sql", "sql/08_puntos_fijos.sql"]) {
    const t = leerTexto(rel) || "";
    // `select <lista> from public.map_points` (sin cruzar el fin de sentencia)
    for (const m of t.matchAll(/select\s+([^;]*?)\s+from\s+public\.map_points/gi)) {
      for (const col of m[1].split(",").map((s) => s.trim().toLowerCase())) {
        if (!col || col === "*" || col.includes("(")) continue;
        if (!columnas.has(col)) columnasMalas.push(`${rel} → ${col}`);
      }
    }
  }
  check(columnasMalas.length === 0, "SQL: las consultas solo usan columnas existentes (error 42703)",
    "columnas inexistentes: " + columnasMalas.join(", "));

  // --- estilo base: URL (no objeto) y limpieza de ne2_shaded ----------------
  // Regresión: en MapLibre 4.7.1 `Style.loadJSON()` aplaza la carga a un
  // requestAnimationFrame; si la pestaña no pinta, el mapa queda en blanco.
  check(/style:\s*MAP_STYLE/.test(main), "estilo: el mapa se crea con la URL del estilo",
    "no usa style: MAP_STYLE (el objeto depende de requestAnimationFrame)");
  check(!/obtenerEstiloBase/.test(main), "estilo: sin estilo como objeto", "quedó obtenerEstiloBase (rompe en segundo plano)");
  check(/function limpiarEstiloBase/.test(main), "estilo: función de limpieza", "falta limpiarEstiloBase");
  check(/removeSource\("ne2_shaded"\)/.test(main), "estilo: quita la fuente ne2_shaded", "no quita ne2_shaded");
  check(/map\.on\("style\.load",\(\)\s*=>\s*\{\s*limpiarEstiloBase\(\);/.test(main),
    "estilo: limpia ne2_shaded antes de añadir capas propias", "la limpieza no ocurre en style.load");

  // --- la atribución se reposa sobre el panel --------------------------------
  check(/actualizarAlturaPanelMapa/.test(main), "atribución: altura del panel actualizada", "falta actualizarAlturaPanelMapa");
  check(/--mapa-panel-h/.test(main) && /--mapa-panel-h/.test(html),
    "atribución: variable CSS --mapa-panel-h", "no se publica la altura del panel");
}

// ------------------------- 7. lote de UX del 2026-11-25 ----------------------
console.log("[7] UX del 2026-11-25: zoom escalonado, metro, bomberos, puntos, muro y agenda");
{
  const main = leerTexto("src/main.js") || "";
  const html = leerTexto("index.html") || "";
  const css = leerTexto("styles.css") || "";

  // --- 1) rampa de zoom en 3 momentos ---------------------------------------
  check(/const ZOOM_PUNTO_MIN\s*=/.test(main) && /const ZOOM_PUNTO_MEDIO\s*=/.test(main) &&
        /const ZOOM_PUNTO_MAX\s*=/.test(main) && /const ZOOM_ICONO\s*=/.test(main) &&
        /const ZOOM_ICONO_MAX\s*=/.test(main),
    "zoom: los cinco umbrales de la rampa están definidos", "faltan ZOOM_PUNTO_MEDIO / ZOOM_PUNTO_MAX / ZOOM_ICONO_MAX");
  check(/const RADIO_PUNTO_MIN\s*=/.test(main) && /const RADIO_PUNTO_MAX\s*=/.test(main),
    "zoom: radio mínimo y máximo del punto", "faltan RADIO_PUNTO_MIN / RADIO_PUNTO_MAX");
  check(/\["step",\["zoom"\],\s*RADIO_PUNTO_MIN,ZOOM_PUNTO_MEDIO,RADIO_PUNTO_MEDIO,ZOOM_PUNTO_MAX,RADIO_PUNTO_MAX/.test(main),
    "zoom: el punto se achica en 3 saltos (12,5 → 11,8 → 11)", "falta el escalón del radio");
  check(/minzoom:ZOOM_PUNTO_MIN,maxzoom:ZOOM_ICONO/.test(main),
    "zoom: el punto de color desaparece en el zoom 10,5", "falta minzoom:ZOOM_PUNTO_MIN en la capa");
  check(/ZOOM_ICONO,ICONO_MIN,ZOOM_ICONO_MAX,ICONO_MAX/.test(main),
    "zoom: el icono aparece pequeño y crece apenas hasta su máximo", "falta la rampa de icon-size");
  check(/ICONO_MAX\s*=\s*0\.\d+/.test(main) && /0\.\d+/.test(main),
    "zoom: el icono nunca llega a un tamaño grande", "ICONO_MAX debería ser pequeño");
  check(/interpolarRampa/.test(main), "zoom: interpolación de la rampa en los marcadores HTML", "falta interpolarRampa");

  // --- 2) puntos fijos sin contorno punteado ---------------------------------
  check(!/map-point-admin/.test(main) && !/\.map-point-admin/.test(css),
    "puntos fijos: sin clase ni contorno punteado", "quedó el contorno punteado de los puntos fijos");
  check(!/dashed/.test(css), "puntos fijos: el CSS no usa bordes punteados", "quedó un borde punteado");

  // --- 3) metro unificado (estaciones + líneas) y nombre bajo el icono ------
  check(/id:"metro",nombre:"Metro \(estaciones y líneas\)"/.test(main),
    "metro: un solo interruptor para estaciones y líneas", "el panel separa estaciones y líneas");
  check(/if\(it\.requiere\) asegurarFuente/.test(main),
    "capas: al abrir la app se recuperan las capas que necesitan fuente (transporte)",
    "el interruptor puede quedar encendido sin datos");
  check(/id:"metro-lineas"/.test(main) && /id:"metro-estaciones-icono"/.test(main),
    "metro: capas de líneas y de icono de estación", "faltan capas del metro");
  check(/id:"metro-nombres"[\s\S]{0,400}"text-field":\["get","nombre"\]/.test(main),
    "metro: rótulo con el nombre de la estación", "falta el texto del rótulo");
  check(/id:"metro-nombres"[\s\S]{0,400}"text-anchor":"top"/.test(main),
    "metro: el nombre va DEBAJO del icono", "el rótulo no está anclado arriba");

  // --- 4) bomberos separados de la policía -----------------------------------
  const bom = leerJSON("data/lugares/bomberos.geojson");
  check(!!bom && bom.features.length > 0, "bomberos: archivo con puntos", "falta data/lugares/bomberos.geojson");
  const seg = leerJSON("data/lugares/seguridad.geojson");
  const segBom = (seg?.features || []).filter((f) => /bombero/i.test(f.properties?.subcategoria || ""));
  check(segBom.length === 0, "bomberos: la capa de seguridad ya no tiene cuarteles", "quedaron " + segBom.length + " cuarteles en seguridad");
  check(/bomberos/.test(main), "bomberos: capa propia en el mapa", "no hay referencia a la capa bomberos");
  check(/ICONO_LUGAR[\s\S]{0,300}bomberos:"bomberos"/.test(main),
    "bomberos: icono propio (no el de la policía)", "bomberos usa el mismo icono que seguridad");

  // --- 5) nombre del terminal / punto debajo del icono ------------------------
  check(/\.map-point-nombre/.test(css), "etiquetas: estilo del nombre bajo el icono", "falta .map-point-nombre");
  check(/className="map-point-nombre"/.test(main), "etiquetas: se crea el nombre bajo el icono", "no se crea .map-point-nombre");
  check(/map-point-con-nombre/.test(main) && /map-point-con-nombre/.test(css),
    "etiquetas: se muestran al acercar el mapa", "falta la clase map-point-con-nombre");

  // --- 6) gestión de puntos del mapa por el admin ----------------------------
  check(/id="capas-admin-btn"/.test(html) && /id="capas-admin-dialog"/.test(html),
    "gestión de capas: botón de ajustes del ADMIN", "falta #capas-admin-btn/#capas-admin-dialog");
  check(/id="puntos-sheet"/.test(html) && /id="puntos-lista"/.test(html) && /id="puntos-guardar"/.test(html),
    "gestión de puntos: hoja con lista y botón Guardar", "faltan #puntos-sheet / #puntos-lista / #puntos-guardar");
  check(/data-punto-nombre/.test(main) && /data-punto-visible/.test(main) && /data-punto-borrar/.test(main),
    "gestión de puntos: renombrar, mostrar/ocultar y borrar", "faltan los controles por fila");
  check(/from\("map_points"\)\s*\n?\s*\.update\(\{name:/.test(main),
    "gestión de puntos: guarda el nombre", "no guarda el nombre del punto");
  check(/update\(\{visible:true\}\)\.in\("id"/.test(main) &&
        /update\(\{visible:false\}\)\.in\("id"/.test(main),
    "gestión de puntos: guarda la visibilidad en bloque", "no guarda el campo visible");
  check(/from\("map_points"\)\.delete\(\)/.test(main),
    "gestión de puntos: borra puntos", "no borra puntos");
  check(/tipo==="general"/.test(main) || /tipo:'general'/.test(main) || /id:"general",titulo/.test(main),
    "gestión de puntos: lista por tipo (general / personal)", "no agrupa por tipo");
  const sql09 = leerTexto("sql/09_admin_gestiona_puntos.sql") || "";
  check(!!sql09, "sql/09_admin_gestiona_puntos.sql existe", "falta el archivo");
  check(/create policy "Admin gestiona todos los puntos"/.test(sql09),
    "sql/09: el admin puede gestionar cualquier punto", "falta la política del admin");

  // --- 7) muro: "Descárgate" con fondo naranja y botón blanco -----------------
  check(/muro-vent/.test(main) && /muro-vent/.test(css),
    "muro: estado naranja de la pestaña Descárgate", "falta la clase muro-vent");
  check(/#f25050/.test(css) && /#d6a100/.test(css),
    "muro: fondo naranja (como el botón Publicar)", "no se replica el degradado naranja");
  check(/wall-tab\.vent-activo\.selected[\s\S]{0,200}background:\s*#ffffff/.test(css),
    "muro: el botón queda blanco", "el botón no queda blanco");
  check(/wall-tab\.vent-activo\.selected[\s\S]{0,260}color:\s*#d96a00/.test(css),
    "muro: las letras quedan naranjas", "las letras no quedan naranjas");

  // --- 8) agenda sin scroll lateral -------------------------------------------
  check(/#view-agenda[^{]*\{[^}]*overflow-x:\s*clip/.test(css),
    "agenda: sin scroll lateral (overflow-x: clip)", "falta overflow-x en #view-agenda");
  check(/#view-agenda \.activity-card/.test(css),
    "agenda: las tarjetas se adaptan al ancho", "faltan reglas de ancho en la agenda");
}

// ------------------- 8. calibración de momentos del 2026-11-26 ---------------
console.log("[8] Calibración 2026-11-26: 3 saltos del punto, corte de textos, grupos sin número");
{
  const main = leerTexto("src/main.js") || "";
  const html = leerTexto("index.html") || "";
  const css = leerTexto("styles.css") || "";

  // --- 1) puntos de color: 3 saltos y desaparición en 10,5 -------------------
  check(/const ZOOM_PUNTO_MIN\s*=\s*10\.5/.test(main),
    "punto: desaparece en el zoom 10,5", "ZOOM_PUNTO_MIN ya no es 10,5");
  check(/const ZOOM_PUNTO_MEDIO\s*=\s*11/.test(main) && /const ZOOM_PUNTO_MAX\s*=\s*11\.8/.test(main),
    "punto: saltos en los zooms 11 y 11,8", "faltan los umbrales 11 / 11,8");
  check(/const ESCALA_PUNTO\s*=\s*0\.85/.test(main),
    "punto: −15 % sobre la rampa (ESCALA_PUNTO = 0,85)", "falta ESCALA_PUNTO");
  check(/RADIO_PUNTO_MIN=3\.5\*ESCALA_PUNTO/.test(main) && /RADIO_PUNTO_MAX=7\*ESCALA_PUNTO/.test(main) &&
        /TAM_PUNTO_MIN=7\*ESCALA_PUNTO/.test(main) && /TAM_PUNTO_MAX=14\*ESCALA_PUNTO/.test(main),
    "punto: los 3 saltos bajan proporcionalmente (radios y diámetros)", "los tamaños no usan ESCALA_PUNTO");
  check(/RADIO_PUNTO_MAX-ESCALA_PUNTO/.test(main) && /RADIO_PUNTO_MAX\+ESCALA_PUNTO/.test(main),
    "punto: los ajustes ± entre capas también se escalan", "quedaron offsets fijos de ±1 px");
  check(/saltoRampa/.test(main), "punto: escalón en los marcadores HTML (saltoRampa)", "falta saltoRampa");
  check(/-puntos-mini[\s\S]{0,300}RADIO_PUNTO_MIN,ZOOM_PUNTO_MEDIO,RADIO_PUNTO_MEDIO,ZOOM_PUNTO_MAX,RADIO_PUNTO_MAX/.test(main),
    "punto: los círculos GeoJSON bajan en 3 saltos", "la rampa de -puntos-mini no escalona");

  // --- 2) grupos: 1 punto pequeño, sin número -------------------------------
  check(!/cluster-count/.test(main) && !/point_count_abbreviated/.test(main),
    "grupos: sin capa de número (cluster-count eliminada)", "sigue el contador de puntos");
  check(/-cluster`,type:"circle"[\s\S]{0,260}minzoom:ZOOM_PUNTO_MIN/.test(main),
    "grupos: el grupo se pinta como 1 punto (con el mismo corte en 10,5)", "el grupo no usa la rampa de puntos");
  check(/clusterMaxZoom:\d+,clusterRadius/.test(main),
    "grupos: clusterMaxZoom entero (un decimal rompe Supercluster)", "clusterMaxZoom no es un entero");

  // --- 3) líneas del metro: visibles alejadas y corte en 9,3 ---------------
  check(/const ZOOM_LINEAS_METRO\s*=\s*9\.3/.test(main),
    "metro: las líneas desaparecen en el zoom 9,3", "ZOOM_LINEAS_METRO no es 9,3");
  check(/id:"metro-lineas"[\s\S]{0,220}minzoom:ZOOM_LINEAS_METRO/.test(main),
    "metro: corte de las líneas en 9,3 (visibles desde 9,3 hacia arriba)", "metro-lineas no tiene minzoom");

  // --- 4) textos: corte nítido 12,4 / 12,5 y tamaño en 2 saltos ------------
  check(/const ZOOM_ICONO\s*=\s*12\.5/.test(main),
    "texto: el corte es en 12,5 (12,4 sin texto)", "ZOOM_ICONO ya no es 12,5");
  check(/classList\.toggle\("map-point-con-nombre",z>=ZOOM_ICONO\)/.test(main),
    "texto: corte nítido en los marcadores HTML", "el nombre no obedece a z>=ZOOM_ICONO");
  check(/id:"metro-nombres"[\s\S]{0,420}"text-size":\["step",\["zoom"\],TEXTO_MIN,ZOOM_TEXTO_MEDIO,TEXTO_MEDIO,ZOOM_TEXTO_MAX,TEXTO_MAX\]/.test(main),
    "texto: tamaño del rótulo en 2 saltos (9 → 10 → 11 px)", "metro-nombres no escalona el text-size");
  check(/font-size:\s*var\(--nombre-tam/.test(css),
    "texto: el nombre del marcador usa --nombre-tam", "falta var(--nombre-tam) en .map-point-nombre");
  check(/const TEXTO_MAX\s*=\s*11/.test(main),
    "texto: el tamaño máximo sigue siendo 11 px", "TEXTO_MAX ya no es 11");

  // --- 5) el medidor de zoom quedó fuera ------------------------------------
  check(!/medidores-calibracion/.test(html) && !/pintarMedidores/.test(main),
    "medidor: eliminado tras calibrar", "sigue el medidor de zoom");
}

// ------------------- 9. Acceso: login por usuario, grupo automático y registro --
console.log("[9] Acceso: login por usuario, grupo automático y registro");
{
  const sql10 = leerTexto("sql/10_grupos.sql") || "";
  const sql11 = leerTexto("sql/11_rls_grupos.sql") || "";
  const sql14 = leerTexto("sql/14_registro_perfiles.sql") || "";
  const fnLogin = leerTexto("supabase/functions/login-username/index.ts") || "";
  const fnReg = leerTexto("supabase/functions/register-profile/index.ts") || "";
  const main = leerTexto("src/main.js") || "";
  const html = leerTexto("index.html") || "";
  const sw = leerTexto("sw.js") || "";

  // --- 1) estructura de grupos (sql/10) --------------------------------------
  check(/create table if not exists public\.groups\s*\(/.test(sql10),
    "grupos: tabla public.groups", "falta la tabla groups");
  check(/insert into public\.groups \(slug, name, description\)[\s\S]{0,160}'principal'/.test(sql10),
    "grupos: siembra el grupo principal", "no se crea el grupo principal");
  check(/alter table public\.profiles add column if not exists group_id uuid/.test(sql10) &&
        /add column if not exists group_admin boolean not null default false/.test(sql10),
    "grupos: profiles.group_id + group_admin", "faltan las columnas de grupo en profiles");
  check(/alter table public\.events\s+alter column group_id set not null/.test(sql10) &&
        /alter table public\.activities\s+alter column group_id set not null/.test(sql10) &&
        /alter table public\.wall_posts\s+alter column group_id set not null/.test(sql10),
    "grupos: group_id NOT NULL en events, activities y wall_posts", "algún group_id quedó nullable");
  check(/update public\.activities a\s+set group_id = e\.group_id[\s\S]{0,80}from public\.events e/.test(sql10),
    "grupos: las actividades heredan el grupo del evento", "no se backfillean las actividades");
  check(/events_asignar_grupo/.test(sql10) && /activities_asignar_grupo/.test(sql10) &&
        /wall_posts_asignar_grupo/.test(sql10),
    "grupos: triggers rellenan group_id (compatibilidad con el frontend anterior)",
    "faltan los triggers de group_id");
  check(/create or replace function public\.auth_group\(\)/.test(sql10) &&
        /create or replace function public\.can_manage_group\(g uuid\)/.test(sql10),
    "grupos: helpers auth_group() y can_manage_group()", "faltan los helpers de grupo");
  check(/create or replace function public\.handle_new_user\(\)[\s\S]{0,1400}group_id/.test(sql10),
    "grupos: los perfiles nuevos nacen con grupo", "handle_new_user no asigna grupo");
  check(/grant select \(id, slug, name, description, active, created_at, updated_at\)[\s\S]{0,120}on public\.groups to authenticated/.test(sql10) &&
        !/grant select, insert, update, delete on public\.groups to authenticated/.test(sql10),
    "grupos: GRANT por columna (el hash queda fuera) + service_role completo",
    "authenticated conserva un GRANT de tabla que incluiría el hash");

  // --- 2) políticas RLS (sql/11) ---------------------------------------------
  check(/create policy "Miembros consultan su grupo"/.test(sql11) &&
        /create policy "Admin gestiona grupos"/.test(sql11),
    "RLS: grupos visibles solo para sus miembros", "faltan las políticas de groups");
  check(/create policy "Usuarios consultan perfiles de su grupo"/.test(sql11),
    "RLS: perfiles limitados al grupo", "los perfiles no están separados por grupo");
  check(/create policy "Usuarios consultan eventos de su grupo"/.test(sql11) &&
        /create policy "Usuarios consultan actividades de su grupo"/.test(sql11),
    "RLS: eventos y actividades por grupo", "faltan las políticas de agenda");
  check(/create policy "Usuarios leen el muro de su grupo"/.test(sql11) &&
        /create policy "Usuarios publican en su grupo"/.test(sql11),
    "RLS: muro por grupo", "faltan las políticas del muro");
  check(/group_id = public\.auth_group\(\)/.test(sql11) &&
        /public\.can_manage_group\(/.test(sql11),
    "RLS: lectura por auth_group() y escritura por can_manage_group()", "las políticas no usan los helpers");
  check(!/using \(true\)/.test(sql11),
    "RLS: sin políticas abiertas (using true)", "quedó una política abierta");

  // --- 3) contraseña de grupo + registro (sql/14) ----------------------------
  check(/add column if not exists join_password_hash text/.test(sql14),
    "registro: groups.join_password_hash (bcrypt)", "falta la columna del hash");
  check(/create or replace function public\.definir_password_grupo[\s\S]{0,2500}gen_salt\('bf'/.test(sql14),
    "registro: definir_password_grupo() hashea con bcrypt", "no se hashea la contraseña de grupo");
  check(/set search_path to public, extensions/.test(sql14) &&
        !/set search_path to 'public, extensions'/.test(sql14),
    "registro: search_path como lista de esquemas (pgcrypto en public/extensions)",
    "el search_path está entre comillas y crypt() no se resuelve");
  check(/create or replace function public\.verificar_password_grupo[\s\S]{0,700}crypt\(p_password, g\.join_password_hash\)/.test(sql14),
    "registro: verificar_password_grupo() compara el hash", "la verificación no usa crypt()");
  check(/grant execute on function public\.verificar_password_grupo\(text, text\) to service_role/.test(sql14) &&
        !/grant execute on function public\.verificar_password_grupo\(text, text\) to (anon|authenticated)/.test(sql14),
    "registro: solo service_role puede verificar la contraseña de grupo",
    "anon/authenticated pueden verificar el hash (fuerza bruta)");
  check(/create or replace function public\.grupos_para_registro/.test(sql14) &&
        /grant execute on function public\.grupos_para_registro\(\) to anon/.test(sql14),
    "registro: grupos_para_registro() para el selector (anon)", "falta la RPC del registro");
  check(/revoke select, insert, update, delete on public\.groups from authenticated/.test(sql14) &&
        /grant select \(id, slug, name, description, active, created_at, updated_at\)/.test(sql14),
    "registro: la app no puede leer ni escribir el hash de grupo", "el hash quedó expuesto en los GRANT");
  check(/create unique index if not exists profiles_username_lower_key/.test(sql14) &&
        !/drop constraint[^;]*profiles_username_key/.test(sql14),
    "registro: usuario único global (decisión del proyecto) e insensible a mayúsculas",
    "se perdió la unicidad global o falta el índice lower()");
  check(/create trigger profiles_proteger_identidad/.test(sql14) &&
        /No puedes cambiar tu nombre de usuario ni tu grupo/.test(sql14),
    "registro: el usuario no puede cambiar su nombre ni su grupo", "falta la protección de identidad");

  // --- 4) Edge Function de registro -----------------------------------------
  check(/action === "validar-grupo"/.test(fnReg) && /action === "sugerir-usuario"/.test(fnReg) &&
        /action === "registrar"/.test(fnReg),
    "registro: acciones validar-grupo, sugerir-usuario y registrar", "faltan acciones del registro");
  check(/\.rpc\("verificar_password_grupo"/.test(fnReg),
    "registro: valida la contraseña de grupo en el servidor", "no se verifica la contraseña de grupo");
  check(/USERNAME_TAKEN/.test(fnReg) && /sugerencias: await alternativas/.test(fnReg),
    "registro: nombre tomado → 409 con alternativas comprobadas", "no se sugieren alternativas");
  check(/auth\.admin\.createUser/.test(fnReg) && /email_confirm: true/.test(fnReg) &&
        /user_metadata:/.test(fnReg) && /group_id: group\.id/.test(fnReg),
    "registro: crea el usuario en Auth con el grupo validado", "no se crea el usuario con su grupo");
  check(/signInWithPassword/.test(fnReg),
    "registro: inicia sesión al terminar el registro", "no se devuelve una sesión");
  check(/APP_SUPABASE_SERVICE_ROLE_KEY/.test(fnReg) && !/service_role_eyJ|sb_secret_/.test(fnReg),
    "registro: la función usa variables de entorno (sin claves en el repo)", "hay una clave incrustada");

  // --- 5) login v2: usuario + contraseña, grupo automático -------------------
  check(!/groupRef/.test(fnLogin) && !/if \(!username \|\| !password \|\| !groupRef\)/.test(fnLogin),
    "login: ya no exige el grupo", "la función sigue pidiendo el grupo");
  check(/\.eq\("username", username\)/.test(fnLogin) &&
        /\.select\("id, username, full_name, role, active, group_id"\)/.test(fnLogin),
    "login: busca el perfil por usuario", "no busca el perfil por usuario");
  check(/USER_NOT_FOUND/.test(fnLogin),
    "login: 404 USER_NOT_FOUND para ofrecer el registro", "no distingue usuario inexistente");
  check(/\.from\("groups"\)[\s\S]{0,220}\.eq\("id", profile\.group_id\)/.test(fnLogin),
    "login: detecta el grupo desde el perfil", "no se consulta el grupo del perfil");
  check(/getUserById/.test(fnLogin) && /signInWithPassword/.test(fnLogin),
    "login: resuelve el email y verifica la contraseña", "falta el flujo de autenticación");
  check(/APP_SUPABASE_SERVICE_ROLE_KEY/.test(fnLogin) &&
        !/service_role_eyJ|sb_secret_/.test(fnLogin),
    "login: la función usa variables de entorno (sin claves en el repo)", "hay una clave incrustada");

  // --- 6) frontend: login simple + registro progresivo ----------------------
  check(/id="login-form"/.test(html) && /id="username"/.test(html) && /id="password"/.test(html),
    "login: usuario + contraseña", "falta el formulario de login");
  check(!/id="login-group"/.test(html),
    "login: sin selector de grupo", "el login sigue pidiendo el grupo");
  check(/id="login-register-link"/.test(html) && /id="register-panel"/.test(html),
    "registro: botón y panel de registro", "falta el acceso al registro");
  check(/id="reg-group"/.test(html) && /id="reg-group-password"/.test(html) &&
        /id="reg-validar"/.test(html),
    "registro: paso 1 (grupo + contraseña del grupo)", "falta el paso del grupo");
  check(/id="reg-username"/.test(html) && /id="reg-password"/.test(html) &&
        /id="reg-password2"/.test(html) && /id="reg-crear"/.test(html),
    "registro: paso 2 (usuario + contraseña personal)", "falta el paso del perfil");
  check(/id="reg-sugerencias"/.test(html) && /id="reg-sugerencias-lista"/.test(html),
    "registro: contenedor de nombres alternativos", "faltan las sugerencias");
  check(/usernameLogin\(username,password\)/.test(main) && !/body\.group=group/.test(main),
    "login: el frontend ya no envía el grupo", "el frontend sigue enviando el grupo");
  check(/err\.code==="USER_NOT_FOUND"/.test(main) && /abrirRegistro/.test(main),
    "login: usuario inexistente abre el registro", "no se ofrece el registro");
  check(/action:"validar-grupo"/.test(main) && /action:"registrar"/.test(main),
    "registro: el frontend llama a las acciones del servidor", "faltan las llamadas del registro");
  check(/mostrarSugerencias/.test(main) && /data-sugerencia/.test(main),
    "registro: las alternativas se ofrecen sin autoasignar", "no se muestran sugerencias");
  check(/grupos_para_registro/.test(main),
    "registro: el selector usa grupos_para_registro()", "no se consulta la RPC del registro");
  check(!/join_password_hash/.test(main) && !/join_password_hash/.test(html),
    "seguridad: el frontend nunca toca el hash de la contraseña de grupo", "el hash aparece en el cliente");
  check(/function filtrarGrupo\(q\)/.test(main) && /state\.groupId/.test(main) &&
        /filtrarGrupo\(supabase\.from\("events"\)/.test(main) &&
        /filtrarGrupo\(supabase\.from\("wall_posts"\)/.test(main),
    "datos: agenda y muro filtrados por el grupo activo", "alguna consulta no filtra por grupo");
  check(/faltan las columnas de grupo|falta la columna de grupo/.test(main),
    "compatibilidad: el login no se rompe si falta sql/10", "no hay respaldo sin columnas de grupo");
  check(/\[\"#agenda-past-days\",\"#agenda-active-list\",\"#agenda-upcoming-days\"\]/.test(main),
    "agenda: al cambiar a un grupo sin evento se limpian los días anteriores",
    "quedan tarjetas del grupo anterior en el DOM");
  check(/\$\("#agenda-active-day"\)\?\.classList\.add\("hidden"\)/.test(main),
    "agenda: la tarjeta del día activo se oculta si HOY no tiene actividades",
    "el encabezado del día anterior puede quedar visible");
  check(/app-santiago-2026-v33/.test(sw),
    "service worker: v23 (ADMIN/MANAGER + puntos bloqueados)", "el SW no se renovó");
}

// ------------------- 10. Fase 2: categorías, colores y alcance (2026-11-26) -----
console.log("[10] Fase 2: categorías, color por categoría y alcance global/grupo");
{
  const sql15 = leerTexto("sql/15_categorias_puntos.sql") || "";
  const main = leerTexto("src/main.js") || "";
  const html = leerTexto("index.html") || "";
  const css = leerTexto("styles.css") || "";

  // --- 1) categorías (sql/15) -----------------------------------------------
  check(/create table if not exists public\.map_categories/.test(sql15),
    "categorías: tabla map_categories", "falta la tabla de categorías");
  check(/insert into public\.map_categories[\s\S]{0,1200}'centro_salud'/.test(sql15) &&
        /'jw'/.test(sql15) && /'kiosco'/.test(sql15) && /'expositor'/.test(sql15),
    "categorías: semilla con centro de salud, JW, kiosco y expositor",
    "faltan categorías del documento");
  check(/constraint map_categories_color_check check \(color ~/.test(sql15),
    "categorías: color validado como #rrggbb", "el color no se valida");
  check(/map_points_category_fkey/.test(sql15) &&
        /drop constraint if exists map_points_category_check/.test(sql15),
    "categorías: map_points.category pasa a ser FK", "no se migró la categoría");
  check(/'transporte'[\s\S]{0,260}'comercio'/.test(sql15) &&
        /'areas_verdes'/.test(sql15) && /'educacion'/.test(sql15),
    "categorías: conserva las categorías antiguas (transporte, comercio, …)",
    "se perdieron las categorías anteriores del mapa");
  check(/'transporte'[\s\S]{0,4000}then 'metro'/.test(sql15) === false,
    "categorías: NO renombra los puntos antiguos (los terminales siguen en transporte)",
    "la migración convertiría los terminales de buses en metro");

  // --- 2) alcance global/grupo (sql/15) -------------------------------------
  check(/add column if not exists group_id uuid/.test(sql15) &&
        /add column if not exists scope text not null default 'group'/.test(sql15),
    "alcance: columnas group_id y scope", "faltan las columnas de alcance");
  check(/set scope = 'global', group_id = null/.test(sql15),
    "alcance: los puntos generales existentes quedan globales",
    "no se hace el backfill de los puntos generales");
  check(/set group_id = null\s+where scope = 'global'/.test(sql15),
    "alcance: los puntos globales no conservan group_id",
    "un punto global queda con el grupo de su autor");
  check(/create trigger map_points_asignar_grupo/.test(sql15) &&
        /asignar_grupo_punto/.test(sql15),
    "alcance: trigger de compatibilidad rellena grupo/scope", "falta el trigger");
  check(/create policy "Puntos visibles por grupo o globales"/.test(sql15) &&
        /scope = 'global' or group_id = public\.auth_group\(\)/.test(sql15),
    "RLS: puntos globales y de grupo", "la política no distingue alcance");
  check(/create policy "Admin de grupo gestiona puntos personales de su grupo"/.test(sql15),
    "RLS: el admin de grupo modera los personales de su grupo", "falta la política del admin de grupo");
  check(/create policy "Admin gestiona las categorías"/.test(sql15),
    "RLS: solo el admin global cambia las categorías", "las categorías no están protegidas");

  // --- 3) frontend: categorías y colores ------------------------------------
  check(/async function cargarCategorias/.test(main) && /from\("map_categories"\)/.test(main),
    "mapa: carga las categorías desde Supabase", "no se cargan las categorías");
  check(/function colorCategoria/.test(main) && /function colorDeCapa/.test(main),
    "mapa: color por categoría (incluidas las capas externas)", "falta el color por categoría");
  check(/colorCategoria\("metro"/.test(main),
    "mapa: el metro usa el color de su categoría", "el metro sigue con colores fijos");
  check(/function aplicarColoresCategorias/.test(main) &&
        /setPaintProperty\(id,"circle-color",color\)/.test(main),
    "mapa: al guardar un color se actualizan las capas cargadas", "no se refrescan los colores");

  // --- 4) frontend: formulario y alcance ------------------------------------
  check(/id="point-scope"/.test(html) && /id="point-group"/.test(html),
    "formulario: alcance global/grupo y grupo", "faltan los campos de alcance");
  check(/function actualizarCamposPunto/.test(main) &&
        /id="point-visible-label"/.test(html),
    "formulario: muestra/oculta alcance y grupo según el rol", "no se ajustan los campos");
  check(/function puntoGestionable/.test(main),
    "permisos: el admin de grupo no edita los puntos globales", "no se distingue el alcance al editar");

  // --- 5) frontend: gestión por categoría -----------------------------------
  check(/id="puntos-buscar"/.test(html) && /id="puntos-todos"/.test(html) &&
        /id="puntos-ninguno"/.test(html) && /id="puntos-resumen"/.test(html),
    "gestión: buscador, seleccionar todos/deseleccionar y contador",
    "faltan los controles de la lista");
  check(/data-cat-color/.test(main) && /data-cat-abrir/.test(main),
    "gestión: lista de categorías con color y acceso al detalle",
    "no se gestionan las categorías");
  check(/update\(\{color\}\)\.eq\("slug"/.test(main) &&
        /update\(\{visible:true\}\)\.in\("id"/.test(main),
    "gestión: guarda colores y visibilidad en bloque", "no se guardan los cambios");
  check(/data-punto-ubicar/.test(main) && /flyTo\(\{center:\[p\.longitude,p\.latitude\]/.test(main),
    "gestión: botón para ubicar el punto en el mapa", "falta ubicar el punto");
  check(/\.map-point-oculto-admin/.test(css) && /map-point-oculto-admin/.test(main),
    "mapa: el admin ve atenuados los puntos ocultos", "no se distingue el punto oculto");
}

// ------------------- 11. Fase 3: categoría JW y actividades (2026-11-26) ------
console.log("[11] Fase 3: categoría JW y actividades vinculadas");
{
  const sql16 = leerTexto("sql/16_jw_actividades.sql") || "";
  const main = leerTexto("src/main.js") || "";
  const html = leerTexto("index.html") || "";

  // --- 1) SQL (vínculo actividad ↔ punto JW) --------------------------------
  check(/add column if not exists map_point_id uuid/.test(sql16),
    "JW: activities.map_point_id", "falta la columna del punto JW en actividades");
  check(/drop constraint if exists map_points_icon_check/.test(sql16),
    "JW: elimina el CHECK antiguo de iconos (salon no estaba permitido)",
    "el icono salon sigue bloqueado por una restricción vieja");
  check(/activities_map_point_id_fkey/.test(sql16) && /on delete set null/.test(sql16),
    "JW: FK a map_points con ON DELETE SET NULL", "falta la FK/acción de borrado");
  check(/create trigger activities_validar_punto/.test(sql16) &&
        /v_categoria <> 'jw'/.test(sql16),
    "JW: la actividad solo puede usar puntos de categoría JW", "no se valida la categoría");
  check(/v_scope = 'group' and v_group is distinct from v_act_group/.test(sql16),
    "JW: el punto de grupo debe ser del mismo grupo que la actividad",
    "no se valida el grupo del punto");

  // --- 2) Formulario de actividad ------------------------------------------
  check(/id="activity-point"/.test(html) && /id="activity-mark-map"/.test(html),
    "actividad: selector de punto JW + botón para marcar en el mapa",
    "falta el selector o el botón");
  check(!/id="activity-lat"/.test(html) && !/id="activity-lng"/.test(html),
    "actividad: sin coordenadas manuales", "siguen los campos de latitud/longitud");
  check(/async function cargarPuntosJW/.test(main) && /eq\("category","jw"\)/.test(main),
    "actividad: carga los puntos JW disponibles", "no se cargan los puntos JW");
  check(/map_point_id:puntoId/.test(main) && /reabrirActividadPendiente/.test(main),
    "actividad: guarda el vínculo y reabre tras marcar en el mapa",
    "no se guarda map_point_id o no se reabre");
  check(/state\.puntoParaActividad/.test(main) && /Punto JW creado/.test(main),
    "actividad: flujo de punto JW nuevo desde la actividad", "falta el flujo de marcado");

  // --- 3) Marcadores JW -----------------------------------------------------
  check(/el\.dataset\.jw=p\.category==="jw"/.test(main),
    "JW: el marcador se identifica como JW", "no se marca el punto como JW");
  check(/esJW\?tamIcono\*1\.2:tamIcono/.test(main),
    "JW: icono 20 % más grande que el resto", "no se aplica el +20 %");
  check(/const fijo=el\.dataset\.fijo==="1" \|\| esJW/.test(main),
    "JW: siempre mantiene el icono (nunca punto de color)", "el JW se convierte en círculo");
  check(/map-point-jw/.test(main),
    "JW: clase propia para las animaciones futuras", "falta la clase map-point-jw");

  // --- 4) Actividad en el mapa y popup JW ----------------------------------
  check(/enlazarTarjetasActividad/.test(main) && /data-mapa=/.test(main),
    "agenda: botón Ver en mapa en las tarjetas", "no hay acción para ver la actividad");
  check(/function verActividadEnMapa/.test(main) && /togglePopup/.test(main),
    "agenda: vuela al punto JW y abre su popup", "no se visualiza la actividad en el mapa");
  check(/actividadesJW/.test(main) && /map_point_id===p\.id/.test(main),
    "JW: el popup lista las actividades del punto", "el popup no muestra las actividades");
  check(/sql\/16_jw_actividades\.sql/.test(main),
    "compatibilidad: avisa si falta sql/16 al guardar la actividad",
    "no hay respaldo sin la columna map_point_id");
}

// ------------------- 12. Fase 4: evento general editable (2026-11-26) --------
console.log("[12] Fase 4: evento general editable");
{
  const main = leerTexto("src/main.js") || "";
  const html = leerTexto("index.html") || "";
  const sql11 = leerTexto("sql/11_rls_grupos.sql") || "";

  check(/id="event-edit-btn"/.test(html),
    "evento: botón para editarlo en la agenda", "falta #event-edit-btn");
  check(/id="event-dialog"/.test(html) && /id="event-name"/.test(html) &&
        /id="event-start"/.test(html) && /id="event-end"/.test(html) &&
        /id="event-form"/.test(html),
    "evento: diálogo con nombre, fechas y formulario", "faltan campos del evento");
  check(/function openEventForm/.test(main) && /event-edit-btn"\)\?\.addEventListener/.test(main),
    "evento: el botón abre el formulario", "no se abre el formulario del evento");
  check(/from\("events"\)\.update\(p\)/.test(main) && /from\("events"\)\.insert/.test(main),
    "evento: actualiza o crea el evento", "no se guarda el evento");
  check(/created_by:state\.user\.id/.test(main) && /status:"published"/.test(main),
    "evento: se crea publicado y con autor", "falta el autor o el estado publicado");
  check(/fin<inicio/.test(main) && /El nombre del evento es obligatorio/.test(main),
    "evento: valida nombre y rango de fechas", "faltan validaciones del evento");
  check(/\$\("#event-edit-btn"\)\?\.classList\.toggle\("hidden",!esGestorDeGrupo\(\) \|\| esAdminGeneral\(\)\)/.test(main),
    "evento: solo admin global/de grupo ve el botón", "el botón no respeta el rol");
  check(/create policy "Admin o admin de grupo gestiona eventos"/.test(sql11),
    "evento: RLS de escritura por grupo (sql/11, sin SQL nuevo)",
    "falta la política de escritura del evento");
  check(/id="event-dialog-title"/.test(html) && /Editar evento"|Crear evento/.test(main),
    "evento: título dinámico Editar/Crear", "el diálogo no distingue editar/crear");
}

// ------------------- 13. Fase 5: agenda completa, FAB y SOS (2026-11-26) -----
console.log("[13] Fase 5: agenda con todos los días, FAB y SOS");
{
  const main = leerTexto("src/main.js") || "";
  const html = leerTexto("index.html") || "";
  const sw = leerTexto("sw.js") || "";

  check(!/filter-tab|tab-mine|tab-all|count-mine|count-all/.test(html) &&
        !/state\.filter|syncFilterControls/.test(main),
    "agenda: sin filtro Mis/Todas", "quedó el filtro de actividades");
  check(/for\(let d=state\.event\.start_date; d<=state\.event\.end_date; d=sumarDias\(d,1\)\)/.test(main),
    "agenda: genera todos los días del evento", "solo se muestran días con actividades");
  check(/const isPast=date<today;/.test(main) && /const dayNode=isPast\?past:upcoming;/.test(main),
    "agenda: los días pasados van al bloque de pasados", "se comparan Date y string (todos caen en próximos)");
  check(/Sin actividades registradas/.test(main) && /Sin actividades programadas/.test(main),
    "agenda: días sin actividades con mensaje", "falta el mensaje de día vacío");
  check(/\$\("#active-day-subtitle"\)\.textContent=items\[0\]\?\.description/.test(main),
    "agenda: subtítulo del día activo dinámico", "el subtítulo sigue estático");
  check(/const mes=\(dt\)=>dt\.toLocaleDateString\("es-CL",\{month:"short"\}\)\.toUpperCase\(\)/.test(main) &&
        !/>OCT</.test(html),
    "agenda: mes real en las tarjetas de día", "quedó el mes fijo OCT");
  check(/id="view-agenda"[^>]*pb-28/.test(html),
    "agenda: espacio inferior para el FAB", "la agenda no reserva espacio para el FAB");
  check(/id="admin-create-wrap"[^>]*fixed right-4/.test(html) &&
        /id="new-activity-btn"[^>]*w-14 h-14 rounded-full/.test(html),
    "FAB: Nueva actividad circular fija a la derecha", "el botón no es un FAB fijo");
  check(/id="sos-fab"/.test(html) && /#F25050/i.test(html) &&
        /target="_blank"/.test(html) && /rel="noopener"/.test(html),
    "SOS: botón flotante rojo en pestaña nueva", "falta el SOS flotante");
  check(/\$\("#sos-fab"\)\?\.setAttribute\("href",EMERGENCY_URL\)/.test(main) &&
        /id="emergency-open-link"/.test(html) &&
        /Abrir sistema de emergencia/.test(html),
    "SOS: el botón flotante y el enlace inferior abren EMERGENCY_URL",
    "el SOS no abre la URL configurada");
  check(!/sosButton|ACTIVAR PROTOCOLO|Protocolo de seguridad|crisis_alert|net-status/.test(html) &&
        /id="emergency-contacts"/.test(html) &&
        /id="emergency-open-link"/.test(html),
    "Emergencia: solo contactos + botón inferior (sin hero SOS)",
    "quedaron restos del hero/estado de red");
  check(/bottom: calc\(4\.5rem \+ env\(safe-area-inset-bottom/.test(html),
    "SOS/FAB: sobre la barra de navegación (safe area)", "no respetan la barra inferior");
  check(/app-santiago-2026-v33/.test(sw),
    "service worker: v23", "el SW no se renovó");
}

// ------------------- 14. Fase 6: animaciones JW (2026-11-26) -----------------
console.log("[14] Fase 6: animaciones JW (destello y latido)");
{
  const main = leerTexto("src/main.js") || "";
  const css = leerTexto("styles.css") || "";
  const { estadoJW, ahoraChile } = await import(pathToFileURL(join(ROOT, "src/jw-tiempo.js")).href);
  const act = (o = {}) => ({ fecha: "2026-11-26", inicio: "18:00", fin: "19:00", ...o });

  check(estadoJW([act()], "2026-11-26T17:00").estado === "destello",
    "JW: actividad de hoy antes del latido → destello", "no destella");
  check(estadoJW([act()], "2026-11-26T17:30").estado === "latido",
    "JW: 30 minutos antes → latido", "no late a −30");
  check(estadoJW([act()], "2026-11-26T18:00").estado === "destello",
    "JW: al inicio → destello", "no destella al inicio");
  check(estadoJW([act()], "2026-11-26T19:29").estado === "destello",
    "JW: al término +30 → destello", "se apaga antes del +30");
  check(estadoJW([act()], "2026-11-26T19:31").estado === null,
    "JW: después del +30 sin otra → se apaga", "sigue destacado");
  check(estadoJW([act(), act({ inicio: "21:00", fin: "22:00" })], "2026-11-26T19:31").estado === "destello",
    "JW: después del +30 pasa a la siguiente de hoy", "no resalta la siguiente");
  check(estadoJW([act({ inicio: "21:00", fin: "22:00" })], "2026-11-26T20:30").estado === "latido",
    "JW: latido de la siguiente 30 min antes", "no late la siguiente");
  check(estadoJW([act()], "2026-11-27T10:00").estado === null,
    "JW: otro día no se destaca", "destella fuera de su día");
  check(estadoJW([act({ cancelada: true })], "2026-11-26T18:10").estado === null,
    "JW: actividad cancelada no anima", "anima una cancelada");
  check(estadoJW([act()], "2026-11-26T12:00").estado === "destello",
    "JW: actividad de hoy sin hora cercana → destello", "no destella de día");

  const ch = ahoraChile(new Date("2026-11-26T20:30:00Z"));
  check(ch.fecha === "2026-11-26" && ch.hora === "17:30",
    "JW: hora de Chile (UTC-3 en noviembre)", `dio ${ch.iso}`);

  check(/@keyframes jw-destello/.test(css) && /@keyframes jw-latido/.test(css),
    "JW: keyframes de destello y latido", "faltan las animaciones CSS");
  check(/\.map-point-jw\.jw-destello/.test(css) && /\.map-point-jw\.jw-latido/.test(css),
    "JW: clases de animación en el marcador", "faltan las clases");
  check(/\.map-point-jw\.jw-latido \.map-point-jw-anim/.test(css) &&
        /@keyframes jw-latido\s*\{[\s\S]{0,220}transform: scale\(1\.22\)/.test(css),
    "JW: el latido escala el icono interior EN SU LUGAR",
    "el latido anima el marcador posicionado (puede desplazarse)");
  check(/transform-origin: 50% 50%/.test(css),
    "JW: origen de animación centrado", "el icono no escala desde el centro");
  check(!/\.map-point-jw\.jw-(destello|latido)\s*\{[^}]*animation/.test(css),
    "JW: no se anima el marcador (solo el icono interior)",
    "el marcador con transform de MapLibre recibe la animación");
  check(/classList\.toggle\("jw-latido"/.test(main) && /map-point-jw-anim/.test(main),
    "JW: el marcador crea el icono interior animable", "falta el icono interior");
  check(/import \{ ahoraChile, estadoJW \} from "\.\/jw-tiempo\.js"/.test(main),
    "JW: el frontend usa el módulo de tiempo", "no importa jw-tiempo");
  check(/setInterval\(aplicarEstadoJW,60000\)/.test(main),
    "JW: temporizador de 60 s (sin consultas a Supabase)", "no hay temporizador");
  check(/aplicarEstadoJW\(\);\s*\}/.test(main),
    "JW: el estado se reaplica al renderizar los puntos", "no se aplica al render");
  check(/app-santiago-2026-v33/.test(leerTexto("sw.js") || ""),
    "service worker: v23", "el SW no se renovó");
}

// ------------------- 15. Jerarquía ADMIN / MANAGER (sql/17) -----------------
{
  const sql17 = leerTexto("sql/17_admin_manager.sql") || "";
  const html = leerTexto("index.html") || "";
  const css = leerTexto("styles.css") || "";
  const main = leerTexto("src/main.js") || "";

  check(/role in \('admin', 'manager', 'user'\)/.test(sql17),
    "ADMIN/MANAGER: roles admin, manager y user", "falta el CHECK de roles");
  check(/drop column if exists group_admin/.test(sql17),
    "ADMIN/MANAGER: group_admin migrado y eliminado", "group_admin sigue como fuente de verdad");
  check(/function public\.can_manage_group\(g uuid\)[\s\S]{0,420}p\.role = 'manager' and p\.group_id = g/.test(sql17),
    "ADMIN/MANAGER: can_manage_group limita al MANAGER a su grupo",
    "el manager podría administrar otros grupos");
  check(/function public\.admin_grupos\(\)/.test(sql17) &&
        /if not public\.is_admin\(\) then/.test(sql17) &&
        /has_password/.test(sql17),
    "ADMIN/MANAGER: admin_grupos() es solo para ADMIN y no expone el hash",
    "la RPC de grupos no está protegida");
  check(/add column if not exists bloqueado boolean/.test(sql17) &&
        /map_points_bloqueado_check/.test(sql17) &&
        /function public\.proteger_punto_bloqueado\(\)/.test(sql17),
    "ADMIN/MANAGER: puntos bloqueados con CHECK y trigger", "falta la protección de puntos");
  check(/old\.bloqueado and not v_admin/.test(sql17) &&
        /new\.bloqueado and not v_admin/.test(sql17),
    "ADMIN/MANAGER: solo el ADMIN modifica puntos bloqueados",
    "un manager podría editar un punto bloqueado");
  check(/add column if not exists series_id uuid/.test(sql17) &&
        /activities_series_idx/.test(sql17),
    "ADMIN/MANAGER: actividades multi-grupo con series_id", "falta series_id");
  check(/new\.group_id := v_grupo;/.test(sql17),
    "ADMIN/MANAGER: el grupo de la actividad sale del evento",
    "el cliente puede asignar un grupo incoherente");
  check(/slug ~ '\^\[a-z0-9\]\[a-z0-9_-\]\{0,40\}\$'/.test(sql17),
    "ADMIN/MANAGER: grupos con número de 1 carácter", "el slug sigue exigiendo 2 caracteres");

  check(/function esAdminGeneral\(\)/.test(main) &&
        /function esManager\(\)/.test(main) &&
        /function esGestorDeGrupo\(\)/.test(main),
    "ADMIN/MANAGER: helpers de rol en el frontend", "faltan los helpers");
  check(!/group_admin/.test(main),
    "ADMIN/MANAGER: el frontend ya no usa group_admin", "queda código con group_admin");
  check(/function configurarVistaPorRol\(\)/.test(main) &&
        /data-view=.*grupos|v==="grupos"/.test(main),
    "ADMIN/MANAGER: navegación por rol", "no se configura la vista por rol");
  check(/cargarGruposAdmin\(\)/.test(main) && /admin_grupos/.test(main) &&
        /cargarActividadesAdmin\(\)/.test(main),
    "ADMIN/MANAGER: cargadores de grupos y actividades generales",
    "faltan los cargadores del ADMIN");
  check(/seriesId=edit\?\.series_id/.test(main) || /payload\.series_id=seriesId/.test(main) ||
        /series_id:seriesId/.test(main),
    "ADMIN/MANAGER: el ADMIN guarda actividades por serie", "no se usa series_id");
  check(/\.eq\("series_id",a\.series_id\)/.test(main),
    "ADMIN/MANAGER: borrar una serie elimina todas sus filas",
    "solo se borra una fila");
  check(/payload\.bloqueado/.test(main) && /point-bloqueado/.test(main),
    "ADMIN/MANAGER: el formulario de punto marca bloqueado", "falta el checkbox bloqueado");
  check(/p\?\.bloqueado \|\| capasEstado\.puntos/.test(main),
    "ADMIN/MANAGER: los puntos bloqueados no se ocultan con la capa",
    "la capa puede ocultar un punto bloqueado");
  check(/data-contacto-edit/.test(main) && /is_general:true,user_id:null/.test(main),
    "ADMIN/MANAGER: contactos generales editables por el ADMIN",
    "falta el CRUD de contactos");
  check(/data-miembro-rol/.test(main) && /role:b\.dataset\.rol/.test(main),
    "ADMIN/MANAGER: el ADMIN nombra/quita managers", "falta la gestión de managers");

  check(/data-view="grupos"/.test(html) && /data-view="actividades"/.test(html) &&
        /id="view-grupos"/.test(html) && /id="view-actividades"/.test(html),
    "ADMIN/MANAGER: pestañas y vistas Grupos/Actividades", "falta la UI del ADMIN");
  check(/id="activity-groups"/.test(html) && /multiple/.test(html),
    "ADMIN/MANAGER: selector multi-grupo en la actividad", "falta el multi-select");
  check(/id="point-bloqueado"/.test(html) && /id="contacto-form"/.test(html) &&
        /id="grupo-form"/.test(html) && /id="miembros-dialog"/.test(html),
    "ADMIN/MANAGER: diálogos de grupo, miembros, contacto y punto bloqueado",
    "faltan diálogos");
  check(/body\.modo-admin/.test(css) && /\.group-card/.test(css) &&
        /\.map-point-bloqueado/.test(css),
    "ADMIN/MANAGER: estilos de la vista simplificada", "faltan estilos");
}

// ------------------- 16. QA de integración y endurecimiento (2026-11-26) ----
{
  const sql18 = leerTexto("sql/18_endurecer_grupos.sql") || "";
  const qa = leerTexto("scripts/qa-simulacion.mjs") || "";
  const main = leerTexto("src/main.js") || "";

  check(/drop policy if exists "Admin de grupo edita su grupo"/.test(sql18) &&
        /drop policy/.test(sql18),
    "QA: MANAGER ya no puede editar la fila del grupo (sql/18)",
    "la política heredada sigue permitiendo update");
  check(/QA_CONFIRM/.test(qa) && /3 grupos × 10 usuarios|30 usuarios/.test(qa),
    "QA: simulación reproducible de 3 grupos × 10 usuarios",
    "falta la simulación de carga");
  check(/join_password_hash/.test(qa) && /verificar_password_grupo/.test(qa),
    "QA: comprueba que el hash y la RPC de contraseña no se expongan",
    "faltan las pruebas del hash");
  check(/<img src=x onerror=/.test(qa) && /DROP TABLE public\.wall_posts/.test(qa),
    "QA: pruebas de XSS e inyección SQL", "faltan las pruebas de ataque");
  check(/anon no lee|JWT manipulado|MANAGER no se asciende/.test(qa),
    "QA: anon, JWT manipulado y escalada de privilegios", "faltan pruebas de seguridad");
  check(/esc\(p\.content\)/.test(main) && /wall_posts/.test(main),
    "QA: el muro escapa el contenido antes de insertarlo en HTML",
    "el muro podría ser vulnerable a XSS");
}

{
  const html = leerTexto("index.html") || "";
  check(/STGO 2026 \| Región 8/.test(html) &&
        /<title>STGO 2026 \| Región 8<\/title>/.test(html),
    "Marca: encabezado y título STGO 2026 | Región 8",
    "el encabezado/título no se actualizó");
  const manifest = leerTexto("manifest.webmanifest") || "";
  check(/"name": "STGO 2026 \| Región 8"/.test(manifest) &&
        /"short_name": "STGO 2026"/.test(manifest),
    "Marca: nombre PWA STGO 2026 | Región 8",
    "el manifest conserva el nombre anterior");
}

// ------------------- 17. Subcategorías/capas y gestos (sql/19, 20) ----------
{
  const sql19 = leerTexto("sql/19_subcategorias_capas.sql") || "";
  const sql20 = leerTexto("sql/20_jw_subcategorias.sql") || "";
  const main = leerTexto("src/main.js") || "";
  const html = leerTexto("index.html") || "";
  const css = leerTexto("styles.css") || "";

  check(/create table if not exists public\.map_subcategories/.test(sql19) &&
        /create table if not exists public\.map_layer_point_overrides/.test(sql19) &&
        /add column if not exists subcategory_id uuid/.test(sql19),
    "Capas: subcategorías, overrides y subcategory_id", "falta el modelo sql/19");
  check(/Admin gestiona subcategorías/.test(sql19) && /Admin gestiona overrides/.test(sql19),
    "Capas: escritura solo ADMIN", "faltan las políticas de administración");
  check(/layer_key/.test(sql19) && /render_mode/.test(sql19) && /'jw' then 'icon'/.test(sql19),
    "Capas: render_mode y JW siempre icono", "falta la herencia JW");
  check(/forzar_jw_subcategoria/.test(sql20),
    "Capas: trigger JW siempre icono", "falta sql/20");
  check(/id="point-name"[^>]*textarea|textarea[^>]*id="point-name"/.test(html) &&
        /id="point-subcategory"/.test(html),
    "Puntos: nombre multilínea y selector de subcategoría",
    "falta textarea o subcategoría");
  check(!/id="map-zoom-in"|id="map-zoom-out"|id="map-add-point"|id="map-puntos-btn"|id="map-satellite"|id="map-fullscreen"/.test(html) &&
        /id="map-recenter"/.test(html) && /id="map-locate"/.test(html) &&
        /id="map-layers"/.test(html) && /id="map-near-me"/.test(html),
    "Controles: centrar, ubicación, capas y cerca de mí",
    "quedaron botones laterales antiguos");
  check(/id="capas-admin-btn"/.test(html) && /id="capas-admin-dialog"/.test(html) &&
        /id="capa-form-dialog"/.test(html) && /id="capa-puntos-dialog"/.test(html),
    "Capas: ajustes ADMIN, formulario y lista de puntos externos",
    "falta la UI de administración");
  check(/white-space: pre-line/.test(css) && /-webkit-line-clamp: 3/.test(css),
    "Nombres: máximo 3 líneas", "la etiqueta no limita a 3 líneas");
  check(/function subcategoriaDe\(p\)/.test(main) &&
        /function modoRenderPunto\(p\)/.test(main) &&
        /function filtrarGeoOverrides/.test(main) &&
        /capa-puntos-guardar/.test(main),
    "Capas: render por subcategoría y overrides globales", "falta la lógica de capas");
  check(/pointerdown/.test(main) && /suppressMapClick/.test(main) &&
        /abrirFormPunto\(null,e\.lngLat\.lat,e\.lngLat\.lng\)/.test(main),
    "Puntos: clic o pulsación larga sobre el mapa", "falta el gesto de alta");
  check(/map-near-me/.test(main) && /función en la próxima etapa/.test(main),
    "Cerca de mí: botón reservado para la siguiente etapa", "falta el placeholder");
  check(/safe-area-inset-top/.test(css) && /#map-controls/.test(css) &&
        /#map-search-bar/.test(css),
    "Mapa: controles bajo la safe area del móvil", "los controles pueden quedar bajo el notch");

  const sql21 = leerTexto("sql/21_salud_hospital_sapu.sql") || "";
  check(/salud_hospital/.test(sql21) && /salud_sapu/.test(sql21) &&
        /Hospitales públicos/.test(sql21) && /SAPU \/ SAR/.test(sql21),
    "Salud: hospitales y SAPU/SAR separados", "falta sql/21");
  check(/id:"salud_hospital"/.test(main) && /id:"salud_sapu"/.test(main) &&
        /f\.properties\?\.subcategoria/.test(main),
    "Salud: capas y filtros por subcategoría de origen",
    "las capas de salud siguen unidas");

  const sql22 = leerTexto("sql/22_categorias_eliminables.sql") || "";
  check(/drop not null/.test(sql22) && /on delete set null/.test(sql22),
    "Categorías: borrar deja subcategorías huérfanas", "sql/22 no libera category_slug");
  check(/async function eliminarCategoria/.test(main) && /Sin categoría/.test(main) &&
        /data-capa-cat-del/.test(main),
    "Categorías: eliminar y reasignar subcategorías", "falta la UI de borrado/huérfanas");
  check(/function gruposPanelCapas/.test(main) && /subcategoriasDeCategoria\(c\.slug\)/.test(main) &&
        /grupo:"Aplicación"/.test(main),
    "Capas: secciones por categoría y subcategorías reales",
    "el panel sigue usando grupos estáticos");
  check(/id="capa-puntos-ninguno"/.test(html) && /capa-puntos-ninguno/.test(main) &&
        /x\.visible=false/.test(main),
    "Puntos externos: botón Deseleccionar todo",
    "falta el botón o no marca todos como ocultos");
  check(/iconoDeCategoria\(g\.categoria\)/.test(main) && /colorDeCategoria\(g\.categoria\)/.test(main) &&
        /iconoDeCategoria\(c\)/.test(main),
    "Categorías: icono y color visibles en panel/ajustes",
    "las categorías no muestran su icono/color");
}

// ---------------------------------------------------------------- resumen ----
console.log("\n" + detalle.join("\n"));
console.log(`\n=== ${pruebas} pruebas · ${fallos} fallos · ${avisos} avisos ===\n`);
process.exit(fallos ? 1 : 0);
