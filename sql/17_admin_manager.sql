-- ============================================================================
-- sql/17_admin_manager.sql — Jerarquía ADMIN / MANAGER / USUARIO (2026-11-26)
--
-- Ejecutar DESPUÉS de sql/16_jw_actividades.sql.
--
-- Roles:
--   admin   = ADMIN general: eventos que involucran varios grupos, grupos,
--             contraseñas de grupo, puntos fijos bloqueados y contactos
--             generales de emergencia. Ve la vista simplificada.
--   manager = MANAGER de UN grupo: actividades, evento, puntos y muro de su
--             propio grupo. Ve la app normal.
--   user    = usuario normal.
--
-- `group_admin` deja de existir: su función pasa a role='manager' + group_id.
--
-- Este archivo:
--   1. Amplía el CHECK de profiles.role y migra group_admin -> manager.
--   2. Actualiza can_manage_group() y la protección de identidad.
--   3. Restringe la contraseña de grupo al ADMIN.
--   4. Agrega map_points.bloqueado + CHECK + trigger anti-manipulación.
--   5. Agrega activities.series_id (actividades multi-grupo) y asegura que el
--      grupo de la actividad salga SIEMPRE del evento.
--   6. Permite números de grupo (slug de 1 carácter).
--   7. Crea admin_grupos() para la vista de grupos del ADMIN.
--
-- Es idempotente: se puede ejecutar más de una vez.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Comprobaciones previas
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.groups') is null
     or to_regclass('public.activities') is null
     or to_regclass('public.map_points') is null then
    raise exception 'Faltan tablas base: aplica primero sql/10–sql/16.';
  end if;
  if to_regprocedure('public.can_manage_group(uuid)') is null then
    raise exception 'Falta can_manage_group(): aplica primero sql/10_grupos.sql.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) Roles: admin | manager | user
-- ----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;

-- Los gestores de grupo actuales pasan a MANAGER. Un perfil que ya era admin
-- global conserva admin (el rol superior manda). El bloque es idempotente:
-- después de la primera ejecución la columna group_admin ya no existe.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'group_admin'
  ) then
    execute $sql$
      update public.profiles
         set role = 'manager'
       where group_admin = true
         and role = 'user'
    $sql$;
  end if;
end;
$$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'manager', 'user'));

comment on column public.profiles.role is
  'admin = ADMIN general (varios grupos, vista simplificada); manager = gestor de su grupo; user = usuario.';

-- La columna group_admin ya no es fuente de verdad. Se elimina después de
-- actualizar las funciones que la usaban.
drop index if exists public.profiles_group_admin_idx;

-- ----------------------------------------------------------------------------
-- 2) Helpers
-- ----------------------------------------------------------------------------
create or replace function public.is_manager()
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
       and p.role = 'manager'
  );
$function$;

-- ADMIN (role='admin') puede todo; MANAGER solo su propio grupo.
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
         or (p.role = 'manager' and p.group_id = g)
       )
  );
$function$;

comment on function public.can_manage_group(uuid) is
  'true para el ADMIN general y para el MANAGER del grupo g. group_admin quedó obsoleto.';

-- Protección de identidad: además de username/group_id, solo el ADMIN puede
-- cambiar el rol. Evita que un MANAGER se ascienda a ADMIN.
create or replace function public.proteger_identidad_perfil()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if (new.role is distinct from old.role)
     and not (
       public.is_admin()
       or session_user in ('postgres','supabase_admin')
       or coalesce((select auth.role()), '') = 'service_role'
     ) then
    raise exception 'Solo el ADMIN puede cambiar roles.'
      using errcode = '42501';
  end if;

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

-- La contraseña de grupo queda reservada al ADMIN general (y service_role/SQL).
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
    or session_user in ('postgres','supabase_admin')
    or coalesce((select auth.role()), '') = 'service_role'
  ) then
    raise exception 'Solo el ADMIN general puede cambiar la contraseña de un grupo.'
      using errcode = '42501';
  end if;

  update public.groups
     set join_password_hash = crypt(p_password, gen_salt('bf', 10)),
         updated_at = now()
   where id = v_id;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 3) Eliminar group_admin (ya migrado a role='manager')
-- ----------------------------------------------------------------------------
alter table public.profiles drop column if exists group_admin;

-- ----------------------------------------------------------------------------
-- 4) map_points: puntos fijos BLOQUEADOS
--    Un punto bloqueado es general, global, visible, activo y fijo. Solo el
--    ADMIN lo puede crear, editar, desbloquear o borrar.
-- ----------------------------------------------------------------------------
alter table public.map_points
  add column if not exists bloqueado boolean not null default false;

comment on column public.map_points.bloqueado is
  'true = punto fijo global que solo el ADMIN puede modificar. La app lo muestra siempre y lo excluye de la gestión de usuarios/managers.';

alter table public.map_points drop constraint if exists map_points_bloqueado_check;
alter table public.map_points
  add constraint map_points_bloqueado_check check (
    not bloqueado or (
      tipo = 'general'
      and scope = 'global'
      and group_id is null
      and visible = true
      and active = true
      and fijo = true
    )
  );

create or replace function public.proteger_punto_bloqueado()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_admin boolean;
begin
  v_admin := public.is_admin()
    or session_user in ('postgres','supabase_admin')
    or coalesce((select auth.role()), '') = 'service_role';

  if tg_op = 'INSERT' then
    if new.bloqueado and not v_admin then
      raise exception 'Solo el ADMIN puede crear puntos bloqueados.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (old.bloqueado or new.bloqueado) and not v_admin then
      raise exception 'Este punto está bloqueado: solo el ADMIN puede modificarlo.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.bloqueado and not v_admin then
      raise exception 'Este punto está bloqueado: solo el ADMIN puede borrarlo.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  return coalesce(new, old);
end;
$function$;

drop trigger if exists map_points_proteger_bloqueado on public.map_points;
create trigger map_points_proteger_bloqueado
  before insert or update or delete on public.map_points
  for each row execute function public.proteger_punto_bloqueado();

create index if not exists map_points_bloqueado_idx
  on public.map_points (bloqueado)
  where bloqueado = true;

-- ----------------------------------------------------------------------------
-- 5) Actividades multi-grupo
--    series_id agrupa las filas creadas para varios grupos. El grupo SIEMPRE
--    se deriva del evento elegido, nunca del cliente.
-- ----------------------------------------------------------------------------
alter table public.activities
  add column if not exists series_id uuid;

comment on column public.activities.series_id is
  'Identifica una actividad general replicada en varios grupos (una fila por grupo/evento). NULL = actividad suelta.';

create index if not exists activities_series_idx
  on public.activities (series_id)
  where series_id is not null;

create or replace function public.asignar_grupo_actividad()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_grupo uuid;
begin
  if new.event_id is not null then
    select e.group_id into v_grupo
      from public.events e
     where e.id = new.event_id;
    if v_grupo is not null then
      new.group_id := v_grupo;
      return new;
    end if;
  end if;

  if new.group_id is null then
    select p.group_id into v_grupo
      from public.profiles p
     where p.id = (select auth.uid());
    new.group_id := v_grupo;
  end if;
  return new;
end;
$function$;

drop trigger if exists activities_asignar_grupo on public.activities;
create trigger activities_asignar_grupo
  before insert or update on public.activities
  for each row execute function public.asignar_grupo_actividad();

-- ----------------------------------------------------------------------------
-- 6) Números de grupo: se acepta un slug de 1 carácter (p. ej. "1")
-- ----------------------------------------------------------------------------
alter table public.groups drop constraint if exists groups_slug_check;
alter table public.groups
  add constraint groups_slug_check
  check (slug ~ '^[a-z0-9][a-z0-9_-]{0,40}$');

-- ----------------------------------------------------------------------------
-- 7) RPC segura para la vista de grupos del ADMIN
--    No expone join_password_hash; solo si existe contraseña.
-- ----------------------------------------------------------------------------
create or replace function public.admin_grupos()
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  active boolean,
  has_password boolean,
  member_count bigint,
  manager_count bigint,
  event_id uuid,
  event_name text,
  event_start date,
  event_end date,
  event_status text
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not public.is_admin() then
    raise exception 'Solo el ADMIN general puede consultar todos los grupos.'
      using errcode = '42501';
  end if;

  return query
  select g.id,
         g.slug,
         g.name,
         g.description,
         g.active,
         (g.join_password_hash is not null) as has_password,
         (select count(*) from public.profiles p where p.group_id = g.id) as member_count,
         (select count(*) from public.profiles p where p.group_id = g.id and p.role = 'manager') as manager_count,
         e.id,
         e.name,
         e.start_date,
         e.end_date,
         e.status
    from public.groups g
    left join lateral (
      select ev.id, ev.name, ev.start_date, ev.end_date, ev.status
        from public.events ev
       where ev.group_id = g.id
       order by (ev.status = 'published') desc, ev.start_date desc
       limit 1
    ) e on true
   order by g.slug;
end;
$function$;

revoke all on function public.admin_grupos() from public;
grant execute on function public.admin_grupos() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8) VERIFICACIÓN RÁPIDA
-- ----------------------------------------------------------------------------
select role, count(*) as perfiles
from public.profiles
group by role
order by role;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'map_points'
  and column_name = 'bloqueado';

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'activities'
  and column_name = 'series_id';

select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.profiles'::regclass
  and conname = 'profiles_role_check';

select tgname, tgrelid::regclass as tabla
from pg_trigger
where tgname in ('profiles_proteger_identidad','map_points_proteger_bloqueado','activities_asignar_grupo')
order by tgname;

-- Recordatorio: promover al ADMIN general cuando exista la cuenta.
--   update public.profiles set role = 'admin' where username = 'admin';
-- El resto de usuarios que deban gestionar un grupo:
--   update public.profiles set role = 'manager' where username = '...';
