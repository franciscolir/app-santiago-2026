// =============================================================================
// scripts/optimizar-iconos.mjs
// Optimiza los iconos SVG del mapa (icons/*.svg) sin perder el viewBox.
//
// Uso:  node scripts/optimizar-iconos.mjs
//
// Los iconos originales venían con 2 decimales y ocupaban 4,3 MB; con SVGO
// (rutas relativas, 1 decimal, grupos colapsados) bajan a ~1 MB: se descargan
// 4 veces menos y se rasterizan más rápido en el navegador.
// El PNG original de cada icono queda en icons/png/ como respaldo.
//
// Requiere SVGO (se baja solo con npx, no se agrega al proyecto):
//   npx svgo@3.3.2 -f icons -o <salida> --config scripts/svgo.config.mjs
// =============================================================================
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICONOS = join(ROOT, "icons");
const CONFIG = join(ROOT, "scripts", "svgo.config.mjs");
const Npx = process.platform === "win32" ? "npx.cmd" : "npx";

const svgs = readdirSync(ICONOS).filter((n) => n.toLowerCase().endsWith(".svg"));
if (!svgs.length) {
  console.error("No hay archivos .svg en icons/.");
  process.exit(1);
}

const antes = svgs.reduce((sum, n) => sum + statSync(join(ICONOS, n)).size, 0);

const salida = mkdtempSync(join(tmpdir(), "iconos-svgo-"));
console.log(`Optimizando ${svgs.length} iconos con SVGO…`);
const res = spawnSync(
  Npx,
  ["--yes", "svgo@3.3.2", "-f", ICONOS, "-o", salida, "--config", CONFIG],
  { stdio: "inherit", shell: process.platform === "win32" }
);

if (res.status !== 0) {
  console.error("\nSVGO no se pudo ejecutar. Revisa la conexión a npm o instala svgo con:");
  console.error("  npm i -D svgo@3.3.2");
  rmSync(salida, { recursive: true, force: true });
  process.exit(1);
}

let total = 0;
for (const n of svgs) {
  const destino = join(salida, n);
  if (!existsSync(destino)) {
    console.warn(`  (aviso) SVGO no generó ${n}: se conserva el original`);
    total += statSync(join(ICONOS, n)).size;
    continue;
  }
  // Se valida que el SVG siga teniendo viewBox (necesario para escalarlo).
  const texto = readFileSync(destino, "utf8");
  if (!/viewBox\s*=/i.test(texto) || !/<svg[\s>]/i.test(texto)) {
    console.warn(`  (aviso) ${n} quedó sin viewBox: se conserva el original`);
    total += statSync(join(ICONOS, n)).size;
    continue;
  }
  copyFileSync(destino, join(ICONOS, n));
  total += statSync(join(ICONOS, n)).size;
}
rmSync(salida, { recursive: true, force: true });

const pct = ((1 - total / antes) * 100).toFixed(1);
console.log(`\nIconos: ${(antes / 1024).toFixed(1)} KB -> ${(total / 1024).toFixed(1)} KB (-${pct}%)`);
console.log("Listo. Revisa que los iconos se vean bien en el mapa antes de commitear.");
