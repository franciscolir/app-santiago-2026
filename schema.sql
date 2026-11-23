-- ============================================================================
-- APP SANTIAGO 2026 — schema.sql
-- Regenerado desde la BD real (Supabase) el 2026-11-23.
--
-- Fiel a la base de datos existente: columnas, restricciones, índices,
-- funciones, políticas RLS y GRANTs tal como están aplicados hoy.
-- Origen: queries A–E, G y H de AGENT.md §15.
--
-- Estado de las queries de AGENT.md §15 (2026-11-23): TODAS ejecutadas.
--   A, B, C, D, E, G volcadas aquí.
--   F: 0 filas → sin triggers en tablas de public (ver sección TRIGGERS).
--   F2: hecho → trigger on_auth_user_created en auth.users (ver TRIGGERS).
--   F3: hecho → event trigger ensure_rls → rls_auto_enable confirmado.
--   H: 0 filas → NO existen políticas de Storage para adjuntos (ver STORAGE).
--
-- Este archivo es la REFERENCIA fiel del estado real. En una BD nueva
-- reproduce la misma estructura; en una existente no rompe nada
-- (create ... if not exists / drop policy if exists / create or replace).
-- No contiene claves, usuarios ni datos de prueba.
-- ============================================================================

-- ============================================================================
-- 1) FUNCIONES
-- ============================================================================

-- ¿Es el usuario actual un admin activo? Lo usan todas las políticas RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
    select exists (
        select 1
        from public.profiles
        where id = (select auth.uid())
          and role = 'admin'
          and active = true
    );
$function$;

-- Crea automáticamente el perfil cuando Supabase Auth crea un usuario.
-- Definición real (sin trim/on conflict: el original falla si el username
-- está duplicado, comportamiento registrado tal cual).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
    v_username text;
    v_full_name text;
begin
    v_username := lower(
        coalesce(
            new.raw_user_meta_data ->> 'username',
            split_part(new.email, '@', 1)
        )
    );

    v_full_name := coalesce(
        new.raw_user_meta_data ->> 'full_name',
        v_username
    );

    insert into public.profiles (
        id,
        username,
        full_name
    )
    values (
        new.id,
        v_username,
        v_full_name
    );

    return new;
end;
$function$;

-- Activa RLS automáticamente en toda tabla nueva creada en public.
-- Función real; el EVENT TRIGGER que la dispara está PENDIENTE (query F).
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL
        AND cmd.schema_name IN ('public')
        AND cmd.schema_name NOT IN ('pg_catalog','information_schema')
        AND cmd.schema_name NOT LIKE 'pg_toast%'
        AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl
        FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security',
                       cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
       RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
                 cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- ============================================================================
-- 2) TABLAS (columnas, tipos, restricciones y FKs = estado real)
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key,
  username text not null,
  full_name text not null,
  role text not null default 'user',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint profiles_id_fkey foreign key (id)
    references auth.users(id) on delete cascade,
  constraint profiles_role_check check (role in ('admin', 'user')),
  constraint profiles_username_key unique (username)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  start_date date not null,
  end_date date not null,
  status text not null default 'draft',
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint events_created_by_fkey foreign key (created_by)
    references public.profiles(id),
  constraint events_status_check
    check (status in ('draft', 'published', 'finished')),
  constraint events_check check (end_date >= start_date)
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  title text not null,
  description text,
  activity_date date not null,
  start_time time,
  end_time time,
  place text,
  latitude numeric,
  longitude numeric,
  status text not null default 'pending',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_event_id_fkey foreign key (event_id)
    references public.events(id) on delete cascade,
  constraint activities_created_by_fkey foreign key (created_by)
    references public.profiles(id),
  constraint activities_status_check
    check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  constraint activities_latitude_check
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint activities_longitude_check
    check (longitude is null or (longitude >= -180 and longitude <= 180))
  -- No existe CHECK de horario (end_time > start_time): esa validación
  -- vive SOLO en el frontend. Verificado con la query B (2026-11-23).
);

create table if not exists public.activity_assignments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null,
  user_id uuid not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint activity_assignments_activity_id_fkey foreign key (activity_id)
    references public.activities(id) on delete cascade,
  constraint activity_assignments_user_id_fkey foreign key (user_id)
    references public.profiles(id) on delete cascade,
  constraint activity_assignments_status_check
    check (status in ('pending', 'in_progress', 'completed')),
  constraint activity_assignments_activity_id_user_id_key
    unique (activity_id, user_id)
);

create table if not exists public.activity_user_details (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null,
  user_id uuid not null,
  instructions text,
  additional_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint activity_user_details_activity_id_fkey foreign key (activity_id)
    references public.activities(id) on delete cascade,
  constraint activity_user_details_user_id_fkey foreign key (user_id)
    references public.profiles(id) on delete cascade,
  constraint activity_user_details_activity_id_user_id_key
    unique (activity_id, user_id)
);

create table if not exists public.activity_attachments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  file_size bigint,
  uploaded_by uuid not null,
  created_at timestamptz not null default now(),
  constraint activity_attachments_activity_id_fkey foreign key (activity_id)
    references public.activities(id) on delete cascade,
  constraint activity_attachments_uploaded_by_fkey foreign key (uploaded_by)
    references public.profiles(id),
  constraint activity_attachments_storage_path_key unique (storage_path)
);

create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  phone text not null,
  description text,
  is_general boolean not null default false,
  created_at timestamptz not null default now(),
  constraint emergency_contacts_user_id_fkey foreign key (user_id)
    references public.profiles(id) on delete cascade,
  constraint emergency_contacts_check check (
    (is_general = true and user_id is null)
    or
    (is_general = false and user_id is not null)
  )
);

create table if not exists public.wall_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category text not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint wall_posts_user_id_fkey foreign key (user_id)
    references public.profiles(id),
  constraint wall_posts_category_check check (category in ('positive', 'vent')),
  constraint wall_posts_content_check
    check (char_length(trim(both from content)) >= 1
       and char_length(trim(both from content)) <= 500)
);

-- Nota: solo activities tiene updated_at. El resto de tablas NO lo tienen
-- (el schema.sql anterior los inventaba). No existe ninguna tabla extra.

-- Índices de datos (los UNIQUE ya crean los suyos: profiles_username_key,
-- *_pkey, activity_assignments/activity_user_details (activity_id,user_id),
-- activity_attachments_storage_path_key).
create index if not exists activities_event_date_idx
  on public.activities (event_id, activity_date, start_time);
create index if not exists wall_posts_created_idx
  on public.wall_posts (created_at desc);
-- No existen índices sobre user_id de assignments/details ni sobre
-- wall_posts.user_id en la BD real (no recrear los del schema.sql anterior).

-- ============================================================================
-- 3) ROW LEVEL SECURITY + POLÍTICAS (nombres y condiciones reales)
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.activities enable row level security;
alter table public.activity_assignments enable row level security;
alter table public.activity_user_details enable row level security;
alter table public.activity_attachments enable row level security;
alter table public.wall_posts enable row level security;
alter table public.emergency_contacts enable row level security;

-- Se eliminan con sus nombres REALES (español) para poder re-ejecutar.
drop policy if exists "Admin gestiona perfiles" on public.profiles;
drop policy if exists "Usuarios pueden consultar perfiles activos" on public.profiles;
drop policy if exists "Admin gestiona eventos" on public.events;
drop policy if exists "Usuarios consultan eventos publicados" on public.events;
drop policy if exists "Admin gestiona actividades" on public.activities;
drop policy if exists "Usuarios consultan actividades" on public.activities;
drop policy if exists "Admin crea asignaciones" on public.activity_assignments;
drop policy if exists "Admin elimina asignaciones" on public.activity_assignments;
drop policy if exists "Admin o usuario actualiza estado" on public.activity_assignments;
drop policy if exists "Usuarios consultan asignaciones" on public.activity_assignments;
drop policy if exists "Admin gestiona instrucciones" on public.activity_user_details;
drop policy if exists "Usuario consulta sus instrucciones" on public.activity_user_details;
drop policy if exists "Admin gestiona adjuntos" on public.activity_attachments;
drop policy if exists "Usuarios consultan adjuntos" on public.activity_attachments;
drop policy if exists "Admin gestiona contactos" on public.emergency_contacts;
drop policy if exists "Consultar contactos generales y propios" on public.emergency_contacts;
drop policy if exists "Admin elimina publicaciones" on public.wall_posts;
drop policy if exists "Autor elimina su publicación" on public.wall_posts;
drop policy if exists "Todos leen publicaciones" on public.wall_posts;
drop policy if exists "Usuarios publican" on public.wall_posts;

-- profiles ------------------------------------------------------------------
create policy "Admin gestiona perfiles"
on public.profiles for all to authenticated
using (is_admin())
with check (is_admin());

create policy "Usuarios pueden consultar perfiles activos"
on public.profiles for select to authenticated
using ((active = true) or (id = (select auth.uid())));

-- events --------------------------------------------------------------------
create policy "Admin gestiona eventos"
on public.events for all to authenticated
using (is_admin())
with check (is_admin());

create policy "Usuarios consultan eventos publicados"
on public.events for select to authenticated
using ((status = 'published') or is_admin());

-- activities ----------------------------------------------------------------
create policy "Admin gestiona actividades"
on public.activities for all to authenticated
using (is_admin())
with check (is_admin());

-- Un usuario ve las actividades de eventos publicados (o todas si es admin).
create policy "Usuarios consultan actividades"
on public.activities for select to authenticated
using (
  exists (
    select 1
    from events e
    where e.id = activities.event_id
      and (e.status = 'published' or is_admin())
  )
);

-- activity_assignments ------------------------------------------------------
create policy "Admin crea asignaciones"
on public.activity_assignments for insert to authenticated
with check (is_admin());

create policy "Admin elimina asignaciones"
on public.activity_assignments for delete to authenticated
using (is_admin());

create policy "Admin o usuario actualiza estado"
on public.activity_assignments for update to authenticated
using (is_admin() or (user_id = (select auth.uid())))
with check (is_admin() or (user_id = (select auth.uid())));

-- Lectura abierta a cualquier usuario autenticado (la RLS no filtra por
-- usuario: cualquier autenticado puede listar todas las asignaciones).
create policy "Usuarios consultan asignaciones"
on public.activity_assignments for select to authenticated
using (true);

-- activity_user_details -----------------------------------------------------
create policy "Admin gestiona instrucciones"
on public.activity_user_details for all to authenticated
using (is_admin())
with check (is_admin());

create policy "Usuario consulta sus instrucciones"
on public.activity_user_details for select to authenticated
using ((user_id = (select auth.uid())) or is_admin());

-- activity_attachments ------------------------------------------------------
create policy "Admin gestiona adjuntos"
on public.activity_attachments for all to authenticated
using (is_admin())
with check (is_admin());

create policy "Usuarios consultan adjuntos"
on public.activity_attachments for select to authenticated
using (true);

-- emergency_contacts --------------------------------------------------------
create policy "Admin gestiona contactos"
on public.emergency_contacts for all to authenticated
using (is_admin())
with check (is_admin());

create policy "Consultar contactos generales y propios"
on public.emergency_contacts for select to authenticated
using ((is_general = true) or (user_id = (select auth.uid())) or is_admin());

-- wall_posts ----------------------------------------------------------------
create policy "Admin elimina publicaciones"
on public.wall_posts for delete to authenticated
using (is_admin());

create policy "Autor elimina su publicación"
on public.wall_posts for delete to authenticated
using (user_id = (select auth.uid()));

create policy "Todos leen publicaciones"
on public.wall_posts for select to authenticated
using (true);

create policy "Usuarios publican"
on public.wall_posts for insert to authenticated
with check (user_id = (select auth.uid()));

-- ============================================================================
-- 4) PERMISOS SQL (GRANT) — estado real aplicado (sql/02_grants.sql + query G)
-- RLS sigue siendo la barrera por fila.
-- ============================================================================

grant usage on schema public to authenticated;

grant select on public.profiles to authenticated;
grant update on public.profiles to authenticated;                 -- 05: admin edita perfiles
grant select, insert, update, delete on public.events to authenticated;  -- 05: admin gestiona eventos
grant select, insert, update, delete on public.activities to authenticated;
grant select, insert, delete on public.activity_assignments to authenticated;
grant update (status) on public.activity_assignments to authenticated;
grant select, insert, update, delete on public.activity_user_details to authenticated;  -- 05
grant select, insert, update, delete on public.activity_attachments to authenticated;   -- 05
grant select, insert, update, delete on public.emergency_contacts to authenticated;     -- 05
grant select, insert, delete on public.wall_posts to authenticated;

-- Verificado el 2026-11-23 tras ejecutar sql/05_grants_admin.sql.
-- RLS sigue filtrando por fila: el solo hecho de tener el GRANT no permite
-- escribir si la política is_admin() no lo autoriza.

-- service_role: según la query G solo tiene REFERENCES/TRIGGER/TRUNCATE en
-- todas las tablas y SELECT en profiles. Si alguna Edge Function necesita
-- leer otras tablas, faltan GRANT (pendiente, AGENT.md §14).

-- PENDIENTE: Storage (query H = 0 filas) → no existen políticas de adjuntos.
-- El frontend hoy no usa Storage; crearlas cuando se implementen adjuntos.

-- ============================================================================
-- 5) STORAGE — adjuntos
-- ============================================================================
-- La query H (políticas de storage.objects con nombre tipo %activity%)
-- devolvió 0 filas el 2026-11-23: NO existen políticas de Storage ni se
-- verificó la existencia del bucket 'activity-attachments'.
-- => Adjuntos NO funcionarán hasta crear bucket + políticas (AGENT.md §14).
--    No se inventan aquí a propósito: hay que definirlas y probarlas.

-- ============================================================================
-- 6) TRIGGERS — queries F (0 filas), F2 y F3 ejecutadas el 2026-11-23
-- ============================================================================
-- F: no existe NINGÚN trigger en las tablas de public. En particular no hay
--    trigger que actualice activities.updated_at → ese campo solo cambia si
--    la app lo escribe (el default now() aplica solo al insertar).
-- F2: SÍ existe el trigger de registro en auth.users (recreado abajo).
-- F3: existe el event trigger "ensure_rls" sobre ddl_command_end →
--    rls_auto_enable(), habilitado (enabled = O), junto a los event triggers
--    por defecto de Supabase (pgrst_ddl_watch, pgrst_drop_watch,
--    issue_pg_net_access, etc.). NO se recrea aquí: no se introspeccionó
--    su cláusula WHEN y ya existe en la BD.

-- Registro de usuario → creación de perfil (estado real, F2).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- ============================================================================
-- CONSULTAS DE VERIFICACIÓN (ejecutar aparte)
-- ============================================================================
-- select id, username, full_name, role, active from public.profiles;
-- select id, name, start_date, end_date, status from public.events;
-- select id, event_id, title, activity_date, start_time, end_time, place,
--        latitude, longitude, status
-- from public.activities order by activity_date, start_time;
-- select grantee, table_name, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'public' order by table_name, grantee, privilege_type;
