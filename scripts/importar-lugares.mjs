// =============================================================================
// scripts/importar-lugares.mjs
// Etapa 3 (mapas.txt §4.B–G y §7.1): lugares de interés de OpenStreetMap.
//
// Entrada : consulta Overpass generada en memoria (área = Región Metropolitana)
// Salida  : data/lugares/*.geojson — un archivo por interruptor del panel de capas
//
// Uso:  node scripts/importar-lugares.mjs                  # todas las categorías
//       node scripts/importar-lugares.mjs salud             # solo las indicadas
//
// Salida: un archivo GeoJSON POR CAPA en data/lugares/<capa>.geojson.
// No se genera un mega-archivo: el frontend descarga solo la capa que el
// usuario enciende (§11) y el repositorio no duplica los mismos puntos.
// Si una categoría falla (Overpass 502/406), NO se sobrescribe su archivo:
// se conserva el anterior para no dejar una capa vacía.
//
// Fuentes y licencia (§7.6):
//   - OpenStreetMap vía Overpass API, licencia ODbL.
//     https://wiki.openstreetmap.org/wiki/Overpass_API
//   - Espejos usados (el oficial `overpass-api.de` suele responder 502/406):
//       https://overpass.private.coffee/api/interpreter
//       https://maps.mail.ru/osm/tools/overpass/api/interpreter
//   - `osm3s.timestamp_osm_base` viaja en cada feature como `actualizado`.
//
// NO se usan coordenadas estimadas: todo punto nace de un elemento OSM con
// centro real (§15: no introducir puntos ficticios).
//
// FILTROS SOLICITADOS:
//   - Parques: solo parques grandes, cerros parque y zoológicos.
//   - Plazas: solo plazas de armas de las comunas.
//   - Comercio: solo centros comerciales grandes (malls).
//   - Salud: solo hospitales públicos, SAPU y SAR.
//   - Seguridad: bomberos, carabineros, comisarías y tenencias.
//   - Servicios públicos: solo municipalidades.
//   - Sin escuelas ni edificios educacionales.
//   - Sin paraderos de bus (solo terminales específicas como puntos del admin).
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data");
const COMUNAS = join(OUT, "comunas-rm.geojson");
const DIR_LUGARES = join(OUT, "lugares");

const ESPEJOS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];
const UA = "app-santiago-2026/1.0 (data import; OSM ODbL attribution)";
const RM = "Región Metropolitana de Santiago";

// ------------------------------------------------------- catálogo de capas --
// filtro = tag filter de Overpass sin el `(area.rm)`
// clave  = tag del elemento que hay que evaluar con `re` para elegir subcategoría
const e = (filtro, clave, re, sub) => ({ filtro, clave, re, sub });

const CATEGORIAS = [
  // --- Áreas verdes: solo parques grandes, cerros parque y zoológicos ---
  ["parques", "Parques grandes, cerros y zoológicos", [
    e('["leisure"="park"]["name"]', "leisure", /^park$/i, "Parque grande"),
    e('["natural"="volcano"]', "natural", /^volcano$/i, "Cerro parque"),
    e('["tourism"="zoo"]', "tourism", /^zoo$/i, "Zoológico"),
  ]],
  // --- Plazas: solo plazas de armas de las comunas ---
  ["plazas", "Plazas de Armas", [
    e('["place"="square"]["name"]', "place", /^square$/i, "Plaza de Armas"),
  ]],
  // --- Comercio: solo centros comerciales grandes (malls) ---
  ["comercio", "Centros comerciales (Malls)", [
    e('["shop"="mall"]', "shop", /^mall$/i, "Centro comercial"),
  ]],
  // --- Salud: solo hospitales públicos, SAPU y SAR ---
  ["salud", "Hospitales públicos, SAPU y SAR", [
    e('["amenity"="hospital"]["name"]', "amenity", /^hospital$/i, "Hospital público"),
    e('["amenity"="clinic"]["name"]["healthcare"]', "amenity", /^clinic$/i, "SAPU / SAR"),
    e('["healthcare"~"^(hospital|clinic)$"]["name"]', "healthcare", /^(hospital|clinic)$/i, "Hospital público / SAR"),
  ]],
  // --- Seguridad: bomberos, carabineros, comisarías y tenencias ---
  ["seguridad", "Bomberos, Carabineros, Comisarías y Tenencias", [
    e('["amenity"="fire_station"]', "amenity", /^fire_station$/i, "Cuartel de bomberos"),
    e('["amenity"="police"]["name"]', "amenity", /^police$/i, "Comisaría o tenencia"),
    e('["office"="police"]["name"]', "office", /^police$/i, "Comisaría o tenencia"),
  ]],
  // --- Servicios públicos: solo municipalidades ---
  ["servicios", "Municipalidades", [
    e('["amenity"="townhall"]["name"]', "amenity", /^townhall$/i, "Municipalidad"),
  ]],
];

// --------------------------------------------------------------- utilidades --
function armarConsulta(entradas) {
  const body = entradas
    .map((x) => `  node${x.filtro}(area.rm);\n  way${x.filtro}(area.rm);\n  relation${x.filtro}(area.rm);`)
    .join("\n");
  return `[out:json][timeout:180];\narea["boundary"="administrative"]["name"="${RM}"]->.rm;\n(\n${body}\n);\nout center tags;`;
}

async function consultar(query) {
  let ultimo = null;
  for (const url of ESPEJOS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" },
        body: "data=" + encodeURIComponent(query),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
      if (txt.trimStart().startsWith("<")) throw new Error(`respuesta no JSON en ${url}: ${txt.slice(0, 80)}`);
      const json = JSON.parse(txt);
      if (!Array.isArray(json.elements)) throw new Error(`sin elements en ${url}`);
      return json;
    } catch (e2) { ultimo = e2; }
  }
  throw new Error(`Ningún espejo de Overpass respondió. Último error: ${ultimo?.message}`);
}

// ------------------------------------------------- comuna por punto (§6) --
function cargarComunas() {
  if (!existsSync(COMUNAS)) return [];
  const fc = JSON.parse(readFileSync(COMUNAS, "utf8"));
  return fc.features.map((f) => {
    const anillos = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const todos = anillos.flat();
    const xs = todos.map((p) => p[0]), ys = todos.map((p) => p[1]);
    return {
      nombre: f.properties.nombre,
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      anillos,
    };
  });
}
function dentro(pt, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function comunaDe(lon, lat, comunas) {
  for (const c of comunas) {
    const [x0, y0, x1, y1] = c.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    for (const poly of c.anillos) {
      if (dentro([lon, lat], poly[0]) && !poly.slice(1).some((h) => dentro([lon, lat], h))) return c.nombre;
    }
  }
  return null;
}

// ------------------------------------------------------------------- main ----
const args = process.argv.slice(2).filter((a) => a !== "--todo");
const rehacerTodo = process.argv.includes("--todo");
const solo = args.length ? new Set(args) : null;

if (solo) {
  const validas = new Set(CATEGORIAS.map((c) => c[0]));
  for (const a of solo) if (!validas.has(a)) {
    console.error(`Categoría desconocida: "${a}". Válidas: ${[...validas].join(", ")}`);
    process.exit(1);
  }
}

const comunas = cargarComunas();
console.log(`Comunas cargadas para georreferenciar: ${comunas.length}`);

const porCategoria = new Map();   // categoria → Map(claveDedup → feature)
let fechaFuente = null;

for (const [categoria, etiqueta, entradas] of CATEGORIAS) {
  if (solo && !solo.has(categoria)) continue;
  let json;
  try {
    json = await consultar(armarConsulta(entradas));
  } catch (err) {
    console.error(`  ✗ ${categoria}: ${err.message}`);
    continue;
  }
  fechaFuente = fechaFuente || json.osm3s?.timestamp_osm_base || null;

  const bucket = new Map();
  let n = 0, sinCentro = 0, sinNombre = 0;
  for (const el of json.elements) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { sinCentro++; continue; }
    const nombre = String(t.name || "").trim();
    if (!nombre) { sinNombre++; continue; }

    // Subcategoría: primera entrada cuya expresión casó con el elemento.
    let sub = etiqueta;
    for (const x of entradas) if (x.re.test(t[x.clave] || "")) { sub = x.sub; break; }

    const comuna = comunaDe(lon, lat, comunas);
    // Dirección legible: número + calle (si existen en OSM).
    const numero = String(t["addr:housenumber"] || "").trim();
    const calle = String(t["addr:street"] || "").trim();
    const direccion = [numero, calle].filter(Boolean).join(" ") || null;
    // Dedupe: mismo lugar mapeado como relación Y como sus ways sueltos.
    // Preferencia relación > way > nodo, y se separa por comuna (§13.15).
    const clave = `${categoria}|${nombre}|${comuna || "?"}`;
    const previo = bucket.get(clave);
    const prioridad = { relation: 3, way: 2, node: 1 };
    if (previo && (prioridad[previo._tipo] || 0) >= (prioridad[el.type] || 0)) continue;

    bucket.set(clave, {
      _tipo: el.type,
      type: "Feature",
      properties: {
        nombre,
        categoria,
        categoria_label: etiqueta,
        subcategoria: sub,
        comuna,
        direccion,
        osm_id: `${el.type}/${el.id}`,
        fuente: "OpenStreetMap",
        licencia: "ODbL",
        actualizado: json.osm3s?.timestamp_osm_base || null,
        ...(t.operator ? { operador: String(t.operator).trim() } : {}),
      },
      geometry: { type: "Point", coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
    });
    n++;
  }
  for (const f of bucket.values()) delete f._tipo;
  porCategoria.set(categoria, bucket);
  console.log(`  ✓ ${categoria.padEnd(10)} ${String(n).padStart(5)} crudos → ${String(bucket.size).padStart(5)} tras dedupe  (sin centro: ${sinCentro}, sin nombre: ${sinNombre})`);
}

// ------------------------------------------------------------------ salida --
// Etapa 4/§11: cada interruptor del panel de capas descarga SU archivo, no un
// mega-archivo con todo. Así el móvil no carga miles de puntos si solo quiere
// ver, por ejemplo, los parques. Cada archivo se cachea en su primer uso.
const CAPAS_LUGARES = [
  ["parques",   "Parques grandes, cerros y zoológicos"],
  ["plazas",    "Plazas de Armas"],
  ["comercio",  "Centros comerciales (Malls)"],
  ["salud",     "Hospitales públicos, SAPU y SAR"],
  ["seguridad", "Bomberos, Carabineros, Comisarías y Tenencias"],
  ["servicios", "Municipalidades"],
];
mkdirSync(DIR_LUGARES, { recursive: true });
console.log("\nCorte por capa (una descarga por interruptor):");
for (const [capa] of CAPAS_LUGARES) {
  const archivo = join(DIR_LUGARES, `${capa}.geojson`);
  if (!porCategoria.has(capa)) {
    console.log(`  ${capa.padEnd(18)}   ---  sin cambios (consulta fallida; se conserva el archivo previo)`);
    continue;
  }
  const fs = [...porCategoria.get(capa).values()];
  writeFileSync(archivo, JSON.stringify({ type: "FeatureCollection", features: fs }));
  console.log(`  ${capa.padEnd(18)} ${String(fs.length).padStart(5)} pts  → data/lugares/${capa}.geojson  (${(readFileSync(archivo).length / 1024).toFixed(1)} KB)`);
}

const features = [...porCategoria.values()].flatMap((m) => [...m.values()]);
console.log(`\nFecha de la fuente (osm3s): ${fechaFuente}`);

// ----------------------------------------------------------- validaciones --
const porCat = {};
for (const f of features) porCat[f.properties.categoria] = (porCat[f.properties.categoria] || 0) + 1;
console.log("Por categoría:", porCat);

const sinComuna = features.filter((f) => !f.properties.comuna);
console.log(`Sin comuna asignada: ${sinComuna.length}` + (sinComuna.length ? ` (ej: ${sinComuna.slice(0, 3).map((f) => f.properties.nombre).join(", ")})` : ""));

const lats = features.map((f) => f.geometry.coordinates[1]);
const lons = features.map((f) => f.geometry.coordinates[0]);
console.log(`bbox: lon [${Math.min(...lons).toFixed(4)}, ${Math.max(...lons).toFixed(4)}] lat [${Math.min(...lats).toFixed(4)}, ${Math.max(...lats).toFixed(4)}]`);

const claves = features.map((f) => `${f.properties.categoria}|${f.properties.nombre}|${f.properties.comuna}`);
console.log(`Duplicados (categoría+nombre+comuna): ${claves.length - new Set(claves).size}`);
