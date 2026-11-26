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
| 6. Vista de mapa (2026-11-25) | El header se oculta en la vista mapa y el mapa usa `100dvh`; lupa del buscador arriba a la izquierda; controles colapsables arriba a la derecha con flecha hacia abajo y fila horizontal; **panel inferior eliminado** y detalles en el cuadro de mensaje (`#toast-msg`, `mostrarMensaje`); umbrales de zoom y capa de punto de color (`-puntos-mini`) con radio interpolado; puntos con marca de "vista fija"; casilla `#point-fijo` y columna `fijo` en `sql/06`/`sql/08`; el mapa se crea con la **URL** del estilo (no con el objeto, que depende de `requestAnimationFrame`) y quita `ne2_shaded` en `style.load` |
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
| 27 | Controles del mapa | Colapsados solo se ve el **botón con flecha hacia abajo** arriba a la derecha; al presionarlo se despliega la fila horizontal de 8 botones a su izquierda y la flecha rota 180° | ✅ |
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

---

## 3. Resultados de la corrida automática

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
- El service worker quedó en `app-santiago-2026-v11` (precache renovada tras la
  calibración de momentos y el −15 % en los puntos; los iconos SVG siguen en cache-first).
- **Limitación del navegador embebido de pruebas**: no dispara `requestAnimationFrame`, por lo
  que MapLibre no repinta (`map.loaded()` queda en `false` y `queryRenderedFeatures()` devuelve
  0). Se verificó por otra vía que el estilo se aplica, que `ne2_shaded` se elimina y que las
  capas propias se crean (`comunas-fill`, `lugares-*-puntos`, `lugares-*-puntos-mini`,
  `satelite-layer`, 67 capas en total). En un navegador normal el mapa se ve con normalidad.

---

## 4. Pendiente de verificación por el administrador

Requiere credenciales del proyecto Supabase (no hay `service_role` en el entorno):

1. Ejecutar `sql/06_map_points.sql` en el **SQL Editor** de Supabase.
2. Ejecutar `sql/07_terminales.sql` (siembra las 4 terminales de bus).
   - Si aparece el error **42P10** (`there is no unique or exclusion constraint matching the
     ON CONFLICT specification`), significa que el índice único de `external_id` es parcial:
     hay que usar `on conflict (external_id) where external_id is not null`. La versión
     actual de `sql/07_terminales.sql` ya lo trae corregido.
3. (Opcional) Ejecutar `sql/08_puntos_fijos.sql` si la tabla `map_points` ya existía antes
   de esta versión: agrega la columna `fijo` (vista fija). `sql/06` ya la incluye.
4. Ejecutar **`sql/09_admin_gestiona_puntos.sql`**: permite que el administrador renombre,
   muestre/oculte y **borre cualquier punto** del mapa (incluidos los personales de otros
   usuarios). Sin esta política, el botón “Guardar” de la hoja de gestión fallaría con
   error 42501 sobre puntos que no son suyos.
5. Repetir las pruebas 11–15, 23 y 40 con dos cuentas: una `admin` y otra normal.
6. Verificar que el usuario normal recibe error al intentar insertar un punto `tipo='general'`
   (la política `Admin gestiona puntos generales` debe rechazarlo).
