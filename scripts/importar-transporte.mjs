// =============================================================================
// scripts/importar-transporte.mjs
// Etapa 3 (mapas.txt §4.A y §7.5): estaciones y líneas de Metro y MetroTren.
//
// Entrada : scripts/_gtfs/  — GTFS oficial del DTPM
//           (https://www.dtpm.cl/index.php/gtfs-vigente → GTFS_20261114_v2.zip)
// Salida  : data/transporte-estaciones.geojson  (Points)
//           data/transporte-lineas.geojson      (LineStrings)
//
// Uso:
//   curl -sL -A "app-santiago-2026/1.0" "https://www.dtpm.cl/descargas/gtfs/GTFS_20261114_v2.zip" -o scripts/_gtfs.zip
//   # extraer trips.txt routes.txt stops.txt stop_times.txt shapes.txt a scripts/_gtfs/
//   node scripts/importar-transporte.mjs
//
// Criterio §7.5: NO todo stop es estación de Metro. Se filtra por AGENCIA
// (M = Metro de Santiago, MT = EFE/Trenes) y luego se sube al parent_station.
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GTFS = join(ROOT, "scripts", "_gtfs");
const OUT = join(ROOT, "data");

const AGENCIAS = { M: "metro", MT: "metrotren" };
const NOMBRE_AGENCIA = { M: "Metro de Santiago", MT: "EFE Trenes de Chile" };

// --------------------------------------------------------------- utilidades --
function parseRow(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function leerCsv(file) {
  const lines = readFileSync(join(GTFS, file), "utf8").split(/\r?\n/).filter(Boolean);
  const head = parseRow(lines[0]);
  return lines.slice(1).map((l) => {
    const row = parseRow(l); const o = {};
    head.forEach((h, i) => (o[h] = row[i] ?? ""));
    return o;
  });
}

async function porLineas(file, cb) {
  const rl = createInterface({ input: createReadStream(join(GTFS, file), "utf8"), crlfDelay: Infinity });
  let head = null;
  for await (const line of rl) {
    if (!line) continue;
    if (!head) { head = parseRow(line); continue; }
    cb(parseRow(line), head);
  }
}

const esEstacion = (s) => s && (s.location_type === "1");

// ------------------------------------------------------------------- main ----
if (!existsSync(join(GTFS, "stops.txt"))) {
  console.error(`No existe ${GTFS}. Descarga y extrae el GTFS del DTPM (ver encabezado).`);
  process.exit(1);
}

// 1) Rutas de Metro (agencia M) y de Trenes (agencia MT). Se ignoran los buses.
const rutas = leerCsv("routes.txt");
const rutasInteres = rutas.filter((r) => AGENCIAS[r.agency_id]);
const tipoDeRuta = new Map(rutasInteres.map((r) => [r.route_id, AGENCIAS[r.agency_id]]));
const metaDeRuta = new Map(rutasInteres.map((r) => [r.route_id, r]));
console.log(`Rutas de interés: ${rutasInteres.length} (${[...tipoDeRuta.values()].filter(t=>t==="metro").length} metro, ${[...tipoDeRuta.values()].filter(t=>t==="metrotren").length} tren)`);

// 2) Viajes de esas rutas → trip_id → ruta y rutas → shape_ids
const tripARuta = new Map();
const shapesPorRuta = new Map();
for (const t of leerCsv("trips.txt")) {
  if (!tipoDeRuta.has(t.route_id)) continue;
  tripARuta.set(t.trip_id, t.route_id);
  if (t.shape_id) {
    if (!shapesPorRuta.has(t.route_id)) shapesPorRuta.set(t.route_id, new Set());
    shapesPorRuta.get(t.route_id).add(t.shape_id);
  }
}
console.log(`Viajes de interés: ${tripARuta.size}`);

// 2b) Paraderos de transporte público (buses). §4.A los pide como capa
// opcional. Se recorren los stop_times de TODOS los viajes para saber qué
// paradas existen de verdad (no se inventan posiciones).
const rutasBus=new Set(rutas.filter(r=>r.agency_id==="RM"||r.agency_id==="BAA").map(r=>r.route_id));
const metaBus=new Map();          // trip_id → { linea }
for (const t of leerCsv("trips.txt")) {
  if (!rutasBus.has(t.route_id)) continue;
  const m=rutas.find(r=>r.route_id===t.route_id);
  metaBus.set(t.trip_id,{linea:(m&&m.route_short_name)||t.route_id});
}
console.log(`Rutas de buses: ${rutasBus.size} · viajes de bus: ${metaBus.size}`);

const paradasBus=new Map();     // stop_id → Set(lineas de bus)
await porLineas("stop_times.txt", (row) => {
  const tripId=row[0], stopId=row[3];
  if (!stopId) return;
  const bus=metaBus.get(tripId);
  if (!bus) return;
  if (!paradasBus.has(stopId)) paradasBus.set(stopId,new Set());
  paradasBus.get(stopId).add(bus.linea);
});
console.log(`Paraderos de bus referenciados: ${paradasBus.size}`);

// 3) stop_times (51 MB, en streaming) → paradas usadas por cada ruta
const paradasPorRuta = new Map();
let nStopTimes = 0;
await porLineas("stop_times.txt", (row) => {
  const ruta = tripARuta.get(row[0]);          // trip_id
  if (!ruta) return;
  const stopId = row[3];                       // stop_id
  if (!stopId) return;
  nStopTimes++;
  if (!paradasPorRuta.has(ruta)) paradasPorRuta.set(ruta, new Set());
  paradasPorRuta.get(ruta).add(stopId);
});
console.log(`stop_times procesados: ${nStopTimes}`);

// 4) Estaciones: se resuelve al parent_station (§7.5: un stop NO es estación)
const stops = new Map(leerCsv("stops.txt").map((s) => [s.stop_id, s]));
const estaciones = new Map();   // stop_id de estación → {nombre, lat, lon, lineas:Set}
for (const [ruta, stopIds] of paradasPorRuta) {
  const linea = metaDeRuta.get(ruta).route_short_name || ruta;
  for (const id of stopIds) {
    const s = stops.get(id);
    if (!s) continue;
    const estId = esEstacion(s) ? id : (s.parent_station || id);
    const est = stops.get(estId);
    if (!est) continue;
    const lat = Number(est.stop_lat), lon = Number(est.stop_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!estaciones.has(estId)) {
      estaciones.set(estId, {
        id: estId,
        nombre: (est.stop_name || s.stop_name || estId).replace(/^[A-Z0-9]+-/, "").trim(),
        lat, lon,
        tipo: tipoDeRuta.get(ruta),
        lineas: new Set(),
      });
    }
    estaciones.get(estId).lineas.add(linea);
  }
}
console.log(`Estaciones resueltas: ${estaciones.size}`);

// 5) Geometría de líneas: por ruta se toma el shape con más puntos
const puntosPorShape = new Map();
await porLineas("shapes.txt", (row) => {
  const id = row[0];
  if (!puntosPorShape.has(id)) puntosPorShape.set(id, []);
  puntosPorShape.get(id).push([Number(row[2]), Number(row[1]), Number(row[3])]); // [lon,lat,seq]
});

const lineas = [];
for (const [ruta, shapeIds] of shapesPorRuta) {
  let mejor = null;
  for (const sid of shapeIds) {
    const pts = puntosPorShape.get(sid);
    if (!pts || pts.length < 2) continue;
    if (!mejor || pts.length > mejor.length) mejor = pts;
  }
  if (!mejor) { console.warn(`   ! ${ruta}: sin shape usable`); continue; }
  const coords = mejor
    .slice()
    .sort((a, b) => a[2] - b[2])
    .map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))])
    .filter((c, i, arr) => i === 0 || c[0] !== arr[i - 1][0] || c[1] !== arr[i - 1][1]);
  const meta = metaDeRuta.get(ruta);
  lineas.push({
    type: "Feature",
    properties: {
      nombre: meta.route_long_name || meta.route_short_name || ruta,
      linea: meta.route_short_name || ruta,
      tipo: tipoDeRuta.get(ruta),
      operador: NOMBRE_AGENCIA[meta.agency_id],
      gtfs_route_id: ruta,
      fuente: "DTPM GTFS",
    },
    geometry: { type: "LineString", coordinates: coords },
  });
}
console.log(`Líneas escritas: ${lineas.length}`);

// 6) Salidas
mkdirSync(OUT, { recursive: true });
const estFeatures = [...estaciones.values()]
  .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
  .map((e) => ({
    type: "Feature",
    properties: {
      nombre: e.nombre,
      tipo: e.tipo,
      lineas: [...e.lineas].sort(),
      combinaciones: e.lineas.size > 1,           // estación de combinación (§4.A)
      operador: e.tipo === "metro" ? NOMBRE_AGENCIA.M : NOMBRE_AGENCIA.MT,
      gtfs_stop_id: e.id,
      fuente: "DTPM GTFS",
    },
    geometry: { type: "Point", coordinates: [Number(e.lon.toFixed(6)), Number(e.lat.toFixed(6))] },
  }));

writeFileSync(join(OUT, "transporte-estaciones.geojson"), JSON.stringify({ type: "FeatureCollection", features: estFeatures }));
writeFileSync(join(OUT, "transporte-lineas.geojson"), JSON.stringify({ type: "FeatureCollection", features: lineas }));

const kb = (f) => (readFileSync(join(OUT, f)).length / 1024).toFixed(1);
console.log(`\nestaciones: ${estFeatures.length} → data/transporte-estaciones.geojson (${kb("transporte-estaciones.geojson")} KB)`);
console.log(`líneas    : ${lineas.length} → data/transporte-lineas.geojson (${kb("transporte-lineas.geojson")} KB)`);

// 7) Validación básica
const metro = estFeatures.filter((f) => f.properties.tipo === "metro");
const tren = estFeatures.filter((f) => f.properties.tipo === "metrotren");
const combo = estFeatures.filter((f) => f.properties.combinaciones);
console.log(`  metro: ${metro.length} estaciones | metrotren: ${tren.length} | combinaciones: ${combo.length}`);
const lats = estFeatures.map((f) => f.geometry.coordinates[1]);
const lons = estFeatures.map((f) => f.geometry.coordinates[0]);
console.log(`  bbox: lon [${Math.min(...lons).toFixed(4)}, ${Math.max(...lons).toFixed(4)}] lat [${Math.min(...lats).toFixed(4)}, ${Math.max(...lats).toFixed(4)}]`);
if (metro.length < 100) { console.error("AVISO: menos de 100 estaciones de Metro: revisar el filtro de agencia."); process.exitCode = 2; }

// 8) Paraderos de bus → GeoJSON independiente (§4.A, capa opcional)
const paraderosFeatures = [...paradasBus.entries()]
  .map(([stopId, lineas]) => {
    const s = stops.get(stopId);
    if (!s) return null;
    const lat = Number(s.stop_lat), lon = Number(s.stop_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      type: "Feature",
      properties: {
        nombre: s.stop_name || "Paradero de bus",
        tipo: "paradero",
        subcategoria: "Paradero",
        lineas: [...lineas].sort().join(" · "),
        operador: "Red Metropolitana de Movilidad",
        gtfs_stop_id: stopId,
        fuente: "DTPM GTFS",
      },
      geometry: { type: "Point", coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
    };
  }).filter(Boolean);

writeFileSync(join(OUT, "transporte-paraderos.geojson"), JSON.stringify({ type: "FeatureCollection", features: paraderosFeatures }));
console.log(`paraderos: ${paraderosFeatures.length} → data/transporte-paraderos.geojson (${kb("transporte-paraderos.geojson")} KB)`);
