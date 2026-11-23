# AGENT.md — APP SANTIAGO 2026

> Documento de continuidad para agentes de programación. Léelo completo antes de modificar el repositorio.
> Última actualización: 2026-11-23.
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
- Mapa: Leaflet (según el frontend inicial).
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
9. `fitBounds` con la vista oculta + la lista del mapa dependía de Leaflet (si el CDN fallaba, no se pintaba nada).
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
2. **Mapa: Leaflet real** con las coordenadas de las 5 actividades (NO el SVG falso del mock), con panel inferior "sede seleccionada", barra de búsqueda y botones de zoom/recentrar.
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
