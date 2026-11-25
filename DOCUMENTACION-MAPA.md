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
- El estilo base declara una fuente ráster `ne2_shaded` (relieve de Natural Earth) que
  **ninguna capa usa**: si esa fuente se demora o falla, MapLibre nunca termina de "cargar"
  el estilo → el mapa queda en blanco. Se elimina en `limpiarEstiloBase()` (`src/main.js`),
  en el evento `style.load` y **antes** de añadir las capas propias (quitarla después
  recarga el estilo y borra lo ya añadido).
- **El mapa se crea con la URL del estilo, no con el objeto JSON**: en MapLibre 4.7.1
  `Style.loadJSON()` aplaza la carga a un `requestAnimationFrame`; si la pestaña está en
  segundo plano (o el navegador no pinta) ese frame nunca llega y el mapa queda en blanco.
  La ruta por URL no depende de `requestAnimationFrame` y funciona siempre.
- **Límites comunales**: `data/comunas-rm.geojson` (52 comunas, OSM/ODbL) con capas de
  relleno, resaltado al pasar y borde. Popup con el nombre de la comuna.
- **Pantalla completa** del mapa y **atribución siempre visible** (control desplazado
  sobre el panel inferior mediante la variable CSS `--mapa-panel-h`, que se recalcula con
  un `ResizeObserver` sobre el panel y el contenedor del mapa).

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

- Iconos **SVG** en `icons/` (16 drawings vectoriales del mapa: parque, plaza, mall,
  urgencias, policía, municipalidad, buses, metro, hospital, planetario, evento, salón,
  predicción, betel, casa, información) y clustering nativo de MapLibre.
- MapLibre solo pinta imágenes rasterizadas: el SVG se descarga con `fetch`, se dibuja en
  un `<canvas>` (máx. 128 px) y se añade con `map.addImage`. Si el SVG no se puede
  decodificar se usa el PNG de respaldo de `icons/png/` y, en último caso, un pin de color.
  **No** se usa `map.loadImage` (en este entorno nunca resolvía y dejaba la capa sin añadir).
- El servicio worker sirve los iconos SVG con **cache-first** (`app-santiago-2026-v5`):
  se descargan una sola vez. El resto de recursos se sirven **network-first**, y la
  precache (app shell) se renueva con cada versión del service worker.
- Popups con **nombre, categoría, dirección, comuna, coordenadas, fuente y fecha**
  (§6). En Metro además líneas y estación de combinación.
- **Selector visual de iconos** en el formulario de punto: grilla con las miniaturas SVG
  (`#point-icon-grid`); el valor guardado es la clave del catálogo (`place`, `warning`,
  `health_and_safety`, `hospital`, `school`, `directions_bus`, `metro`,
  `metro_combinacion`, `store`, `park`, `planetario`, `info`, `evento`, `salon`,
  `predicacion`, `betel`, `casa`). Al cambiar la categoría se propone el icono equivalente.

### 1.5 Puntos personalizados y administración (`mapas.txt` §8, §9)

- Botón `#map-add-point`: cualquier usuario autenticado marca un punto en el mapa.
- **Tipo**: `personal` (solo su autor) o `general` (visible para todos; solo admin).
- Formulario con nombre, descripción, categoría, **icono elegido**, lat/lon, visibilidad y
  **vista fija** (`#point-fijo`).
- CRUD completo contra Supabase, protegido por RLS.

### 1.6 Vista de mapa a pantalla completa (2026-11-25)

- **Máximo espacio**: al abrir la pestaña Mapa se añade la clase `body.vista-mapa`, que
  oculta el **header de la app** (`display:none`) y deja el mapa con
  `height: calc(100dvh - 4rem - safe-area)`: ocupa toda la pantalla salvo la barra de
  navegación inferior.
- **Buscador colapsable**: arriba a la izquierda hay un botón con forma de **lupa**
  (`#map-search-toggle`); al presionarlo se despliega el input (`#map-search-wrap`) con el
  foco puesto y, al cerrarlo, se limpia el filtro de la lista de actividades.
- **Controles del mapa a la derecha, en fila horizontal y colapsables**: quedan agrupados
  en `#map-controls-row` (acercar, alejar, centrar, GPS, satélite, capas, pantalla completa,
  agregar punto). Colapsados solo se ve el **botón superior derecho con flecha hacia abajo**
  (`#map-controls-toggle`, `keyboard_arrow_down`); al presionarlo se despliega la fila a su
  izquierda y la flecha rota 180° (`rotate-180`).
- **Panel inferior de actividades colapsable**: `#mapa-panel-toggle` (asa + flecha) pliega
  la sede seleccionada y la lista de actividades; el panel queda reducido a 58 px y la
  atribución se reposa sobre él (`--mapa-panel-h`). Al seleccionar una actividad el panel
  se reabre automáticamente.

### 1.7 Comportamiento de los puntos según el zoom (2026-11-25)

- **Al acercar** (zoom ≥ 12,5) cada punto muestra su **icono**.
- **Al alejar** el icono se transforma en un **punto del color del pin** y ese punto se
  **achica a medida que se aleja hasta desaparecer** (radio interpolado entre zoom 12,5 y
  zoom 7; por debajo de 7 no se dibuja).
  - Capa de lugares (GeoJSON): capa `circle` `${capa}-puntos-mini` (`minzoom: 7`,
    `maxzoom: 12,5`, `circle-radius` interpolado) + capa `symbol` `${capa}-puntos`
    (`minzoom: 12,5`).
  - Puntos personalizados: la misma lógica en CSS (`actualizarPuntosSegunZoom()` al evento
    `zoom`): `.map-point-punto` (círculo de color) y `.map-point-oculto` (desaparecido).
- **Vista fija**: los puntos marcados como fijos (`fijo = true`, opción `#point-fijo` del
  formulario) **conservan siempre su icono**, a cualquier zoom.
- Los pines de **actividad** también se reducen a un punto de color, pero con un **tamaño
  mínimo** (12 px): no desaparecen nunca, para que la sede siempre sea seleccionable.

### 1.8 Agenda y funcionalidades existentes

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
| `icon` | `text` | clave del icono elegido (catálogo SVG, ver §1.4) |
| `latitude` / `longitude` | `double precision` | check dentro de la RM (PostGIS no está disponible) |
| `address`, `comuna`, `source`, `external_id` | `text` | procedencia del dato |
| `active`, `visible` | `boolean` | flags de publicación |
| `tipo` | `text` | `personal` \| `general` |
| `fijo` | `boolean` | vista fija: el punto muestra siempre su icono (por defecto `false`) |
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

-- 3) (opcional, solo si ya existía la tabla) columna "vista fija"
\i sql/08_puntos_fijos.sql
```

> `sql/06` ya incluye la columna `fijo`; `sql/08_puntos_fijos.sql` sirve para agregarla
> a una tabla que se creó antes de esta versión (es idempotente).
>
> **Error 42703** (`column "activo" does not exist`): la columna de publicación se llama
> **`active`**, no `activo`. Ocurrió en la consulta de verificación de `sql/08`; el
> `alter table` de `fijo` sí se había aplicado, así que basta con volver a ejecutar el
> archivo corregido. `scripts/verificar-mapa.mjs` ahora revisa que ninguna consulta
> `select … from public.map_points` use una columna inexistente.

> **Error 42P10** (`there is no unique or exclusion constraint matching the ON CONFLICT
> specification`): el índice único de `external_id` es **parcial**
> (`... where external_id is not null`). PostgreSQL no puede inferir un índice parcial, así
> que el `ON CONFLICT` debe repetir el predicado:
> `on conflict (external_id) where external_id is not null do update`.
> `sql/07_terminales.sql` ya viene corregido (y además crea el índice si falta, borra
> duplicados previos de esas 4 terminales y avisa si falta la tabla `map_points`).

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

# 5) Iconos SVG del mapa (optimiza sin perder el viewBox)
node scripts/optimizar-iconos.mjs     # usa npx svgo (se baja solo, no se agrega al repo)
```

Los iconos se conservan ya optimizados en `icons/*.svg` (490 KB en total para los 16
dibujos; antes 4,3 MB) y el PNG original de cada uno queda en `icons/png/` como respaldo.

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

- `node scripts/verificar-mapa.mjs` → **141 pruebas, 0 fallos, 2 avisos** (datos, coordenadas,
  duplicados, iconos SVG, vista de mapa a pantalla completa, controles colapsables,
  comportamiento de los puntos según el zoom, vista fija, referencias del frontend, RLS en
  los SQL, columnas existentes en las consultas SQL y ausencia de claves privadas).
- Navegador (2026-11-25): **0 errores de consola**; el mapa abre con satélite + comunas,
  las 6 capas de lugares se encienden/apagan de forma independiente, los iconos **SVG** se
  rasterizan y pintan (17/17 miniaturas del selector cargan), los popups muestran todos
  los campos de §6 y el acordeón de la agenda funciona.
- Vista de mapa (2026-11-25): header oculto (`display:none`), mapa de 614 px en una
  ventana de 678 px (nav de 64 px), lupa arriba a la izquierda, controles colapsados en el
  botón con flecha arriba a la derecha (8 botones en una fila horizontal de 362 px),
  panel inferior plegable (269 px → 58 px, con `--mapa-panel-h` = 68 px) y formulario de
  punto con la casilla **“Vista fija (mostrar siempre el icono)”**.
- El service worker quedó en `app-santiago-2026-v5` (los iconos SVG se sirven cache-first y la
  precache se renovó con el rediseño de la vista de mapa).

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
- **El navegador embebido de pruebas no dispara `requestAnimationFrame`**: por eso el mapa
  no se repinta ahí y `map.loaded()` queda en `false`. No es un fallo de la app (en un
  navegador normal sí se pinta); se verificó que el estilo, las fuentes y las capas propias
  se crean correctamente (`style.load` → `ne2_shaded` eliminada → capas añadidas).
- **RLS y las 4 terminales** requieren que el administrador ejecute `sql/06`, `sql/07` y
  (opcionalmente) `sql/08` en Supabase: hasta entonces el frontend funciona y solo avisa
  por consola.
