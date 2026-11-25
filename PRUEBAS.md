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

---

## 3. Resultados de la corrida automática

- **2026-11-25**: **101 pruebas · 0 fallos · 2 avisos**.
  - Los dos avisos son nombres que contienen palabras educativas: dos “Granja Educativa”
    (etiquetadas como zoológico en OSM) y “Cerro Escuela La Cantera” (cerro parque), más
    un consultorio de la Universidad Finis Terrae. **No hay establecimientos educacionales**
    en el mapa: la verificación lo comprueba en cada capa.
- Avisos no bloqueantes del navegador: Tailwind CDN (aviso conocido de producción) y 3 avisos
  de MapLibre (`Expected value to be of type number, but found null instead`) que provienen del
  estilo OpenFreeMap, no del código de la app.

---

## 4. Pendiente de verificación por el administrador

Requiere credenciales del proyecto Supabase (no hay `service_role` en el entorno):

1. Ejecutar `sql/06_map_points.sql` en el **SQL Editor** de Supabase.
2. Ejecutar `sql/07_terminales.sql` (siembra las 4 terminales de bus).
   - Si aparece el error **42P10** (`there is no unique or exclusion constraint matching the
     ON CONFLICT specification`), significa que el índice único de `external_id` es parcial:
     hay que usar `on conflict (external_id) where external_id is not null`. La versión
     actual de `sql/07_terminales.sql` ya lo trae corregido.
3. Repetir las pruebas 11–15 y 23 con dos cuentas: una `admin` y otra normal.
4. Verificar que el usuario normal recibe error al intentar insertar un punto `tipo='general'`
   (la política `Admin gestiona puntos generales` debe rechazarlo).
