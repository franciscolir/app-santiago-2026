-- ============================================================================
-- sql/10_grupos.sql — Entidad GRUPO y pertenencia de usuarios (2026-11-26)
--
-- Fase 1 del UPDATE.md (Etapas 1 y 2). Ejecutar DESPUÉS de sql/09.
--
-- Qué hace:
--   1. Crea `public.groups` y siembra el grupo `principal` (idempotente).
--   2. Agrega `profiles.group_id` y `profiles.group_admin`; asigna los
--      usuarios existentes al grupo principal.
--   3. Agrega `group_id` a `events`, `activities` y `wall_posts`, rellena los
--      datos existentes y lo deja NOT NULL.
--   4. Crea los triggers que rellenan `group_id` al insertar, para que el
--      frontend anterior (que no lo envía) siga funcionando.
--   5. Crea los helpers `auth_group()`, `can_manage_group(g)` y
--      `grupos_publicos()` (este último alimenta el selector del login).
--   6. Actualiza `handle_new_user()` para que los perfiles nuevos tengan grupo.
--
-- NO crea políticas RLS: eso va en sql/11_rls_grupos.sql (ejecutar después).
-- NO toca `map_points` (su alcance por grupo va en la Fase 2, sql/12).
--
-- Es idempotente: se puede ejecutar más de una vez sin error.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Comprobaciones previas
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'Falta public.profiles: aplica primero el esquema base (schema.sql / sql/02_grants.sql).';
  end if;
  if to_regclass('public.events') is null
     or to_regclass('public.activities') is null
     or to_regclass('public.wall_posts') is null then
    raise exception 'Faltan tablas base (events/activities/wall_posts): revisa schema.sql antes de este archivo.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) Tabla groups + grupo inicial
-- ----------------------------------------------------------------------------
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  slug        text        not null unique,
  name        text        not null,
  description text,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint groups_slug_check check (slug ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
  constraint groups_name_check check (char_length(btrim(name)) between 2 and 80)
);

comment on table public.groups is
  'Grupo de usuarios: unidad de separación de agenda, actividades, muro y puntos (UPDATE.md Etapa 1).';

alter table public.groups enable row level security;

-- Grupo por defecto: reúne a todos los usuarios y datos que ya existían.
insert into public.groups (slug, name, description)
values ('principal', 'Grupo principal', 'Grupo inicial de la aplicación (usuarios y datos existentes)')
on conflict (slug) do nothing;

-- updated_at automático (mismo patrón que map_points).
create or replace function public.set_groups_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists groups_updated_at on public.groups;
create trigger groups_updated_at
  before update on public.groups
  for each row execute function public.set_groups_updated_at();

-- ----------------------------------------------------------------------------
-- 2) profiles: pertenencia al grupo y rol de administrador de grupo
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists group_id uuid;
alter table public.profiles add column if not exists group_admin boolean not null default false;

comment on column public.profiles.group_id is
  'Grupo al que pertenece el usuario. Varios usuarios comparten el mismo grupo.';
comment on column public.profiles.group_admin is
  'true = puede administrar la información SOLO de su grupo (role=admin sigue siendo admin global).';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_group_id_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_group_id_fkey
      foreign key (group_id) references public.groups(id) on delete restrict;
  end if;
end;
$$;

-- Backfill: todos los usuarios existentes pasan al grupo principal.
update public.profiles
   set group_id = (select id from public.groups where slug = 'principal')
 where group_id is null;

alter table public.profiles alter column group_id set not null;

create index if not exists profiles_group_idx on public.profiles (group_id);

-- ----------------------------------------------------------------------------
-- 3) events / activities / wall_posts: group_id (+ backfill + NOT NULL)
-- ----------------------------------------------------------------------------
alter table public.events    add column if not exists group_id uuid;
alter table public.activities add column if not exists group_id uuid;
alter table public.wall_posts add column if not exists group_id uuid;

-- events: primero el grupo del autor; si no, el principal.
update public.events e
   set group_id = p.group_id
  from public.profiles p
 where e.group_id is null and p.id = e.created_by;

update public.events
   set group_id = (select id from public.groups where slug = 'principal')
 where group_id is null;

-- activities: hereda el grupo del evento; si no, el del autor; si no, principal.
update public.activities a
   set group_id = e.group_id
  from public.events e
 where a.group_id is null and e.id = a.event_id;

update public.activities a
   set group_id = p.group_id
  from public.profiles p
 where a.group_id is null and p.id = a.created_by;

update public.activities
   set group_id = (select id from public.groups where slug = 'principal')
 where group_id is null;

-- wall_posts: grupo del autor.
update public.wall_posts w
   set group_id = p.group_id
  from public.profiles p
 where w.group_id is null and p.id = w.user_id;

update public.wall_posts
   set group_id = (select id from public.groups where slug = 'principal')
 where group_id is null;

alter table public.events     alter column group_id set not null;
alter table public.activities alter column group_id set not null;
alter table public.wall_posts alter column group_id set not null;

-- FKs con guarda (idempotente).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'events_group_id_fkey'
      and conrelid = 'public.events'::regclass
  ) then
    alter table public.events
      add constraint events_group_id_fkey
      foreign key (group_id) references public.groups(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'activities_group_id_fkey'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_group_id_fkey
      foreign key (group_id) references public.groups(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'wall_posts_group_id_fkey'
      and conrelid = 'public.wall_posts'::regclass
  ) then
    alter table public.wall_posts
      add constraint wall_posts_group_id_fkey
      foreign key (group_id) references public.groups(id) on delete restrict;
  end if;
end;
$$;

create index if not exists events_group_idx     on public.events (group_id);
create index if not exists activities_group_idx on public.activities (group_id);
create index if not exists wall_posts_group_idx on public.wall_posts (group_id);

-- ----------------------------------------------------------------------------
-- 4) Triggers de compatibilidad: rellenan group_id si el cliente no lo envía
--    (el frontend anterior sigue funcionando durante el despliegue por fases).
-- ----------------------------------------------------------------------------
create or replace function public.asignar_grupo_autor()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_grupo uuid;
begin
  if new.group_id is null then
    select p.group_id into v_grupo
      from public.profiles p
     where p.id = (select auth.uid());
    new.group_id := v_grupo;
  end if;
  return new;
end;
$function$;

create or replace function public.asignar_grupo_actividad()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_grupo uuid;
begin
  if new.group_id is null then
    select e.group_id into v_grupo
      from public.events e
     where e.id = new.event_id;
    if v_grupo is null then
      select p.group_id into v_grupo
        from public.profiles p
       where p.id = (select auth.uid());
    end if;
    new.group_id := v_grupo;
  end if;
  return new;
end;
$function$;

drop trigger if exists events_asignar_grupo on public.events;
create trigger events_asignar_grupo
  before insert on public.events
  for each row execute function public.asignar_grupo_autor();

drop trigger if exists activities_asignar_grupo on public.activities;
create trigger activities_asignar_grupo
  before insert on public.activities
  for each row execute function public.asignar_grupo_actividad();

drop trigger if exists wall_posts_asignar_grupo on public.wall_posts;
create trigger wall_posts_asignar_grupo
  before insert on public.wall_posts
  for each row execute function public.asignar_grupo_autor();

-- ----------------------------------------------------------------------------
-- 5) Helpers usados por las políticas RLS y por el login
-- ----------------------------------------------------------------------------
-- Grupo del usuario autenticado (SECURITY DEFINER: evita la recursión de RLS
-- al leer profiles desde una política de profiles).
create or replace function public.auth_group()
returns uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select group_id from public.profiles where id = (select auth.uid())
$function$;

-- ¿Puede el usuario actual administrar el grupo g?
--   - role='admin'  → admin global (cualquier grupo).
--   - group_admin   → solo su propio grupo.
create or replace function public.can_manage_group(g uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.active = true
       and (
         p.role = 'admin'
         or (p.group_admin = true and p.group_id = g)
       )
  )
$function$;

-- Grupos activos para el selector del login. Se expone a `anon` a propósito:
-- solo devuelve id/slug/nombre (información organizativa, no datos privados).
create or replace function public.grupos_publicos()
returns table (id uuid, slug text, name text)
language sql
stable
security definer
set search_path to ''
as $function$
  select g.id, g.slug, g.name
    from public.groups g
   where g.active = true
   order by g.name
$function$;

revoke all on function public.auth_group() from public;
revoke all on function public.can_manage_group(uuid) from public;
revoke all on function public.grupos_publicos() from public;

grant execute on function public.auth_group() to authenticated, service_role;
grant execute on function public.can_manage_group(uuid) to authenticated, service_role;
grant execute on function public.grupos_publicos() to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6) handle_new_user(): el perfil nuevo nace con grupo
--    - Toma `group_id` o `group`/`group_slug` de raw_user_meta_data si existe.
--    - Si no, lo asigna al grupo principal.
--    (Se conserva el comportamiento original: sin trim ni on conflict.)
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_username text;
  v_full_name text;
  v_group uuid;
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

  select g.id into v_group
    from public.groups g
   where g.active = true
     and (
       g.id::text = nullif(new.raw_user_meta_data ->> 'group_id', '')
       or g.slug = lower(coalesce(
            new.raw_user_meta_data ->> 'group',
            new.raw_user_meta_data ->> 'group_slug'
          ))
     )
   limit 1;

  if v_group is null then
    select g.id into v_group
      from public.groups g
     where g.slug = 'principal'
     limit 1;
  end if;

  insert into public.profiles (
    id,
    username,
    full_name,
    group_id
  )
  values (
    new.id,
    v_username,
    v_full_name,
    v_group
  );

  return new;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 7) GRANTS
--    - `authenticated` lee la tabla groups y, con la política RLS de sql/11,
--      solo el admin global (o el admin de su grupo) puede modificarla.
--      Los GRANT son POR COLUMNA: el hash de la contraseña de grupo
--      (sql/14) queda fuera y la app no puede leerlo ni escribirlo.
--    - `service_role` la necesita la Edge Function login-username.
--    - `anon` NO tiene select directo: usa la RPC grupos_publicos().
-- ----------------------------------------------------------------------------
grant usage on schema public to anon;
grant select (id, slug, name, description, active, created_at, updated_at)
  on public.groups to authenticated;
grant insert (slug, name, description, active)
  on public.groups to authenticated;
grant update (slug, name, description, active)
  on public.groups to authenticated;
grant delete on public.groups to authenticated;
grant select, insert, update, delete on public.groups to service_role;

-- ----------------------------------------------------------------------------
-- 8) VERIFICACIÓN
-- ----------------------------------------------------------------------------
select slug, name, active, created_at
from public.groups
order by name;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles','events','activities','wall_posts')
  and column_name in ('group_id','group_admin')
order by table_name, column_name;

select table_name, column_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles','events','activities','wall_posts')
  and column_name = 'group_id'
order by table_name;

select conname, conrelid::regclass as tabla
from pg_constraint
where conname in ('profiles_group_id_fkey','events_group_id_fkey',
                  'activities_group_id_fkey','wall_posts_group_id_fkey')
order by conname;

select tgname, tgrelid::regclass as tabla
from pg_trigger
where tgname in ('events_asignar_grupo','activities_asignar_grupo','wall_posts_asignar_grupo')
order by tgname;

select proname, pg_get_function_identity_arguments(oid) as argumentos
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('auth_group','can_manage_group','grupos_publicos')
order by proname;

-- Recordatorio: después de este archivo ejecuta sql/11_rls_grupos.sql.
