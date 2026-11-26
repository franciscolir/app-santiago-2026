# STGO 2026 | Región 8 — Notas de entrega

**Fecha:** 2026-11-26  
**Rama de código:** `main`  
**Despliegue:** GitHub Pages (`sw` v34)

Este documento resume el estado funcional, las migraciones aplicadas, la batería de pruebas y los pendientes conocidos.

---

## Funcionalidades entregadas

### Acceso, grupos y roles

- Login por usuario + contraseña; grupo automático desde el perfil.
- Registro con contraseña de grupo.
- Jerarquía:
  - **ADMIN**: vista simplificada (Grupos · Actividades · Mapa · Emergencia).
  - **MANAGER**: gestor de su grupo, con la app normal.
  - **Usuario**: acceso normal a su grupo.
- Grupos con número/slug, nombre, descripción, estado y contraseña.
- El ADMIN puede nombrar/quitar MANAGER desde los miembros.
- RLS por grupo y por alcance global/grupo.

### Mapa

- Categorías → subcategorías/capas.
- Subcategorías con color, icono, comportamiento (`auto`/siempre icono) y capa externa opcional.
- Panel **Capas** generado desde categorías/subcategorías reales.
- Ajustes de capas solo para ADMIN.
- Nombres de puntos de hasta 3 líneas, editables con textarea.
- Alta de punto por clic o pulsación larga; sin botón lateral.
- Controles laterales: Centrar · Mi ubicación · Capas · Cerca de mí (placeholder).
- Puntos externos: lista completa con visibilidad global y botón **Deseleccionar todo**.
- JW: siempre icono, +20 %, destello/latido y vínculo con actividades.
- Salud separada en **Hospitales públicos** y **SAPU / SAR**.

### Actividades, agenda y muro

- Agenda con todos los días del evento, días pasados/futuros, día actual expandido.
- Evento editable por ADMIN/MANAGER de su grupo.
- Actividades por grupo; el MANAGER puede crearlas para su grupo.
- Actividades multi-grupo para el ADMIN con `series_id`.
- Muro aislado por grupo; XSS escapado.

### Emergencia

- Vista simplificada: solo contactos y botón “Abrir sistema de emergencia”.
- ADMIN puede administrar contactos generales; todos los usuarios los ven.
- SOS flotante oculto dentro de la vista Emergencia.

### Puntos fijos

- Puntos bloqueados globales creados por ADMIN.
- Solo ADMIN puede editarlos/borrarlos; siempre visibles aunque la capa esté apagada.

---

## Migraciones aplicadas

`sql/06` → `07` → `08` (si aplica) → `09` → `10` → `11` → `14` → `15` → `16` → `17` → `18` → `19` → `20` → `21` → `22`.

Novedades finales:

- `sql/17_admin_manager.sql`: roles ADMIN/MANAGER, puntos bloqueados, `series_id`, `admin_grupos()`.
- `sql/18_endurecer_grupos.sql`: el MANAGER no edita la fila del grupo.
- `sql/19_subcategorias_capas.sql`: subcategorías, overrides externos y backfill.
- `sql/20_jw_subcategorias.sql`: JW siempre icono.
- `sql/21_salud_hospital_sapu.sql`: Hospitales públicos / SAPU-SAR.
- `sql/22_categorias_eliminables.sql`: categorías eliminables con subcategorías huérfanas.

`schema.sql` documenta el estado final; los archivos `sql/` son la fuente de verdad.

---

## Pruebas

- `node scripts/verificar-mapa.mjs` → **404 pruebas · 0 fallos · 2 avisos**.
- `scripts/qa-simulacion.mjs` → **228 comprobaciones de integración · 0 fallos**:
  - 3 grupos × 10 usuarios, 1 MANAGER por grupo.
  - Eventos solapados, actividades ADMIN/MANAGER, muro aislado.
  - IDOR, XSS, inyección SQL, anon, JWT manipulado, escalada de privilegios.
- Pruebas en navegador: login/registro, agenda, mapa, capas, puntos, muro, emergencia, ADMIN/MANAGER.
- **0 errores de consola** en los flujos normales.

---

## Pendientes conocidos

1. Implementar **“Cerca de mí”** (radio, mall/parques/urgencias/metro). PostGIS está disponible
   (3.3.7) pero no instalado; para las capas GeoJSON actuales se puede usar Haversine.
2. Alta de evento cuando no existe ninguno (ruta `insert` cubierta por verificador).
3. Corte **+30 → siguiente actividad** de JW observado en vivo (lógica cubierta por pruebas puras).
4. Límites de tasa/abuso de Supabase Auth (configuración del proyecto).
5. `schema.sql` es consolidación documentada, no un `pg_dump` en vivo.

---

## Estado de datos

- 5 actividades originales.
- 6 puntos originales.
- 1 grupo (`principal`).
- 2 perfiles: `admin` (ADMIN) y `test` (MANAGER).
- Sin usuarios, grupos, actividades, puntos, contactos ni overrides de prueba.
