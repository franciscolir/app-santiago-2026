-- ============================================================================
-- sql/11_rls_grupos.sql — Políticas RLS por grupo (2026-11-26)
--
-- Fase 1 del UPDATE.md (Etapas 1 y 2). Ejecutar DESPUÉS de sql/10_grupos.sql.
--
-- Regla general:
--   - LECTURA: solo las filas del grupo del usuario (`group_id = auth_group()`).
--   - ESCRITURA: admin global (`role='admin'`) o admin del grupo
--     (`group_admin=true` y `group_id=auth_group()`), mediante
--     `can_manage_group(group_id)`.
--   - Las filas personales (map_points) NO se tocan aquí: su alcance por grupo
--     se implementa en la Fase 2 (sql/12).
--   - `emergency_contacts` se mantiene global (no forma parte del UPDATE.md).
--
-- Deroga y recrea TODAS las políticas de las tablas con grupo. Es idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Comprobaciones previas
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.groups') is null then
    raise exception 'Falta public.groups: ejecuta primero sql/10_grupos.sql';
  end if;
  if to_regprocedure('public.auth_group()') is null
     or to_regprocedure('public.can_manage_group(uuid)') is null then
    raise exception 'Faltan los helpers auth_group()/can_manage_group(): ejecuta primero sql/10_grupos.sql';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 0) RLS activo en todas las tablas con grupo (idempotente)
-- ----------------------------------------------------------------------------
alter table public.groups                enable row level security;
alter table public.profiles              enable row level security;
alter table public.events                enable row level security;
alter table public.activities            enable row level security;
alter table public.activity_assignments  enable row level security;
alter table public.activity_user_details enable row level security;
alter table public.activity_attachments  enable row level security;
alter table public.wall_posts            enable row level security;

-- ----------------------------------------------------------------------------
-- 1) groups
-- ----------------------------------------------------------------------------
drop policy if exists "Miembros consultan su grupo" on public.groups;
drop policy if exists "Admin gestiona grupos" on public.groups;
drop policy if exists "Admin de grupo edita su grupo" on public.groups;

create policy "Miembros consultan su grupo"
on public.groups for select to authenticated
using (id = public.auth_group() or public.is_admin());

create policy "Admin gestiona grupos"
on public.groups for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admin de grupo edita su grupo"
on public.groups for update to authenticated
using (id = public.auth_group() and public.can_manage_group(id))
with check (id = public.auth_group() and public.can_manage_group(id));

-- ----------------------------------------------------------------------------
-- 2) profiles
--    Los miembros ven los perfiles activos de su grupo (el muro muestra el
--    nombre del autor) y siempre el propio; el admin global ve todos.
-- ----------------------------------------------------------------------------
drop policy if exists "Admin gestiona perfiles" on public.profiles;
drop policy if exists "Usuarios pueden consultar perfiles activos" on public.profiles;
drop policy if exists "Usuarios consultan perfiles de su grupo" on public.profiles;

create policy "Admin gestiona perfiles"
on public.profiles for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Usuarios consultan perfiles de su grupo"
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or public.is_admin()
  or (active = true and group_id = public.auth_group())
);

-- ----------------------------------------------------------------------------
-- 3) events
-- ----------------------------------------------------------------------------
drop policy if exists "Admin gestiona eventos" on public.events;
drop policy if exists "Usuarios consultan eventos publicados" on public.events;
drop policy if exists "Admin o admin de grupo gestiona eventos" on public.events;
drop policy if exists "Usuarios consultan eventos de su grupo" on public.events;

create policy "Admin o admin de grupo gestiona eventos"
on public.events for all to authenticated
using (public.can_manage_group(group_id))
with check (public.can_manage_group(group_id));

create policy "Usuarios consultan eventos de su grupo"
on public.events for select to authenticated
using (
  public.is_admin()
  or (
    group_id = public.auth_group()
    and (status = 'published' or public.can_manage_group(group_id))
  )
);

-- ----------------------------------------------------------------------------
-- 4) activities
-- ----------------------------------------------------------------------------
drop policy if exists "Admin gestiona actividades" on public.activities;
drop policy if exists "Usuarios consultan actividades" on public.activities;
drop policy if exists "Admin o admin de grupo gestiona actividades" on public.activities;
drop policy if exists "Usuarios consultan actividades de su grupo" on public.activities;

create policy "Admin o admin de grupo gestiona actividades"
on public.activities for all to authenticated
using (public.can_manage_group(group_id))
with check (public.can_manage_group(group_id));

create policy "Usuarios consultan actividades de su grupo"
on public.activities for select to authenticated
using (
  public.is_admin()
  or (
    group_id = public.auth_group()
    and exists (
      select 1
        from public.events e
       where e.id = activities.event_id
         and (e.status = 'published' or public.can_manage_group(e.group_id))
    )
  )
);

-- ----------------------------------------------------------------------------
-- 5) activity_assignments
-- ----------------------------------------------------------------------------
drop policy if exists "Admin crea asignaciones" on public.activity_assignments;
drop policy if exists "Admin elimina asignaciones" on public.activity_assignments;
drop policy if exists "Admin o usuario actualiza estado" on public.activity_assignments;
drop policy if exists "Usuarios consultan asignaciones" on public.activity_assignments;
drop policy if exists "Admin o admin de grupo crea asignaciones" on public.activity_assignments;
drop policy if exists "Admin o admin de grupo elimina asignaciones" on public.activity_assignments;
drop policy if exists "Admin, autor o admin de grupo actualiza estado" on public.activity_assignments;
drop policy if exists "Usuarios consultan asignaciones de su grupo" on public.activity_assignments;

create policy "Admin o admin de grupo crea asignaciones"
on public.activity_assignments for insert to authenticated
with check (
  exists (
    select 1 from public.activities a
     where a.id = activity_id
       and public.can_manage_group(a.group_id)
  )
);

create policy "Admin o admin de grupo elimina asignaciones"
on public.activity_assignments for delete to authenticated
using (
  exists (
    select 1 from public.activities a
     where a.id = activity_id
       and public.can_manage_group(a.group_id)
  )
);

-- El usuario asignado puede cambiar el estado de SU asignación (grant de
-- update limitado a la columna status); los admins pueden actualizar las de
-- su grupo.
create policy "Admin, autor o admin de grupo actualiza estado"
on public.activity_assignments for update to authenticated
using (
  public.is_admin()
  or user_id = (select auth.uid())
  or exists (
    select 1 from public.activities a
     where a.id = activity_id
       and public.can_manage_group(a.group_id)
  )
)
with check (
  public.is_admin()
  or user_id = (select auth.uid())
  or exists (
    select 1 from public.activities a
     where a.id = activity_id
       and public.can_manage_group(a.group_id)
  )
);

create policy "Usuarios consultan asignaciones de su grupo"
on public.activity_assignments for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.activities a
     where a.id = activity_id
       and a.group_id = public.auth_group()
  )
);

-- ----------------------------------------------------------------------------
-- 6) activity_user_details
-- ----------------------------------------------------------------------------
drop policy if exists "Admin gestiona instrucciones" on public.activity_user_details;
drop policy if exists "Usuario consulta sus instrucciones" on public.activity_user_details;
drop policy if exists "Admin o admin de grupo gestiona instrucciones" on public.activity_user_details;
drop policy if exists "Usuario consulta sus instrucciones del grupo" on public.activity_user_details;

create policy "Admin o admin de grupo gestiona instrucciones"
on public.activity_user_details for all to authenticated
using (
  exists (
    select 1 from public.activities a
     where a.id = activity_id
       and public.can_manage_group(a.group_id)
  )
)
with check (
  exists (
    select 1 from public.activities a
     where a.id = activity_id
       and public.can_manage_group(a.group_id)
  )
);

create policy "Usuario consulta sus instrucciones del grupo"
on public.activity_user_details for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.activities a
     where a.id = activity_id
       and public.can_manage_group(a.group_id)
  )
);

-- ----------------------------------------------------------------------------
-- 7) activity_attachments
-- ----------------------------------------------------------------------------
drop policy if exists "Admin gestiona adjuntos" on public.activity_attachments;
drop policy if exists "Usuarios consultan adjuntos" on public.activity_attachments;
drop policy if exists "Admin o admin de grupo gestiona adjuntos" on public.activity_attachments;
drop policy if exists "Usuarios consultan adjuntos de su grupo" on public.activity_attachments;

create policy "Admin o admin de grupo gestiona adjuntos"
on public.activity_attachments for all to authenticated
using (
  exists (
    select 1 from public.activities a
     where a.id = activity_id
       and public.can_manage_group(a.group_id)
  )
)
with check (
  exists (
    select 1 from public.activities a
     where a.id = activity_id
       and public.can_manage_group(a.group_id)
  )
);

create policy "Usuarios consultan adjuntos de su grupo"
on public.activity_attachments for select to authenticated
using (
  public.is_admin()
  or exists (
    select 1 from public.activities a
     where a.id = activity_id
       and a.group_id = public.auth_group()
  )
);

-- ----------------------------------------------------------------------------
-- 8) wall_posts
-- ----------------------------------------------------------------------------
drop policy if exists "Admin elimina publicaciones" on public.wall_posts;
drop policy if exists "Autor elimina su publicación" on public.wall_posts;
drop policy if exists "Todos leen publicaciones" on public.wall_posts;
drop policy if exists "Usuarios publican" on public.wall_posts;
drop policy if exists "Usuarios leen el muro de su grupo" on public.wall_posts;
drop policy if exists "Usuarios publican en su grupo" on public.wall_posts;
drop policy if exists "Autor o admin de grupo elimina su publicación" on public.wall_posts;

create policy "Usuarios leen el muro de su grupo"
on public.wall_posts for select to authenticated
using (public.is_admin() or group_id = public.auth_group());

create policy "Usuarios publican en su grupo"
on public.wall_posts for insert to authenticated
with check (
  user_id = (select auth.uid())
  and group_id = public.auth_group()
);

create policy "Autor o admin de grupo elimina su publicación"
on public.wall_posts for delete to authenticated
using (
  user_id = (select auth.uid())
  or public.can_manage_group(group_id)
);

-- ----------------------------------------------------------------------------
-- 9) VERIFICACIÓN
-- ----------------------------------------------------------------------------
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('groups','profiles','events','activities',
                    'activity_assignments','activity_user_details',
                    'activity_attachments','wall_posts')
order by tablename, policyname;

-- Prueba rápida con el rol real (ejecutar en una sesión autenticada):
--   select public.auth_group() as mi_grupo,
--          public.can_manage_group(public.auth_group()) as puedo_administrar;
--   select count(*) from public.events;    -- solo los de mi grupo
--   select count(*) from public.wall_posts;-- solo los de mi grupo
