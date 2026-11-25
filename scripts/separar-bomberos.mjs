// =============================================================================
// scripts/separar-bomberos.mjs
// Separa la capa "seguridad" en dos: "bomberos" (cuarteles) y "seguridad"
// (policía, comisarías y tenencias).
//
// Motivo: el usuario pidió separar bomberos de policía (2026-11-25). Los datos
// vienen del MISMO archivo importado desde Overpass: este script solo reparte
// los puntos ya descargados, sin inventar ni mover nada.
//
// Uso:  node scripts/separar-bomberos.mjs
// Entrada : data/lugares/seguridad.geojson
// Salida  : data/lugares/bomberos.geojson  (nuevo)
//           data/lugares/seguridad.geojson  (reescrito sin los bomberos)
//
// Es idempotente: se puede ejecutar más de una vez. Si el archivo ya está
// separado, no cambia nada.
//
// NOTA: para regenerar todo desde Overpass (con la separación ya incluida en
// la consulta), usar `node scripts/importar-lugares.mjs`.
// =============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "data", "lugares");
const ARCHIVO = join(DIR, "seguridad.geojson");
const BOMBEROS = join(DIR, "bomberos.geojson");

const esBombero = (f) => {
  const sub = String(f.properties?.subcategoria || "");
  const nombre = String(f.properties?.nombre || "");
  return /bombero/i.test(sub) || /cuartel de bomberos|bomberos de/i.test(nombre);
};

const fc = JSON.parse(readFileSync(ARCHIVO, "utf8"));
const features = Array.isArray(fc.features) ? fc.features : [];

// Si ya está separado, no se toca nada.
const yaSeparado = features.length > 0 && features.every((f) => !esBombero(f));
if (yaSeparado) {
  console.log("La capa 'seguridad' ya está separada de 'bomberos': no hay nada que hacer.");
  process.exit(0);
}

const bomberos = features.filter(esBombero).map((f) => ({
  ...f,
  properties: {
    ...f.properties,
    categoria: "bomberos",
    categoria_label: "Bomberos",
    subcategoria: "Cuartel de bomberos",
  },
}));
const seguridad = features.filter((f) => !esBombero(f)).map((f) => ({
  ...f,
  properties: {
    ...f.properties,
    categoria: "seguridad",
    categoria_label: "Policía, comisarías y tenencias",
    subcategoria: "Comisaría o tenencia",
  },
}));

writeFileSync(BOMBEROS, JSON.stringify({ type: "FeatureCollection", features: bomberos }));
writeFileSync(ARCHIVO, JSON.stringify({ type: "FeatureCollection", features: seguridad }));

console.log(`  ✓ bomberos.geojson  ${bomberos.length} pts  (${(readFileSync(BOMBEROS).length / 1024).toFixed(1)} KB)`);
console.log(`  ✓ seguridad.geojson ${seguridad.length} pts  (${(readFileSync(ARCHIVO).length / 1024).toFixed(1)} KB)`);
