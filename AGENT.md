# AGENT.md — APP SANTIAGO 2026

> Documento de continuidad para agentes de programación. Léelo completo antes de modificar el repositorio.
> Última actualización: 2026-11-26.
>
> **Estado:** integración con Supabase **resuelta** (§13). Los dos fallos de la §8 están cerrados. Las **9 etapas de `UPDATE.md`** están completadas y documentadas en §29–§36 (Fase 7 cerrada el 2026-11-26). La jerarquía **ADMIN/MANAGER** se documenta en §37 (SQL 17).
> **`schema.sql`:** snapshot de la BD real del 2026-11-23 (§1–§8) **más** la sección 9 con el estado final de las migraciones 10–22. La fuente de verdad del esquema son los archivos `sql/`.

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
3. Los **botones del mapa a la derecha**, en **columna vertical**, **colapsables** en un único
   **botón superior derecho con flecha hacia abajo** (la columna se despliega hacia abajo).
4. **Iconos al acercar / punto de color al alejar**: el punto se achica hasta desaparecer.
   Todos los puntos menos los marcados como **fijos**. Al agregar un punto debe existir la
   opción de vista fija.
5. **Lupa colapsable arriba a la izquierda** que abre un input de búsqueda.

### Lo implementado

| Requisito | Implementación |
|---|---|
| Máximo espacio | `body.vista-mapa` (se activa en `gotoView("mapa")`): oculta `#app > header` y fija `#view-mapa` en `calc(100dvh - 4rem - safe-area)`; el marco pasó de `h-[62vh]` a `h-full` |
| Panel inferior colapsable | `#mapa-panel-toggle` (asa + flecha) pliega `#mapa-panel-cuerpo` (269 px → 58 px); `colapsarPanelMapa()` reabre el panel al seleccionar una actividad |
| Controles a la derecha y colapsables | `#map-controls-row` (**columna vertical** de 9 botones, todos con la misma X a la derecha) + `#map-controls-toggle` **arriba** con `keyboard_arrow_down` que rota 180° al desplegar (§28) |
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
| Zoom de puntos en **3 momentos** | Rampa escalonada (§27): `ZOOM_PUNTO_MIN=10,5` (desaparece), `ZOOM_PUNTO_MEDIO=11`, `ZOOM_PUNTO_MAX=11,8`, `ZOOM_ICONO=12,5`, `ZOOM_ICONO_MAX=15`; radio 2,975→4,25→5,95 px en 3 saltos (−15 % con `ESCALA_PUNTO`), `icon-size` 0,25→0,375 = 16→24 px y texto 9→10→11 px en 2 saltos | `src/main.js` (constantes, `cargarLugares`, `cargarTransporte`, `actualizarPuntosSegunZoom`) |
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
| **2 · Círculos en 3 saltos** al alejar (12,5 → 11,8 → 11) y **desaparecen en 10,5** | `ZOOM_PUNTO_MIN` 7 → **10,5**, `ZOOM_PUNTO_MEDIO` 9,5 → **11**, `ZOOM_PUNTO_MAX` 11 → **11,8**; radio con `["step",["zoom"],…]` y `minzoom:10.5` en las capas circle; en HTML la nueva `saltoRampa()` (equivalente JS de `step`). Vale para `-puntos-mini`, `-cluster`, estaciones y combinaciones del metro y MetroTren. Tamaños con el **−15 %** de la fila siguiente: radio 2,975 → 4,25 → 5,95 px y diámetro 5,95 → 8,5 → 11,9 px | `src/main.js` (constantes, `cargarLugares`, `cargarTransporte`, `actualizarPuntosSegunZoom`, `saltoRampa`) |
| **−15 % en los puntos** que reemplazan a los iconos (tarea del 2026-11-26) | Un solo factor **`ESCALA_PUNTO=0.85`** multiplica toda la rampa, así los 3 saltos bajan **proporcionalmente** y la forma no cambia: `RADIO_PUNTO_MIN/MEDIO/MAX` = 3,5/5/7 → **2,975/4,25/5,95 px** y `TAM_PUNTO_MIN/MEDIO/MAX` = 7/10/14 → **5,95/8,5/11,9 px**. También los ajustes ± entre capas del metro (±1 → ±0,85 px) y los pines de actividad (`TAM_PIN_MIN/MAX` = 12/24 → **10,2/20,4 px**, para no despegar la proporción). **No** se tocan los iconos (siguen 16→24 px) ni el texto (9→11 px) | `src/main.js` (constantes, `cargarTransporte`, `actualizarPuntosSegunZoom`) |
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

- `node scripts/verificar-mapa.mjs` → **210 pruebas · 0 fallos · 2 avisos**
  (bloque nuevo `[8]` con 19 comprobaciones —entre ellas `ESCALA_PUNTO=0.85` y el
  escalón de la rampa—; el test de la rampa del bloque `[7]` se adaptó al escalón en
  vez de la meseta lineal).
- **Navegador** (0 errores de consola, con las capas Metro/Parques/Salud/Seguridad
  encendidas y barrido de zoom por todos los cortes):
  | Zoom | Marcador HTML |
  |---|---|
  | 6 y 10,4 | oculto (desaparece por debajo de 10,5) |
  | 10,6 | punto **5,95 px** |
  | 11,5 | punto **8,5 px** |
  | 12,4 | punto **11,9 px**, **sin texto** |
  | 12,5 | icono 16 px + nombre **9 px** |
  | 13,5 | nombre **10 px** |
  | 14,5 y 16 | nombre **11 px** (meseta), icono 24 px |
  Capas leídas con `getLayer`/`getPaintProperty`: `-cluster` y `-puntos-mini`
  `min 10.5 / max 12.5` con `["step",["zoom"],2.975,11,4.25,11.8,5.95]`,
  `-cluster-count` **no existe**, `metro-lineas` `min 9.3`, `metro-nombres`
  `min 12.5` con `text-size ["step",["zoom"],9,13.5,10,14.5,11]`.
- **Medidor de zoom ELIMINADO** (ya no hace falta: los tres momentos están
  calibrados): bloque `#medidores-calibracion` de `index.html`,
  `pintarMedidores()` y sus listeners `zoom`/`move`.
- `sw.js` → **`CACHE_NAME` v12** (v10 fue el lote de calibración, v11 el del −15 % y
  v12 el de la columna vertical de los controles, §28).

## 28. Controles del mapa en columna vertical (2026-11-26)

| Pedido | Solución | Archivos |
|---|---|---|
| Los botones del mapa que colapsan con un botón deben estar **ordenados verticalmente a la derecha** | `#map-controls` pasa de `flex items-start gap-2` a **`flex flex-col items-end gap-1.5`** y `#map-controls-row` de `flex flex-wrap-reverse justify-end` a **`flex flex-col items-end`**: los 9 botones (acercar, alejar, centrar, GPS, satélite, capas, pantalla completa, agregar punto, gestionar puntos) quedan **apilados hacia abajo**, todos con la **misma X** (derecha). El **botón de colapso va ARRIBA** de la columna (`#map-controls-toggle` antes de `#map-controls-row`), así la flecha `keyboard_arrow_down` apunta al contenido que se despliega y rota 180° al abrir | `index.html` |
| — | La columna lleva `max-h-[calc(100dvh-7rem)] overflow-y-auto no-scrollbar` para que en pantallas bajas no se salga de la pantalla | `index.html` |
| — | El JS del toggle **no cambia** (misma lógica `hidden` + `aria-expanded` + `rotate-180`): solo cambia el orden en el HTML | `src/main.js` (sin cambios) |
| — | 5 comprobaciones nuevas en el verificador: `flex flex-col` en la fila, `flex flex-col items-end` en el conjunto, el toggle **antes** de la fila en el HTML, `max-h` de la columna y el `absolute right-3 top-3` | `scripts/verificar-mapa.mjs` |

**Verificación**
- `node scripts/verificar-mapa.mjs` → **214 pruebas · 0 fallos · 2 avisos**.
- Navegador (medido con `getBoundingClientRect`): toggle en (856, 12) de 44 × 44 px;
  desplegado, los 9 botones quedan en **x = 860** (todos iguales), en y = 62, 108, 154,
  200, 246, 292, 338, 384 y 430 (46 px de paso: 40 px de botón + 6 px de separación),
  todos **por debajo** del botón de colapso. Colapsado solo queda el toggle
  (`display:none` en la fila, `aria-expanded="false"`, flecha `keyboard_arrow_down`).
  **0 errores de consola**.
- `sw.js` → **`CACHE_NAME` v12**.

## 29. Fase 1 de `UPDATE.md`: grupos, login por grupo y RLS (2026-11-26)

> ⚠️ El **login con selector de grupo** de esta sección fue reemplazado por el flujo del §30
> (usuario + contraseña, grupo automático + registro con contraseña de grupo). El resto
> (grupos, RLS por grupo y filtros de consultas) sigue vigente.

Primera fase del plan de `UPDATE.md` (Etapas 1 y 2). Decisiones acordadas con el usuario:

- **Grupo en el login**: se modifica la Edge Function y se valida `(usuario, grupo)` **antes**
  de autenticar; el cliente además revalida la pertenencia (defensa en profundidad).
- La gestión individual de puntos será solo sobre `map_points` (Fase 2).
- La categoría JW usará `salon.svg` por defecto (el selector permite `trebol`, `betel` y
  `exhibidor`).
- SOS abrirá en pestaña nueva; las actividades siguen siendo solo de administradores.

### SQL (ejecutar en este orden)

| Archivo | Qué hace |
|---|---|
| `sql/10_grupos.sql` | `public.groups` + grupo `principal`; `profiles.group_id` (NOT NULL) y `group_admin`; `group_id` en `events`, `activities` y `wall_posts` con backfill e `NOT NULL`; triggers que rellenan `group_id` al insertar (compatibilidad con el frontend anterior); `handle_new_user()` con grupo; helpers `auth_group()`, `can_manage_group(g)` y la RPC `grupos_publicos()` (anon); GRANT de `groups` a `authenticated` y `service_role`. |
| `sql/11_rls_grupos.sql` | Deroga y recrea **todas** las políticas de `groups`, `profiles`, `events`, `activities`, `activity_assignments`, `activity_user_details`, `activity_attachments` y `wall_posts` por grupo. Lectura `group_id = auth_group()`; escritura `can_manage_group(group_id)` (admin global o admin de su grupo). `emergency_contacts` sigue global. |

### Edge Function

- Nueva en el repo: `supabase/functions/login-username/index.ts` (antes solo estaba
  desplegada en Supabase).
- `POST { username, password, group }`; el grupo se resuelve por slug o uuid y **se valida
  antes** de `signInWithPassword`. Errores: 400 grupo inválido, 401 credenciales,
  403 usuario desactivado o de otro grupo.
- Requiere `sql/10` (GRANT de `groups` a `service_role`) y **Verify JWT desactivado**.
- Instrucciones y contrato en `supabase/functions/login-username/README.md`.

### Frontend

- `index.html`: selector `#login-group` (required) y chip `#group-label` en el header.
- `src/main.js`: `cargarGruposLogin()` (RPC → fallback), `usernameLogin(..., group)`,
  revalidación tras el login, `state.groupId` y el helper `filtrarGrupo()` aplicado a
  `events`, `activities`, `wall_posts` y a los inserts (el trigger también rellena).
- **Compatibilidad**: si `sql/10` no está aplicado, la app entra en "modo compatibilidad"
  (un único grupo `principal`) y el login sigue funcionando; `loadProfile()` reintenta sin
  las columnas de grupo.

### Verificación

- `node scripts/verificar-mapa.mjs` → **242 pruebas · 0 fallos · 2 avisos** (bloque nuevo
  `[9]` con 28 comprobaciones).
- Navegador **antes** de aplicar el SQL: modo compatibilidad visible, login y agenda/muro
  funcionando. Los dos errores de red de la consola son el sondeo de la RPC y la consulta de
  columnas; desaparecen al ejecutar `sql/10`.
- `sw.js` → **v13**.

### Pendiente de esta fase

1. Ejecutar `sql/10_grupos.sql` → `sql/11_rls_grupos.sql` en Supabase.
2. Desplegar `login-username` con el código nuevo (Verify JWT off).
3. Probar: login con el grupo correcto/incorrecto, y que un usuario del grupo B no vea
   agenda, muro ni puntos del A (también por REST).
4. `schema.sql` queda desactualizado respecto a `sql/10`/`11` (se regenerará en la Fase 7).

## 30. Nuevo flujo de acceso y registro de perfiles (2026-11-26)

Reemplaza el login con selector de grupo del §29. La separación por grupo (§29 + `sql/11`) se
mantiene intacta.

### Decisiones del usuario

- **Usuario único global**: no se permite el mismo nombre en dos grupos. La prueba 8 del
  documento de acceso (“dos grupos pueden tener el mismo nombre”) **NO aplica por esta
  decisión**; el registro rechaza el nombre en cualquier grupo y ofrece alternativas.
- La contraseña de grupo se administra desde SQL o por una RPC de admin (no hay UI todavía).
- El nombre de usuario se guarda en **minúsculas**; `full_name` conserva lo escrito y es el
  nombre visible.
- El registro pide **solo usuario + contraseña** (sin nombre para mostrar aparte).
- Se autorizó crear un perfil de prueba para la verificación.

### SQL (`sql/14_registro_perfiles.sql`)

- `groups.join_password_hash` (bcrypt con `pgcrypto`; nunca en claro).
- `definir_password_grupo(slug, password)`: admin global, admin del grupo o SQL Editor;
  guarda `crypt(password, gen_salt('bf',10))`.
- `verificar_password_grupo(slug, password)`: compara con `crypt()`; **solo `service_role`**
  (la Edge Function). Ni `anon` ni `authenticated` pueden llamarla.
- `grupos_para_registro()` (anon): `id, slug, name, abierto` (`abierto` = tiene contraseña).
- GRANT **por columna** en `groups`: `authenticated` puede leer los metadatos y actualizar solo
  `slug/name/description/active`; **no** lee ni escribe `join_password_hash`. `service_role`
  conserva el acceso completo.
- Se conserva `profiles_username_key` (global) y se agrega el índice único
  `profiles_username_lower_key` sobre `lower(username)`.
- Trigger `profiles_proteger_identidad`: un usuario no puede cambiar su `username` ni su
  `group_id` (solo admin/`service_role`).

### Edge Functions

- **`login-username` v2**: `POST {username,password}`; busca el perfil por usuario (único
  global), detecta el grupo del perfil y autentica. `404 USER_NOT_FOUND` para ofrecer el
  registro; `401` contraseña; `403` usuario/grupo inactivo. El campo `group` de versiones
  anteriores se ignora.
- **`register-profile`** (nueva): acciones `validar-grupo`, `sugerir-usuario` y `registrar`.
  - Verifica la contraseña de grupo con la RPC (bcrypt, sin exponer el hash).
  - `registrar` crea el usuario en Supabase Auth con email sintético
    (`uuid@usuarios.appsantiago2026.cl`, `email_confirm:true`) y metadatos
    `{ username, full_name, group_id }`; `handle_new_user` crea el perfil.
  - Si el nombre está tomado (o hay una carrera contra el índice único) devuelve
    `409 { code:"USERNAME_TAKEN", sugerencias }`; las alternativas se comprueban antes de
    mostrarlas y el usuario debe confirmar.
  - Devuelve la sesión para entrar directo.

### Frontend

- Login: **usuario + contraseña** (sin grupo). Si el servidor responde `USER_NOT_FOUND`, se
  abre el registro con el usuario precargado.
- Registro progresivo:
  1. grupo + contraseña del grupo + “Validar grupo”;
  2. usuario + contraseña personal + confirmación + “Crear perfil”;
  3. si el nombre está tomado, chips con alternativas (sin autoasignar).
- `cargarGruposRegistro()` usa `grupos_para_registro()` con respaldo en `grupos_publicos()`.
- `loadProfile`, `state.groupId` y `filtrarGrupo()` no cambian: agenda, muro y puntos siguen
  filtrados por el grupo del perfil.

### Verificación

- `node scripts/verificar-mapa.mjs` → **267 pruebas · 0 fallos · 2 avisos** (bloque `[9]`
  con **53 comprobaciones**, incluida la limpieza de la agenda al cambiar de grupo).
- **En vivo (2026-11-26)**:
  - `test` entró sin grupo → grupo `principal`; `test1` (perfil de prueba) se registró en el
    grupo temporal `prueba_acceso` y reingresó sin grupo → grupo detectado.
  - Contraseña mala → 401, sin ofrecer registro; usuario inexistente → 404 + panel de registro
    con el usuario precargado.
  - Contraseña de grupo mala → 403; correcta → paso 2; nombre `test` tomado → 409 con
    `test1…test5` (el chip solo rellena el campo; no crea solo).
  - RLS con el token de `test1` (usuario normal del grupo B): `events`, `activities` y
    `wall_posts` → **0 filas**; el evento del principal consultado por ID → **0 filas**;
    `profiles` → solo su perfil.
  - Fix: al cambiar a un grupo sin evento se limpian los días y se oculta la tarjeta del día
    activo (antes quedaba el DOM del grupo anterior).
- **Pendiente de limpieza**: borrar el perfil de prueba `test1` (Dashboard → Authentication →
  Users) y después el grupo temporal:
  `delete from public.groups where slug = 'prueba_acceso';`.
- **Pendiente**: publicar el frontend (los dos Edge Functions ya están desplegados y el login
  v2 funciona).

### Orden de despliegue (estado 2026-11-26)

1. ✅ `sql/14_registro_perfiles.sql` aplicado (se corrigió el `search_path` de `crypt` y se fijó
   la contraseña de grupo).
2. ✅ `login-username` (v2) y `register-profile` desplegadas con **Verify JWT desactivado**.
3. ⏳ Publicar el frontend nuevo (push a `main`): el login viejo exige grupo; el nuevo no lo
   envía, así que el frontend va al final.

---

## 31. Fase 2 de `UPDATE.md`: categorías, colores y alcance de puntos (2026-11-26)

Cubre las Etapas 3 y 7 del documento: gestión individual por categoría, color de cada
categoría y visibilidad global/grupo.

### SQL (`sql/15_categorias_puntos.sql`)

- `public.map_categories`: `slug` (PK), `name`, `icon`, `color` (#rrggbb), `sort`, `active`.
  Semilla: `general`, `mall`, `policia`, `bomberos`, `hospital`, `centro_salud`, `metro`,
  `parque`, `kiosco`, `expositor`, `otros` y `jw`.
- `map_points.category` deja de ser un CHECK y pasa a **FK** a `map_categories`. Se
  **conservan** las categorías antiguas (seguridad, salud, educación, transporte, comercio,
  áreas verdes, otro) además de las nuevas; **ningún punto se renombra** (los 4 terminales de
  buses siguen en `transporte`).
- `map_points.group_id` + `map_points.scope` (`global`/`group`). Los puntos generales
  existentes (terminales, referencias) quedan **globales**; los personales, en el grupo de
  su autor. Trigger `asignar_grupo_punto` para compatibilidad con el cliente anterior.
- RLS: lectura por `scope='global'` o `group_id=auth_group()`; el autor gestiona sus
  personales; el admin de grupo modera los personales/generales de **su** grupo; el admin
  global modera todo. El admin de grupo no puede crear puntos globales.
- `map_categories`: lectura para autenticados; escritura solo admin global.

### Frontend

- `cargarCategorias()` lee `map_categories` (con respaldo al catálogo antiguo si falta el SQL).
- `colorCategoria()` / `colorDeCapa()`: el punto circular y las capas GeoJSON (parques,
  comercio, salud, seguridad, bomberos, servicios, metro y MetroTren) usan el color de su
  categoría. `aplicarColoresCategorias()` actualiza las capas ya cargadas al guardar un color.
- Formulario de punto: categoría dinámica, icono por defecto de la categoría, **alcance**
  (`global`/`grupo`) y **grupo** (el admin global elige; el admin de grupo queda fijo en el
  suyo). Los usuarios normales solo crean puntos **personales** y el botón de alta queda
  visible para todos los autenticados.
- Gestión (`#puntos-sheet`): lista de categorías con `visibles/total` y selector de color
  (solo admin global) → detalle con **buscador**, **seleccionar todos / deseleccionar todos**,
  **contador**, renombrar, **ubicar en el mapa** y borrar. Guardado en bloque (visibilidad,
  nombres, colores y borrados).
- El admin ve atenuados (`.map-point-oculto-admin`) los puntos deshabilitados, para ubicarlos;
  los usuarios normales no los reciben.

### Verificación

- `node scripts/verificar-mapa.mjs` → **292 pruebas · 0 fallos · 2 avisos** (bloque `[10]`
  con 27 comprobaciones).
- Navegador **antes** de aplicar `sql/15`: modo respaldo con el catálogo antiguo, 6 puntos
  (2 generales + 4 terminales en Transporte), hoja de gestión con conteos `2/2` y `4/4`,
  buscador (`sur` → 1), seleccionar/deseleccionar y contador, formulario con alcance/grupo,
  **0 errores JS** (el 404 es la tabla `map_categories` aún no creada).
- **En vivo con `sql/15` aplicado**:
  - **19 categorías** (12 nuevas + 7 conservadas); los 4 terminales siguen en `transporte`.
  - Color de `transporte` cambiado a `#ff00ff`: guardado, aplicado a los 4 marcadores y
    **persistente tras recargar**; revertido a `#0f7fd4`.
  - Terminal Alameda desactivado: contador `3/4`, marcador **atenuado** para el admin,
    persistente; reactivado.
  - Punto **Kiosco** (grupo principal) creado con icono `store` y color `#7048e8`, visible en
    la categoría `1/1`, y **borrado** (vuelve a 6 puntos).
  - Metro `#f2b705` y parques `#2e9e4f` leídos con `getPaintProperty` en las capas externas.
  - **Detalle corregido**: los puntos globales conservaban el `group_id` del autor (la
    visibilidad era correcta, el dato no). Se agregó `group_id=null where scope='global'` y
    `puntoGestionable()` exige que el punto no sea global. **Re-ejecutar `sql/15`** (o el
    `update` de limpieza) para corregir los datos.
- **Pendiente**: RLS de puntos con un **usuario normal** y con un **admin de grupo** (tras la
  limpieza solo quedan `admin` y `test`, ambos admins globales).
- `sw.js` → **v16**.

### Pendiente

1. ✅ `group_id` de los puntos globales limpiado vía API admin: **6/6 globales con `group_id = null`**.
2. Probar la RLS de puntos con un usuario normal y con un admin de grupo (crear uno temporal
   si se quiere verificar en vivo; los únicos perfiles actuales son admins globales).
3. `schema.sql` sigue desactualizado (se regenerará en la Fase 7 del plan).

---

## 32. Fase 3 de `UPDATE.md`: categoría JW y actividades (2026-11-26)

Cubre la Etapa 4: categoría JW, su tamaño especial, el vínculo con actividades y el flujo
“Marcar actividad en el mapa”.

### SQL (`sql/16_jw_actividades.sql`)

- `activities.map_point_id` (FK a `map_points`, `ON DELETE SET NULL`) + índice.
- Trigger `validar_punto_actividad`: el punto debe existir, ser de categoría `jw` y, si es de
  grupo, pertenecer al mismo grupo que la actividad (los globales valen para todos).
- Elimina el **CHECK antiguo `map_points_icon_check`**: no conocía los SVG nuevos (`salon`,
  `betel`, `predicación`, `exhibidor`, …) y bloqueaba el icono por defecto de JW. El catálogo
  de iconos lo valida la app (`ICONOS_MAPA`).

### Frontend

- **Marcadores JW**: siempre icono (nunca se convierten en punto de color, ni por debajo del
  zoom 10,5) y **20 % más grandes** (19,2 px al aparecer → 28,8 px al máximo; el resto
  16 → 24). El nombre sigue el corte nítido de 12,5.
- **Popup JW**: además de la categoría/alcance, lista las actividades vinculadas.
- **Formulario de actividad**: se reemplazaron latitud/longitud por un **selector de punto
  JW** con vista previa (nombre, dirección, comuna, coordenadas). La ubicación de la actividad
  se copia del punto. Al editar una actividad antigua sin punto JW se conservan sus
  coordenadas.
- **Sin puntos JW**: aparece el botón **“Marcar actividad en el mapa”**; cierra la actividad,
  activa el modo punto con categoría JW y, al guardar el punto, vuelve a abrir la actividad
  con el punto recién creado seleccionado y los datos ya escritos.
- **Ver en mapa** en todas las tarjetas de actividad: lleva al mapa, vuela al punto JW (o a
  las coordenadas de la actividad) y abre el popup del punto.
- **Botones de las tarjetas**: se unificó el enlazado (`enlazarTarjetasActividad`) para el
  diseño nuevo de días; antes los botones Editar/Cancelar/etc. solo se enlazaban en el
  fallback.
- `loadEventAndActivities` refresca los popups de los puntos JW para mostrar sus actividades.

### Verificación

- `node scripts/verificar-mapa.mjs` → **310 pruebas · 0 fallos · 2 avisos** (bloque `[11]`
  con 18 comprobaciones).
- Navegador **antes** de aplicar `sql/16`: el formulario de actividad muestra el selector JW
  y el estado “sin puntos JW”, sin lat/lng; “Editar” funciona en el diseño nuevo; “Ver en
  mapa” abre la vista de mapa; el flujo “Marcar actividad en el mapa” abre el formulario de
  punto con categoría **JW**, icono `salon` y alcance grupo. **0 errores JS**.
- **En vivo con `sql/16` aplicado**:
  - Punto JW creado y actividad “Actividad prueba JW” vinculada: `map_point_id` guardado y
    lat/lng copiadas del punto.
  - Trigger: intentar vincular un terminal (`transporte`) devuelve `400 / 23514` “La actividad
    debe usar un punto de categoría JW”; el vínculo JW no cambia.
  - JW **+20 %**: 19,2 px en el zoom 12,5, 28,8 px en 15 y 19,2 px en 6; a zoom 6 el JW sigue
    visible (`display:flex`) mientras los demás puntos están ocultos.
  - **Popup JW**: lista “Actividades: Actividad prueba JW”; “Ver en mapa” lleva al mapa,
    cierra popups previos y abre el del JW (zoom 15 cuando el navegador anima).
  - **Flujo completo** “Marcar actividad en el mapa”: crear punto → reabrir la actividad con
    el punto seleccionado → guardar la actividad.
  - Artefactos de prueba borrados: vuelven las **5 actividades** y los **6 puntos**; JW 0/0.
- **Hallazgos corregidos**: `map_points_icon_check` no permitía `salon` (se elimina en
  `sql/16` y `sql/15`); `verActividadEnMapa` cerraba el popup si ya estaba abierto (ahora solo
  lo abre si está cerrado); los botones de las tarjetas del diseño nuevo ya se enlazan.
- `sw.js` → **v18**.

### Pendiente

1. RLS con un usuario normal y un admin de grupo (solo existen admins globales).
2. `schema.sql` desactualizado (se regenerará en la Fase 7 del plan).

---

## 33. Fase 4 de `UPDATE.md`: evento general editable (2026-11-26)

Cubre la Etapa 5. **No requiere SQL nuevo**: `events.group_id` (sql/10) y la política
`"Admin o admin de grupo gestiona eventos"` (sql/11) ya existían.

### Frontend

- Botón **`#event-edit-btn`** (lápiz) en la banda del evento, visible para admin global y
  admin de grupo (`esAdminDeGrupo()`).
- Diálogo **`#event-dialog`**: nombre, descripción, fecha de inicio y de término. Si no hay
  evento, el mismo diálogo permite **crear** uno (por defecto hoy → +7 días).
- Al guardar: `update` si existe o `insert` publicado con `group_id` y `created_by`;
  validaciones de nombre, fechas y `término ≥ inicio`; recarga la agenda (`loadEventAndActivities`).
- La banda, el rango (“23 nov – 30 nov, 2026”), el badge “Día X de Y” y la descripción se
  actualizan al guardar y persisten tras recargar.
- Las actividades siguen ligadas por `event_id`; no se modifican al editar el evento.

### Verificación

- `node scripts/verificar-mapa.mjs` → **319 pruebas · 0 fallos · 2 avisos** (bloque `[12]`
  con 9 comprobaciones).
- En vivo: se editó el nombre/descripción y el término (30 nov → 1 dic); la banda pasó a
  **“23 nov – 1 dic, 2026”** y **“Día 4 de 9”**, persistió tras recargar; la validación
  `término < inicio` mostró el error y **no guardó**; se restauró el evento original
  (“Evento de prueba APP SANTIAGO 2026”, 23–30 nov, “Día 4 de 8”). **0 errores JS**.
- `sw.js` → **v19**.

### Pendiente

1. Probar el alta de un evento cuando no hay ninguno (la ruta `insert` está cubierta por el
   verificador; en vivo hay un evento).
2. RLS con admin de grupo / usuario normal (solo hay admins globales).
3. `schema.sql` desactualizado (Fase 7).

---

## 34. Fase 5 de `UPDATE.md`: agenda completa, FAB y SOS (2026-11-26)

Cubre la Etapa 6. **Sin SQL nuevo.**

### Agenda

- **Filtro Mis/Todas eliminado** (HTML, CSS y JS): la agenda muestra directamente todas las
  actividades del grupo.
- **Todos los días del evento**: se recorre `start_date → end_date` con `sumarDias()`. Los
  días pasados y futuros quedan compactos; **hoy** se muestra expandido; todos son
  expandibles. Los días sin actividades aparecen con “Sin actividades” y, al abrir,
  “Sin actividades registradas.”.
- El **mes** y el **subtítulo** del día activo son dinámicos (antes “OCT” y una frase fija).
- **Bug corregido**: `dt<today` comparaba un `Date` con un string (siempre `false`), así que
  los días pasados se pintaban como próximos. Ahora `isPast = date < today`.
- La agenda reserva espacio inferior (`pb-28`) para el FAB.

### FAB y SOS

- **FAB “Nueva actividad”**: circular de 56 px, fijo abajo-derecha, sobre la barra de
  navegación (`bottom: calc(4.5rem + env(safe-area-inset-bottom))`), visible solo para admin.
  Reemplaza el botón de texto anterior.
- **SOS flotante**: enlace circular de 64 px, fijo abajo-izquierda, `#F25050`, megáfono + “SOS”,
  visible en todas las vistas de la app. Abre `EMERGENCY_URL` en **pestaña nueva**
  (`target="_blank" rel="noopener"`; `href` desde `config.js`).
- El **botón grande de Emergencia** también abre la URL (`abrirEmergencia()` con
  `window.open` y fallback); el texto se actualizó.
- El FAB y el SOS no se solapan: quedan 8 px sobre la barra, uno a cada lado.

### Verificación

- `node scripts/verificar-mapa.mjs` → **331 pruebas · 0 fallos · 2 avisos** (bloque `[13]`
  con 12 comprobaciones).
- En vivo: **3 días pasados** (23, 24, 25), **hoy 26 expandido** y **4 futuros** (27–30);
  el 25 (0 actividades) expande “Sin actividades registradas.”; el FAB abre la actividad;
  FAB/SOS 8 px sobre la nav, derecha/izquierda, sin solape; SOS con `href`, `_blank` y
  `noopener`; el botón grande llama a la URL; **0 errores JS**.
- `sw.js` → **v20**.

### Pendiente

1. RLS con admin de grupo / usuario normal (solo hay admins globales).
2. `schema.sql` desactualizado (Fase 7).

---

## 35. Fase 6 de `UPDATE.md`: animaciones JW (2026-11-26)

Cubre la Etapa 8. **Sin SQL nuevo.**

### Módulo puro (`src/jw-tiempo.js`)

- `ahoraChile(fecha)` → `{ fecha, hora, iso }` con `Intl` en `America/Santiago` y
  `hourCycle:"h23"`: la hora de pared de Chile, sin depender de la zona del dispositivo.
- `estadoJW(actividades, ahoraIso)` → `destello` / `latido` / `null`:
  - **latido**: desde 30 min antes del inicio (incluido) hasta el inicio.
  - **destello**: desde el inicio hasta **30 min después del término**.
  - **8.1**: actividad programada para **hoy** y aún fuera de la ventana de latido →
    destello.
  - **8.3**: después del +30 se deja de destacar y se pasa a la **siguiente** actividad de
    hoy; si no hay otra, el punto deja de animarse.
  - Canceladas o sin hora de inicio se ignoran.
  - Compara **hora de pared** (`Date.UTC` sobre los strings), no offsets: evita desfases por
    zona horaria/DST.

### Frontend

- `aplicarEstadoJW()` recorre los marcadores JW, arma las actividades de cada punto
  (`map_point_id`) y aplica las clases `.jw-destello` / `.jw-latido` + `dataset.jwEstado`.
- Un `setInterval(…, 60000)` actualiza sin recargar y **sin consultar Supabase**; también se
  aplica al renderizar los puntos y al recargar las actividades.
- **En su lugar**: el marcador raíz lo posiciona MapLibre con `transform`; por eso la
  animación se aplica a un **icono interior** (`.map-point-jw-anim`,
  `position:absolute; inset:0; transform-origin:50% 50%`) y **nunca al marcador**. El icono se
  infla/desinfla alrededor de su centro; el marcador no se desplaza.
- CSS: `@keyframes jw-destello` (`transform: scale(1.08)` + halo ámbar) y `jw-latido`
  (`transform: scale(1.22/1.14)`, tipo corazón), con `prefers-reduced-motion`.

### Verificación

- `node scripts/verificar-mapa.mjs` → **352 pruebas · 0 fallos · 2 avisos** (bloque `[14]`
  con 21 comprobaciones; importa el módulo puro y prueba −30, inicio, +30, siguiente, otro
  día, cancelada, UTC−3 y que la animación va en el icono interior con origen centrado).
- En vivo: actividad a **14 min** del inicio → `jw-latido` (animación `jw-latido`, icono
  24,3 px); editada a **en curso** (12:00–12:30) → `jw-destello` (animación `jw-destello`).
  Comprobado que el marcador raíz tiene `animation-name: none` y su `transform` es solo la
  posición de MapLibre; el icono interior (`jw-latido`/`jw-destello`) escala con
  `transform: scale(...)` y **el mismo centro** (691,331) → se infla en su lugar.
  Artefactos borrados: 5 actividades, 6 puntos, JW 0/0. **0 errores JS**.
- `sw.js` → **v22**.

### Pendiente

1. El corte tras el +30 y el paso a la siguiente están cubiertos por las pruebas puras; en
   vivo requeriría esperar la hora.
2. RLS con admin de grupo / usuario normal (solo hay admins globales).
3. `schema.sql` desactualizado (Fase 7).

---

## 36. Fase 7 de `UPDATE.md`: cierre, validación y entrega (2026-11-26)

### Resumen de cambios

Se completaron las 9 etapas de `UPDATE.md` **sin cambiar la arquitectura** (JS Vanilla +
MapLibre 4.7.1 + Supabase + GitHub Pages):

- **§29–§30** · Grupos, RLS por grupo, login por usuario+contraseña con grupo automático y
  registro progresivo con contraseña de grupo (usuario único **global**, decisión del
  usuario; la prueba 8 del documento de acceso no aplica).
- **§31** · Categorías de puntos (nuevas + antiguas conservadas), color por categoría,
  gestión individual por categoría y alcance global/grupo.
- **§32** · Categoría **JW**: siempre icono, +20 %, popup con actividades y flujo “Marcar
  actividad en el mapa”.
- **§33** · Evento general editable (nombre, descripción, fechas) por grupo.
- **§34** · Agenda con **todos los días** del evento, sin filtro Mis/Todas, FAB de nueva
  actividad y SOS flotante.
- **§35** · Animaciones JW (destello/latido) con hora de Chile, cada 60 s y **en su lugar**
  (icono interior con origen centrado, no el marcador).
- **Fase 7** · Validación, consolidación de `schema.sql`, documentación y entrega.

### Tablas creadas/modificadas

| Tabla | Cambio |
|---|---|
| `groups` | **Nueva** (`sql/10`): `id`, `slug` único, `name`, `description`, `active`. |
| `map_categories` | **Nueva** (`sql/15`): `slug` PK, `name`, `icon`, `color` (#rrggbb), `sort`, `active`. |
| `profiles` | `group_id` (NOT NULL, FK), `role` (`admin`/`manager`/`user`); índice `group_id`; índice único `lower(username)`; trigger de identidad. |
| `events` | `group_id` (NOT NULL, FK), backfill; políticas por grupo. |
| `activities` | `group_id` (NOT NULL, FK), `map_point_id` (FK `ON DELETE SET NULL`); trigger que exige categoría JW y grupo/global. |
| `wall_posts` | `group_id` (NOT NULL, FK), políticas por grupo. |
| `map_points` | `group_id`, `scope` (`global`/`group`), `category` como FK a `map_categories`; trigger de compatibilidad; RLS por alcance; CHECK antiguo de iconos eliminado. |

### Migraciones SQL (orden de ejecución)

`sql/06_map_points.sql` → `07_terminales.sql` → `08_puntos_fijos.sql` (si aplica) →
`09_admin_gestiona_puntos.sql` → `10_grupos.sql` → `11_rls_grupos.sql` →
`14_registro_perfiles.sql` → `15_categorias_puntos.sql` → `16_jw_actividades.sql` →
`17_admin_manager.sql` → `18_endurecer_grupos.sql` → `19_subcategorias_capas.sql` →
`20_jw_subcategorias.sql` → `21_salud_hospital_sapu.sql` → `22_categorias_eliminables.sql`.

Todas son idempotentes. La Fase 7 **no agrega migraciones**: el esquema final se documenta
en `schema.sql` (sección 9) y en los archivos anteriores. `sql/17` es la migración de la
jerarquía ADMIN/MANAGER (posterior a la Fase 7).

### Edge Functions

- `login-username` (v2): login por usuario + contraseña; `404 USER_NOT_FOUND` para ofrecer el
  registro; grupo automático.
- `register-profile` (nueva): `validar-grupo`, `sugerir-usuario`, `registrar`; contraseña de
  grupo con bcrypt en la BD; crea el usuario en Auth y devuelve la sesión.
- Ambas con **Verify JWT desactivado** y las variables `APP_SUPABASE_*`.

### RLS implementadas

- **Grupos/acceso**: `groups` (miembros/admin), `profiles` (mismo grupo/self/admin),
  `events`, `activities`, `activity_assignments`, `activity_user_details`,
  `activity_attachments` y `wall_posts` por `group_id = auth_group()`; escritura por
  `can_manage_group()`; trigger que impide cambiar `username`/`group_id` a los no admin.
- **Puntos**: lectura por grupo/global; autor para personales; admin de grupo para su grupo;
  admin global para todo; el admin de grupo no puede crear puntos globales.
- **Categorías**: lectura para autenticados; escritura solo admin global.
- **Pendiente de verificación en vivo** (no se marca como completado): acceso con un usuario
  normal y con un admin de grupo (hoy solo existen `admin` y `test`, ambos globales).

### Validación §9 del documento (`UPDATE.md`)

| Bloque | Estado |
|---|---|
| 9.1 Grupos | ✅ Grupos creados, pertenencia, login y separación de agenda/muro; ⏳ RLS de puntos con usuario normal. |
| 9.2 Mapa | ✅ Filtros de categorías intactos, gestión individual, persistencia, globales/de grupo, admin de grupo en UI/RLS; ⏳ prueba con usuario normal. |
| 9.3 JW | ✅ Puntos JW creados/gestionados, actividades vinculadas, “Marcar en el mapa”, ubicación y visualización. |
| 9.4 Agenda | ✅ Evento editable, actividades por evento, filtro eliminado, FAB, días pasados visibles, hoy expandido, compactos y expandibles. |
| 9.5 Animaciones | ✅ Destello hoy/en curso/+30, latido −30, siguiente, zona horaria (pruebas puras); el +30 en vivo queda cubierto por las pruebas. |
| 9.6 Entrega | ✅ Este apartado + `PRUEBAS.md` + `DOCUMENTACION-MAPA.md` + `README.md`. |

### Pruebas

- `node scripts/verificar-mapa.mjs` → **402 pruebas · 0 fallos · 2 avisos** (bloques `[1]`–`[16]`).
- Verificación en navegador por fase: login/registro, RLS de eventos/muro con `test1`,
  colores y puntos, JW (latido/destello en su lugar), evento, agenda, FAB/SOS y animaciones.
  **0 errores de consola** en los flujos normales; los 4xx/5xx esperados de las pruebas
  negativas (usuario inexistente, contraseña mala, nombre tomado) no son fallos.

### Archivos de la entrega

| Archivo | Rol |
|---|---|
| `src/main.js` | Toda la lógica del frontend (acceso, grupos, puntos, JW, actividades, evento, agenda, muro, animaciones). |
| `src/jw-tiempo.js` | Módulo puro de tiempo de Chile y estado de animación JW. |
| `src/config.js` | `SUPABASE_URL`, clave publicable y `EMERGENCY_URL` (todas públicas). |
| `index.html` | Vistas, diálogos (actividad, punto, evento), agenda, FAB y SOS. |
| `styles.css` | Categorías/colores, JW, mapas, agenda, FAB/SOS y `@keyframes` de destello/latido. |
| `sw.js` | Service worker, precache `v32`. |
| `scripts/verificar-mapa.mjs` | Verificador (402 pruebas, bloques `[1]`–`[16]`). |
| `sql/06`–`sql/16` | Migraciones idempotentes (mapa, terminales, admin, grupos, RLS, perfiles, categorías, JW). |
| `supabase/functions/login-username` | Login por usuario+contraseña con grupo automático (v2). |
| `supabase/functions/register-profile` | Registro con contraseña de grupo (`validar-grupo`, `sugerir-usuario`, `registrar`). |
| `AGENT.md`, `PRUEBAS.md`, `DOCUMENTACION-MAPA.md`, `README.md`, `schema.sql` | Crónica, pruebas, documentación técnica, puesta en marcha y esquema final. |

### Pendientes / limitaciones honestas

1. **RLS con usuario normal y admin de grupo**: políticas aplicadas, sin prueba en vivo por
   falta de perfiles no globales.
2. **Alta de evento sin evento existente**: la ruta `insert` está cubierta por el verificador;
   no se probó en vivo porque siempre hay un evento.
3. **Corte +30 → siguiente** en vivo: cubierto por las pruebas puras del módulo de tiempo.
4. **Selección individual en capas externas** (parques/salud/comercio de OSM): se mantiene el
   interruptor por categoría; la gestión individual aplica a `map_points` (decisión de alcance).
5. **`schema.sql` no es un `pg_dump` en vivo**: la sección 9 consolida las migraciones 10–22;
   la fuente de verdad son los archivos `sql/`.
6. Limpieza de caché del service worker tras cada despliegue (hoy `v32`).
7. `UPDATE.md` es del usuario y quedó **sin rastrear**.

### Artefactos de prueba

Eliminados: usuario `test1`, grupo `prueba_acceso`, actividad/punto JW de prueba y grupo
`prueba_acceso`; quedan el grupo `principal`, los perfiles `admin`/`test`, las 5 actividades
de prueba y los 6 puntos (4 terminales + 2 generales).

---

## 37. Jerarquía ADMIN / MANAGER y vista general (2026-11-26)

Cubre la petición posterior a la Fase 7. **SQL nuevo: `sql/17_admin_manager.sql`.**

### Roles

| Rol BD | Nombre | Alcance | Vista |
|---|---|---|---|
| `admin` | ADMIN general | Todos los grupos | Simplificada: Grupos · Actividades · Mapa · Emergencia |
| `manager` | MANAGER de grupo | Solo su `group_id` | Normal: Agenda · Mapa · Emergencia · Muro |
| `user` | Usuario | Su grupo | Normal |

`profiles.group_admin` **deja de existir**: se migra a `role='manager'` + `group_id`.
El MANAGER puede crear/editar actividades, evento, puntos y muro de su grupo; no puede
crear grupos, cambiar contraseñas, tocar puntos bloqueados ni administrar contactos.

### SQL (`sql/17_admin_manager.sql`)

- CHECK de `profiles.role` con `admin`, `manager`, `user`; migración de `group_admin=true`
  a `manager` y eliminación de la columna.
- `is_manager()`; `can_manage_group()` acepta ADMIN o MANAGER de ese grupo.
- `proteger_identidad_perfil()` impide que un MANAGER cambie roles.
- `definir_password_grupo()` queda solo para el ADMIN.
- `map_points.bloqueado` + CHECK (general, global, visible, activo, fijo) + trigger
  `proteger_punto_bloqueado` (solo ADMIN crea/edita/borra).
- `activities.series_id` para actividades multi-grupo; el grupo se deriva siempre del evento.
- `groups.slug` acepta números de 1 carácter.
- RPC `admin_grupos()` (solo ADMIN) con grupos, contraseña definida, miembros, managers y
  evento; nunca expone `join_password_hash`.

### Endurecimiento (`sql/18_endurecer_grupos.sql`)

La QA de integración detectó que la política heredada `"Admin de grupo edita su grupo"`
permitía al MANAGER actualizar su fila de `groups` por API (nombre, slug, active), aunque la
UI no ofreciera esa edición. Se eliminó la política: la gestión del grupo queda **solo** para
el ADMIN (`"Admin gestiona grupos"`). El MANAGER conserva actividades, evento, puntos y muro
de su grupo.

### Frontend

- `esAdminGeneral()` (`role='admin'`), `esManager()`, `esGestorDeGrupo()`.
- El ADMIN no carga agenda ni muro; navega Grupos/Actividades/Mapa/Emergencia.
- Vista **Grupos**: crear/editar número, nombre, descripción, activo, contraseña y evento;
  lista de miembros con “Hacer/Quitar manager”.
- Vista **Actividades**: lista con filtro por grupo; el diálogo permite seleccionar **varios
  grupos** para el ADMIN y guarda una fila por grupo con `series_id` común.
- El MANAGER conserva la agenda normal y ahora puede crear/editar actividades de su grupo
  (antes el FAB estaba reservado al admin global).
- Puntos: checkbox **“Punto fijo BLOQUEADO”** solo para el ADMIN; los puntos bloqueados se
  muestran siempre (aunque la capa de puntos esté apagada), no se pueden editar desde la
  gestión y el trigger/RLS impide modificarlos.
- Emergencia: CRUD de contactos **generales** (`is_general=true`, `user_id=null`) para el
  ADMIN; todos los usuarios los ven.

### Verificación

- `node scripts/verificar-mapa.mjs` → **402 pruebas · 0 fallos · 2 avisos** (bloques `[15]` y
  `[16]`).
- `sw.js` → **v32**.
- **QA de integración (2026-11-26)**: `scripts/qa-simulacion.mjs` → **228 comprobaciones · 0
  fallos** con 3 grupos, 30 usuarios (10 por grupo), 1 MANAGER por grupo, 3 eventos solapados,
  actividades de ADMIN/MANAGER, 30 publicaciones de muro, puntos y ataques.
  - Aislamiento: cada usuario vio solo los 10 perfiles, 2 actividades y 10 posts de su grupo;
    IDOR de actividad/post/punto devolvió 0 filas/403.
  - Muro: XSS `<img onerror>` se mostró como texto; payload `DROP TABLE` no se ejecutó.
  - Seguridad: anon y JWT manipulado rechazados; login/username/slug con inyección no
    autenticaron ni ejecutaron SQL; MANAGER no se ascendió, no creó grupos/contactos/puntos
    globales ni leyó `join_password_hash`/`verificar_password_grupo`.
  - **Hallazgo corregido**: el MANAGER podía actualizar su fila de `groups` por API (nombre,
    slug, active) aunque la UI lo ocultara. Se eliminó la política heredada
    `"Admin de grupo edita su grupo"` en **`sql/18_endurecer_grupos.sql`**; ahora la gestión
    del grupo queda solo para el ADMIN. Reprobado: 204 sin filas, nombre intacto.
- **En vivo (UI)**: ADMIN ve los 3 grupos con 10 miembros/1 manager/evento; MANAGER crea una
  actividad desde el FAB; el usuario normal ve solo su muro (10 posts + XSS/SQL), no los de
  g2/g3, y el contacto general; 0 errores de consola.
- **Limpieza**: 60 usuarios QA, 6 grupos, eventos, actividades, muro, puntos y contactos
  eliminados. Quedan: 5 actividades, 6 puntos, 0 contactos, 1 grupo (`principal`), 2 perfiles
  (`admin` = ADMIN, `test` = MANAGER).
- `login-username` y `register-profile` se redesplegaron sin `group_admin` (el SQL 17 elimina
  la columna; sin este cambio el login fallaba).

---

## 38. Vista Emergencia simplificada (2026-11-26)

Petición: dejar en Emergencia **solo la lista de contactos y el botón inferior** que abre el
sistema externo.

- Se eliminó el hero completo: `crisis_alert`, “Protocolo de seguridad”, “ACTIVAR PROTOCOLO
  DE EMERGENCIA”, el texto explicativo y el botón circular **SOS/Pulsar** (`#sosButton`).
- Se eliminó también el bloque “Estado de red” (`#net-status`, `#net-dot`); los avisos
  online/offline siguen funcionando mediante `updateNetStatus()` con guardas.
- Se quitó el párrafo sobre X-Frame-Options del bloque inferior; queda solo el botón
  “Abrir sistema de emergencia”.
- El **SOS flotante** global (`#sos-fab`) se oculta únicamente en la vista Emergencia para no
  duplicar la acción; sigue disponible en Agenda/Mapa/Muro.
- `sw` → **v32**.
- `scripts/verificar-mapa.mjs` → **402 pruebas · 0 fallos · 2 avisos**, con comprobación de que
  no quedan `sosButton`, `ACTIVAR PROTOCOLO`, `crisis_alert` ni `net-status`, y de que siguen
  `#emergency-contacts` y `#emergency-open-link`.
- En vivo: la vista muestra únicamente contactos + botón; el flotante desaparece en
  Emergencia y vuelve al cambiar de pestaña; **0 errores de consola**.

---

## 39. Marca: STGO 2026 | Región 8 (2026-11-26)

Se reemplazó el título visible y de PWA:

- Encabezado de la app y pantalla de login: **STGO 2026 | Región 8**.
- `<title>` y `meta description`.
- `manifest.webmanifest`: `name` = **STGO 2026 | Región 8**, `short_name` = **STGO 2026**.
- `alt` del logo actualizado.

`sw` → **v32**. `scripts/verificar-mapa.mjs` → **402 pruebas · 0 fallos · 2 avisos** (incluye
la comprobación del encabezado/título y del manifest).

---

## 40. Vista mapa: nombres, controles, subcategorías y capas (2026-11-26)

### Nombres

- Máximo **3 líneas** visibles (`white-space: pre-line` + `-webkit-line-clamp: 3`).
- El formulario de punto usa **textarea** para insertar saltos manuales.

### Controles laterales

Quedaron solo: **Centrar · Mi ubicación · Capas · Cerca de mí**.
Se eliminaron `+`, `-`, satélite, pantalla completa, agregar punto y gestión de puntos.
El satélite se sigue alternando desde la capa “Vista satelital”.

### Alta de punto

- **Clic en zona vacía** del mapa o **pulsación larga** (600 ms) abre el formulario.
- No se abre sobre marcadores, popups, controles ni capas de datos.
- No hay botón “Agregar punto”.
- “Cerca de mí” queda como placeholder con aviso de próxima etapa.
- Los controles y la búsqueda del mapa se posicionan con `env(safe-area-inset-top/right/left)`
  para no quedar bajo el notch/status bar en móvil.

### Subcategorías/capas (`sql/19`, `sql/20`)

- `map_categories` → `map_subcategories` (subcategoría = capa).
- Campos: color, icono, `render_mode` (`auto`/`icon`), `layer_key`, orden, activo.
- `map_points.subcategory_id`; backfill a la subcategoría “General” de cada categoría.
- Overrides globales de puntos externos:
  `map_layer_point_overrides(layer_key, external_id, visible, …)`.
  Solo se guardan las **excepciones ocultas**; sin fila = visible.
- RLS: lectura autenticada, escritura solo ADMIN.
- JW: trigger `map_subcategories_jw` fuerza `render_mode='icon'`; todos los puntos JW
  siguen vinculables a actividades.

### UI de capas

- Engranaje **solo ADMIN** en el título de “Capas del mapa”.
- ADMIN: CRUD de categorías/subcategorías, color, icono, comportamiento, capa y puntos
  externos visibles.
- MANAGER/usuarios: solo encienden/apagan capas completas; no ven ajustes.
- Nombres de capas externas salen de su subcategoría (Metro, MetroTren, Parques, Plazas…).
- Los puntos manuales usan color/icono/comportamiento de su subcategoría.
- Capas propias sin `layer_key` aparecen como toggles adicionales (p. ej. Buses).
- **Salud** se separó en dos subcategorías/capas: **Hospitales públicos** (incluye
  Hospital público y Hospital público/SAR) y **SAPU / SAR**. La antigua “Urgencias” se retiró;
  el formulario de punto ya no las muestra juntas. Totales de origen: 111 y 158.
- **Eliminar categoría**: botón en cada categoría del ADMIN. Si tiene puntos, se bloquea para
  no dejar puntos sin categoría. Si solo tiene subcategorías, la categoría se borra y las
  subcategorías quedan con `category_slug=NULL` (“Sin categoría”) hasta reasignarlas;
  `sql/22` cambia la FK a `ON DELETE SET NULL`.
- **Panel de Capas**: ya no usa grupos estáticos. Se genera desde `map_categories` y
  `map_subcategories`: cada categoría es una sección y cada subcategoría/capa una fila.
  Las huérfanas aparecen en “Sin categoría”; las capas de aplicación quedan al final.
- **Deseleccionar todo** en la lista de puntos externos: desmarca todos los puntos de la capa
  (no solo los filtrados por la búsqueda); el cambio se confirma con “Guardar visibilidad”.

### Pendiente

- “Cerca de mí”: implementar radio + PostGIS/Haversine. PostGIS está disponible (3.3.7)
  pero no instalado; para GeoJSON se puede usar Haversine en cliente.
- El cambio de icono de capas externas se aplica a lugares y Metro; MetroTren solo usa
  círculos.
- La visibilidad externa se aplica a la fuente al guardar; si la capa no está cargada se
  aplica al encenderla.



