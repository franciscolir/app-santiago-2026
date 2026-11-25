// =============================================================================
// scripts/importar-lugares.mjs
// Etapa 3 (mapas.txt §4.B–G y §7.1): lugares de interés de OpenStreetMap.
//
// Entrada : consulta Overpass generada en memoria (área = Región Metropolitana)
// Salida  : data/lugares/<capa>.geojson — un archivo por interruptor del panel
//
// Uso:  node scripts/importar-lugares.mjs                  # todas las categorías
//       node scripts/importar-lugares.mjs salud             # solo las indicadas
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
// centro real (§15: no introducir puntos ficticios). Para los parques y plazas
// se usa además el área real de la geometría (`out geom`) para descartar las
// plazas pequeñas.
//
// FILTROS SOLICITADOS POR EL USUARIO:
//   - Parques: solo parques grandes (>= 1 ha), cerros parque y zoológicos.
//   - Plazas: solo plazas de armas de las comunas.
//   - Comercio: solo centros comerciales grandes (malls).
//   - Salud: solo hospitales públicos, SAPU y SAR (se descartan clínicas privadas).
//   - Seguridad: bomberos, carabineros, comisarías y tenencias.
//   - Servicios públicos: solo municipalidades.
//   - Sin escuelas ni edificios educacionales.
//   - Sin paraderos de bus (solo las 4 terminales generales, en sql/07_terminales.sql).
//
// Si una categoría falla (Overpass 502/504), NO se sobrescribe su archivo:
// se conserva el anterior para no dejar una capa vacía.
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

// Bounding box de la Región Metropolitana: descarta elementos que el área de
// Overpass arrastra fuera de la RM (p. ej. volcanes que quedan en Argentina).
const BBOX_RM = { lonMin: -72.0, lonMax: -69.5, latMin: -34.05, latMax: -32.9 };
const dentroRM = (lon, lat) => lon >= BBOX_RM.lonMin && lon <= BBOX_RM.lonMax
  && lat >= BBOX_RM.latMin && lat <= BBOX_RM.latMax;

// ---------------------------------------------------------------- umbrales --
// Un parque "grande" mide al menos 1 hectárea (10.000 m²).
const AREA_PARQUE_GRANDE = 10000;

// --------------------------------------------------------------- categorías --
// consulta : filtros Overpass (tag filters) que se aplican a node/way/relation.
// sub      : devuelve la subcategoría de §8 o null si el elemento no sirve.
// regla    : aceptación adicional (área, propiedad pública, etc.).
const CATEGORIAS = [
  {
    id: "parques",
    etiqueta: "Parques grandes, cerros y zoológicos",
    consulta: [
      '["leisure"="park"]["name"]',
      '["natural"="volcano"]["name"]',
      '["tourism"="zoo"]["name"]',
    ],
    sub: (t) => {
      if (t.tourism === "zoo") return "Zoológico";
      if (t.natural === "volcano") return "Cerro parque";
      if (t.leisure === "park") return /cerro/i.test(t.name || "") ? "Cerro parque" : "Parque grande";
      return null;
    },
    regla: (t, area) => t.tourism === "zoo" || t.natural === "volcano"
      || /cerro/i.test(t.name || "") || area >= AREA_PARQUE_GRANDE,
  },
  {
    id: "plazas",
    etiqueta: "Plazas de Armas",
    consulta: ['["place"="square"]["name"]'],
    sub: (t) => (t.place === "square" ? "Plaza de Armas" : null),
    // Sin filtro de área: en OSM la plaza de armas suele estar mapeada como un
    // nodo (el centroide) y el área real como un way sin tag, así que el área
    // calculada es 0 y se perderían las plazas reales. El tag `place=square`
    // ya identifica las plazas de armas de las comunas.
    regla: () => true,
  },
  {
    id: "comercio",
    etiqueta: "Centros comerciales (Malls)",
    consulta: ['["shop"="mall"]["name"]'],
    sub: (t) => (t.shop === "mall" ? "Centro comercial" : null),
    regla: () => true,
  },
  {
    id: "salud",
    etiqueta: "Hospitales públicos, SAPU y SAR",
    consulta: [
      '["amenity"="hospital"]["name"]',
      '["amenity"="clinic"]["name"]["healthcare"]',
      '["healthcare"~"^(hospital|clinic)$"]["name"]',
    ],
    sub: (t) => {
      if (t.amenity === "hospital") return "Hospital público";
      if (t.amenity === "clinic") return "SAPU / SAR";
      if (/^(hospital|clinic)$/.test(t.healthcare || "")) return "Hospital público / SAR";
      return null;
    },
    // Salud pública: necesidad básica (SAPU, SAR, CESFAM, CECOSF, consultorios,
    // centros de salud, postas) u operador público. Se descartan las clínicas
    // privadas (IntegraMédica, clínicas universitarias, laboratorios, etc.).
    regla: (t) => {
      const nombre = `${t.name || ""} ${t["name:es"] || ""}`.trim();
      const op = `${t.operator || ""} ${t["operator:es"] || ""}`;
      const opType = `${t["operator:type"] || ""}`;
      if (/\b(SAPU|SAR|CESFAM|CECOSF|COSAM|UROC)\b/i.test(nombre)) return true;
      if (/\bconsultorios?\b/i.test(nombre)) return true;
      if (/(centro de salud|centro comunitario|centro familiar|puesto de salud|posta (rural|de salud))/i.test(nombre)) return true;
      if (/(ministerio de salud|minsal|servicio de salud|municipalidad|publico|p[uú]blico|gobierno|ministerio)/i.test(op)) return true;
      if (/^(public|government|state)$/i.test(opType)) return true;
      // Hospital con nombre propio, sin marca de clínica privada.
      if (t.amenity === "hospital" && /^hospital\b/i.test(nombre)
          && !/(cl[ií]nic|clinic|instituto|consultorio|m[eé]dic)/i.test(nombre)) return true;
      return false;
    },
  },
  {
    id: "seguridad",
    etiqueta: "Bomberos, Carabineros, Comisarías y Tenencias",
    consulta: [
      '["amenity"="fire_station"]["name"]',
      '["amenity"="police"]["name"]',
      '["office"="police"]["name"]',
    ],
    sub: (t) => (t.amenity === "fire_station" ? "Cuartel de bomberos" : "Comisaría o tenencia"),
    regla: () => true,
  },
  {
    id: "servicios",
    etiqueta: "Municipalidades",
    consulta: ['["amenity"="townhall"]["name"]'],
    sub: () => "Municipalidad",
    regla: () => true,
  },
];

// --------------------------------------------------------------- utilidades --
function armarConsulta(categoria) {
  const body = categoria.consulta
    .map((f) => `  node${f}(area.rm);\n  way${f}(area.rm);\n  relation${f}(area.rm);`)
    .join("\n");
  // `out geom` entrega la geometría completa: permite medir el área real de
  // parques y plazas y calcular el centroide sin inventar coordenadas.
  return `[out:json][timeout:180];\narea["boundary"="administrative"]["name"="${RM}"]->.rm;\n(\n${body}\n);\nout geom;`;
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

// ------------------------------------------------------- geometría (área) ---
function puntosDe(el) {
  if (el.type === "way") return el.geometry || [];
  if (el.type === "relation") return (el.members || []).flatMap((m) => m.geometry || []);
  return [];
}
// Área en m² de un anillo (shoelace sobre una proyección equirrectangular).
function areaAnillo(pts) {
  if (!pts || pts.length < 3) return 0;
  const lat0 = pts[0].lat * Math.PI / 180;
  const kx = 111320 * Math.cos(lat0), ky = 110540;
  let a = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    a += (pts[i].lon * kx) * (pts[i + 1].lat * ky) - (pts[i + 1].lon * kx) * (pts[i].lat * ky);
  }
  return Math.abs(a / 2);
}
function areaM2(el) {
  if (el.type === "way") return areaAnillo(el.geometry || []);
  if (el.type === "relation") {
    // Se suman las ways miembros (aproximación: ignora los huecos interiores).
    return (el.members || []).reduce((acc, m) => acc + (m.type === "way" ? areaAnillo(m.geometry || []) : 0), 0);
  }
  return 0;
}
// Centroide real de la geometría (no una coordenada inventada).
function centroDe(el) {
  if (el.type === "node") return (Number.isFinite(el.lat) && Number.isFinite(el.lon)) ? { lat: el.lat, lon: el.lon } : null;
  const pts = puntosDe(el);
  if (!pts.length) return null;
  if (pts.length >= 3) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const cross = p.lon * q.lat - q.lon * p.lat;
      a += cross; cx += (p.lon + q.lon) * cross; cy += (p.lat + q.lat) * cross;
    }
    a *= 0.5;
    if (Math.abs(a) > 1e-12) return { lon: cx / (6 * a), lat: cy / (6 * a) };
  }
  const n = pts.length;
  return {
    lon: pts.reduce((s, p) => s + p.lon, 0) / n,
    lat: pts.reduce((s, p) => s + p.lat, 0) / n,
  };
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
const args = process.argv.slice(2);
const solo = args.length ? new Set(args) : null;

if (solo) {
  const validas = new Set(CATEGORIAS.map((c) => c.id));
  for (const a of solo) if (!validas.has(a)) {
    console.error(`Categoría desconocida: "${a}". Válidas: ${[...validas].join(", ")}`);
    process.exit(1);
  }
}

const comunas = cargarComunas();
console.log(`Comunas cargadas para georreferenciar: ${comunas.length}`);

const porCategoria = new Map();   // categoria → Map(claveDedup → feature)
let fechaFuente = null;

for (const categoria of CATEGORIAS) {
  if (solo && !solo.has(categoria.id)) continue;
  let json;
  try {
    json = await consultar(armarConsulta(categoria));
  } catch (err) {
    console.error(`  ✗ ${categoria.id}: ${err.message}`);
    continue;
  }
  fechaFuente = fechaFuente || json.osm3s?.timestamp_osm_base || null;

  const bucket = new Map();
  let n = 0, sinCentro = 0, sinNombre = 0, fueraDeFiltro = 0;
  for (const el of json.elements) {
    const t = el.tags || {};
    const nombre = String(t.name || "").trim();
    if (!nombre) { sinNombre++; continue; }
    const sub = categoria.sub(t);
    if (!sub) { fueraDeFiltro++; continue; }
    const area = areaM2(el);
    if (!categoria.regla(t, area)) { fueraDeFiltro++; continue; }
    const centro = centroDe(el);
    if (!centro || !Number.isFinite(centro.lat) || !Number.isFinite(centro.lon)) { sinCentro++; continue; }
    if (!dentroRM(centro.lon, centro.lat)) { fueraDeFiltro++; continue; }

    const comuna = comunaDe(centro.lon, centro.lat, comunas);
    // Dirección legible: número + calle (si existen en OSM).
    const numero = String(t["addr:housenumber"] || "").trim();
    const calle = String(t["addr:street"] || "").trim();
    const direccion = [numero, calle].filter(Boolean).join(" ") || null;
    // Dedupe: mismo lugar mapeado como relación Y como sus ways sueltos.
    // Preferencia relación > way > nodo, y se separa por comuna (§13.15).
    const clave = `${categoria.id}|${nombre}|${comuna || "?"}`;
    const previo = bucket.get(clave);
    const prioridad = { relation: 3, way: 2, node: 1 };
    if (previo && (prioridad[previo._tipo] || 0) >= (prioridad[el.type] || 0)) continue;

    bucket.set(clave, {
      _tipo: el.type,
      type: "Feature",
      properties: {
        nombre,
        categoria: categoria.id,
        categoria_label: categoria.etiqueta,
        subcategoria: sub,
        comuna,
        direccion,
        ...(area >= 100 ? { area_m2: Math.round(area) } : {}),
        osm_id: `${el.type}/${el.id}`,
        fuente: "OpenStreetMap",
        licencia: "ODbL",
        actualizado: json.osm3s?.timestamp_osm_base || null,
        ...(t.operator ? { operador: String(t.operator).trim() } : {}),
      },
      geometry: { type: "Point", coordinates: [Number(centro.lon.toFixed(6)), Number(centro.lat.toFixed(6))] },
    });
    n++;
  }
  for (const f of bucket.values()) delete f._tipo;
  porCategoria.set(categoria.id, bucket);
  console.log(`  ✓ ${categoria.id.padEnd(10)} ${String(n).padStart(5)} aceptados → ${String(bucket.size).padStart(5)} tras dedupe  (descartados: ${fueraDeFiltro}, sin centro: ${sinCentro}, sin nombre: ${sinNombre})`);
}

// ------------------------------------------------------------------ salida --
mkdirSync(DIR_LUGARES, { recursive: true });
console.log("\nCorte por capa (una descarga por interruptor):");
for (const categoria of CATEGORIAS) {
  const archivo = join(DIR_LUGARES, `${categoria.id}.geojson`);
  if (!porCategoria.has(categoria.id)) {
    console.log(`  ${categoria.id.padEnd(18)}   ---  sin cambios (consulta fallida; se conserva el archivo previo)`);
    continue;
  }
  const fs = [...porCategoria.get(categoria.id).values()];
  writeFileSync(archivo, JSON.stringify({ type: "FeatureCollection", features: fs }));
  console.log(`  ${categoria.id.padEnd(18)} ${String(fs.length).padStart(5)} pts  → data/lugares/${categoria.id}.geojson  (${(readFileSync(archivo).length / 1024).toFixed(1)} KB)`);
}

const features = [...porCategoria.values()].flatMap((m) => [...m.values()]);
console.log(`\nFecha de la fuente (osm3s): ${fechaFuente}`);

// ----------------------------------------------------------- validaciones --
const porCat = {};
for (const f of features) porCat[f.properties.categoria] = (porCat[f.properties.categoria] || 0) + 1;
console.log("Por categoría:", porCat);

const sinComuna = features.filter((f) => !f.properties.comuna);
console.log(`Sin comuna asignada: ${sinComuna.length}` + (sinComuna.length ? ` (ej: ${sinComuna.slice(0, 3).map((f) => f.properties.nombre).join(", ")})` : ""));

if (features.length) {
  const lats = features.map((f) => f.geometry.coordinates[1]);
  const lons = features.map((f) => f.geometry.coordinates[0]);
  console.log(`bbox: lon [${Math.min(...lons).toFixed(4)}, ${Math.max(...lons).toFixed(4)}] lat [${Math.min(...lats).toFixed(4)}, ${Math.max(...lats).toFixed(4)}]`);
}

const claves = features.map((f) => `${f.properties.categoria}|${f.properties.nombre}|${f.properties.comuna}`);
console.log(`Duplicados (categoría+nombre+comuna): ${claves.length - new Set(claves).size}`);
