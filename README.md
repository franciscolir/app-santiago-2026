# APP SANTIAGO 2026 — frontend inicial

Frontend móvil en JavaScript Vanilla + HTML/CSS, preparado para GitHub Pages y Supabase.

## 1. Publicar en GitHub
1. Descomprime este proyecto.
2. Copia el contenido de la carpeta dentro del repositorio `app-santiago-2026`.
3. Confirma que `index.html` quede en la raíz del repositorio y `src/` como subcarpeta.
4. En GitHub: **Settings → Pages → Deploy from a branch → main → /(root)**.

La URL del repositorio parece tener un punto adicional al final en el mensaje recibido. Comprueba que el repositorio real sea `https://github.com/franciscolir/app-santiago-2026`.

## 2. Configuración
Los valores públicos de Supabase ya están puestos en `src/config.js`. La publishable key puede estar en el frontend; nunca pongas la `service_role` key.

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
Puedes abrirlo con un servidor estático local (no abrir `index.html` directamente). Por ejemplo:
```bash
python -m http.server 8080
```
Luego entra a `http://localhost:8080`.
