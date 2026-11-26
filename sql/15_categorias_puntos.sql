-- ============================================================================
-- sql/15_categorias_puntos.sql — Categorías, colores, gestión individual y
-- alcance global/grupo de los puntos del mapa (2026-11-26, Fase 2).
--
-- Ejecutar DESPUÉS de sql/06, sql/10 y sql/14.
--
-- Qué hace:
--   1. Crea `map_categories` (nombre, icono, color, orden, activa) y la siembra
--      con las categorías del UPDATE.md (mall, policía, bomberos, hospital,
--      centro de salud, metro, parque, kiosco, expositor, otros, JW, general)
--      y CONSERVA las categorías anteriores (seguridad, salud, educación,
--      transporte, comercio, áreas verdes, otro).
--   2. Convierte `map_points.category` en una FK a las categorías SIN renombrar
--      los puntos existentes (los 4 terminales de buses siguen en `transporte`).
--   3. Agrega `map_points.group_id` y `map_points.scope` ('global'|'group'),
--      rellena los datos existentes y crea el trigger de compatibilidad.
--   4. Reescribe las políticas RLS de `map_points` por grupo/alcance.
--   5. Crea/ajusta los GRANT de `map_categories`.
--
-- Decisiones:
--   - El color de cada categoría es compartido y solo lo edita el admin global.
--   - Un punto GENERAL puede ser global (todos los grupos) o de grupo.
--   - Un punto PERSONAL siempre es del grupo de su autor.
--   - El admin de grupo gestiona los puntos de su grupo; el admin global, todos.
--
-- Es idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Comprobaciones previas
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.map_points') is null then
    raise exception 'Falta public.map_points: ejecuta primero sql/06_map_points.sql';
  end if;
  if to_regclass('public.groups') is null then
    raise exception 'Falta public.groups: ejecuta primero sql/10_grupos.sql';
  end if;
  if to_regprocedure('public.auth_group()') is null
     or to_regprocedure('public.can_manage_group(uuid)') is null then
    raise exception 'Faltan auth_group()/can_manage_group(): ejecuta primero sql/10_grupos.sql';
  end if;
end;
$$;

-- ============================================================================
-- 1) CATEGORÍAS
-- ============================================================================
create table if not exists public.map_categories (
  slug       text primary key,
  name       text not null,
  icon       text not null default 'place',
  color      text not null default '#006492',
  sort       integer not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint map_categories_slug_check check (slug ~ '^[a-z0-9_]{2,40}$'),
  constraint map_categories_color_check check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint map_categories_name_check check (char_length(btrim(name)) between 2 and 80)
);

comment on table public.map_categories is
  'Categorías de los puntos del mapa: nombre, icono por defecto, color del punto al alejar y orden (UPDATE.md Etapa 3). Conserva las categorías anteriores y agrega las nuevas.';
comment on column public.map_categories.color is
  'Color con el que la categoría se dibuja como punto circular cuando el mapa se aleja.';

alter table public.map_categories enable row level security;

-- Categorías NUEVAS del UPDATE.md (§3.2) + `general`.
insert into public.map_categories (slug, name, icon, color, sort) values
  ('general',      'General',                    'place',             '#006492',  10),
  ('mall',         'Mall / Centro comercial',    'store',             '#e8590c',  20),
  ('policia',      'Policía',                    'warning',           '#1c7ed6',  30),
  ('bomberos',     'Bomberos',                   'bomberos',          '#c92a2a',  40),
  ('hospital',     'Hospital',                   'hospital',          '#e03131',  50),
  ('centro_salud', 'Centro de salud',            'health_and_safety', '#0ca678',  60),
  ('metro',        'Metro / Estación de metro',  'metro',             '#f2b705',  70),
  ('parque',       'Parque',                     'park',              '#2e9e4f',  80),
  ('kiosco',       'Kiosco',                     'store',             '#7048e8',  90),
  ('expositor',    'Expositor',                  'info',              '#0f7fd4', 100),
  ('otros',        'Otros puntos de interés',    'place',             '#5f6871', 110),
  ('jw',           'JW',                         'salon',             '#006492', 120)
on conflict (slug) do nothing;

-- Categorías ANTERIORES: se conservan (el documento lo pide) para no perder
-- la clasificación de los puntos existentes (p. ej. los 4 terminales de buses
-- están en `transporte`). Se pueden unificar más adelante desde el catálogo.
insert into public.map_categories (slug, name, icon, color, sort) values
  ('seguridad',    'Seguridad',                  'warning',           '#c92a2a', 210),
  ('salud',        'Salud',                      'health_and_safety', '#e03131', 220),
  ('educacion',    'Educación',                  'school',            '#7048e8', 230),
  ('transporte',   'Transporte',                 'directions_bus',    '#0f7fd4', 240),
  ('comercio',     'Comercio',                   'store',             '#e8590c', 250),
  ('areas_verdes', 'Áreas verdes',               'park',              '#2e9e4f', 260),
  ('otro',         'Otro',                       'place',             '#5f6871', 270)
on conflict (slug) do nothing;

create or replace function public.set_map_categories_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists map_categories_updated_at on public.map_categories;
create trigger map_categories_updated_at
  before update on public.map_categories
  for each row execute function public.set_map_categories_updated_at();

-- ============================================================================
-- 2) MAP_POINTS: categoría (FK)
-- ============================================================================
alter table public.map_points drop constraint if exists map_points_category_check;

-- Las categorías antiguas se conservan: NO se renombran los puntos existentes.
-- Solo se asegura que ningún valor quede fuera del catálogo (no debería).
update public.map_points
   set category = 'otros'
 where category not in (select slug from public.map_categories);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'map_points_category_fkey'
      and conrelid = 'public.map_points'::regclass
  ) then
    alter table public.map_points
      add constraint map_points_category_fkey
      foreign key (category) references public.map_categories(slug)
      on update cascade on delete restrict;
  end if;
end;
$$;

-- ============================================================================
-- 3) MAP_POINTS: alcance global/grupo
-- ============================================================================
alter table public.map_points add column if not exists group_id uuid;
alter table public.map_points add column if not exists scope text not null default 'group';

-- Backfill:
--   - Los puntos GENERALES existentes (terminales, referencias) eran visibles
--     para todos → scope 'global'.
--   - Los PERSONALES quedan en el grupo de su autor (o el principal).
update public.map_points
   set scope = 'global', group_id = null
 where tipo = 'general';

update public.map_points p
   set group_id = pr.group_id
  from public.profiles pr
 where p.group_id is null
   and p.scope = 'group'
   and pr.id = p.created_by;

update public.map_points
   set group_id = (select id from public.groups where slug = 'principal')
 where group_id is null and scope = 'group';

-- Los puntos GLOBALES no llevan grupo, aunque su autor pertenezca a uno.
update public.map_points
   set group_id = null
 where scope = 'global';

-- Constraints (después del backfill para no validar datos intermedios).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'map_points_scope_check'
      and conrelid = 'public.map_points'::regclass
  ) then
    alter table public.map_points
      add constraint map_points_scope_check check (scope in ('global','group'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'map_points_scope_group_check'
      and conrelid = 'public.map_points'::regclass
  ) then
    alter table public.map_points
      add constraint map_points_scope_group_check check (scope = 'global' or group_id is not null);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'map_points_group_id_fkey'
      and conrelid = 'public.map_points'::regclass
  ) then
    alter table public.map_points
      add constraint map_points_group_id_fkey
      foreign key (group_id) references public.groups(id) on delete restrict;
  end if;
end;
$$;

create index if not exists map_points_group_idx on public.map_points (group_id);
create index if not exists map_points_scope_idx on public.map_points (scope);

-- Trigger de compatibilidad: rellena grupo/alcance si el cliente no los envía.
--   - Personal → grupo del autor, scope 'group'.
--   - General sin grupo (cliente antiguo) → global (como antes).
--   - General con grupo → scope 'group' (o 'global' si el admin lo indica).
create or replace function public.asignar_grupo_punto()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.tipo = 'personal' then
    new.scope := 'group';
    new.group_id := public.auth_group();
  elsif new.tipo = 'general' then
    if new.scope is null then new.scope := 'group'; end if;
    if new.scope = 'group' and new.group_id is null then
      -- Sin grupo explícito: comportamiento anterior (visible para todos).
      new.scope := 'global';
    end if;
    if new.scope = 'global' then
      new.group_id := null;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists map_points_asignar_grupo on public.map_points;
create trigger map_points_asignar_grupo
  before insert on public.map_points
  for each row execute function public.asignar_grupo_punto();

-- ============================================================================
-- 4) RLS de map_points por grupo/alcance
-- ============================================================================
drop policy if exists "Usuarios consultan puntos del mapa" on public.map_points;
drop policy if exists "Usuarios gestionan sus puntos personales" on public.map_points;
drop policy if exists "Admin gestiona puntos generales" on public.map_points;
drop policy if exists "Admin gestiona todos los puntos" on public.map_points;
drop policy if exists "Puntos visibles por grupo o globales" on public.map_points;
drop policy if exists "Autor gestiona sus puntos personales" on public.map_points;
drop policy if exists "Admin o admin de grupo gestiona puntos generales" on public.map_points;
drop policy if exists "Admin global gestiona todos los puntos" on public.map_points;

-- Lectura:
--   - admin global: todo.
--   - admin de grupo: los de su grupo (incluidos los ocultos) y los globales visibles.
--   - autor: sus personales.
--   - resto: generales activos, visibles, globales o de su grupo.
create policy "Puntos visibles por grupo o globales"
on public.map_points for select to authenticated
using (
  public.is_admin()
  or public.can_manage_group(group_id)
  or (tipo = 'personal' and created_by = (select auth.uid()))
  or (
    tipo = 'general'
    and active = true
    and visible = true
    and (scope = 'global' or group_id = public.auth_group())
  )
);

-- Escritura personal: solo el autor, en su grupo.
create policy "Autor gestiona sus puntos personales"
on public.map_points for all to authenticated
using (tipo = 'personal' and created_by = (select auth.uid()))
with check (
  tipo = 'personal'
  and created_by = (select auth.uid())
  and group_id = public.auth_group()
  and scope = 'group'
);

-- El admin de grupo también modera los puntos personales de su grupo.
create policy "Admin de grupo gestiona puntos personales de su grupo"
on public.map_points for all to authenticated
using (tipo = 'personal' and public.can_manage_group(group_id))
with check (tipo = 'personal' and public.can_manage_group(group_id));

-- Escritura general: admin global o admin del grupo. El admin de grupo no
-- puede crear puntos globales.
create policy "Admin o admin de grupo gestiona puntos generales"
on public.map_points for all to authenticated
using (public.is_admin() or (tipo = 'general' and public.can_manage_group(group_id)))
with check (
  public.is_admin()
  or (
    tipo = 'general'
    and public.can_manage_group(group_id)
    and (scope = 'group' or public.is_admin())
  )
);

-- El admin global modera cualquier punto (incluidos los personales de otros).
create policy "Admin global gestiona todos los puntos"
on public.map_points for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ============================================================================
-- 5) RLS y GRANT de map_categories
-- ============================================================================
drop policy if exists "Categorías visibles para autenticados" on public.map_categories;
drop policy if exists "Admin gestiona las categorías" on public.map_categories;

create policy "Categorías visibles para autenticados"
on public.map_categories for select to authenticated
using (true);

create policy "Admin gestiona las categorías"
on public.map_categories for all to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.map_categories to authenticated, service_role;
grant insert, update, delete on public.map_categories to authenticated, service_role;

-- ============================================================================
-- 6) VERIFICACIÓN
-- ============================================================================
select slug, name, icon, color, sort, active
from public.map_categories
order by sort, slug;

select tipo, scope, count(*) as puntos, count(group_id) as con_grupo
from public.map_points
group by tipo, scope
order by tipo, scope;

select category, count(*) as puntos
from public.map_points
group by category
order by category;

select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.map_points'::regclass
  and conname in ('map_points_category_fkey','map_points_group_id_fkey',
                  'map_points_scope_check','map_points_scope_group_check')
order by conname;

select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'map_points'
order by policyname;

-- Recordatorio: las categorías nuevas usan los iconos del catálogo de la app
-- (place, store, warning, bomberos, hospital, health_and_safety, metro, park,
-- info, salon). El color se aplica al punto circular cuando el mapa se aleja.
