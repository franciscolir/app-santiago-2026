# AGENT.md — APP SANTIAGO 2026

> Documento de continuidad para agentes de programación. Léelo completo antes de modificar el repositorio.
> Última actualización: 2026-11-26.
>
> **Estado:** integración con Supabase **resuelta** (§13). Los dos fallos de la §8 están cerrados.
> **`schema.sql`:** regenerado desde la BD real el 2026-11-23 con **todas** las queries de §15 (§13.3). Único hueco sin contraparte real: Storage (H = 0 filas → no existen políticas de adjuntos).

## 1. Objetivo del proyecto

**APP SANTIAGO 2026** es una aplicación web móvil (PWA) para coordinar actividades de un evento. El frontend está desarrollado con JavaScript Vanilla, HTML y CSS; el backend utiliza Supabase; el despliegue del frontend se realiza mediante GitHub Pages.

El objetivo inmediato es estabilizar la autenticación, la lectura de actividades y la creación/administración de actividades. No asumir que una funcionalidad está terminada solo porque existe una pantalla o una tabla.

## 2. Tecnologías y arquitectura

- Frontend: HTML, CSS y JavaScript Vanilla (módulos ES).
- Backend: Supabase (PostgreSQL, Auth, RLS, Storage y Edge Functions).
- Despliegue: GitHub Pages.
- PWA: `manifest.webmanifest`.
- Mapa: **MapLibre GL** (v4.7.1, estilo OpenFreeMap `positron`, CDN unpkg) — migrado desde Leaflet el 2026-11-23; vista satélite con capa raster Esri World Imagery y GPS continuo con `watchPosition`.
- Inicio de sesión: nombre de usuario + contraseña. Supabase Auth autentica con email/contraseña; una Edge Function resuelve el nombre de usuario al email asociado.
- No introducir frameworks o herramientas nuevas sin una razón clara y sin consultar primero.
- No incorporar credenciales secretas al repositorio ni al frontend.

## 3. Funcionalidades requeridas

### Navegación principal
La aplicación es mobile-first y contempla cuatro secciones mediante navegación inferior:

1. **Agenda**: vista cronológica vertical con todos los días del evento. El administrador configura fecha inicial y final del evento. El día actual debe abrirse automáticamente; el usuario puede expandir otros días.
2. **Mapa**: mostrar las actividades del evento con marcadores y tarjetas de detalle; permitir abrir navegación externa.
3. **Emergencia**: integrar o mostrar el sitio externo `https://auxilio-rm-go.base44.app/`. Intentar iframe solo si el sitio lo permite; si bloquea la incrustación, ofrecer apertura externa o alternativa. No asumir que el iframe funciona.
4. **Muro**: muro compartido con categorías **Positivo** y **Descárgate**. Todos los usuarios autenticados pueden leer y publicar.

### Eventos y actividades
- El administrador crea, edita y elimina eventos y actividades.
- El evento tiene nombre, descripción, fecha inicial, fecha final y estado.
- Las actividades pertenecen a un evento y tienen título, descripción, fecha, hora inicial/final, lugar y estado.
- El administrador puede asignar actividades a usuarios.
- Todos los usuarios autorizados pueden ver la agenda compartida.
- Cada usuario asignado puede actualizar el estado de su asignación: pendiente, en curso o completada.
- Una misma actividad puede incluir instrucciones o datos particulares para cada usuario asignado.
- Los archivos adjuntos de actividades solo pueden ser cargados, modificados o eliminados por administradores. Los usuarios pueden verlos/descargarlos si tienen acceso.
- Las actividades deben aparecer en Agenda y Mapa.

### Usuarios y roles
- Roles: `admin` y `user`.
- El administrador gestiona usuarios y sus roles/estado.
- Los perfiles contienen nombre de usuario, nombre completo, rol y estado activo.
- Un usuario inactivo no debe poder entrar a la aplicación.

## 4. Paleta visual

Usar estos colores como base del diseño:

- Azul claro: `#4BB2F2`
- Azul oscuro: `#024059`
- Celeste pálido: `#CEE8F2`
- Amarillo: `#F2B705`
- Rojo: `#F25050`

Mantener diseño claro, legible y táctil en teléfonos. Evitar controles pequeños y formularios excesivamente densos.

## 5. Proyecto Supabase: datos conocidos

Proyecto Supabase:
- URL: `https://kwdpxukyknloyqqchshy.supabase.co`
- El frontend utiliza una clave pública `sb_publishable_...`. Esa clave puede estar en la configuración pública del frontend; nunca incluir una clave secreta o `service_role` en el frontend ni en Git.

Tablas creadas inicialmente:

### `profiles`
- `id` referencia a `auth.users.id`.
- `username` único.
- `full_name`.
- `role` (`admin` o `user`).
- `active`.

### `events`
- `id`.
- `name`, `description`.
- `start_date`, `end_date`.
- `status` (`draft`, `published`, `finished`).
- `created_by`.
- Restricción: fecha final no anterior a fecha inicial.

### `activities`
- `id`, `event_id`.
- `title`, `description`.
- `activity_date`, `start_time`, `end_time`.
- `place`.
- **`status`** — `text NOT NULL DEFAULT 'pending'`, con `CHECK (status in ('pending','in_progress','completed','cancelled'))`. **`cancelled` está permitido** (query B, 2026-11-23). `schema.sql` ya lo define.
- `latitude` / `longitude` tipo `numeric` con `CHECK` −90..90 y −180..180.
- `created_by` **`NOT NULL` sin default** — el frontend siempre lo envía; FK a `profiles(id)` **sin** `ON DELETE`.
- **No existe `CHECK` de horario** (`end_time > start_time`) en BD: esa validación vive solo en el frontend (query B, 2026-11-23).

### `activity_assignments`
- Relaciona `activity_id` y `user_id`.
- Estado de la asignación: `pending`, `in_progress`, `completed`.
- Restricción única por actividad/usuario.

### `activity_user_details`
- Relaciona actividad y usuario.
- Contiene instrucciones y datos particulares (`additional_data` JSONB).

### `activity_attachments`
- Relaciona actividad con metadatos del archivo y su ruta de Storage.

### `wall_posts`
- `user_id`, categoría (`positive` o `vent`), contenido (máximo 500 caracteres), fecha.

### `emergency_contacts`
- Contactos generales o personales, con validación para distinguir ambos tipos.

### Funciones y políticas
- Existe una función `is_admin()` con `SECURITY DEFINER`.
- RLS está habilitado en las tablas.
- Las políticas iniciales contemplan acceso a eventos publicados, actividades de eventos publicados, asignaciones, detalles personales, adjuntos, muro y contactos de emergencia.
- Se restringieron algunos permisos de actualización por columna en `activity_assignments` y `profiles`.
- Storage: bucket privado `activity-attachments`, inicialmente con límite de 10 MB. La carga, modificación y eliminación deben estar reservadas al administrador.

**Importante:** no deshabilitar RLS para “solucionar” errores. Diagnosticar permisos SQL (`GRANT`) y políticas RLS por separado. Un `GRANT` concede privilegios a nivel de tabla; RLS sigue filtrando las filas.

## 6. Autenticación por nombre de usuario

La función Edge `login-username` permite iniciar sesión con `username` y `password`:

1. Recibe POST con `username` y `password`.
2. Busca el perfil activo en `public.profiles`, normalizando el username a minúsculas.
3. Obtiene el usuario de Supabase Auth por `profiles.id`.
4. Recupera el email de Auth.
5. Ejecuta `signInWithPassword({ email, password })` con un cliente público.
6. Devuelve la sesión y un objeto de usuario con id y username.

El frontend invoca la función y establece la sesión con `supabase.auth.setSession()`.

### Variables de entorno actuales de `login-username`

Por una restricción del panel de Supabase, los secretos personalizados no pueden comenzar con `SUPABASE_`. Se acordó utilizar estos nombres personalizados:

- `APP_SUPABASE_URL`
- `APP_SUPABASE_SERVICE_ROLE_KEY`
- `APP_SUPABASE_PUBLISHABLE_KEY`

La función debe leerlas así:

```ts
const url = Deno.env.get("APP_SUPABASE_URL");
const serviceKey = Deno.env.get("APP_SUPABASE_SERVICE_ROLE_KEY");
const publishableKey = Deno.env.get("APP_SUPABASE_PUBLISHABLE_KEY");
```

El cliente administrativo debe usar `serviceKey`; el cliente de autenticación debe usar `publishableKey`. Validar que las tres variables existan antes de usarlas. No imprimir ni devolver valores secretos. Se pueden registrar booleanos de presencia durante diagnóstico, nunca el contenido de las claves.

La función está desplegada en Supabase con **Verify JWT desactivado** porque se invoca antes de que exista una sesión del usuario. Mantener CORS limitado al origen real de GitHub Pages antes de producción; la versión inicial utilizaba `*`. Considerar protección contra intentos repetidos de contraseña/rate limiting antes de producción.

### Diagnóstico anterior de autenticación
Se observaron estos errores en distintos intentos:

- `permission denied for table profiles` desde la Edge Function al consultar el perfil.
- `No API key found in request` en una llamada a Supabase.
- `403 Forbidden` en la consulta REST del frontend a `profiles`.

Se concedieron permisos SQL adicionales:
```sql
GRANT SELECT ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.profiles TO authenticated;
```

Después el usuario informó: **“ahora sí”**, indicando que pudo iniciar sesión. La autenticación funciona (verificado el 2026-11-23 con login real, §13.4).

> ✅ 2026-11-23: además se aplicaron los `GRANT` que faltaban para **todas** las tablas
> (no solo `profiles`) — esa era la causa real de que la agenda no cargara. Ver `sql/02_grants.sql` y §13.

No volver a pedir que se creen secretos con prefijo `SUPABASE_`. No pedir al usuario que comparta claves. No cambiar contraseñas ni recrear al administrador como primer recurso.

## 7. Estado del administrador y evento de prueba

Existe un perfil administrador con:
- `username`: `admin`
- `role`: `admin`
- `active`: `true`

No divulgar ni repetir datos personales o credenciales innecesariamente.

Se creó un evento de prueba publicado:

- Nombre: `Evento de prueba APP SANTIAGO 2026`
- ID: `28b3fe1d-93d9-480c-a568-31686509c665`
- Inicio: `2026-11-23`
- Término: `2026-11-30`
- Estado: `published`

Se insertaron cinco actividades ficticias para probar agenda y mapa:

| Fecha | Actividad | Horario | Lugar |
|---|---|---|---|
| 2026-11-23 | Reunión de coordinación | 10:00–11:30 | Plaza de la Constitución, Santiago |
| 2026-11-24 | Inspección técnica | 09:00–11:00 | Parque O’Higgins, Santiago |
| 2026-11-26 | Jornada de trabajo | 14:00–16:00 | Centro Cultural La Moneda, Santiago |
| 2026-11-28 | Actividad recreativa | 11:00–13:00 | Parque Forestal, Santiago |
| 2026-11-30 | Cierre y evaluación semanal | 16:00–17:00 | Museo Nacional de Bellas Artes, Santiago |

Las actividades se insertaron directamente en SQL, con estado `pending` y `created_by` administrador. No se crearon asignaciones para otros usuarios. La consulta de inserción no incluyó coordenadas geográficas. Confirmar si el mapa geocodifica por lugar o requiere latitud/longitud.

## 8. Problemas actuales prioritarios

> ✅ **RESUELTO el 2026-11-23** — la causa era la falta de `GRANT` para `authenticated` (detallado en §13).
> El contenido siguiente queda como registro histórico del diagnóstico.

El usuario informó:

> “actividades existen pero no cargan en front. tampoco se pueden agendar nuevas.”

Esto significa que:
1. Los registros están en Supabase, pero no aparecen en el frontend.
2. La creación de actividades desde el formulario no funciona.

La respuesta anterior sugirió conceder:
```sql
GRANT SELECT ON TABLE public.events TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.activities
TO authenticated;
```
No hay confirmación todavía de que estos `GRANT` se hayan ejecutado ni de que hayan solucionado el problema. No asumir que el problema está resuelto.

### Diagnóstico recomendado, en este orden

1. **Inspeccionar el repositorio y el código real** antes de proponer cambios.
2. Revisar `src/supabase.js`, `src/main.js`, `src/config.js`, `index.html` y `README.md`.
3. Identificar la consulta exacta de agenda:
   - ¿Consulta `events`?
   - ¿Filtra por `status = 'published'`?
   - ¿Filtra actividades por `event_id`?
   - ¿Filtra por fecha de hoy/semana?
   - ¿Usa una columna o relación equivocada?
   - ¿Maneja y muestra `error` de Supabase o lo oculta?
4. Inspeccionar columnas reales de `events` y `activities` en Supabase. No adivinar nombres.
5. Comparar nombres de columnas reales con los usados por el frontend, especialmente `lat`/`long` frente a `latitude`/`longitude`.
6. Revisar `GRANT` y RLS de `events` y `activities`:
   - `authenticated` necesita privilegios SQL adecuados.
   - Las políticas RLS deben permitir que el usuario lea los eventos publicados y sus actividades.
   - Solo el administrador debe insertar, editar y eliminar actividades.
7. Revisar el formulario de creación:
   - `event_id` debe ser el UUID del evento publicado/activo.
   - `created_by` debe ser el ID del usuario autenticado.
   - Los campos de fecha y hora deben coincidir con tipos y nombres reales.
   - Comprobar si el código usa `insert`, `select`, `single` o `maybeSingle` de manera correcta.
   - Comprobar que el formulario captura y muestra el error real de Supabase.
8. Verificar que la aplicación no esté consultando un evento diferente o un ID fijo incorrecto.
9. Corregir el frontend y/o las políticas con cambios pequeños y verificables.
10. Probar lectura de las cinco actividades y creación de una nueva desde la interfaz, autenticado como administrador.

### Consultas útiles de diagnóstico SQL

Comprobar evento:
```sql
SELECT id, name, start_date, end_date, status
FROM public.events
WHERE id = '28b3fe1d-93d9-480c-a568-31686509c665';
```

Comprobar actividades:
```sql
SELECT id, event_id, title, activity_date, start_time, end_time, place, status, created_by
FROM public.activities
WHERE event_id = '28b3fe1d-93d9-480c-a568-31686509c665'
ORDER BY activity_date, start_time;
```

Comprobar privilegios:
```sql
SELECT
  grantee,
  table_schema,
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('profiles', 'events', 'activities')
ORDER BY table_name, grantee, privilege_type;
```

Consultar políticas:
```sql
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'events', 'activities')
ORDER BY tablename, policyname;
```

No ejecutar cambios de permisos indiscriminadamente. Revisar primero las políticas y el código.

## 9. Frontend inicial y archivos conocidos

El frontend inicial entregado contenía:

- `index.html`
- `styles.css`
- `src/config.js`
- `src/supabase.js`
- `src/main.js`
- `manifest.webmanifest`
- `README.md`

La configuración inicial incluía la URL del proyecto, una clave pública `sb_publishable_...` y la URL externa de emergencia. Mantener la clave pública en el frontend solo si corresponde al proyecto; nunca usar la clave secreta de administración.

La función de login del frontend tenía una lógica equivalente a:

```js
const { data, error } = await supabase.functions.invoke(
  "login-username",
  { body: { username, password } }
);

if (error || !data?.session) {
  throw new Error(data?.error || "No fue posible iniciar sesión.");
}

const { error: setError } = await supabase.auth.setSession({
  access_token: data.session.access_token,
  refresh_token: data.session.refresh_token
});

if (setError) throw setError;
```

El archivo inicial puede no reflejar las últimas modificaciones del usuario. Siempre inspeccionar el estado actual del repositorio antes de sustituir archivos.

## 10. Reglas de trabajo para el agente

- Responder al usuario en español.
- El usuario prefiere instrucciones claras, simples y paso a paso.
- El usuario ejecuta comandos y SQL y devuelve resultados; no asumir que ya ejecutó algo si no lo confirmó.
- Antes de cambiar código, inspeccionar archivos y estructura actual del repositorio.
- No inventar rutas, nombres de columnas, funciones, tablas, variables ni políticas.
- No reemplazar archivos completos si basta un cambio pequeño.
- Explicar qué archivo editar, qué bloque buscar y qué reemplazar.
- Si se dispone del repositorio o archivos, hacer cambios reales y ejecutar pruebas cuando sea posible.
- Mostrar errores reales; evitar `catch` silenciosos.
- No ocultar fallos de Supabase detrás de mensajes genéricos durante desarrollo.
- Mantener seguridad: RLS activa, privilegios mínimos, validación de entradas, autorización en backend y nunca confiar solo en ocultar botones del frontend.
- No poner claves `service_role`, `sb_secret_...`, contraseñas ni tokens en GitHub, frontend, capturas o logs.
- No exponer el correo del administrador ni datos personales innecesariamente.
- No eliminar ni recrear el evento o las cinco actividades de prueba sin autorización.
- Las actividades de prueba deben identificarse como ficticias y no confundirse con actividades reales.
- No realizar despliegues o cambios destructivos sin explicar impacto y obtener confirmación cuando corresponda.

## 11. Orden de prioridades inmediato

> ✅ = hecho el 2026-11-23 (ver §13.4)

1. ✅ Conseguir que la Agenda lea y muestre las cinco actividades del evento de prueba.
2. ✅ Conseguir que el administrador cree una actividad desde la interfaz.
3. ✅ Conseguir que editar y eliminar actividades funcione correctamente.
4. ⬜ Verificar asignaciones y cambio de estado por usuario (lectura/escritura probada; falta probar con un usuario **asignado**).
5. ⬜ Alinear mapa con campos geográficos reales y mostrar marcadores (columnas correctas; **faltan coordenadas en los datos de prueba**).
6. ⬜ Completar administración de eventos y usuarios.
7. ⬜ Completar adjuntos con permisos seguros.
8. ✅ Probar muro, contactos de emergencia. ⬜ PWA (falta iconos en el manifest).
9. ⬜ Endurecer CORS, rate limiting, validaciones y políticas antes de uso real.

## 12. Primer paso obligatorio para el próximo agente

**No empezar creando más SQL ni modificando permisos a ciegas.** Primero solicitar o inspeccionar el repositorio actual y leer, como mínimo:

- `src/main.js`
- `src/supabase.js`
- `src/config.js`
- `index.html`
- `README.md`

Después reproducir y diagnosticar los dos fallos actuales (carga de actividades y creación de actividades), identificando la consulta exacta y el error real que devuelve Supabase.

---

## 13. Resuelto el 2026-11-23: integración con Supabase

### 13.1 Causa raíz de "las actividades no cargan"

**Faltaban los `GRANT` para el rol `authenticated`.** Evidencia: `information_schema.role_table_grants` mostraba que `authenticated` solo tenía `REFERENCES/TRIGGER/TRUNCATE` en todas las tablas (defaults de Supabase) y `SELECT` únicamente en `profiles`. El error real devuelto era:

```
42501: permission denied for table events
HINT: GRANT SELECT ON public.events TO authenticated;
```

Los `GRANT` de `schema.sql` **nunca se aplicaron** (ese archivo va en una sola transacción `begin;…commit;`, así que o se aplicó completo o nada).

**Arreglo aplicado:** ver `sql/02_grants.sql`. Idempotente, no toca datos, no deshabilita RLS.

### 13.2 Cómo diagnosticar (lección aprendida)

Un `SET LOCAL ROLE authenticated` dentro del mismo lote que las consultas de diagnóstico **aborta todo el script y hace rollback** de lo anterior. Por eso los scripts están separados en tres archivos independientes:

| Archivo | Función |
|---|---|
| `sql/01_diagnostico.sql` | Solo lectura: privilegios, RLS, columnas de `activities`, políticas |
| `sql/02_grants.sql` | Aplica los GRANT que faltan + verificación |
| `sql/03_verificacion.sql` | Prueba con `SET LOCAL ROLE authenticated` (la real) |

También: probar la API **sin sesión** usa el rol `anon`, que **no debe** tener permisos de negocio. Un `42501` en `anon` **no prueba nada** sobre lo que ve la app autenticada. Siempre diagnosticar como `authenticated`.

### 13.3 Esquema real — `schema.sql` regenerado el 2026-11-23

El `schema.sql` original **no coincidía** con la BD real. Se regeneró con las queries A–E, G y H de §15. Diferencias confirmadas respecto al archivo antiguo:

- `activities` **SÍ tiene columna `status`** (`text NOT NULL DEFAULT 'pending'`), que el original no definía; su `CHECK` **incluye `'cancelled'`**.
- `activities.created_by` es `NOT NULL` sin default.
- Coordenadas `latitude` / `longitude` tipo **`numeric`** con `CHECK` de rango.
- Las políticas RLS tienen **nombres en español** (`"Admin gestiona actividades"`, `"Usuarios consultan eventos publicados"`, …) y usan `is_admin()`; el original usaba `activities_admin_all`, etc.
- **Solo `activities` tiene `updated_at`**; el resto de tablas solo `created_at` (el original inventaba `updated_at` en varias).
- **No existe `CHECK` de horario** en `activities` (el original lo definía).
- `emergency_contacts.phone` es `NOT NULL` (el original lo dejaba nullable).
- Índices reales: solo `activities_event_date_idx` y `wall_posts_created_idx` además de PK/UNIQUE; **no existen** los índices `user_id` que traía el original.
- **Query H (Storage): 0 filas** → no hay políticas de adjuntos en `storage.objects`; el bloque de Storage del original **nunca se aplicó**.
- **Triggers: F = 0 filas** → no hay ningún trigger en las tablas de `public` (nadie actualiza `updated_at`). **F2: hecho** → `on_auth_user_created` (`AFTER INSERT ON auth.users` → `handle_new_user()`), recreado en `schema.sql`. **F3: hecho** → event trigger `ensure_rls` (`ddl_command_end` → `rls_auto_enable`, habilitado) más los event triggers por defecto de Supabase (`pgrst_ddl_watch`, etc.).

**`schema.sql` ya es usable como referencia** del estado real, salvo las dos secciones pendientes (triggers y Storage).

### 13.4 Verificación funcional completa (2026-11-23)

Con el usuario de prueba `test` (rol admin) se verificó **0 errores de consola** en todo:

- ✅ Login, perfil, **agenda con las 5 actividades**, recarga con sesión persistida, logout.
- ✅ Muro: leer, publicar, eliminar.
- ✅ Emergencia: contactos (tabla vacía) + botón externo.
- ✅ Actividades: **crear (201), editar (200), cancelar (204 → badge "Cancelada" + botón Reabrir), reabrir (204), eliminar (204)**.
- ✅ Validaciones: fecha dentro del rango del evento y hora término > inicio.
- ⚠️ **Mapa sin marcadores**: las 5 actividades de prueba se insertaron **sin coordenadas** (§7 de este documento). La lista sí carga.

### 13.5 Bugs corregidos en el frontend (commits `d799834`, `5a8a652`)

1. `insert` **sin `.select()`** → `result.data` era `null` y **las asignaciones nunca se guardaban**.
2. El mensaje real de la Edge Function se perdía tras un genérico "No fue posible iniciar sesión."
3. `boot()` **cerraba sesión ante cualquier error de red/permisos** → expulsaba al usuario por un fallo transitorio.
4. `refreshAll` secuencial: un fallo impedía cargar el resto (ahora `Promise.allSettled`).
5. Sin validación de UUID, rango de fechas del evento ni coherencia de horario.
6. La validación de UUID ocurría *después* de guardar (actividad quedaba a medias).
7. El admin no veía ni podía reabrir canceladas; no había acción Cancelar.
8. Se elegía el evento más reciente en vez del **vigente** (el que contiene hoy).
9. `fitBounds` con la vista oculta + la lista del mapa dependía de Leaflet (si el CDN fallaba, no se pintaba nada; hoy el mapa es MapLibre con creación perezosa al abrir la pestaña).
10. Coordenadas solo admitían `latitude/longitude` (rompía con `lat/long`).
11. **El iframe de emergencia nunca funcionó**: el sitio externo envía `X-Frame-Options: DENY`. Reemplazado por botón de apertura en pestaña nueva.
12. Errores `42501`/`PGRST204` silenciados; ahora se muestran y se registra `console.error`.
13. Si `status` no existiera, la agenda no se rompe: reintenta sin ese filtro y avisa por consola (defensa ante la desincronización de la §13.3).

## 14. Pendientes inmediatos

1. ✅ **Regenerar `schema.sql`** desde la BD real — hecho el 2026-11-23 con todas las queries (A–H, F2, F3).
2. ✅ **Coordenadas de las 5 actividades de prueba** — `sql/04_coordenadas.sql` ejecutado el 2026-11-23 y **verificado en navegador: 5 marcadores, 5 botones "Cómo llegar", 0 errores**.
3. ⬜ **Políticas de Storage**: la query H devolvió 0 filas → no existen. **Bajada de prioridad (2026-11-23): el frontend no usa Storage en absoluto** (0 referencias a adjuntos/subidas en `src/` e `index.html`). Crearlas cuando se implemente la función de adjuntos.
4. ✅ **GRANT faltantes para `authenticated`** — resuelto el 2026-11-23 con `sql/05_grants_admin.sql` (verificado: `events` y las 4 tablas con `DELETE/INSERT/SELECT/UPDATE`; `profiles` con `SELECT/UPDATE`). RLS sigue filtrando por fila (`is_admin()`). *Observación pendiente: `service_role` solo tiene `SELECT` en `profiles` (query G) — si una Edge Function necesita leer más tablas, faltan GRANT.*
5. Asignación de usuarios: el formulario aún pide **UUIDs separados por coma** (solución temporal, ver §8/§9).
6. Administración de usuarios, adjuntos, y personalización de instrucciones por usuario.
7. Antes de producción: CORS de la Edge Function a un origen concreto (hoy `*`), rate limiting en `login-username`, iconos del PWA (`manifest.webmanifest` tiene `"icons":[]`).
8. ⬜ **`emergency_contacts` está vacía** (verificado el 2026-11-23 en navegador: la vista Emergencia muestra "No hay contactos registrados."). Falta cargar los contactos reales (INSERT con datos reales de la red interna).

## 15. Queries para regenerar `schema.sql`

> ✅ Ejecutadas el 2026-11-23: **A, B, C, D, E, F, G, H, F2, F3** — todas, resultados ya volcados en `schema.sql`.
> **F: 0 filas** → sin triggers en tablas de `public`. **F2**: `on_auth_user_created` en `auth.users`.
> **F3**: event trigger `ensure_rls` → `rls_auto_enable`. **H: 0 filas** → sin políticas de Storage.

Ejecutar en el SQL Editor y volcar la salida al archivo `schema.sql`:

```sql
-- A) Columnas de TODAS las tablas
SELECT c.relname AS tabla, a.attname AS columna,
       format_type(a.atttypid, a.atttypmod) AS tipo,
       a.attnotnull AS not_null, pg_get_expr(ad.adbin, ad.adrelid) AS default_expr
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND a.attnum = ad.adnum
WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;

-- B) Restricciones (PK, FK, CHECK, UNIQUE)
SELECT c.relname AS tabla, con.conname, pg_get_constraintdef(con.oid) AS definicion
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' ORDER BY c.relname, con.conname;

-- C) Índices
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname='public' ORDER BY tablename;

-- D) Políticas RLS completas (qual / with_check)
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname;

-- E) Funciones
SELECT p.proname, pg_get_functiondef(p.oid) AS definicion
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' ORDER BY p.proname;

-- F) Triggers
SELECT c.relname AS tabla, t.tgname, pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname;

-- G) GRANTs vigentes
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee IN ('authenticated','service_role')
ORDER BY table_name, grantee, privilege_type;

-- H) Políticas de Storage para adjuntos
SELECT policyname, cmd, qual, with_check FROM pg_policies
WHERE schemaname='storage' AND tablename='objects' AND policyname ILIKE '%activity%'
ORDER BY policyname;

-- F2) Triggers sobre auth.users (aquí vive el que llama a handle_new_user)
SELECT c.relname AS tabla, t.tgname, pg_get_triggerdef(t.oid) AS definicion
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- F3) Event triggers (p. ej. el que ejecuta rls_auto_enable)
SELECT evtname, evtevent, evtenabled, evtfoid::regproc AS funcion
FROM pg_event_trigger ORDER BY evtname;
```

## 16. Rediseño visual con el mockup `index-up.html` (2026-11-23)

Se reemplazó el frontend por el diseño del mockup `index-up.html` **manteniendo toda la lógica Supabase**.
Decisiones acordadas con el usuario (todas las recomendadas):

1. **Tailwind por CDN** (`cdn.tailwindcss.com`) + Google Fonts (Plus Jakarta Sans) + Material Symbols, tal como el mock.
2. ~~**Mapa: Leaflet real**~~ → **Mapa: MapLibre GL** (decisión posterior, ver §17), con las coordenadas de las 5 actividades (NO el SVG falso del mock), con panel inferior "sede seleccionada", barra de búsqueda y botones de zoom/recentrar.
3. **Muro: 2 categorías reales** de la BD (`positive`/`vent`) con el look del mock (4 pestañas del mock descartadas: el CHECK de `wall_posts.category` no cambió).
4. **Botones sin backend (SOS, reacciones, ficha médica…)**: ocultos o con toast honesto. El SOS informa que no hay alertas automáticas.
5. **Datos de ejemplo del mock** (Camila Rojas, ficha médica, avatares): conectados a datos reales; los ficticios, ocultos.
6. **Estados de asistencia**: los de la BD (`pending/in_progress/completed`) con look nuevo; el CHECK no cambió.

Archivos cambiados: `index.html` (diseño nuevo + todos los IDs que necesita `src/main.js`),
`src/main.js` (navegación con `#header-view-label`, `showToast()`, agenda por días con HOY/progreso/filtro
Mis-Todas, panel de sede del mapa, modal del muro, red real con `navigator.onLine`) y `styles.css`
(reescrito en versión mínima: solo clases que genera `main.js`). `index-up.html` se conserva como referencia del diseño.

Verificado en navegador con `test`/`123456` (2026-11-23), **0 errores de consola**:
login, agenda (5 actividades, acordeón por día, "Día 1 de 8", filtro Mis/Todas con conteos),
crear/editar (toast "Actividad actualizada."), cancelar/reabrir (píldora `is-cancelled`),
cambiar estado de asignación (Pendiente/En curso/Completada con botón activo),
mapa (5 marcadores, selección de sede, "Cómo llegar" habilitado con coordenadas, búsqueda, zoom/recentrar),
muro (publicar con toast, eliminar, pestañas sincronizadas entre vista y modal),
emergencia (red real `navigator.onLine`, enlace externo, toast honesto de SOS), navegación y sesión.

> **Pendiente detectado en la verificación**: `emergency_contacts` está vacía (§14.8).

## 17. Migración del mapa a MapLibre GL (2026-11-23)

Se reemplazó **Leaflet 1.9.4 por MapLibre GL 4.7.1** (decisión explícita del usuario), alineando la app con
la implementación de referencia de `gps/territorio-gps-movil`. Cambios:

- **CDN**: `unpkg.com/maplibre-gl@4.7.1` (CSS + JS); estilos popup/controles adaptados en `styles.css`.
- **Estilo base**: OpenFreeMap `positron` (`https://tiles.openfreemap.org/styles/positron`) — mismo estilo que
  territorio-gps-movil, sin API key.
- **Vista satélite**: capa raster Esri World Imagery insertada bajo la primera capa `symbol` del estilo
  (alternada con `#map-satellite`, `aria-pressed`).
- **GPS continuo**: `watchPosition` al iniciar sesión (una sola vez), badge `#gps-badge` sobre el mapa
  (GPS activo / Ubicación no disponible) y punto azul `.user-dot` en el mapa; `#map-locate` centra con offset.
- **Pines**: `renderMarkers()` con `PIN_ICON` (Material Symbols en div `.map-pin`, color por estado:
  `pending` #F2B705, `in_progress` #4BB2F2, `completed` #006492, `cancelled` #F25050) + popup.
- **Creación perezosa**: el mapa solo se instancia al abrir la pestaña Mapa (el contenedor necesita tamaño);
  `gotoView` llama `renderMap()` con `setTimeout(100)` y `resize()`.
- **Encuadre sin tapar pines**: `paddingMapa()` deja libres la barra de búsqueda (arriba) y el panel inferior;
  `applyPendingFit()` re-aplica a los 300 ms por si el layout aún se estabiliza (`maxZoom:14`).
  `offsetPanel()` desplaza `flyTo` para que el punto centrado caiga en la franja visible.
- **Controles**: fila horizontal `top-16` (zoom +/−, recentrar, mi ubicación, satélite) para no quedar
  bajo el panel inferior; panel inferior limitado a `max-h-[52%]`.
- **App informativa**: NO se migró la cola offline ni gestión de reportes/estados (territorio-gps-movil sí la
  tiene); solo lectura de puntos públicos y actividades.

Verificado en navegador (`test`/`123456`): 5 pines, selección desde lista y desde pín (popup + panel),
vista satélite alternando OK, botones visibles, badge GPS, **0 errores de consola**.

## 18. Etapa 2 del mapa: satélite por defecto + límites comunales (2026-11-24)

Implementa `mapas.txt` §3.1 y §3.2 (etapa 2 de su §14). No reemplaza el mapa ni toca Supabase.

**Repo**: renombrado en GitHub a **`app-santiago-2026`** (sin el punto final). El nombre anterior
(`app-santiago-2026.`) rompía el clon en Windows ("Invalid argument" al crear la carpeta).
El remoto local ya apunta a `https://github.com/franciscolir/app-santiago-2026.git`.

### Cambios

- **Vista satélite por defecto** (§3.1): `activarSateliteInicial()` se llama en el `load` del mapa y
  reutiliza `alternarSatelite()`; el botón `#map-satellite` queda `aria-pressed="true"`. Sigue
  alternando a la vista cartográfica OpenFreeMap `positron`, que aporta los rótulos legibles encima.
- **Límites comunales** (§3.2): `data/comunas-rm.geojson` — **52 comunas**, 164 KB, 7.113 puntos.
  - Fuente: **OpenStreetMap vía Overpass API** (§7.1), licencia **ODbL**. Geometrías reales, no dibujadas.
  - Generación reproducible (§12):
    1. `scripts/_q_comunas.txt` — consulta Overpass (área RM + `admin_level=8`).
    2. Descarga: `curl -A "app-santiago-2026/1.0" --data-urlencode "data@scripts/_q_comunas.txt" https://overpass.private.coffee/api/interpreter -o scripts/_overpass_comunas.json`
       (usar también `maps.mail.ru` como espejo; `overpass-api.de` respondió 502/406).
    3. `node scripts/importar-comunas.mjs` → ensambla anillos, simplifica (Douglas-Peucker, ~30 m) y escribe el GeoJSON.
    4. `node scripts/validar-comunas.mjs` → bbox y centroides de control.
  - El volcado crudo (2,6 MB) está en `.gitignore`.
- **Capas**: `comunas-fill` (relleno 8 %), `comunas-hover` (resaltado ámbar) y `comunas-line`
  (borde blanco). Las tres se insertan **por debajo de la primera capa `symbol`** con
  `insertarBajoSimbolos()` para no tapar los rótulos sobre el satélite.
- **Nombre de la comuna** (§3.2): popup `#comuna-popup` al pasar el mouse y al tocar (clic) el polígono.
- **Interruptor de la capa** (§3.2/§10): `#map-comunas` alterna `visibility` de las 3 capas sin
  recargar el mapa; `[ON]` por defecto una vez cargadas.
- **Pantalla completa** (§3.1): `#map-fullscreen` sobre el contenedor `.mapa-frame` (nueva clase) con
  `:fullscreen { height:100vh }` y `map.resize()` en `fullscreenchange`. El botón se oculta si
  `document.fullscreenEnabled` es falso (p. ej. iOS Safari).
- **Fila de controles**: ahora `flex-wrap` + `max-w-[calc(100%-2rem)]`, porque son 7 botones y en
  pantallas angostas deben pasar a 2 filas.
- **Atribución visible** (§3.1): el control de atribución quedaba **detrás** del panel inferior
  (medido: top 456 vs panel en 282). Ahora `attributionControl:{compact:false}` (texto completo
  "Esri, Maxar… | OpenFreeMap © OpenMapTiles Data from OpenStreetMap") y una variable CSS
  `--mapa-panel-h` calculada con un `ResizeObserver` sobre el panel se usa como `bottom` del
  `.maplibregl-ctrl-bottom-right`, con 10 px de aire.
- **Service worker**: `./data/comunas-rm.geojson` agregado a `APP_SHELL` (offline tras la 1ª visita).

### Verificación (2026-11-24, `test`, 0 errores de consola)

Satélite ON por defecto · 52 comunas cargadas · resaltado y nombre al pasar (probado "Santiago") ·
interruptor comunas ON→OFF→ON · 5 pines de actividades intactos · atribución visible sobre el panel
(272 ≤ 281.6 px) · app real carga sin errores de módulo.

### Limitaciones conocidas

- **Pantalla completa no verificable en el navegador embebido de pruebas**: `requestFullscreen()`
  allí devuelve una promesa que nunca se resuelve (ni se rechaza). En Chrome/Edge normal funciona.
- **Tiles satélite de Esri World Imagery**: sin clave en el frontend, pero revisar sus condiciones de
  uso y volumen antes de producción (§3.1). La atribución ya se muestra.
- **Sin diferenciación de color por comuna**: solo borde + resaltado al pasar. Si se quiere un tinte
  distinto por comuna, hacerlo en la Etapa 4 (panel de capas).
- **`index-up.html` es el mock viejo** (mapa SVG falso y botón de capas que solo muestra un toast):
  no usarlo como referencia de implementación.

### Pendiente (Etapas 3+ de `mapas.txt`)

Datos geográficos (Metro/MetroTren, parques, comercio, salud, seguridad, educación, servicios),
panel completo de capas, tabla `map_points` con RLS, administración de puntos por admin y
procedimiento de importación masiva.

## 19. Etapa 3 del mapa: datos geográficos (2026-11-24)

Implementa `mapas.txt` §4, §7 y §8 (etapa 3 de su §14). No toca la UI de actividades ni autenticación.

### Transporte público (DTPM GTFS oficial, fuente abierta)

- **Fuente**: `https://www.dtpm.cl/index.php/gtfs-vigente` → `GTFS_20261114_v2.zip` (feed vigente desde 14-11-2026).
- `scripts/importar-transporte.mjs` lee el GTFS descomprimido en `scripts/_gtfs/` y genera:
  - `data/transporte-estaciones.geojson` — **154 estaciones** (126 Metro + 28 MetroTren), 38 KB.
  - `data/transporte-lineas.geojson` — **9 líneas** con trazado real (`shapes.txt`), 16 KB.
  - `data/transporte-paraderos.geojson` — **12.181 paraderos de bus** con líneas asociadas, 3,8 MB.
    **NO se genera ni se versiona por defecto** (el usuario pidió mostrar solo las 4 terminales
    generales): se reproduce con `node scripts/importar-transporte.mjs --paraderos`.
- Criterio §7.5: NO todo `stop` es estación de Metro. Se filtra por agencia (M = Metro, MT = EFE/Trenes) y los stops se suben a `parent_station`.
- Paraderos: se recorren los `stop_times` de todos los viajes de bus para saber qué paradas existen de verdad (no se inventan posiciones).
- Nombres de estación validados: Baquedano → ["L1","L5"], Tobalaba → ["L1","L4"], Los Héroes → ["L1","L2"].

### Lugares de interés (OpenStreetMap vía Overpass, ODbL)

- `scripts/importar-lugares.mjs` consulta Overpass (espejo `overpass.private.coffee`, con `User-Agent`) y genera archivos **uno por interruptor del panel de capas** (§11: no cargar todas las categorías indiscriminadamente).
- **Filtros aplicados** (por solicitud del usuario):
  - Parques: solo parques grandes, cerros parque y zoológicos.
  - Plazas: solo plazas de armas de las comunas.
  - Comercio: solo centros comerciales grandes (malls).
  - Salud: solo hospitales públicos, SAPU y SAR.
  - Seguridad: bomberos, carabineros, comisarías y tenencias.
  - Servicios públicos: solo municipalidades.
  - Sin escuelas ni edificios educacionales. Sin paraderos de bus.
- Total: ver `data/lugares/*.geojson` tras ejecutar `scripts/importar-lugares.mjs` (una capa por archivo).
- Cada feature tiene nombre, subcategoría, dirección (`addr:street`+`addr:housenumber`), comuna (georreferenciados contra `comunas-rm.geojson`), y fecha de la fuente (`osm3s.timestamp_osm_base`).
- Dedupe por `categoría|nombre|comuna` con prioridad relación > way > nodo (§13.15).
- **No existe mega-archivo acumulado**: `data/lugares.geojson` se eliminó (duplicaba los mismos puntos y pesaba 3,4 MB). El script escribe solo `data/lugares/<capa>.geojson`.
- Si una capa falla (Overpass 502/504), **el script NO sobrescribe su archivo**: conserva el previo y lo informa ("sin cambios"). Así una caída del espejo no deja una capa vacía.
- Archivos por capa vigentes (2026-11-25): `parques` 2.244 · `comercio` 708 · `salud` 513 · `seguridad` 345 · `plazas` 42 · `servicios` 61.

### Base de datos Supabase (`sql/06_map_points.sql`)

- Tabla `public.map_points` con RLS: id, name, description, category, subcategory, icon, latitude, longitude, address, comuna, source, external_id, active, visible, tipo, created_by, created_at, updated_at.
- Modelo `tipo`: `personal` (solo el autor lo ve/edita) o `general` (admin lo crea, todos lo ven) — mapas.txt §9.
- RLS: `Usuarios consultan puntos del mapa` (select: general+visible, o personal del dueño, o admin ve todo)
  + `Usuarios gestionan sus puntos personales` (personal del dueño) + `Admin gestiona puntos generales` (general solo admin).
- Índice único parcial en `external_id` → permite reimportar sin duplicar (lo usa `sql/07_terminales.sql`).
- GRANT select/insert/update/delete a `authenticated` (barrera real es RLS).
- **PostGIS NO disponible** (verificado). Coordenadas lat/lon simples.
- **Semilla de las 4 terminales de bus** (`sql/07_terminales.sql`, ejecutar después de `06`): Terminal Alameda,
  Terminal Sur, Terminal San Borja y Terminal de Buses Pajaritos, como puntos `tipo='general'` con datos
  OSM verificables (`external_id` = `way/23393749`, `way/23393750`, `way/39330024`, `node/253282386`).

### Puntos personalizados del mapa (§9, Etapa 5)

- Botón `#map-add-point` (cualquier usuario autenticado): activa modo edición, clic en el mapa para ubicar.
- Usuarios normales: solo pueden crear puntos **personales** (tipo=personal).
- Administradores: pueden crear puntos **personales o generales** (selector en el formulario), y editar/eliminar cualquier punto.
- Guardado/edición/eliminación en Supabase (`map_points`), protegido por RLS.
- Los puntos son independientes de los importados de fuentes externas.

## 20. Etapa 4 del mapa: panel de capas + puntos personalizados (2026-11-24)

Implementa `mapas.txt` §4, §5, §6, §9 y §10.

### Panel de capas (botón `#map-layers`)

- 14 interruptores (ON/OFF), uno por capa, cambios al instante sin recargar el mapa.
- Grupos: Cartografía, Transporte, Áreas verdes, Comercio, Servicios, Aplicación.
- Capas: satélite, límites comunales, estaciones Metro, líneas Metro, MetroTren, parques, plazas de armas, centros comerciales (malls), hospitales públicos/SAPU/SAR, bomberos/Carabineros/comisarías, municipalidades, actividades, puntos personalizados.
- Estados por defecto: satélite ON, comunas ON, actividades ON, puntos ON, resto OFF.
- Cada capa de lugares carga su propio archivo `data/lugares/<capa>.geojson` solo la primera vez que se enciende (§11).
- Preferencias del usuario guardadas en `localStorage` (`app-santiago-2026:capas`) (§10).

### Diseño visual de marcadores (§5)

- Íconos PNG con forma de pin en `/icons/`.
- Estaciones de Metro: círculo blanco con borde.
- Lugares de OSM: icono PNG por subcategoría (clustering nativo de MapLibre, `cluster:true`, `clusterMaxZoom:13`).
- Puntos personalizados: icono PNG **elegido por el usuario** en el formulario (`#point-icon`); si no se
  reconoce, se usa el de la categoría (`ICONO_PUNTO`). Al cambiar la categoría se propone el icono equivalente.
  Indicador "personal" o "general" en el popup.

### Información al seleccionar (§6)

- Popup con nombre, subcategoría, dirección, comuna, fuente y fecha de actualización.
- Metro: nombre de estación, líneas, operador.
- Lugar OSM: comuna, dirección, licencia ODbL.

### Verificación

- 0 errores de consola en navegador (salvo 404 de `map_points` si no se aplicó `sql/06_map_points.sql` en Supabase).
- Cluster renderiza según capas encendidas.

### Pendiente (Etapa 5+ de `mapas.txt`)

- Aplicar `sql/06_map_points.sql` en el SQL Editor de Supabase (requiere credenciales del proyecto).
- CRUD completo de puntos personalizados implementado en frontend, pendiente de tabla en BD.
- Vista de agenda adaptada de `agenda.html` (timeline por días, nodo activo, accordions).

## 21. Correcciones de la app en Pages (2026-11-25)

Errores reportados por el usuario al abrir la app publicada + ajustes derivados. Sin cambios de arquitectura.

### 1) `SyntaxError: Unexpected identifier 'muted'` (`src/main.js`)

- El `else` de un ternario usaba comillas dobles alrededor de HTML que ya traía comillas dobles.
- Corregido con plantillas literales (backticks). `node --check src/main.js` OK.

### 2) `ReferenceError: toggleDay is not defined`

- `index.html` carga `src/main.js` como `<script type="module">`: las funciones del módulo **no** son globales
  y los `onclick="toggleDay('day-…')"` inline fallaban.
- Ahora los botones se generan con `data-day="<id>"` y se enganchan con `addEventListener` dentro del módulo
  (`enlazarDias()`), sin handlers inline. `toggleDay()` además valida que el nodo exista (re-render).

### 3) Las capas `lugares-*` nunca se añadían al mapa (síntoma: `fetch` 200 pero sin source/layer)

- Causa raíz: **`map.loadImage()` nunca resolvía el callback** en este entorno, la promesa de `cargarIcono()`
  quedaba colgada y `cargarLugares()` no llegaba a `addSource`/`addLayer`. El botón del panel sí cambiaba
  a `aria-pressed="true"`, por eso parecía un problema de datos.
- Solución: los iconos PNG se descargan con `fetch` + `createImageBitmap` y se añaden con `map.addImage()`
  (con `hasImage()` para no duplicar id). Si el PNG falla, se usa un pin de color de respaldo
  (`crearPinRespaldo()`), de modo que el punto nunca queda invisible. Timeout de 8 s por icono.

### 4) Service Worker

- `CACHE_NAME` subido a `app-santiago-2026-v3` (el código nuevo de `main.js` llega a los clientes).
- Fuera del precache: `data/transporte-paraderos.geojson` (3,7 MB que la app ya no usa).

### 5) Limpieza de datos

- Eliminados `data/lugares.geojson` (mega-archivo de 3,4 MB) y los archivos obsoletos
  `areas-verdes`, `comercio-centros`, `comercio-mercados`, `comercio-super`, `educacion`.
- `scripts/importar-lugares.mjs` ahora escribe **solo** `data/lugares/<capa>.geojson` y no pisa un archivo
  si la consulta a Overpass falla.
- `scripts/importar-transporte.mjs` solo genera los paraderos con `--paraderos`.
- `plazas` (42) y `servicios` (61) reimportados con éxito (Overpass volvió a responder el 2026-11-25).

### Verificación (2026-11-25, navegador embebido, `http://localhost:8080`)

- Consola: **0 errores**. Solo avisos: Tailwind CDN (aviso conocido) y 3 avisos de MapLibre
  (`Expected value to be of type number, but found null instead`) que provienen del estilo OpenFreeMap.
- Mapa: fuentes `ne2_shaded`, `openmaptiles`, `satelite`, `comunas` + `lugares-parques/comercio/salud/seguridad`.
- Iconos cargados: `icono-parque.png`, `icono-mall.png`, `icono-urgencias.png`, `icono-policia.png`.
- Encender/apagar una capa del panel adds/quita su source y sus layers al instante.
- Agenda: el acordeón de días abre y cierra (`toggleDay`).

### Pendiente

- **Etapas 6 (pruebas) y 7 (documentación)** de `mapas.txt`: entregadas el 2026-11-25
  (`scripts/verificar-mapa.mjs`, `PRUEBAS.md` y `DOCUMENTACION-MAPA.md`).
- Ejecutar en Supabase (SQL Editor, en este orden): `sql/06_map_points.sql` → `sql/07_terminales.sql`.
- Si `map_points` aún no existe, el frontend registra el aviso `cargarPuntosMapa:` y sigue funcionando.

## 22. Datos con los filtros estrictos + Etapas 6 y 7 (2026-11-25)

### Datos reimportados con los filtros reales del usuario

Los archivos `parques`, `comercio` y `salud` estaban generados con una versión anterior del
importador y **no cumplían** los filtros pedidos (contenían plazas pequeñas, supermercados,
mercados y clínicas privadas). Se reescribió `scripts/importar-lugares.mjs` y se regeneró todo:

| Capa | Antes | Ahora | Regla aplicada |
|---|---|---|---|
| Parques | 2.244 (plazas, áreas recreativas, playgrounds) | **380** | `leisure=park` con área ≥ **1 ha**, o nombre de cerro, o `tourism=zoo` |
| Plazas | 42 | **42** | `place=square` (plaza de armas) |
| Comercio | 708 (supermercados, mercados) | **131** | solo `shop=mall` |
| Salud | 513 (clínicas privadas) | **269** | solo SAPU/SAR/CESFAM/CECOSF/consultorios/centros de salud/postas u operador público |
| Seguridad | 345 | 345 | bomberos, Carabineros, comisarías y tenencias |
| Servicios | 61 | 61 | solo municipalidades |

- El importador ahora usa `out geom`: calcula el **área real** (shoelace) y el **centroide**
  de cada elemento OSM, y guarda `area_m2` en las propiedades (visible en el popup).
- Se descartan los elementos fuera del bbox de la RM (el área de Overpass arrastraba volcanes
  que están en Argentina).
- `place=square` NO lleva filtro de área: en OSM la plaza suele ser un nodo (centroide) y el
  área real un way sin tag; filtrar por área las hacía desaparecer.

### Se eliminó la fuente `ne2_shaded` del estilo OpenFreeMap

- El estilo `positron` declara la fuente ráster `ne2_shaded` (relieve Natural Earth) pero
  **ninguna capa la usa**. Si su carga se demora, MapLibre nunca termina de "cargar" el estilo:
  el mapa queda en blanco y las capas propias (comunas, lugares) no se añaden nunca.
- Ahora, en `style.load`, se elimina esa fuente y en `load` se añaden las capas propias, con
  un vigilante que reintenta cada segundo hasta que el estilo esté listo.
- Resultado medido: `isStyleLoaded() = true`, 11.216 features renderizadas y las 6 capas de
  lugares con sus clusters.

### Popups completos (§6)

- Lugares: nombre, subcategoría, **categoría**, dirección, comuna, **área (m²)**,
  **coordenadas**, fuente y fecha. Metro: nombre, líneas, **estación de combinación**, comuna,
  **coordenadas** y fuente.

### Iconos de los puntos personalizados

- El icono elegido en el formulario (`#point-icon`) ahora manda sobre el de la categoría; al
  cambiar la categoría se propone el equivalente (`ICONO_POR_CATEGORIA`).

### Etapa 6 — Pruebas

- `scripts/verificar-mapa.mjs`: **88 pruebas automáticas, 0 fallos, 2 avisos** (datos,
  coordenadas, duplicados, subcategorías filtradas, referencias del frontend, precache,
  credenciales privadas y políticas RLS de los SQL).
- `PRUEBAS.md`: plan completo con 20 pruebas manuales (17 ✅, 3 ⏳ pendientes de Supabase).

### Etapa 7 — Documentación

- `DOCUMENTACION-MAPA.md`: modificaciones, tablas, SQL/RLS, fuentes, procedimiento de
  importación, variables de configuración, pruebas y limitaciones conocidas.
- `README.md`: enlaza la documentación y el comando de verificación.

## 23. Iconos SVG del mapa + fix de la migración 7 (2026-11-25)

### `sql/07_terminales.sql` — error 42P10

- **Síntoma**: `ERROR: 42P10: there is no unique or exclusion constraint matching the
  ON CONFLICT specification` al ejecutar la siembra de las 4 terminales.
- **Causa**: el índice único de `external_id` es **parcial**
  (`create unique index ... on public.map_points (external_id) where external_id is not null`).
  PostgreSQL **no puede inferir** un índice parcial con `on conflict (external_id)`: hay que
  repetir el predicado → `on conflict (external_id) where external_id is not null do update`.
- **Fix aplicado**: `sql/07_terminales.sql` ahora
  1. avisa con un mensaje claro si falta la tabla `map_points` (ejecutar `sql/06` primero),
  2. borra duplicados previos de esas 4 terminales (conserva la más antigua),
  3. crea el índice parcial si falta,
  4. hace el upsert con el predicado correcto.
- Regresión cubierta por `scripts/verificar-mapa.mjs` (comprueba el `ON CONFLICT` de `sql/07`
  y el índice parcial de `sql/06`).

### Iconos del mapa en SVG (los que dejó el usuario)

- El usuario dejó 16 dibujos vectoriales en `icons/*.svg` y movió los PNG a `icons/png/`.
- **Optimización**: `scripts/optimizar-iconos.mjs` (usa `npx svgo`, sin dependencias al
  repo) → **4,3 MB → 490 KB (-89%)**. Se conservan `viewBox`, `width` y `height`
  (el navegador necesita tamaño intrínseco para rasterizar) y los grosores de trazo.
- **Carga en MapLibre**: MapLibre no acepta SVG, así que el SVG se descarga con `fetch`, se
  dibuja en un `<canvas>` (máx. 256 px) y se añade con `map.addImage`. Si el SVG falla se usa
  el PNG de `icons/png/` y, en último caso, un pin de color.
  Se mantiene `fetch` + `createImageBitmap` (y **no** `map.loadImage`, que se cuelga).
- **Catálogo** (`ICONOS_MAPA` en `src/main.js`): 17 claves → archivo SVG. `ICONO_LUGAR` y
  `ICONO_PUNTO` ahora guardan la clave, no el nombre de archivo.
- **Selector visual de iconos**: el `<select id="point-icon">` se reemplazó por una grilla de
  miniaturas SVG (`#point-icon-grid` + `<input type="hidden" id="point-icon">`), construida
  desde el catálogo. Al cambiar la categoría se propone el icono equivalente.
- **Service worker**: `CACHE_NAME` v4 y los iconos SVG se sirven **cache-first**
  (se descargan una sola vez).

### Arreglo del mapa en blanco (estilo OpenFreeMap)

- El estilo `positron` declara la fuente ráster `ne2_shaded` que **ninguna capa usa**; si su
  carga se demora, MapLibre nunca termina de "cargar" el estilo → el mapa queda en blanco.
- **Quitar la fuente después de crear el mapa no sirve**: MapLibre recarga el estilo entero y
  **borra las capas propias** ya añadidas (se vio en la prueba: las fuentes `comunas` y
  `lugares-*` desaparecieron).
- **Solución (versión inicial, corregida en §24)**: `obtenerEstiloBase()` descargaba el JSON
  del estilo, le quitaba `ne2_shaded` (fuente y capas que la usen) y se lo pasaba a MapLibre
  **como objeto**. El arranque del mapa se hace en `style.load` con reintentos (el vigilante
  llama a `iniciarMapa()` cada segundo hasta que `addSource` deja de lanzar).
- Medido: `isStyleLoaded=true`, `loaded=true`, fuentes `openmaptiles, satelite, comunas,
  lugares-*`, 26 features de lugares renderizadas, 0 errores de consola.

---

## 24. Vista de mapa a pantalla completa + puntos que se achican (2026-11-25)

### Lo pedido

1. El mapa debe usar **el máximo espacio posible** y, solo en esa vista, **sin el header**.
2. El **panel inferior de actividades** colapsable.
3. Los **botones del mapa a la derecha**, en **fila horizontal**, **colapsables** en un único
   **botón superior derecho con flecha hacia abajo**.
4. **Iconos al acercar / punto de color al alejar**: el punto se achica hasta desaparecer.
   Todos los puntos menos los marcados como **fijos**. Al agregar un punto debe existir la
   opción de vista fija.
5. **Lupa colapsable arriba a la izquierda** que abre un input de búsqueda.

### Lo implementado

| Requisito | Implementación |
|---|---|
| Máximo espacio | `body.vista-mapa` (se activa en `gotoView("mapa")`): oculta `#app > header` y fija `#view-mapa` en `calc(100dvh - 4rem - safe-area)`; el marco pasó de `h-[62vh]` a `h-full` |
| Panel inferior colapsable | `#mapa-panel-toggle` (asa + flecha) pliega `#mapa-panel-cuerpo` (269 px → 58 px); `colapsarPanelMapa()` reabre el panel al seleccionar una actividad |
| Controles a la derecha y colapsables | `#map-controls-row` (8 botones en una fila horizontal de 362 px) + `#map-controls-toggle` con `keyboard_arrow_down` que rota 180° al desplegar |
| Lupa colapsable | `#map-search-toggle` (lupa) → `#map-search-wrap` con foco automático; `#map-search-close` limpia el filtro |
| Icono ↔ punto de color | `ZOOM_PUNTO_MIN=10.5`, `ZOOM_ICONO=12.5`, `RADIO_PUNTO_MAX=7` (§27). Capas de lugares: `circle` `${capa}-puntos-mini` (`minzoom:10.5`, `maxzoom:12.5`, radio en 3 saltos) + `symbol` `${capa}-puntos` (`minzoom:12.5`). Puntos propios: `actualizarPuntosSegunZoom()` en el evento `zoom` con las clases `.map-point-punto` / `.map-point-oculto` |
| Vista fija | Columna `fijo` (`sql/06` y `sql/08_puntos_fijos.sql`), casilla `#point-fijo` en el formulario y `dataset.fijo` en el marcador: el icono se conserva a cualquier zoom |
| Atribución | `--mapa-panel-h` se recalcula con `ResizeObserver` sobre el panel **y** el mapa (antes quedaba desfasada: 279 px con el panel plegado) |

### Bug real encontrado: el estilo pasado como objeto no carga en MapLibre 4.7.1

- La solución anterior (`obtenerEstiloBase()` → `new Map({style: objeto})`) **no funciona**:
  en MapLibre 4.7.1 `Style.loadJSON()` aplaza la carga a un `requestAnimationFrame`
  (`browser.frameAsync`) → si la pestaña no pinta, **el mapa queda en blanco**.
  Comprobado en el navegador de pruebas: con el objeto, `stylesheet=false` y 0 capas; con la
  URL, 55 capas.
- **Solución definitiva**: el mapa se crea con la **URL** del estilo (`style: MAP_STYLE`) y la
  fuente inútil `ne2_shaded` se quita en `limpiarEstiloBase()` dentro del evento `style.load`
  y **antes** de añadir las capas propias (verificado: las capas propias sobreviven y no se
  recarga el estilo).
- De paso, `clusterMaxZoom` bajó de 13 a 12 para que el punto de color y el icono encadenen
  sin huecos, y el radio máximo del icono se ajustó a 128 px (se veía muy grande).

### Limitación del entorno de pruebas

- El navegador embebido de pruebas **no dispara `requestAnimationFrame`**: MapLibre no
  repinta (`map.loaded()` queda en `false` y `queryRenderedFeatures()` devuelve 0). No es un
  fallo de la app. Se verificó por otra vía: `style.load` dispara, `ne2_shaded` se elimina,
  las 67 capas quedan creadas (`comunas-*`, `lugares-*-puntos`, `lugares-*-puntos-mini`,
  `satelite-layer`) y las 5 actividades tienen su marcador.

### Verificación

- `node scripts/verificar-mapa.mjs` → **138 pruebas · 0 fallos · 2 avisos** (bloque nuevo
  `[6] Vista de mapa`: espacio, controles, zoom, vista fija, SQL y regresión del estilo).
- Navegador: header `display:none`, mapa 614 px en una ventana de 678 px, lupa (12,12),
  controles (856,12) con 8 botones en fila, panel 269 → 58 px con `--mapa-panel-h` = 68 px,
  formulario con la casilla “Vista fija”, **0 errores de consola**.
- `sw.js` subido a `CACHE_NAME` **v5** (renueva la precache del app shell con el rediseño).

### Fix del error 42703 en `sql/08_puntos_fijos.sql`

- Al ejecutar la migración 8 en Supabase falló: `ERROR 42703: column "activo" does not
  exist` (la columna real se llama **`active`**, no `activo`). El `alter table` de la
  columna `fijo` **sí se había aplicado**: el error venía de la consulta de verificación
  final, así que la migración 8 era idempotente y se puede volver a ejecutar sin más.
- Corregido: la consulta usa `active`. Además se le agregó la comprobación previa de la
  tabla (`to_regclass('public.map_points')`), igual que `sql/07`.
- **Regresión automática**: `scripts/verificar-mapa.mjs` ahora extrae las columnas reales
  del `create table` de `sql/06` y revisa que **todas** las consultas
  `select … from public.map_points` de `sql/06`, `sql/07` y `sql/08` usen solo columnas
  existentes (detecta el 42703 antes de que llegue a Supabase). Verificado que la prueba
  falla si se reintroduce `activo`.
- Total: **141 pruebas · 0 fallos · 2 avisos**.

---

## 25. Lote de UX del 2026-11-25 (zoom escalonado, metro, bomberos, puntos, muro y agenda)

Pedido del usuario (un solo lote) y cómo quedó resuelto:

| Pedido | Solución | Dónde |
|---|---|---|
| Zoom de puntos en **3 momentos** | Rampa escalonada (§27): `ZOOM_PUNTO_MIN=10,5` (desaparece), `ZOOM_PUNTO_MEDIO=11`, `ZOOM_PUNTO_MAX=11,8`, `ZOOM_ICONO=12,5`, `ZOOM_ICONO_MAX=15`; radio 3,5→5→7 px en 3 saltos, `icon-size` 0,25→0,375 = 16→24 px y texto 9→10→11 px en 2 saltos | `src/main.js` (constantes, `cargarLugares`, `cargarTransporte`, `actualizarPuntosSegunZoom`) |
| Puntos fijos **sin borde punteado** | Se eliminó la clase `.map-point-admin` y su `outline: dashed`; los fijos solo cambian que no se achican (`data-fijo`) | `src/main.js`, `styles.css` |
| **Metro en una sola capa** + nombre bajo el icono | Un interruptor “Metro (estaciones y líneas)” (`id: metro`) agrupa líneas, estaciones, iconos y rótulos; la capa `metro-nombres` escribe `nombre` con `text-anchor: top` desde el zoom 12,5 | `src/main.js` (`CAPAS_DEF`, `cargarTransporte`) |
| **Bomberos separados de la policía** | `data/lugares/seguridad.geojson` quedó con 167 puntos de policía y los 178 cuarteles pasaron a `data/lugares/bomberos.geojson`; dos capas, dos interruptores y dos iconos (`policia.svg`, `bomberos.svg`) | `scripts/separar-bomberos.mjs`, `scripts/importar-lugares.mjs`, `src/main.js` |
| **Eliminar el panel inferior** | Ya no existe `#mapa-panel-inferior`; los detalles de lugar/evento y los resultados de búsqueda se muestran en el cuadro de mensaje (`#toast-msg`) con título, cuerpo, acciones y botón de cerrar (`mostrarMensaje()`) | `index.html`, `src/main.js`, `styles.css` |
| **Admin gestiona los puntos marcados** | Botón `#map-puntos-btn` → hoja `#puntos-sheet` con la lista por tipo (general/personal), input de nombre, checkbox `visible`, botón de borrar y **Guardar** (solo se envían los cambios y borrados) | `index.html`, `src/main.js` |
| **Nombre del terminal al acercar** | Los marcadores HTML llevan `.map-point-nombre` debajo del icono, visible con `.map-point-con-nombre` desde el zoom 12,5 | `src/main.js`, `styles.css` |
| **Agenda sin scroll lateral** | `overflow-x: clip` en `#view-agenda`, `min-w-0` en las tarjetas de día y botón “Nueva Actividad” con salto de línea | `styles.css`, `src/main.js`, `index.html` |
| **Muro “Descárgate” en naranja** | Clase `muro-vent` en `#view-muro`: fondo `linear-gradient(#f25050,#d6a100)` y botón de la pestaña blanco con letras `#d96a00` | `src/main.js` (`pintarMuro`), `styles.css` |

Extras que hicieron falta:

- **`sql/09_admin_gestiona_puntos.sql`**: con las políticas de `sql/06` el admin no podía
  escribir en los puntos **personales de otros usuarios** (RLS → 42501). La política nueva
  “Admin gestiona todos los puntos” lo habilita sin cambiar nada para los demás usuarios.
- **Iconos**: los SVG que trae el usuario pesaban 3,2 MB (trebol.svg 1,8 MB). Se optimizaron
  con `node scripts/optimizar-iconos.mjs` (SVGO, `scripts/svgo.config.mjs`): quedan en
  **415 KB** y ninguno supera 400 KB. El script se restauró porque la documentación ya lo
  citaba y faltaba en el árbol de trabajo; ahora usa `--config` (con `-f` SVGO lo tomaba
  como carpeta) y valida que el SVG conserve su `viewBox`.
- **`sw.js`** subido a `CACHE_NAME` **v6** (precache renovada con el lote de UX).
- **Verificación**: `scripts/verificar-mapa.mjs` → **191 pruebas · 0 fallos · 2 avisos**.
  El bloque `[6]` se adaptó (el panel inferior ya no debe existir) y se agregó el bloque
  `[7]` con las 11 comprobaciones del lote.
- **Navegador** (0 errores de consola): rampa verificada en los marcadores HTML (zoom 6
  oculto · 9 → 5,2 px · 11 → 12 px · 12,5 → icono 16 px + nombre · 16 → 24 px); capas
  `lugares-bomberos-*` y `metro-*` creadas al encender los interruptores; cuadro de mensaje
  con los 5 resultados de búsqueda y la ficha del evento (acciones “Ver actividad” y “Cómo
  llegar”); hoja de gestión con los 5 puntos generales; muro naranja con botón blanco;
  agenda sin scroll horizontal a 390 px (comprobado con un iframe de 390 px, que comparte la
  sesión de `localStorage` con la app).
- **Extra**: al abrir la app, las capas encendidas en las preferencias guardadas se recuperan
  también las que necesitan fuente propia (transporte). Antes, el interruptor de Metro podía
  quedar “encendido” sin datos en el mapa: había que apagarlo y volverlo a encender.

---

## 26. Fix de los iconos del metro + calibración del tamaño de icono (2026-11-26)

### Síntoma

Los iconos y rótulos del metro (`metro-estaciones-icono`, `metro-combo-icono`,
`metro-nombres`) existían en el estilo pero **no se renderizaban** en los zooms medios
(≥ 12,5), aunque `getZoom()` fuera 13–15.

### Causa raíz (dos capas del mismo fallo)

1. **404 de glifos → el worker rechaza el tile entero.** `metro-nombres` no declaraba
   `text-font`, así que MapLibre usaba el fontstack **por defecto**
   (`Open Sans Regular, Arial Unicode MS Regular`), que `tiles.openfreemap.org` **no sirve**
   (404). El error ocurría al construir el tile de la fuente `transporte-estaciones` → los
   tiles hijos (z12–z15) quedaban en estado `errored` (0 bytes) y **solo sobrevivía el tile
   padre z11**, que queda fuera del rango de las capas con `minzoom ≥ 12` → 0 features.
   Se comprobó en vivo: al añadir una capa de texto de prueba con el fontstack por defecto a
   una fuente sana, esa fuente pasó a 8 tiles `errored`; al quitarla, volvía a cargar.
2. **Umbrales de zoom.** Aunque los tiles cargaran, una capa `symbol` con `minzoom: 12.5`
   queda excluida de cualquier tile con zoom < 12,5 (umbral verificado exacto: 11,999 pinta,
   12,000 no).

**Fix aplicado** (`src/main.js`, `cargarTransporte`): `metro-nombres` ahora declara
`"text-font":["Noto Sans Regular"]` — el mismo fontstack que ya usa el estilo base
(OpenFreeMap `positron`) y el contador de clusters. No hace falta tocar el `minzoom`.

- **Regla para capas nuevas**: toda capa `symbol` con texto **debe** declarar `text-font`
  con un fontstack que el proveedor de tiles sirva (aquí: `Noto Sans Regular` /
  `Noto Sans Bold` / `Noto Sans Italic`). Sin `text-font` se cae al default → 404 →
  desaparecen TODAS las capas symbol de esa fuente, no solo la de texto.
- **Diagnóstico útil**: estados de tiles con
  `Object.values(map.style.sourceCaches[id]._tiles).forEach(t=>…t.state…)`
  (`loaded` / `errored`) y `t.latestRawTileData.byteLength` para ver si traen datos.

**Verificado en navegador** (`http://localhost:8080`, capa Metro encendida, zoom 14,5):
tiles `4 loaded / 0 errored`, `metro-estaciones-icono` + `metro-combo-icono` +
`metro-nombres` pintando (Parque Almagro, Toesca con combinación L5), **0 errores de
consola** (el 404 de glifos desapareció).

### Calibración del tamaño de icono (2026-11-26) — RESUELTA

Se usaron los medidores temporales de calibración (zoom 0–100 + tamaño de icono
0–20 px, mismas constantes que las capas) para leer `zoom real → px`:

| Zoom | Antes | Después |
|---|---|---|
| 12,5 (aparece) | 16 px | 16 px (`ICONO_MIN=0,25`) |
| 13,6 | 21,7 px | 19,5 px |
| 14,5 | 26,2 px | 22,8 px |
| 15 (meseta) | 28,8 px | **24 px** (`ICONO_MAX=0,375`) |

- El usuario eligió **techo de 24 px** para los iconos de las capas GeoJSON
  (metro y lugares): `ICONO_MAX` pasó de `0,45` a `0,375` (24/64 px; `icon-size`
  1 ≈ 64 px porque los SVG se rasterizan a 128 px con `pixelRatio: 2`).
- Los **marcadores HTML** (puntos propios y terminales) se bajaron al mismo
  techo: su rampa era 22 → 34 px y quedó en **16 → 24 px**
  (`interpolarRampa(z,[[ZOOM_ICONO,16],[ZOOM_ICONO_MAX,24]])`).
- **Medidor de tamaño ELIMINADO** tras calibrar (se borró el bloque HTML
  `#medidores-calibracion`, la función `pintarMedidores()` con su listener y los
  listeners `zoom`/`move` en la creación del mapa).
- **El medidor de zoom VOLVIÓ el 2026-11-26** (commit posterior) para calibrar
  los **3 umbrales de momento** de la rampa: barra de zoom (0–100 + zoom real) y
  tres filas con su marca de color (texto bajo icono · icono ↔ punto · punto
  desaparece). El usuario leyó los valores con él y **quedó eliminado en el §27**
  (mismo procedimiento que arriba: bloque HTML + `pintarMedidores()` + sus 2
  listeners + la llamada inicial).
- **`sw.js` → `CACHE_NAME` v8** (precache renovada: `index.html` y `main.js`
  cambiaron).

### Service worker

- `CACHE_NAME` → **v9** (el precache v8 guardaba `index.html`/`main.js` sin el
  medidor de zoom; la estrategia de red es network-first, pero el precache se
  renueva para uso offline).

---

## 27. Calibración de momentos de la rampa (2026-11-26, segundo lote)

Con el medidor de zoom (§26) el usuario indicó los momentos exactos y pidió
cinco ajustes en un solo lote:

| Pedido | Solución | Dónde |
|---|---|---|
| **1 · Texto bajo el icono**: nace en el corte círculo↔icono (12,5), más pequeño, y crece hasta el máximo actual (11 px) **en 2 saltos** | `TEXTO_MIN=9` → `TEXTO_MEDIO=10` (zoom 13,5) → `TEXTO_MAX=11` (zoom 14,5). En `metro-nombres`: `"text-size":["step",["zoom"],9,13.5,10,14.5,11]`; en los marcadores HTML: la variable `--nombre-tam` que fija `actualizarPuntosSegunZoom()` (CSS `font-size: var(--nombre-tam, 11px)`) | `src/main.js`, `styles.css` |
| **2 · Círculos en 3 saltos** al alejar (12,5 → 11,8 → 11) y **desaparecen en 10,5** | `ZOOM_PUNTO_MIN` 7 → **10,5**, `ZOOM_PUNTO_MEDIO` 9,5 → **11**, `ZOOM_PUNTO_MAX` 11 → **11,8**; radio 3,5 → 5 → 7 px con `["step",["zoom"],…]` y `minzoom:10.5` en las capas circle; en HTML la nueva `saltoRampa()` (equivalente JS de `step`) con `TAM_PUNTO_MIN/MEDIO/MAX` = 7/10/14 px. Vale para `-puntos-mini`, `-cluster`, estaciones y combinaciones del metro y MetroTren | `src/main.js` (constantes, `cargarLugares`, `cargarTransporte`, `actualizarPuntosSegunZoom`, `saltoRampa`) |
| **3 · Sin grupo con número**: si hay muchos cerca, **1 punto pequeño**; al acercar se deshace | Se borró la capa `${fuente}-cluster-count` (el número) y la burbuja `${fuente}-cluster` pasó a ser **un círculo más** con la misma rampa (`minzoom:10.5`, `maxzoom:12.5`, radio 3,5→5→7, color de la capa). El clic en el grupo sigue haciendo zoom a su contenido; el clustering sigue activo (`clusterRadius:52`, `clusterMaxZoom:12`) | `src/main.js` (`cargarLugares`, `aplicarCapas`) |
| **4 · Líneas del metro visibles alejadas y corte en 9,3** | `const ZOOM_LINEAS_METRO=9.3` y `minzoom:ZOOM_LINEAS_METRO` en `metro-lineas` y `metrotren-lineas`: se ven desde 9,3 hacia arriba (sobreviven a los puntos, que mueren en 10,5) y desaparecen por debajo | `src/main.js` (`cargarTransporte`) |
| **5 · Corte nítido de textos: 12,4 fuera, 12,5 dentro** | Todos los textos de icono usan el mismo corte `ZOOM_ICONO=12.5`: `metro-nombres` con `minzoom:12.5` y los marcadores HTML con `classList.toggle("map-point-con-nombre", z>=ZOOM_ICONO)` (también los puntos de "vista fija": conservan el icono, pero el nombre obedece al corte) | `src/main.js`, `styles.css` |

### Dos errores que salieron al probar

1. **`clusterMaxZoom` no admite decimales.** Se probó con `ZOOM_ICONO` (12,5) para
   que los grupos duraran hasta el icono y la fuente revienta con
   `Error: Invalid array length` (Supercluster hace `new Array(maxZoom+1)`).
   Quedó en **entero 12**: del zoom 12 al 12,5 los puntos se desagrupan como
   círculos y en 12,5 pasan a iconos. Hay una prueba que exige
   `clusterMaxZoom:\d+,clusterRadius`.
2. **`maxzoom` vs `minzoom` en las líneas.** Un corte con `maxzoom:9.3` esconde
   las líneas al **acercarse** (se pintan por debajo de 9,3), justo al revés de
   lo pedido: para desaparecer al **alejar** hace falta `minzoom:9.3`.

### Verificación

- `node scripts/verificar-mapa.mjs` → **207 pruebas · 0 fallos · 2 avisos**
  (bloque nuevo `[8]` con 16 comprobaciones; el test de la rampa del bloque `[7]`
  se adaptó al escalón en vez de la meseta lineal).
- **Navegador** (0 errores de consola, con las capas Metro/Parques/Salud/Seguridad
  encendidas y barrido de zoom por todos los cortes):
  | Zoom | Marcador HTML |
  |---|---|
  | 6 y 10,4 | oculto (desaparece por debajo de 10,5) |
  | 10,6 | punto **7 px** |
  | 11,5 | punto **10 px** |
  | 12,4 | punto **14 px**, **sin texto** |
  | 12,5 | icono 16 px + nombre **9 px** |
  | 13,5 | nombre **10 px** |
  | 14,5 y 16 | nombre **11 px** (meseta), icono 24 px |
  Capas leídas con `getLayer`/`getPaintProperty`: `-cluster` y `-puntos-mini`
  `min 10.5 / max 12.5` con `["step",["zoom"],3.5,11,5,11.8,7]`,
  `-cluster-count` **no existe**, `metro-lineas` `min 9.3`, `metro-nombres`
  `min 12.5` con `text-size ["step",["zoom"],9,13.5,10,14.5,11]`.
- **Medidor de zoom ELIMINADO** (ya no hace falta: los tres momentos están
  calibrados): bloque `#medidores-calibracion` de `index.html`,
  `pintarMedidores()` y sus listeners `zoom`/`move`.
- `sw.js` → **`CACHE_NAME` v10**.
