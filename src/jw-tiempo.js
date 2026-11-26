// ============================================================================
// src/jw-tiempo.js — Cálculo puro del estado de animación de los puntos JW
// (UPDATE.md Etapa 8, 2026-11-26).
//
// No toca el DOM ni Supabase: recibe las actividades del punto y la hora
// actual de Chile ("YYYY-MM-DDTHH:MM") y devuelve:
//   { estado: "destello" | "latido" | null, actividad: ... }
//
// Reglas:
//   - 30 minutos antes del inicio  → latido.
//   - Desde el inicio hasta 30 min después del término → destello.
//   - Actividad programada para HOY y aún sin entrar en el latido → destello.
//   - Después del +30 se deja de destacar esa actividad y se pasa a la
//     siguiente (si es de hoy; si no, el punto queda sin animación hasta su día).
//   - Las actividades canceladas o sin hora de inicio se ignoran.
//   - Se compara la hora de PARED de Chile, sin offsets del dispositivo: evita
//     desfases por zona horaria o DST.
// ============================================================================

const MINUTO = 60000;

// Hora actual en Chile, independiente de la zona del dispositivo.
export function ahoraChile(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);

  const valor = (tipo) => partes.find((p) => p.type === tipo)?.value || "";
  const dia = `${valor("year")}-${valor("month")}-${valor("day")}`;
  const hora = `${valor("hour")}:${valor("minute")}`;
  return { fecha: dia, hora, iso: `${dia}T${hora}` };
}

// "YYYY-MM-DDTHH:MM" → milisegundos de pared (UTC) para comparar sin offsets.
function minutosDe(fechaHora) {
  const [fecha, hora = "00:00"] = String(fechaHora).split("T");
  const [y, m, d] = fecha.split("-").map(Number);
  const [hh, mm] = hora.split(":").map(Number);
  if (![y, m, d, hh, mm].every(Number.isFinite)) return null;
  return Date.UTC(y, m - 1, d, hh, mm);
}

export function estadoJW(actividades, ahoraIso) {
  const ahora = minutosDe(ahoraIso);
  if (ahora === null) return { estado: null, actividad: null };
  const hoy = String(ahoraIso).slice(0, 10);

  const validas = (actividades || [])
    .filter((a) => a && a.inicio && !a.cancelada)
    .map((a) => {
      const ini = minutosDe(`${a.fecha}T${a.inicio}`);
      const fin = a.fin ? minutosDe(`${a.fecha}T${a.fin}`) : ini;
      return { ...a, ini, fin, _valida: ini !== null && fin !== null };
    })
    .filter((a) => a._valida)
    .sort((a, b) => a.ini - b.ini);

  // 8.2 · latido: empieza 30 min antes (incluido) y dura hasta el inicio.
  for (const a of validas) {
    if (ahora >= a.ini - 30 * MINUTO && ahora < a.ini) {
      return { estado: "latido", actividad: a };
    }
  }

  // 8.3 · destello: durante la actividad y 30 min después del término.
  for (const a of validas) {
    if (ahora >= a.ini && ahora <= a.fin + 30 * MINUTO) {
      return { estado: "destello", actividad: a };
    }
  }

  // 8.1 · actividad programada para HOY (antes de su ventana de latido).
  for (const a of validas) {
    if (a.fecha === hoy && ahora < a.ini - 30 * MINUTO) {
      return { estado: "destello", actividad: a };
    }
  }

  // Después del +30 sin otra actividad hoy: el punto deja de destacarse.
  return { estado: null, actividad: null };
}
