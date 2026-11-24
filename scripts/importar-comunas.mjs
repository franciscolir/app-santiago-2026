// =============================================================================
// scripts/importar-comunas.mjs
// Etapa 2 (mapas.txt §3.2 y §7.1): límites comunales de la Región Metropolitana.
//
// Entrada : scripts/_overpass_comunas.json  (respuesta cruda de Overpass API,
//           consulta guardada en scripts/_q_comunas.txt)
// Salida  : data/comunas-rm.geojson        (FeatureCollection listo para MapLibre)
//
// Uso:
//   curl -s -A "app-santiago-2026/1.0" \
//        --data-urlencode "data@scripts/_q_comunas.txt" \
//        "https://overpass.private.coffee/api/interpreter" \
//        -o scripts/_overpass_comunas.json
//   node scripts/importar-comunas.mjs
//
// Notas:
//   - Datos © Colaboradores de OpenStreetMap, licencia ODbL (atribución en el
//     popup y en el control de atribución del mapa).
//   - Geometrías reales de OSM, NO dibujadas a mano (mapas.txt §3.2).
//   - Se simplifican con Douglas-Peucker para que el archivo sea liviano en
//     móviles; la tolerancia está en grados (~0.0003° ≈ 30 m).
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IN = join(ROOT, "scripts", "_overpass_comunas.json");
const OUT = join(ROOT, "data", "comunas-rm.geojson");
const TOLERANCIA = 0.0003; // grados (~30 m)

// ---------------------------------------------------------------- geometría --
const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;

/** Encadena segmentos (ways) en anillos cerrados. */
function anillosDesdeWays(ways) {
  const pendientes = ways.map((w) => w.map((p) => [p[0], p[1]]));
  const anillos = [];
  while (pendientes.length) {
    let anillo = pendientes.shift();
    let cambio = true;
    while (cambio) {
      cambio = false;
      for (let i = 0; i < pendientes.length; i++) {
        const s = pendientes[i];
        const a = anillo[0], b = anillo[anillo.length - 1];
        const sa = s[0], sb = s[s.length - 1];
        let nuevo = null;
        if (key(a) === key(sb)) nuevo = s.concat(anillo.slice(1));
        else if (key(a) === key(sa)) nuevo = s.slice().reverse().concat(anillo.slice(1));
        else if (key(b) === key(sa)) nuevo = anillo.concat(s.slice(1));
        else if (key(b) === key(sb)) nuevo = anillo.concat(s.slice().reverse().slice(1));
        if (nuevo) { anillo = nuevo; pendientes.splice(i, 1); cambio = true; break; }
      }
    }
    if (anillo.length > 3 && key(anillo[0]) === key(anillo[anillo.length - 1])) anillos.push(anillo);
    else console.warn(`   ! anillo no cerrado descartado (${anillo.length} puntos)`);
  }
  return anillos;
}

/** Douglas-Peucker sobre lon/lat (con corrección por latitud para no deformar). */
function simplificar(ring, tol) {
  if (ring.length < 4) return ring;
  const cosLat = Math.cos((ring[0][1] * Math.PI) / 180);
  const proj = ring.map(([x, y]) => [x * cosLat, y]);
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const pila = [[0, ring.length - 1]];
  while (pila.length) {
    const [i0, i1] = pila.pop();
    let maxD = -1, idx = -1;
    const [ax, ay] = proj[i0], [bx, by] = proj[i1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-18;
    for (let i = i0 + 1; i < i1; i++) {
      const [px, py] = proj[i];
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx, cy = ay + t * dy;
      const d = Math.hypot(px - cx, py - cy);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; pila.push([i0, idx], [idx, i1]); }
  }
  return ring.filter((_, i) => keep[i]);
}

const dentro = (pt, poly) => { // ray casting
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const aRadianes = (n) => n.map(([x, y]) => [Number(x.toFixed(5)), Number(y.toFixed(5))]);

// ------------------------------------------------------------------- main ----
if (!existsSync(IN)) {
  console.error(`No existe ${IN}. Ejecuta primero la descarga descrita en el encabezado.`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(IN, "utf8"));
const relaciones = (raw.elements || []).filter((e) => e.type === "relation");
console.log(`Relaciones recibidas: ${relaciones.length}`);

const features = [];
for (const rel of relaciones) {
  const t = rel.tags || {};
  if (t.boundary !== "administrative" || t.admin_level !== "8") {
    console.log(`   - omitida (level=${t.admin_level}, boundary=${t.boundary}): ${t.name || rel.id}`);
    continue;
  }
  const sub = (rel.members || []).filter((m) => m.type === "relation");
  if (sub.length) console.warn(`   ! ${t.name}: tiene ${sub.length} sub-relación(es); su geometría puede quedar incompleta`);

  const ways = (rel.members || [])
    .filter((m) => m.type === "way" && Array.isArray(m.geometry) && m.geometry.length > 1)
    .map((m) => m.geometry.map((g) => [g.lon, g.lat]));

  const anillos = anillosDesdeWays(ways);
  if (!anillos.length) { console.warn(`   ! ${t.name}: sin geometría usable`); continue; }

  const exteriores = anillos.filter((r) => !esInterior(r, anillos));
  const interiores = anillos.filter((r) => esInterior(r, anillos));
  const simp = anillos.map((r) => aRadianes(simplificar(r, TOLERANCIA)));

  let geometria;
  if (simp.length === 1) geometria = { type: "Polygon", coordinates: [simp[0]] };
  else {
    const poligonos = exteriores.length ? exteriores : [anillos[0]];
    geometria = {
      type: "MultiPolygon",
      coordinates: poligonos.map((ext) => {
        const idx = anillos.indexOf(ext);
        const inners = interiores.filter((inn) => dentro(inn[0], ext));
        return [simp[idx], ...inners.map((inn) => simp[anillos.indexOf(inn)])];
      }),
    };
  }

  features.push({
    type: "Feature",
    properties: {
      nombre: t.name || `Comuna ${rel.id}`,
      osm_id: rel.id,
      region: t["addr:region"] || t["is_in:region"] || "Región Metropolitana de Santiago",
      fuente: "OpenStreetMap",
      licencia: "ODbL",
      actualizado: (raw.osm3s && raw.osm3s.timestamp_osm_base) || null,
    },
    geometry: geometria,
  });
  console.log(`   + ${t.name} (${anillos.length} anillo(s))`);
}

function esInterior(ring, todos) {
  // un anillo es interior si su primer punto cae dentro de otro anillo
  return todos.some((otro) => otro !== ring && dentro(ring[0], otro));
}

const fc = { type: "FeatureCollection", features };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(fc));

const kb = (readFileSync(OUT).length / 1024).toFixed(1);
console.log(`\n${features.length} comunas escritas → ${OUT} (${kb} KB)`);
if (features.length !== 52) {
  console.warn(`AVISO: se esperaban 52 comunas de la RM y salieron ${features.length}.`);
  process.exitCode = 2;
}
