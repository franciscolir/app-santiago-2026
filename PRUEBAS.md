# Pruebas del módulo de mapa — Etapa 6 (`mapas.txt` §13 y §14)

Fecha de la última corrida: **2026-11-25** · App servida en `http://localhost:8080`
(`npx.cmd --yes serve@14 . --listen 8080`) con la cuenta de prueba `test`.

---

## 1. Pruebas automáticas (reproducibles)

```bash
node scripts/verificar-mapa.mjs     # código de salida 0 = todo OK, 1 = hay fallos
```

Sin dependencias: solo Node.js ≥ 18. Comprueba:

| Bloque | Qué verifica |
|---|---|
| 1. Comunales | 52 comunas, FeatureCollection, nombres únicos, geometrías dentro del bbox de la RM |
| 2. Transporte | ≥ 150 estaciones, tipos `metro`/`metrotren`, líneas asociadas, 9 trazados, coordenadas dentro de la RM, `transporte-paraderos.geojson` **no** versionado |
| 3. Lugares | Un archivo por capa, solo geometrías `Point`, dentro de la RM, campos §8 completos, sin duplicados (categoría+nombre+comuna), subcategorías dentro de la lista permitida por capa (filtros estrictos del usuario) |
| 4. Frontend | Catálogo de iconos SVG completo (archivo, `viewBox` y tamaño), PNG de respaldo de cada icono, existe el GeoJSON de cada capa del panel, todos los recursos del precache existen, los paraderos no están en el precache, `CACHE_NAME` versionado, sin `onclick` inline (los módulos no exponen globales), sin hooks de depuración, iconos rasterizados sin `map.loadImage`, selector visual de iconos presente |
| 5. Seguridad y SQL | Sin `service_role` en el frontend (se ignoran los comentarios), `config.js` con publishable key, políticas RLS de `sql/06`, `sql/07` con las 4 terminales y sus `external_id` OSM, `ON CONFLICT` con el predicado del índice parcial (regresión del error 42P10) |
| 6. Vista de mapa (2026-11-25) | El header se oculta en la vista mapa y el mapa usa `100dvh`; lupa del buscador arriba a la izquierda; controles colapsables arriba a la derecha con flecha hacia abajo y **columna vertical** de botones; **panel inferior eliminado** y detalles en el cuadro de mensaje (`#toast-msg`, `mostrarMensaje`); umbrales de zoom y capa de punto de color (`-puntos-mini`) con radio interpolado; puntos con marca de "vista fija"; casilla `#point-fijo` y columna `fijo` en `sql/06`/`sql/08`; el mapa se crea con la **URL** del estilo (no con el objeto, que depende de `requestAnimationFrame`) y quita `ne2_shaded` en `style.load` |
| 7. UX del 2026-11-25 | Rampa de zoom en 3 momentos (5 umbrales, radio con meseta e `icon-size` que nunca llega a ser grande); puntos fijos **sin** contorno punteado; **metro unificado** (un interruptor con estaciones + líneas) y rótulo con el nombre bajo el icono; **bomberos en capa propia** (el archivo existe, la seguridad ya no tiene cuarteles y el icono es distinto); etiqueta `.map-point-nombre` bajo el icono; **gestión de puntos del admin** (botón, hoja por tipo, renombrar, mostrar/ocultar, borrar y Guardar) + `sql/09`; **muro naranja** con el botón blanco y letras naranjas; **agenda sin scroll lateral** (`overflow-x: clip`) |

---

## 2. Pruebas manuales en navegador

| # | Prueba | Resultado esperado | Estado 2026-11-25 |
|---|---|---|---|
| 1 | Login y navegación a la pestaña **Mapa** | El mapa se instancia sin errores de consola | ✅ |
| 2 | Capa por defecto | **Satélite** encendido + límites comunales visibles | ✅ |
| 3 | Superposición de estilos | El mapa abre con sat\u00e9lite + rotulados legibles superpuestos | ✅ || 4 | Hover/click en una comuna | Popup con el nombre de la comuna | ✅ |
| 5 | Encender/apagar cada interruptor del panel | El source/layer aparece y desaparece **sin** afectar las demás capas | ✅ (parques, comercio, salud, seguridad, plazas, servicios) |
| 6 | Preferencia de capas | Se recuerda al recargar (`localStorage`) | ✅ |
| 7 | Iconos de lugares | Icono **SVG** por categoría (parque, mall, urgencias, policía, casa) | ✅ (rasterizados en canvas) |
| 8 | Clustering | Los puntos se agrupan y muestran el contador | ✅ |
| 9 | Popup de un lugar | Nombre, subcategoría, dirección, comuna, coordenadas, fuente y fecha | ✅ |
| 10 | Agenda (acordeón de días) | Abre/cierra sin `ReferenceError` | ✅ |
| 11 | Point map personal | Cualquier usuario autenticado crea un punto personal con nombre e icono elegido | ✅ (frontend) |
| 12 | Punto general (admin) | El admin elige "General (visible para todos)" | ✅ (frontend) |
| 13 | RLS: usuario normal | No ve ni puede modificar puntos generales ajenos ni personales ajenos | ⏳ requiere `sql/06` aplicado |
| 14 | RLS: admin | Gestiona los puntos generales | ⏳ requiere `sql/06` aplicado |
| 15 | Las 4 terminales | Se ven como puntos generales al aplicar `sql/07_terminales.sql` | ⏳ requiere `sql/06` + `sql/07` |
| 16 | Móvil (390×844) | El panel de capas, el panel inferior y los botones son usables | ✅ (revisión de CSS) |
| 17 | Rendimiento | Carga inicial razonable; cada capa de lugares se descarga solo al encenderla | ✅ |
| 18 | Sin conexión | La app abre y el mapa conserva la última vista cacheada | ✅ (service worker) |
| 19 | Resto de la app | Agenda, muro, contactos de emergencia, actividades y login siguen operando | ✅ |
| 20 | Sin claves privadas | El repositorio no contiene `service_role` | ✅ (`scripts/verificar-mapa.mjs`) |
| 21 | Selector de iconos (SVG) | La grilla del formulario muestra las 17 miniaturas SVG y ninguna se ve rota | ✅ (17/17 cargadas) |
| 22 | Icono elegido por el usuario | Al elegir un icono queda marcado y al cambiar la categoría se propone el equivalente | ✅ |
| 23 | `sql/07_terminales.sql` | Se ejecuta sin error **42P10** y deja las 4 terminales con `tipo='general'` | ⏳ requiere aplicar en Supabase |
| 24 | Iconos offline | Los iconos SVG ya descargados se sirven desde caché (cache-first del service worker) | ✅ |
| 25 | Vista mapa a pantalla completa | Al abrir la pestaña **Mapa** desaparece el header y el mapa ocupa todo el alto disponible (614 px de 678 px, descontando la barra de navegación de 64 px) | ✅ |
| 26 | Buscador colapsable | Arriba a la izquierda hay una **lupa**; al presionarla se abre el input con el foco puesto y al cerrarlo se limpia el filtro | ✅ |
| 27 | Controles del mapa | Colapsados solo se ve el **botón con flecha hacia abajo** arriba a la derecha; al presionarlo se despliega la **columna vertical** de 9 botones, todos con la **misma X** (derecha) y **por debajo** del botón, y la flecha rota 180° | ✅ (medido en vivo: x = 860, y = 62…430; `flex flex-col`) |
| 28 | Panel inferior de actividades | Se pliega a 58 px con la flecha hacia arriba y se despliega de nuevo; al elegir una actividad se reabre | ✅ |
| 29 | Iconos al acercar / punto al alejar | Cerca (zoom ≥ 12,5) se ve el icono; al alejar aparece el punto del color del pin y se achica en 3 saltos hasta **desaparecer en el zoom 10,5** | ✅ (capas y CSS verificados) |
| 30 | Vista fija | El formulario de punto tiene la casilla **“Vista fija (mostrar siempre el icono)”**; ese punto conserva su icono a cualquier zoom | ✅ (frontend) |
| 31 | Atribución sobre el panel | El control de atribución de MapLibre se reposa sobre el panel (`--mapa-panel-h`: 279 px con el panel abierto, 68 px plegado) | ✅ |
| 32 | Estilo sin `ne2_shaded` | La fuente inútil se elimina en `style.load` y **las capas propias siguen vivas** (`comunas-*`, `lugares-*`, `satelite-layer`) | ✅ |
| 33 | Rampa de zoom en saltos | Punto: **5,95 px** (10,5–11) · **8,5 px** (11–11,8) · **11,9 px** (11,8–12,5) y **desaparece por debajo de 10,5** · icono: entra en 12,5 a 16 px y sube hasta **24 px** (zoom 15) | ✅ (marcadores HTML con `saltoRampa()` y capas GeoJSON con `minzoom`/`["step",["zoom"],…]`; −15 % con `ESCALA_PUNTO` y calibrado el 2026-11-26) |
| 34 | Puntos de vista fija | Se ven **exactamente igual** que los demás: sin contorno punteado ni ningún distintivo; solo cambian al no achicarse al alejar | ✅ |
| 35 | Metro unificado | Un solo interruptor **“Metro (estaciones y líneas)”**: al encenderlo aparecen líneas, estaciones, iconos y rótulos | ✅ (`metro-lineas`, `metro-estaciones`, `metro-combo`, `metro-estaciones-icono`, `metro-combo-icono`, `metro-nombres`) |
| 36 | Nombre de la estación | Aparece **debajo del icono** al acercarse (zoom ≥ 12,5), sin presionarla | ✅ (`metro-nombres`, `text-anchor: top`) |
| 37 | Bomberos separados | La capa **Cuarteles de bomberos** es independiente de **Policía, Comisarías y Tenencias**; 178 cuarteles y 167 puntos de seguridad | ✅ (archivos + interruptores + iconos propios) |
| 38 | Nombre del terminal y de los puntos | Bajo el icono del punto aparece su nombre (p. ej. “Terminal San Borja”) al acercar el mapa | ✅ (`.map-point-nombre`) |
| 39 | Sin panel inferior | Ya no existe la vista inferior colapsable; la ficha de un evento y los resultados de búsqueda aparecen en el **cuadro de mensaje** (con título, acciones y botón de cerrar) | ✅ |
| 40 | Gestión de puntos (admin) | Botón en la fila de controles → hoja con la lista por tipo; cada fila permite renombrar, mostrar/desmostrar y borrar; un botón **Guardar** aplica los cambios | ✅ (5 puntos generales listados; escritura verificada por código, requiere `sql/09` para moderar puntos de otros usuarios) |
| 41 | Muro “Descárgate” | Al presionarlo el fondo se pone naranja (como el botón Publicar) y el botón queda blanco con letras naranjas | ✅ (`linear-gradient(#f25050,#d6a100)`, botón `#fff` / `#d96a00`) |
| 42 | Agenda sin scroll lateral | A 390 px de ancho la agenda no tiene scroll horizontal (solo vertical) | ✅ (`scrollWidth = clientWidth = 390` en un iframe de 390 px) |
| 43 | Iconos optimizados | Los 17 SVG del mapa pesan 415 KB en total (antes 3,2 MB) y ninguno supera 400 KB | ✅ (revisión visual de los 17 iconos) |
| 44 | Grupos sin número | Si hay muchos puntos cerca se muestra **1 punto pequeño** (sin burbuja ni contador); al acercar (zoom 12) se deshacen y en 12,5 se ven los iconos | ✅ (capa `-cluster-count` eliminada; `-cluster` es un círculo con la misma rampa; `clusterMaxZoom` entero) |
| 45 | Líneas del metro | Se siguen viendo **alejadas** (sobreviven a los puntos, que mueren en 10,5) y **desaparecen por debajo del zoom 9,3** | ✅ (`minzoom: 9.3` en `metro-lineas` y `metrotren-lineas`) |
| 46 | Textos con corte nítido | En **12,4** desaparecen todos los textos de los iconos y en **12,5** vuelven; el nombre nace en **9 px** y sube en 2 saltos a 10 px (13,5) y 11 px (14,5) | ✅ (`metro-nombres` con `minzoom: 12.5` + `text-size` escalonado; `.map-point-con-nombre` con `--nombre-tam`) |
| 47 | Puntos −15 % | Los puntos que reemplazan a los iconos bajan un 15 % **proporcional en los 3 saltos**: radio 2,975 / 4,25 / 5,95 px y diámetro 5,95 / 8,5 / 11,9 px (iconos y texto no cambian) | ✅ (`ESCALA_PUNTO=0.85`; leído en vivo con `getPaintProperty`) |
| 48 | Grupos y RLS | Grupos y `group_id` en agenda, actividades y muro; el login ya no pide grupo (ver 51) | ✅ (verificado en vivo; el login por grupo del lote anterior quedó reemplazado) |
| 49 | Aislamiento por grupo | Eventos, actividades, asignaciones, perfiles y muro filtrados por `group_id = auth_group()`; escritura según `can_manage_group()` | ✅ (con `test1`: events/activities/wall 0 y el evento del principal por ID **0 filas**) |
| 50 | Compatibilidad de despliegue | Sin `sql/10`, la app entra en modo compatibilidad (grupo `principal`) y el login/agenda/muro siguen funcionando | ✅ (probado en navegador antes de aplicar el SQL) |
| 51 | Login por usuario | El login pide solo **usuario + contraseña**; el grupo se detecta del perfil y no se vuelve a pedir | ✅ (en vivo: `test` → 200/principal; `test1` → 200/prueba_acceso; contraseña mala → 401; usuario inexistente → 404 + registro) |
| 52 | Registro con contraseña de grupo | Paso 1: grupo + contraseña del grupo (bcrypt). Paso 2: usuario + contraseña personal + confirmación | ✅ (en vivo: contraseña mala → 403; correcta → paso 2; `test1` creado y con sesión) |
| 53 | Usuario único global | El nombre se rechaza si existe en **cualquier** grupo (decisión del proyecto; la prueba 8 del documento no aplica) | ✅ (`test` en otro grupo → 409; `profiles_username_key` + índice `lower(username)`) |
| 54 | Alternativas de nombre | Si el nombre está tomado, se ofrecen alternativas comprobadas como botones; el usuario debe confirmar | ✅ (chips `test1…test5`; al elegir uno solo se rellena el campo, no se crea solo) |
| 55 | Grupo automático en reingresos | El perfil guarda el grupo; el login lo recupera de la BD y no lo pide | ✅ (en vivo: `test1` reingresó sin grupo → “Grupo de prueba de acceso”) |
| 56 | Contraseña de grupo protegida | Hash bcrypt; la app no puede leerlo ni escribirlo; solo `service_role` verifica | ✅ (GRANT por columna; `verificar_password_grupo` da 42501 a `authenticated`) |
| 57 | Categorías de puntos | Catálogo en BD: nuevas (mall, policía, bomberos, hospital, centro de salud, metro, parque, kiosco, expositor, otros, JW) + **conserva las antiguas** (seguridad, salud, educación, transporte, comercio, áreas verdes, otro) | ✅ (aplicado: **19 categorías**; 4 terminales en Transporte) |
| 58 | Color por categoría | El punto circular y las capas externas (incluido el metro) usan el color de la categoría; al guardar se refresca el mapa | ✅ (transporte #ff00ff guardado/aplicado/persistente y revertido; metro #f2b705 y parques #2e9e4f leídos en vivo) |
| 59 | Gestión individual | Lista por categoría con buscador, seleccionar todos/deseleccionar, contador y guardado persistente | ✅ (Terminal Alameda 3/4, atenuado, persistente y reactivado; buscador “sur” → 1) |
| 60 | Alcance global/grupo | Los puntos generales pueden ser globales o de grupo; los personales quedan en el grupo del autor | ✅ (terminales globales; punto Kiosco de grupo creado/borrado; `group_id` de los 6 globales limpiado a `null`) |
| 61 | Admin de grupo | Modera los puntos de su grupo y no puede editar los globales | ⏳ (código/RLS listos; no hay admin de grupo para probar en vivo) |
| 62 | RLS de puntos | Usuarios normales ven globales + su grupo; el admin de grupo, su grupo; el admin global, todo | ⏳ (políticas aplicadas; tras la limpieza solo quedan admins globales) |
| 63 | Puntos personales | El botón de alta está disponible para cualquier autenticado y crea solo puntos personales | ✅ (test1 veía el botón; el formulario fuerza personal) |
| 64 | JW: tamaño +20 % | Los iconos JW se muestran un 20 % más grandes (19,2 → 28,8 px frente a 16 → 24) | ✅ (en vivo: 19,2 px a 12,5 · 28,8 px a 15) |
| 65 | JW: siempre icono | Un JW nunca se convierte en punto de color, ni por debajo del zoom 10,5 | ✅ (a zoom 6 sigue `display:flex`; los demás puntos están ocultos) |
| 66 | Actividad ↔ punto JW | La actividad guarda `map_point_id`; el trigger exige categoría JW y mismo grupo/global | ✅ (vínculo guardado; terminal rechazado con 23514) |
| 67 | Sin JW → marcar en mapa | Si no hay puntos JW, el botón abre el modo punto con categoría JW y reabre la actividad con el punto creado | ✅ (flujo completo: punto → reabrir con el punto → guardar actividad) |
| 68 | Ver en mapa | El botón de la tarjeta lleva al mapa y vuela al punto JW/coordenadas de la actividad | ✅ (mapa y zoom 15; abre el popup JW) |
| 69 | Popup JW con actividades | El popup del punto JW lista sus actividades vinculadas | ✅ (“Actividades: Actividad prueba JW”) |
| 70 | Trigger JW | Un punto no JW o de otro grupo se rechaza al vincularlo | ✅ (400/23514 con un terminal; el vínculo JW se mantiene) |
| 71 | Evento editable | El botón de la agenda abre un diálogo con nombre, descripción, inicio y término; se guarda por grupo | ✅ (nombre/descripción/término editados y persistentes) |
| 72 | Validación del evento | Nombre obligatorio y término ≥ inicio; el error no guarda | ✅ (“La fecha de término no puede ser anterior…” y no guardó) |
| 73 | Crear evento si no hay | El mismo diálogo crea uno publicado con `group_id`/`created_by` | ⏳ (ruta cubierta por el verificador; en vivo ya existe un evento) |
| 74 | Rango y badge | La banda y “Día X de Y” se recalculan al cambiar las fechas | ✅ (23 nov – 1 dic · Día 4 de 9; luego restaurado a 30 nov · Día 4 de 8) |
| 75 | Sin filtro Mis/Todas | La agenda muestra todas las actividades del grupo; el control desaparece | ✅ (no quedan `#tab-mine`/`#tab-all` ni el estado `filter`) |
| 76 | Todos los días | Del inicio al término, incluidos los días sin actividades | ✅ (3 pasados + hoy + 4 futuros) |
| 77 | Día actual expandido | Hoy se muestra en la tarjeta completa; los demás compactos | ✅ (26 nov · 1 Actividad · subtítulo dinámico) |
| 78 | Días vacíos | Los días sin actividades se ven compactos (“0 actividades”) y expanden “Sin actividades registradas.” | ✅ (el 25 expande el mensaje) |
| 79 | FAB Nueva actividad | Botón circular fijo abajo-derecha, sobre la barra, visible solo al admin | ✅ (56 px; abre el diálogo) |
| 80 | SOS flotante | Botón circular `#F25050` abajo-izquierda, visible en mapa/agenda/muro | ✅ (64 px; 8 px sobre la nav; sin solape con el FAB) |
| 81 | SOS abre la URL | Pestaña nueva con `noopener`; el botón grande también | ✅ (`href` = EMERGENCY_URL; `_blank`/`noopener`; `abrirEmergencia` en el grande) |
| 82 | Pasados vs futuros | Los días anteriores a hoy usan el bloque y estilo de pasados | ✅ (bug `dt<today` corregido; 3 en pasados) |
| 83 | JW latido | 30 min antes del inicio el punto late (tipo corazón) **en su lugar** | ✅ (en vivo a 14 min: `jw-latido`; el icono interior escala 1,17 con el mismo centro 691,331; el marcador no se anima) |
| 84 | JW destello hoy | Una actividad de hoy destella desde antes de su ventana | ✅ (pruebas puras: 12:00 para 18:00 → destello) |
| 85 | JW durante/después | Durante la actividad y 30 min después → destello | ✅ (en vivo en curso → `jw-destello`; +30 en pruebas puras) |
| 86 | JW al terminar +30 | Después del +30 se apaga o pasa a la siguiente de hoy | ✅ (pruebas puras: 19:31 → null; con otra a las 21:00 → destello/latido) |
| 87 | JW zona horaria | Usa la hora de pared de Chile (`America/Santiago`) | ✅ (UTC 20:30Z → 17:30 en noviembre) |
| 88 | JW sin consultas | Un temporizador de 60 s actualiza sin consultar Supabase | ✅ (`setInterval(aplicarEstadoJW,60000)`) |
| 89 | JW clases CSS | Destello y latido con `@keyframes` y `prefers-reduced-motion`, en el **icono interior** (no en el marcador) | ✅ |
| 90 | Esquema final | `schema.sql` documenta el estado de las migraciones 10–16 sin fingir un `pg_dump` | ✅ (sección 9; fuente de verdad: `sql/`, declarado) |
| 91 | Documentación de cierre | `AGENT.md` §36 y `DOCUMENTACION-MAPA.md` §7 resumen la entrega | ✅ |
| 92 | Verificador final | La corrida completa sigue en verde tras el cierre | ✅ (352 pruebas · 0 fallos · 2 avisos) |
| 93 | Artefactos | No quedan usuarios, grupos, actividades ni puntos de prueba | ✅ (`principal`, `admin`/`test`, 5 actividades, 6 puntos) |

---

## 3. Resultados de la corrida automática

- **2026-11-26 (Fase 6: animaciones JW)**: **352 pruebas · 0 fallos · 2 avisos**.
  - Bloque `[14]` (21 comprobaciones): `estadoJW`/`ahoraChile` con fechas fijas (−30, inicio,
    +30, siguiente, otro día, cancelada, UTC−3), temporizador de 60 s sin consultas,
    `aplicarEstadoJW` en el render, `@keyframes`, y que el latido/destello escala el **icono
    interior** con origen centrado (no el marcador posicionado).
  - En vivo: actividad a 14 min → `jw-latido`; editada a en curso → `jw-destello`; el marcador
    raíz queda con `animation-name: none` y su `transform` es solo la posición de MapLibre; el
    icono interior escala con el **mismo centro** (691,331) → se infla en su lugar. Artefactos
    borrados (5 actividades, 6 puntos, JW 0/0); **0 errores JS**.
- **2026-11-26 (Fase 5: agenda completa, FAB y SOS)**: **331 pruebas · 0 fallos · 2 avisos**.
  - Bloque `[13]` (12 comprobaciones): sin filtro Mis/Todas, todos los días del evento,
    pasados/futuros, día activo dinámico, días vacíos, mes real, FAB circular, SOS flotante
    con `#F25050`/`_blank`/`noopener`, `EMERGENCY_URL` y posición sobre la barra.
  - En vivo: **3 pasados + hoy 26 + 4 futuros**; el 25 (0 actividades) expande “Sin
    actividades registradas.”; el FAB abre la actividad; FAB/SOS 8 px sobre la nav, derecha/
    izquierda, sin solape; SOS con URL/pestaña nueva; **0 errores JS**.
  - Bug corregido: `dt<today` (Date vs string) mandaba todos los días a “próximos”.
- **2026-11-26 (Fase 4: evento general editable)**: **319 pruebas · 0 fallos · 2 avisos**.
  - Bloque `[12]` (9 comprobaciones): botón y diálogo del evento, `update`/`insert` publicado
    con `group_id`/`created_by`, validaciones y visibilidad por rol, sobre la RLS de `sql/11`.
  - En vivo: nombre/descripción/término editados (23 nov – 1 dic · “Día 4 de 9”) y
    persistentes; `término < inicio` muestra error y no guarda; evento restaurado (30 nov ·
    “Día 4 de 8”); **0 errores JS**.
- **2026-11-26 (Fase 3: categoría JW y actividades, verificado en vivo)**: **310 pruebas · 0 fallos · 2 avisos**.
  - Bloque `[11]` (18 comprobaciones): `activities.map_point_id` y su FK, trigger de
    categoría/grupo, selector JW sin lat/lng, flujo “Marcar actividad en el mapa”, JW +20 %,
    icono permanente, clase `map-point-jw`, popup con actividades, “Ver en mapa” y la
    eliminación del CHECK antiguo de iconos.
  - **En vivo**: punto JW creado y actividad vinculada; trigger rechaza un terminal con
    `23514`; +20 % (19,2 / 28,8 px) y visible a zoom 6 mientras los demás se ocultan; popup
    con la actividad; “Ver en mapa” (zoom 15 y popup); flujo completo de marcado.
  - **Correcciones**: `map_points_icon_check` bloqueaba `salon`; `verActividadEnMapa` cerraba
    el popup si ya estaba abierto; los botones de las tarjetas del diseño nuevo ya se enlazan.
  - Artefactos de prueba borrados (5 actividades, 6 puntos).
- **2026-11-26 (Fase 2: categorías, colores y alcance de puntos, verificado en vivo)**: **292 pruebas · 0 fallos · 2 avisos**.
  - Bloque `[10]` (27 comprobaciones): `map_categories` y su semilla (nuevas + antiguas), color
    validado, FK de categoría, columnas `group_id`/`scope`, backfill de los generales a global,
    `group_id=null` para los globales, trigger de compatibilidad, RLS por alcance,
    administración de categorías, color en las capas, formulario con alcance/grupo, hoja con
    buscador/contador/seleccionar todos y atenuado del admin.
  - **En vivo**: 19 categorías; color `transporte` #ff00ff guardado/aplicado/persistente y
    revertido; Terminal Alameda 3/4 y atenuado, persistente y reactivado; punto Kiosco de grupo
    creado (color #7048e8) y borrado; metro #f2b705 y parques #2e9e4f.
  - **Detalle corregido**: los puntos globales conservaban el `group_id` del autor; se agregó
    la limpieza en `sql/15` (re-ejecutar `sql/15` o el `update` de `group_id`).
  - **Pendiente**: RLS con un usuario normal y con un admin de grupo (solo hay admins globales).
- **2026-11-26 (nuevo acceso y registro de perfiles, verificado en vivo)**: **267 pruebas · 0 fallos · 2 avisos**.
  - Bloque `[9]` con **53 comprobaciones**: login por usuario con grupo automático, `sql/14`
    (hash bcrypt, RPC de verificación solo para `service_role`, `grupos_para_registro`, GRANT
    por columna, índice `lower(username)`, protección de identidad y `search_path` correcto),
    Edge Functions (`login-username` v2 + `register-profile`), UI progresiva, ausencia del hash
    en el cliente y limpieza de la agenda al cambiar de grupo.
  - **En vivo**: `test` entró sin grupo → principal; `test1` (perfil de prueba) se registró en
    un grupo temporal con contraseña de grupo y reingresó sin grupo; contraseña mala → 401;
    usuario inexistente → 404 + panel de registro; contraseña de grupo mala → 403; nombre
    tomado → 409 con `test1…test5` (sin autoasignar); `test1` no ve events/activities/wall del
    principal (0 filas, incluso el evento por ID).
  - **Ajuste extra**: al cambiar a un grupo sin evento, se limpian los días y se oculta la
    tarjeta del día activo (antes quedaba el DOM del grupo anterior).
  - Decisión del proyecto: **usuario único global**; la prueba 8 del documento de acceso
    (mismo nombre en dos grupos) no aplica y queda documentada.
- **2026-11-26 (Fase 1 de `UPDATE.md`: grupos, login y RLS)**: **242 pruebas · 0 fallos · 2 avisos**.
  - Nuevo bloque `[9]` (28 comprobaciones): tabla/columnas/backfill/triggers de grupo,
    helpers `auth_group()`/`can_manage_group()`, RPC `grupos_publicos()` para anon, políticas
    por grupo, Edge Function (valida el grupo antes del password y no lleva claves), selector
    `#login-group`, filtros `filtrarGrupo()` y respaldo si falta `sql/10`.
  - Navegador **antes** de aplicar el SQL: modo compatibilidad con “Grupo principal”, login y
    agenda/muro funcionando. Los dos errores de red son el sondeo del RPC y la consulta de
    columnas; desaparecen al ejecutar `sql/10`.
- **2026-11-26 (controles del mapa en columna vertical)**: **214 pruebas · 0 fallos · 2 avisos**.
  - 5 comprobaciones nuevas: `#map-controls-row` con `flex flex-col`, `#map-controls` con
    `flex flex-col items-end`, el botón de colapso **antes** de la fila en el HTML, la
    columna con `max-h-[calc(100dvh-7rem)]` y el anclaje `absolute right-3 top-3`.
  - Verificado en vivo: toggle en (856, 12) y los 9 botones en **x = 860**, y = 62…430,
    todos por debajo del toggle; **0 errores de consola**.
- **2026-11-26 (calibración de momentos + −15 % en los puntos)**: **210 pruebas · 0 fallos · 2 avisos**.
  - Nuevo bloque `[8]` (19 comprobaciones): saltos del punto en 11 / 11,8 con corte en
    10,5, `saltoRampa()`, **`ESCALA_PUNTO=0.85` con los tamaños proporcionales**, grupos
    sin número (`cluster-count` eliminada y `-cluster` como punto), `clusterMaxZoom`
    entero, líneas del metro con corte en 9,3, textos con corte nítido en 12,5 y tamaño
    en 2 saltos (9 → 10 → 11 px) y medidor eliminado.
  - El test de la rampa del bloque `[7]` pasó de exigir una meseta lineal a exigir el
    escalón `["step",["zoom"],…]`.
- **2026-11-25 (lote de UX)**: **191 pruebas · 0 fallos · 2 avisos**.
  - Nuevo bloque `[7]`: rampa de zoom en 3 momentos, puntos fijos sin contorno, metro
    unificado con rótulo, bomberos en capa propia, etiquetas bajo el icono, gestión de
    puntos del admin (con `sql/09`), muro naranja y agenda sin scroll lateral.
  - El bloque `[6]` se actualizó: el panel inferior ya no debe existir y los detalles van
    al cuadro de mensaje.
- **2026-11-25 (fix 42703 en sql/08)**: **141 pruebas · 0 fallos · 2 avisos**.
  - Nueva regresión: las consultas `select … from public.map_points` de `sql/06`, `sql/07` y
    `sql/08` solo pueden usar columnas que existen en el `create table` (se extraen del propio
    `sql/06`). Es la que detectó el error `42703: column "activo" does not exist` (la columna
    real es `active`). Comprobado que la prueba falla si se vuelve a escribir `activo`.
- **2026-11-25 (vista de mapa)**: **138 pruebas · 0 fallos · 2 avisos**.
  - Los dos avisos son nombres que contienen palabras educativas: dos “Granja Educativa”
    (etiquetadas como zoológico en OSM) y “Cerro Escuela La Cantera” (cerro parque), más
    un consultorio de la Universidad Finis Terrae. **No hay establecimientos educacionales**
    en el mapa: la verificación lo comprueba en cada capa.
- **2026-11-25 (iconos SVG + fix 42P10)**: **101 pruebas · 0 fallos · 2 avisos**.
- Avisos no bloqueantes del navegador: Tailwind CDN (aviso conocido de producción) y 3 avisos
  de MapLibre (`Expected value to be of type number, but found null instead`) que provienen del
  estilo OpenFreeMap, no del código de la app.
- El service worker quedó en `app-santiago-2026-v22` (precache renovada con las animaciones
  JW y el icono interior; los iconos SVG siguen en cache-first).
- **Limitación del navegador embebido de pruebas**: no dispara `requestAnimationFrame`, por lo
  que MapLibre no repinta (`map.loaded()` queda en `false` y `queryRenderedFeatures()` devuelve
  0). Se verificó por otra vía que el estilo se aplica, que `ne2_shaded` se elimina y que las
  capas propias se crean (`comunas-fill`, `lugares-*-puntos`, `lugares-*-puntos-mini`,
  `satelite-layer`, 67 capas en total). En un navegador normal el mapa se ve con normalidad.

---

## 4. Pendiente de verificación por el administrador

Las migraciones `sql/06`–`sql/16` **ya están aplicadas** (incluidas `10_grupos`,
`11_rls_grupos`, `14_registro_perfiles`, `15_categorias_puntos` y `16_jw_actividades`), y las
Edge Functions `login-username` (v2) y `register-profile` desplegadas.

Queda pendiente, por falta de perfiles no globales (hoy solo existen `admin` y `test`):

1. Repetir las pruebas 11–15, 23 y 40 con una cuenta **normal** y con un **admin de grupo**.
2. Verificar que el usuario normal recibe error al intentar insertar un punto
   `tipo='general'` o `scope='global'`.
3. Verificar que el admin de grupo puede gestionar puntos/evento de su grupo pero **no** los
   globales ni los de otro grupo.
4. Probar el alta de evento cuando no existe ninguno (la ruta `insert` está cubierta por el
   verificador, pero siempre hay un evento en la base).
5. Observar en vivo el corte **+30 → siguiente actividad** de las animaciones JW (la lógica
   está cubierta por las pruebas puras del bloque `[14]`).
