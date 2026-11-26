-- ============================================================================
-- sql/14_registro_perfiles.sql — Contraseña de grupo y registro de perfiles
-- (2026-11-26, adaptación del flujo de acceso)
--
-- Ejecutar DESPUÉS de sql/10 y sql/11.
--
-- Decisiones acordadas con el usuario:
--   - El login pide SOLO usuario + contraseña; el grupo se detecta del perfil.
--   - El nombre de usuario es ÚNICO GLOBAL (decisión del usuario). Por eso la
--     restricción `profiles_username_key` SE MANTIENE y se agrega un índice
--     único sobre lower(username) para que la unicidad sea insensible a
--     mayúsculas. (El documento permitía el mismo nombre en grupos distintos;
--     esa prueba NO aplica por esta decisión.)
--   - La contraseña de grupo se guarda como hash bcrypt (pgcrypto), nunca en
--     claro, y solo la Edge Function puede verificarla.
--
-- Qué hace:
--   1. Agrega `groups.join_password_hash`.
--   2. Crea `definir_password_grupo()` (admin global / admin de grupo) y
--      `verificar_password_grupo()` (solo service_role).
--   3. Crea `grupos_para_registro()` (anon) para el selector del registro.
--   4. Restringe los GRANT por columna de `groups`: la app no puede leer ni
--      escribir el hash.
--   5. Agrega el índice único `lower(username)` y normaliza los usuarios.
--   6. Agrega un trigger que impide cambiar usuario o grupo a los no admin.
--
-- Es idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Comprobaciones previas
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.groups') is null or to_regclass('public.profiles') is null then
    raise exception 'Faltan public.groups/profiles: ejecuta primero sql/10_grupos.sql';
  end if;
end;
$$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- 1) Hash de la contraseña de grupo (bcrypt)
-- ----------------------------------------------------------------------------
alter table public.groups add column if not exists join_password_hash text;

comment on column public.groups.join_password_hash is
  'Hash bcrypt de la contraseña para incorporarse al grupo. Nunca se expone al cliente; solo la Edge Function lo verifica.';

-- ----------------------------------------------------------------------------
-- 2) Funciones
-- ----------------------------------------------------------------------------
-- Define/rota la contraseña de un grupo.
-- Permitido a: admin global, admin de ese grupo, service_role y el SQL Editor
-- (session_user postgres/supabase_admin). El hash nunca se devuelve.
create or replace function public.definir_password_grupo(p_slug text, p_password text)
returns void
language plpgsql
security definer
set search_path to public, extensions
as $function$
declare
  v_id uuid;
begin
  if p_password is null or char_length(p_password) < 6 then
    raise exception 'La contraseña del grupo debe tener al menos 6 caracteres.'
      using errcode = '22023';
  end if;

  select g.id into v_id
    from public.groups g
   where g.slug = lower(btrim(p_slug))
     and g.active = true;

  if v_id is null then
    raise exception 'El grupo no existe o está inactivo.'
      using errcode = '22023';
  end if;

  if not (
    public.is_admin()
    or public.can_manage_group(v_id)
    or session_user in ('postgres','supabase_admin')
    or coalesce((select auth.role()), '') = 'service_role'
  ) then
    raise exception 'Sin permisos para cambiar la contraseña de este grupo.'
      using errcode = '42501';
  end if;

  update public.groups
     set join_password_hash = crypt(p_password, gen_salt('bf', 10)),
         updated_at = now()
   where id = v_id;
end;
$function$;

-- Verifica la contraseña de grupo. Solo service_role (Edge Function).
create or replace function public.verificar_password_grupo(p_slug text, p_password text)
returns boolean
language sql
stable
security definer
set search_path to public, extensions
as $function$
  select coalesce((
    select g.join_password_hash is not null
       and crypt(p_password, g.join_password_hash) = g.join_password_hash
      from public.groups g
     where g.slug = lower(btrim(p_slug))
       and g.active = true
  ), false)
$function$;

-- Grupos activos para el paso de registro (anon). `abierto` = tiene contraseña.
create or replace function public.grupos_para_registro()
returns table (id uuid, slug text, name text, abierto boolean)
language sql
stable
security definer
set search_path to ''
as $function$
  select g.id,
         g.slug,
         g.name,
         (g.join_password_hash is not null) as abierto
    from public.groups g
   where g.active = true
   order by g.name
$function$;

revoke all on function public.definir_password_grupo(text, text) from public;
revoke all on function public.verificar_password_grupo(text, text) from public;
revoke all on function public.grupos_para_registro() from public;

grant execute on function public.definir_password_grupo(text, text) to authenticated, service_role;
grant execute on function public.verificar_password_grupo(text, text) to service_role;
grant execute on function public.grupos_para_registro() to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) GRANT por columna en groups: el hash no se lee ni se escribe desde la API
--    (limpia los GRANT de tabla que pudo dejar sql/10).
-- ----------------------------------------------------------------------------
revoke select, insert, update, delete on public.groups from authenticated;

grant select (id, slug, name, description, active, created_at, updated_at)
  on public.groups to authenticated;
grant insert (slug, name, description, active)
  on public.groups to authenticated;
grant update (slug, name, description, active)
  on public.groups to authenticated;
grant delete on public.groups to authenticated;

grant select, insert, update, delete on public.groups to service_role;

-- ----------------------------------------------------------------------------
-- 4) Unicidad global insensible a mayúsculas + normalización
-- ----------------------------------------------------------------------------
-- 4.1 Comprobar que no haya duplicados al ignorar mayúsculas (no debería:
--     profiles.username ya era único, pero puede haber 'Test' y 'test').
do $$
declare
  v_dup integer;
begin
  select count(*) into v_dup
    from (
      select lower(username)
        from public.profiles
       group by lower(username)
      having count(*) > 1
    ) d;

  if v_dup > 0 then
    raise exception 'Hay % nombres de usuario duplicados al ignorar mayúsculas. Resuélvelos antes de ejecutar sql/14.', v_dup;
  end if;
end;
$$;

update public.profiles
   set username = lower(username)
 where username <> lower(username);

-- 4.2 Índice único insensible a mayúsculas (refuerza profiles_username_key).
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

-- ----------------------------------------------------------------------------
-- 5) Protección de identidad: el usuario no puede cambiar su nombre ni su grupo
--    (los administradores y service_role sí).
-- ----------------------------------------------------------------------------
create or replace function public.proteger_identidad_perfil()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if (new.username is distinct from old.username
      or new.group_id is distinct from old.group_id)
     and not (
       public.is_admin()
       or session_user in ('postgres','supabase_admin')
       or coalesce((select auth.role()), '') = 'service_role'
     ) then
    raise exception 'No puedes cambiar tu nombre de usuario ni tu grupo.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists profiles_proteger_identidad on public.profiles;
create trigger profiles_proteger_identidad
  before update on public.profiles
  for each row execute function public.proteger_identidad_perfil();

-- ----------------------------------------------------------------------------
-- 6) VERIFICACIÓN
-- ----------------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'groups'
  and column_name = 'join_password_hash';

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'profiles'
  and indexname in ('profiles_username_key','profiles_username_lower_key')
order by indexname;

select proname, pg_get_function_identity_arguments(oid) as argumentos
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('definir_password_grupo','verificar_password_grupo','grupos_para_registro')
order by proname;

select tgname, tgrelid::regclass as tabla
from pg_trigger
where tgname = 'profiles_proteger_identidad';

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'groups'
  and grantee in ('anon','authenticated','service_role')
order by grantee, privilege_type;

-- Recordatorio (elegir una contraseña real y no compartirla):
--   select public.definir_password_grupo('principal', 'TU_CONTRASEÑA_DE_GRUPO');
-- Después de este archivo:
--   1) desplegar las Edge Functions login-username (v2) y register-profile;
--   2) recién entonces publicar el frontend nuevo.
