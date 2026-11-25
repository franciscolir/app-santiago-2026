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
import { fileURLToPath } from "node:url";

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
const CAPAS = ["parques", "plazas", "comercio", "salud", "seguridad", "servicios"];
const REQUERIDOS = ["nombre", "categoria", "subcategoria", "fuente", "actualizado"];
// Subcategorías permitidas por capa: son las del importador y reflejan los
// filtros pedidos (parques grandes, malls, salud pública, etc.).
const SUBCATEGORIAS = {
  parques:    ["Parque grande", "Cerro parque", "Zoológico"],
  plazas:     ["Plaza de Armas"],
  comercio:   ["Centro comercial"],
  salud:      ["Hospital público", "SAPU / SAR", "Hospital público / SAR"],
  seguridad:  ["Cuartel de bomberos", "Comisaría o tenencia"],
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

  const iconos = [...main.matchAll(/([a-z0-9\-]+\.png)/g)].map((m) => m[1]);
  const iconosUsados = [...new Set(iconos.filter((n) => !n.includes("-192") && !n.includes("-512") && !n.includes("maskable")))];
  const faltanIcons = iconosUsados.filter((n) => !existsSync(join(ROOT, "icons", n)));
  check(faltanIcons.length === 0, "iconos PNG existen", "faltan: " + faltanIcons.join(", "));

  const capasMain = [...main.matchAll(/^  "([a-z]+)":\s*\{color/gm)].map((m) => m[1]);
  const capasFaltan = capasMain.filter((c) => !existsSync(join(ROOT, `data/lugares/${c}.geojson`)));
  check(capasFaltan.length === 0, "cada capa del panel tiene su GeoJSON", "faltan: " + capasFaltan.join(", "));

  const precache = [...sw.matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]);
  const faltan = precache.filter((p) => !existsSync(join(ROOT, p)));
  check(faltan.length === 0, "precache del service worker existe", "faltan: " + faltan.join(", "));
  check(!precache.some((p) => p.includes("paraderos")), "paraderos fuera del precache", "el precache incluye paraderos");
  check(/CACHE_NAME\s*=\s*"app-santiago-2026-v\d+"/.test(sw), "service worker con versión de caché", "sin CACHE_NAME versionado");

  check(!/onclick\s*=/.test(html) && !/onclick\s*=/.test(main),
    "sin handlers inline", "quedan atributos onclick (los módulos no exponen funciones globales)");
  check(!/window\.__cargarLugares/.test(main), "sin hooks de depuración temporales", "quedó window.__cargarLugares");
  check(/createImageBitmap/.test(main), "iconos cargados sin map.loadImage", "no usa createImageBitmap");
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
}

// ---------------------------------------------------------------- resumen ----
console.log("\n" + detalle.join("\n"));
console.log(`\n=== ${pruebas} pruebas · ${fallos} fallos · ${avisos} avisos ===\n`);
process.exit(fallos ? 1 : 0);
