// =============================================================================
// scripts/optimizar-iconos.mjs
// Optimiza los iconos SVG del mapa (icons/*.svg) sin perder el viewBox.
//
// Uso:  node scripts/optimizar-iconos.mjs
//
// Los iconos originales venían con 2 decimales y ocupaban 4,3 MB; con SVGO
// (rutas relativas, 0-1 decimales, grupos colapsados) bajan a ~0,7 MB: se
// descargan 4 veces menos y se rasterizan más rápido en el navegador.
// El PNG original de cada icono queda en icons/png/ como respaldo.
//
// Requiere SVGO (se baja solo con npx, no se agrega al proyecto):
//   npx svgo@3.3.2 --config scripts/svgo.config.mjs -i <archivo> -o <archivo>
//
// Antes de sobrescribir deja una copia de los archivos en la carpeta temporal
// del sistema (%TEMP%\opencode\icons-backup) por si hay que volver atrás.
// =============================================================================
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICONOS = join(ROOT, "icons");
const CONFIG = join(ROOT, "scripts", "svgo.config.mjs");
const BACKUP = join(tmpdir(), "opencode", "icons-backup");
const LIMITE_KB = 400;   // límite que controla scripts/verificar-mapa.mjs
const Npx = process.platform === "win32" ? "npx.cmd" : "npx";

const svgs = readdirSync(ICONOS).filter((n) => n.toLowerCase().endsWith(".svg"));
if (!svgs.length) {
  console.error("No hay archivos .svg en icons/.");
  process.exit(1);
}
mkdirSync(BACKUP, { recursive: true });

const kb = (n) => (n / 1024).toFixed(1).padStart(7) + " KB";
let antesTotal = 0, despuesTotal = 0, fallos = 0;

for (const n of svgs) {
  const ruta = join(ICONOS, n);
  const antes = statSync(ruta).size;
  antesTotal += antes;
  // Copia de seguridad del original (solo si no existe: así se conserva).
  const copia = join(BACKUP, n);
  if (!existsSync(copia)) copyFileSync(ruta, copia);

  // En Windows `npx.cmd` es un script de comandos: se necesita `shell: true`.
  const res = spawnSync(
    Npx,
    ["--yes", "svgo@3.3.2", "--config", CONFIG, "-i", ruta, "-o", ruta],
    { stdio: ["ignore", "ignore", "pipe"], shell: process.platform === "win32" }
  );
  if (res.status !== 0) {
    console.error(`  ! ${n}: SVGO falló (${String(res.stderr || res.error?.message || "error").split("\n")[0]}), se conserva el original.`);
    fallos++;
    continue;
  }
  // Se valida que el SVG siga teniendo viewBox (necesario para escalarlo).
  const texto = readFileSync(ruta, "utf8");
  if (!/viewBox\s*=/i.test(texto) || !/<svg[\s>]/i.test(texto)) {
    console.warn(`  (aviso) ${n} quedó sin viewBox: se restaura el original`);
    copyFileSync(copia, ruta);
    fallos++;
    continue;
  }
  const despues = statSync(ruta).size;
  despuesTotal += despues;
  const marca = despues > LIMITE_KB * 1024 ? "  ⚠ sigue por encima del límite" : "";
  console.log(`  ✓ ${n.padEnd(24)} ${kb(antes)} → ${kb(despues)}${marca}`);
}

console.log(`\nTotal: ${kb(antesTotal)} → ${kb(despuesTotal)} · ${fallos} fallos · copias en ${BACKUP}`);
console.log("Revisa que ningún SVG supere 400 KB (lo controla scripts/verificar-mapa.mjs).");
