# APP SANTIAGO 2026 — frontend

Frontend móvil en JavaScript Vanilla + HTML/CSS, preparado para GitHub Pages y Supabase.

## 1. Publicar en GitHub
1. Confirma que `index.html` quede en la raíz del repositorio y `src/` como subcarpeta.
2. En GitHub: **Settings → Pages → Deploy from a branch → main → /(root)**.
3. Repository real: `https://github.com/franciscolir/app-santiago-2026`.

## 2. Configuración
Los valores públicos de Supabase ya están puestos en `src/config.js`. La publishable key puede estar en el frontend; nunca pongas la `service_role` key.

Los iconos de la PWA se generaron desde `assets/stgo-2026-logo.png` y viven en `icons/`.

## 3. Requisitos de base de datos que debe tener el esquema
Este frontend presupone que `activities` tiene las columnas `latitude` y `longitude`. Si tu SQL inicial creó `lat` y `long`, cambia esos nombres en `src/main.js` o ejecuta:
```sql
alter table public.activities
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
```
También presupone que las relaciones `activities → activity_assignments` y `wall_posts → profiles` están reconocidas por Supabase mediante claves foráneas.

## 4. Login
Invoca la Edge Function `login-username` con `username` y `password`, recibe la sesión y la registra con `supabase.auth.setSession()`.

## 5. Alcance de esta primera entrega
Incluye login, recuperación de sesión, navegación inferior, agenda, cambio de estado de actividades asignadas, mapa, muro, contactos de emergencia y formulario básico de administración de actividades.
La asignación desde el formulario utiliza UUID de usuarios separados por coma; es una solución temporal de administración. Todavía faltan la pantalla de administración de usuarios, selección de asignados por nombre, personalización de instrucciones por usuario, gestión de archivos adjuntos y validaciones completas de permisos/fechas. Antes de producción hay que revisar RLS y las políticas de Storage.

## 6. Prueba local
No abras `index.html` directamente: los módulos ES y el service worker necesitan un servidor HTTP.

Con Node.js:
```bash
npx --yes serve@14 . --listen 8080
```

Alternativa con Python:
```bash
python -m http.server 8080
```

Luego entra a `http://localhost:8080`.

## 7. PWA
- `manifest.webmanifest` incluye iconos de 192/512 px y variante *maskable*.
- `sw.js` guarda los recursos locales para abrir la interfaz sin conexión.
- Los datos de Supabase y los recursos externos por CDN todavía requieren conexión.

## 8. Módulo de mapa

- Implementación, fuentes, SQL y procedimiento de importación: **`DOCUMENTACION-MAPA.md`**.
- Plan y resultados de pruebas: **`PRUEBAS.md`**.
- Verificación automática (datos, coordenadas, duplicados, iconos SVG, referencias, RLS y claves privadas):

```bash
node scripts/verificar-mapa.mjs
```

- Optimizar los iconos SVG del mapa (sin perder el `viewBox`; usa `npx svgo`, no agrega dependencias):

```bash
node scripts/optimizar-iconos.mjs
```

- En Supabase (SQL Editor, en este orden): `sql/06_map_points.sql` → `sql/07_terminales.sql`
  (opcional `sql/08_puntos_fijos.sql` si la tabla ya existía antes de la columna `fijo`) →
  **`sql/09_admin_gestiona_puntos.sql`** (permite que el admin renombre, oculte y borre
  cualquier punto del mapa, incluidos los personales de otros usuarios).

- Separar los cuarteles de bomberos de la capa de seguridad (sin volver a Overpass; es
  idempotente y no sobrescribe nada si ya están separados):

```bash
node scripts/separar-bomberos.mjs
```
