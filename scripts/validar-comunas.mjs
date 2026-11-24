// Chequeo rápido de data/comunas-rm.geojson (bbox global + centroides de muestra)
import { readFileSync } from "node:fs";
const fc = JSON.parse(readFileSync(new URL("../data/comunas-rm.geojson", import.meta.url), "utf8"));
let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, pts = 0;
const caminar = (c) => typeof c[0] === "number"
  ? (pts++, minx = Math.min(minx, c[0]), maxx = Math.max(maxx, c[0]), miny = Math.min(miny, c[1]), maxy = Math.max(maxy, c[1]))
  : c.forEach(caminar);
fc.features.forEach((f) => caminar(f.geometry.coordinates));
console.log(`features: ${fc.features.length} | puntos: ${pts}`);
console.log(`bbox: lon [${minx.toFixed(4)}, ${maxx.toFixed(4)}]  lat [${miny.toFixed(4)}, ${maxy.toFixed(4)}]`);
console.log(`centroides de muestra:`);
["Santiago", "Providencia", "Maipú", "Puente Alto", "Colina"].forEach((n) => {
  const f = fc.features.find((x) => x.properties.nombre === n);
  if (!f) return console.log(`  ${n}: NO ENCONTRADA`);
  const r = [];
  (function c(co) { typeof co[0] === "number" ? r.push(co) : co.forEach(c); })(f.geometry.coordinates);
  const cx = r.reduce((s, p) => s + p[0], 0) / r.length, cy = r.reduce((s, p) => s + p[1], 0) / r.length;
  console.log(`  ${n}: ${cy.toFixed(4)}, ${cx.toFixed(4)} (${f.geometry.type}, ${r.length} pts)`);
});
const malos = fc.features.filter((f) => !f.properties.nombre || !f.geometry);
console.log(`inválidos: ${malos.length}`);
