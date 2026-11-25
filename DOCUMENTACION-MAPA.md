# Documentación del módulo de mapa — Etapa 7 (`mapas.txt` §14)

Repo: `https://github.com/franciscolir/app-santiago-2026` · Rama `main` · GitHub Pages.
Arquitectura **sin cambios**: JS Vanilla (módulos ES) + HTML/CSS + MapLibre GL 4.7.1 + Supabase + PWA.

Este documento resume lo entregado por las etapas 1–7 del mapa. El detalle de cada
cambio día a día está en `AGENT.md`; el plan de pruebas está en `PRUEBAS.md`.

---

## 1. Modificaciones realizadas

### 1.1 Cartografía (`mapas.txt` §3)

- **Vista satelital por defecto**: fuente ráster Esri World Imagery (`satelite`) + estilo
  OpenFreeMap `positron` superpuesto para los rótulos legibles.
- **Límites comunales**: `data/comunas-rm.geojson` (52 comunas, OSM/ODbL) con capas de
  relleno, resaltado al pasar y borde. Popup con el nombre de la comuna.
- **Pantalla completa** del mapa y **atribución siempre visible** (control desplazado
  sobre el panel inferior mediante la variable CSS `--mapa-panel-h`).

### 1.2 Datos geográficos (`mapas.txt` §4, §7)

| Capa | Archivo | Origen | Puntos |
|---|---|---|---|
| Comunas | `data/comunas-rm.geojson` | OSM (Overpass) | 52 |
| Estaciones Metro/MetroTren | `data/transporte-estaciones.geojson` | DTPM GTFS | 154 |
| Líneas de Metro | `data/transporte-lineas.geojson` | DTPM GTFS (`shapes.txt`) | 9 |
| Parques grandes, cerros y zoológicos | `data/lugares/parques.geojson` | OSM | 380 |
| Plazas de Armas | `data/lugares/plazas.geojson` | OSM | 42 |
| Centros comerciales (malls) | `data/lugares/comercio.geojson` | OSM | 131 |
| Hospitales públicos, SAPU y SAR | `data/lugares/salud.geojson` | OSM | 269 |
| Bomberos, Carabineros, Comisarías y Tenencias | `data/lugares/seguridad.geojson` | OSM | 345 |
| Municipalidades | `data/lugares/servicios.geojson` | OSM | 61 |
| Terminales de bus (4) | tabla `map_points` | OSM (vía `sql/07`) | 4 |

> Los paraderos de bus (12.181) **no** se muestran: el usuario pidió solo las cuatro
> terminales generales. El archivo se puede regenerar con `--paraderos`, pero no se versiona.

### 1.3 Panel de capas (`mapas.txt` §10)

- Botón `#map-layers` que abre `#capas-sheet` con 14 interruptores agrupados
  (Cartografía, Transporte, Áreas verdes, Comercio, Servicios, Aplicación).
- Cada interruptor es independiente: encender/apagar una capa no afecta a las demás.
- Preferencias persistidas en `localStorage` (`app-santiago-2026:capas`).
- Cada capa de lugares descarga **su propio** GeoJSON la primera vez que se enciende
  (§11: no cargar miles de puntos innecesariamente) y queda cacheada por el service worker.

### 1.4 Marcadores e información (`mapas.txt` §5, §6)

- Iconos PNG en `icons/` (pin por categoría) y clustering nativo de MapLibre.
- Popups con **nombre, categoría, dirección, comuna, coordenadas, fuente y fecha**
  (§6). En Metro además líneas y estación de combinación.
- Iconos cargados con `fetch` + `createImageBitmap` (no con `map.loadImage`, que en este
  entorno nunca resolvía y dejaba la capa sin añadir). Si un PNG falla se dibuja un pin
  de color de respaldo.

### 1.5 Puntos personalizados y administración (`mapas.txt` §8, §9)

- Botón `#map-add-point`: cualquier usuario autenticado marca un punto en el mapa.
- **Tipo**: `personal` (solo su autor) o `general` (visible para todos; solo admin).
- Formulario con nombre, descripción, categoría, **icono elegido**, lat/lon y visibilidad.
- CRUD completo contra Supabase, protegido por RLS.

### 1.6 Agenda y funcionalidades existentes

- La agenda de `agenda.html` quedó integrada en `index.html` (timeline por días, nodo
  activo, acordeones) **sin reemplazar** la agenda semanal ni la relación actividades↔usuarios.
- Login, muro, contactos de emergencia, GPS y panel inferior siguen intactos.

---

## 2. Tablas nuevas o modificadas

### `public.map_points` (nueva) — `sql/06_map_points.sql`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `name` | `text` | obligatorio, 1–120 caracteres |
| `description` | `text` | detalle opcional |
| `category` | `text` | `general`, `seguridad`, `salud`, `educacion`, `transporte`, `comercio`, `areas_verdes`, `otro` |
| `subcategory` | `text` | subcategoría §8 |
| `icon` | `text` | icono elegido (PNG de `icons/`) |
| `latitude` / `longitude` | `double precision` | check dentro de la RM (PostGIS no está disponible) |
| `address`, `comuna`, `source`, `external_id` | `text` | procedencia del dato |
| `active`, `visible` | `boolean` | flags de publicación |
| `tipo` | `text` | `personal` \| `general` |
| `created_by` | `uuid` | FK a `profiles(id)` |
| `created_at`, `updated_at` | `timestamptz` | trigger `set_map_points_updated_at()` |

Índices: `visible`, `tipo`, `created_by`, `(latitude, longitude)`, `category` y **único
parcial** sobre `external_id` (permite reimportar sin duplicar).

No se modificó ninguna tabla existente (`activities`, `profiles`, `wall_posts`,
`activity_assignments`, `emergency_contacts`).

---

## 3. SQL y políticas RLS

Aplicar en el **SQL Editor de Supabase**, en este orden:

```sql
-- 1) Tabla + RLS de los puntos personalizados
\i sql/06_map_points.sql      -- o pegar el contenido del archivo

-- 2) Semilla de las 4 terminales de bus (puntos generales)
\i sql/07_terminales.sql
```

Políticas resultantes:

| Política | Comando | Condición |
|---|---|---|
| Usuarios consultan puntos del mapa | `select` | general visible y activo **o** personal propio **o** admin |
| Usuarios gestionan sus puntos personales | `all` | `tipo='personal' and created_by=auth.uid()` |
| Admin gestiona puntos generales | `all` | `tipo='general' and is_admin()` |

`grant select, insert, update, delete on public.map_points to authenticated` — la barrera
real es RLS, no los permisos.

---

## 4. Fuentes de datos utilizadas

| Fuente | Uso | Licencia / atribución |
|---|---|---|
| **OpenStreetMap** (vía Overpass API) | Comunas, parques, plazas, malls, salud, seguridad, municipalidades, terminales | ODbL — se muestra “OSM · ODbL” en los popups |
| **DTPM GTFS** (feed vigente) | Estaciones y líneas de Metro/MetroTren | Datos abiertos DTPM — se muestra “Metro de Santiago · DTPM GTFS” |
| **Esri World Imagery** | Vista satelital | Atribución “Esri, Maxar, Earthstar Geographics” (control de atribución visible) |
| **OpenFreeMap / OpenMapTiles** | Estilo base `positron` (rótulos) | OpenMapTiles / OSM |
| **Supabase** | Sesiones, actividades y puntos personalizados | — |

Sin claves privadas en el frontend: solo la publishable key (`sb_publishable_…`).

---

## 5. Procedimiento de importación (reproducible)

```bash
# 0) Variables: solo Node ≥ 18. Los espejos de Overpass se prueban en orden.
node scripts/verificar-mapa.mjs        # verificación (Etapa 6)

# 1) Comunas (Overpass + simplificación Douglas-Peucker)
curl -A "app-santiago-2026/1.0" --data-urlencode "data@scripts/_q_comunas.txt" \
     https://overpass.private.coffee/api/interpreter -o scripts/_overpass_comunas.json
node scripts/importar-comunas.mjs
node scripts/validar-comunas.mjs

# 2) Transporte (GTFS oficial): descomprimir el zip en scripts/_gtfs/ y luego
node scripts/importar-transporte.mjs              # estaciones + líneas
node scripts/importar-transporte.mjs --paraderos  # opcional: 12.181 paraderos

# 3) Lugares (Overpass): un archivo por capa, con los filtros del usuario
node scripts/importar-lugares.mjs                 # todas las capas
node scripts/importar-lugares.mjs salud seguridad  # solo esas

# 4) Terminales de bus → Supabase (SQL Editor)
#    sql/07_terminales.sql (idempotente)
```

Reglas del importador de lugares:

- **Puntos**: siempre centroides reales de elementos OSM; nunca coordenadas inventadas.
- **Parques**: `leisure=park` con área ≥ **1 ha**, o nombre de cerro, o `tourism=zoo`.
- **Plazas**: `place=square` (plazas de armas).
- **Comercio**: solo `shop=mall`.
- **Salud**: solo necesidad básica pública (SAPU, SAR, CESFAM, CECOSF, consultorios, centros
  de salud, postas) u operador público; se descartan clínicas privadas.
- **Seguridad**: `amenity=fire_station`, `amenity=police`, `office=police`.
- **Servicios**: solo `amenity=townhall` (municipalidades).
- **Dedupe**: `categoría|nombre|comuna`, con prioridad relación > way > nodo.
- **Idempotencia ante fallos**: si Overpass no responde, el archivo de esa capa **no** se
  sobrescribe (se conserva el anterior).

---

## 6. Variables de configuración necesarias

`src/config.js` (todas públicas, ya configuradas):

```js
export const SUPABASE_URL = "https://<proyecto>.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_…";   // nunca service_role
export const EMERGENCY_URL = "https://auxilio-rm-go.base44.app/";
```

No hay variables de entorno ni claves de mapas私 embebidas en el repositorio: el
`service_role` y las claves de administración de Supabase se usan solo en el SQL Editor.

---

## 7. Pruebas ejecutadas y resultados

Detalle en `PRUEBAS.md`.

- `node scripts/verificar-mapa.mjs` → **88 pruebas, 0 fallos, 2 avisos** (datos, coordenadas,
  duplicados, referencias del frontend, RLS en los SQL y ausencia de claves privadas).
- Navegador (2026-11-25): **0 errores de consola**; el mapa abre con satélite + comunas,
  las 6 capas de lugares se encienden/apagan de forma independiente, los iconos PNG se
  cargan, los popups muestran todos los campos de §6 y el acordeón de la agenda funciona.
- El service worker quedó en `app-santiago-2026-v3`.

---

## 8. Limitaciones conocidas

- **PostGIS no está disponible** en el proyecto: los puntos se guardan con lat/lon simples
  y no se pueden consultar por radio ni por polígono.
- **Esri World Imagery** se usa sin clave; hay que revisar sus condiciones de uso y volumen
  antes de un despliegue masivo.
- **Tailwind vía CDN** (aviso de producción del propio Tailwind).
- **3 avisos de MapLibre** (`Expected value to be of type number, but found null instead`)
  provienen del estilo OpenFreeMap, no del código de la app.
- **Sobrescritura de Overpass**: los espejos públicos fallan con 502/504 con frecuencia; el
  importador conserva el archivo anterior cuando eso ocurre.
- **Cobertura de OSM**: no todos los parques o plazas tienen geometría o nombre en OSM;
  el filtro de área deja fuera los parques de menos de 1 ha (por pedido explícito).
- **La vista de pantalla completa** no se puede verificar en el navegador embebido de
  pruebas (`requestFullscreen()` nunca resuelve allí); funciona en Chrome/Edge normal.
- **RLS y las 4 terminales** requieren que el administrador ejecute `sql/06` y `sql/07` en
  Supabase: hasta entonces el frontend funciona y solo avisa por consola.
