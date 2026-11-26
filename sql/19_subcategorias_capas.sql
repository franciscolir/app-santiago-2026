-- ============================================================================
-- sql/19_subcategorias_capas.sql — Categorías → subcategorías/capas (2026-11-26)
--
-- Ejecutar DESPUÉS de sql/18_endurecer_grupos.sql.
--
-- Modelo:
--   map_categories      categoría padre (Transporte, Áreas verdes, JW, ...)
--   map_subcategories   subcategoría = capa (Metro, Parques, ...), con color,
--                       icono, comportamiento y layer_key opcional.
--   map_points          cada punto pertenece a una subcategoría.
--   map_layer_point_overrides
--                       visibilidad GLOBAL de puntos importados (GeoJSON), por
--                       layer_key + external_id (osm_id / gtfs_stop_id).
--
-- Reglas:
--   - Solo el ADMIN escribe categorías/subcategorías/overrides.
--   - Todos los autenticados leen.
--   - Cada categoría actual recibe una subcategoría "general" y los puntos se
--     reasignan allí sin perder color/icono.
--   - JW conserva render_mode='icon' en todas sus subcategorías.
--
-- Idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Comprobaciones
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.map_categories') is null
     or to_regclass('public.map_points') is null then
    raise exception 'Faltan map_categories/map_points: aplica sql/15 primero.';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) Subcategorías
-- ----------------------------------------------------------------------------
create table if not exists public.map_subcategories (
  id uuid primary key default gen_random_uuid(),
  category_slug text not null references public.map_categories(slug)
    on update cascade on delete cascade,
  slug text not null,
  name text not null,
  color text not null default '#006492',
  icon text not null default 'place',
  render_mode text not null default 'auto',
  layer_key text,
  sort integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint map_subcategories_slug_check check (slug ~ '^[a-z0-9][a-z0-9_-]{0,40}$'),
  constraint map_subcategories_color_check check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint map_subcategories_name_check check (char_length(btrim(name)) between 2 and 80),
  constraint map_subcategories_render_check check (render_mode in ('auto', 'icon')),
  constraint map_subcategories_category_slug_key unique (category_slug, slug)
);

comment on table public.map_subcategories is
  'Subcategoría = capa. Define color, icono, comportamiento y, opcionalmente, la capa externa (metro, parques...).';
comment on column public.map_subcategories.layer_key is
  'Id de CAPAS_DEF para capas importadas (metro, parques, ...). NULL = subcategoría de puntos manuales.';
comment on column public.map_subcategories.render_mode is
  'auto = icono/punto según zoom; icon = siempre icono (JW lo fuerza).';

create unique index if not exists map_subcategories_layer_key_key
  on public.map_subcategories (layer_key)
  where layer_key is not null;

create index if not exists map_subcategories_category_idx
  on public.map_subcategories (category_slug, sort);

alter table public.map_subcategories enable row level security;

drop policy if exists "Subcategorías visibles para autenticados" on public.map_subcategories;
create policy "Subcategorías visibles para autenticados"
on public.map_subcategories for select to authenticated
using (true);

drop policy if exists "Admin gestiona subcategorías" on public.map_subcategories;
create policy "Admin gestiona subcategorías"
on public.map_subcategories for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.set_map_subcategories_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists map_subcategories_updated_at on public.map_subcategories;
create trigger map_subcategories_updated_at
  before update on public.map_subcategories
  for each row execute function public.set_map_subcategories_updated_at();

grant select on public.map_subcategories to authenticated;
grant insert, update, delete on public.map_subcategories to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Punto → subcategoría
-- ----------------------------------------------------------------------------
alter table public.map_points
  add column if not exists subcategory_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'map_points_subcategory_id_fkey'
      and conrelid = 'public.map_points'::regclass
  ) then
    alter table public.map_points
      add constraint map_points_subcategory_id_fkey
      foreign key (subcategory_id) references public.map_subcategories(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists map_points_subcategory_idx
  on public.map_points (subcategory_id);

-- ----------------------------------------------------------------------------
-- 3) Subcategoría "general" para cada categoría existente
-- ----------------------------------------------------------------------------
insert into public.map_subcategories (category_slug, slug, name, color, icon, render_mode, layer_key, sort, active)
select c.slug, 'general', 'General', c.color, c.icon,
       case when c.slug = 'jw' then 'icon' else 'auto' end,
       null, 10, true
  from public.map_categories c
on conflict (category_slug, slug) do nothing;

-- Capas externas: una subcategoría por capa, vinculada a CAPAS_DEF.
insert into public.map_subcategories (category_slug, slug, name, color, icon, render_mode, layer_key, sort, active)
select v.category_slug, v.slug, v.name, v.color, v.icon, v.render_mode, v.layer_key, v.sort, true
  from (values
    ('transporte','metro','Metro','#0f7fd4','metro','auto','metro',20),
    ('transporte','metrotren','MetroTren','#0f7fd4','metro','auto','metrotren',30),
    ('transporte','buses','Buses','#0f7fd4','directions_bus','auto',null,40),
    ('areas_verdes','parques','Parques','#2e9e4f','park','auto','parques',20),
    ('areas_verdes','plazas','Plazas','#8bc34a','park','auto','plazas',30),
    ('comercio','malls','Malls','#e8590c','store','auto','comercio',20),
    ('salud','urgencias','Urgencias','#e03131','health_and_safety','auto','salud',20),
    ('seguridad','policia','Policía','#1c7ed6','warning','auto','seguridad',20),
    ('bomberos','bomberos','Bomberos','#c92a2a','bomberos','auto','bomberos',20),
    ('otros','municipalidades','Municipalidades','#0ca678','casa','auto','servicios',20)
  ) as v(category_slug,slug,name,color,icon,render_mode,layer_key,sort)
 where exists (select 1 from public.map_categories c where c.slug = v.category_slug)
on conflict (category_slug, slug) do nothing;

-- Backfill: cada punto va a la subcategoría general de su categoría.
update public.map_points p
   set subcategory_id = s.id
  from public.map_subcategories s
 where p.subcategory_id is null
   and s.category_slug = p.category
   and s.slug = 'general';

-- JW: todas sus subcategorías heredan "siempre icono".
update public.map_subcategories
   set render_mode = 'icon'
 where category_slug = 'jw';

-- ----------------------------------------------------------------------------
-- 4) Overrides de visibilidad de puntos externos (global)
-- ----------------------------------------------------------------------------
create table if not exists public.map_layer_point_overrides (
  id uuid primary key default gen_random_uuid(),
  layer_key text not null,
  external_id text not null,
  visible boolean not null default true,
  subcategory_id uuid references public.map_subcategories(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint map_layer_point_overrides_key unique (layer_key, external_id)
);

comment on table public.map_layer_point_overrides is
  'Visibilidad global de un punto importado (GeoJSON) por capa + external_id. Solo ADMIN escribe.';

create index if not exists map_layer_point_overrides_layer_idx
  on public.map_layer_point_overrides (layer_key);

alter table public.map_layer_point_overrides enable row level security;

drop policy if exists "Overrides visibles para autenticados" on public.map_layer_point_overrides;
create policy "Overrides visibles para autenticados"
on public.map_layer_point_overrides for select to authenticated
using (true);

drop policy if exists "Admin gestiona overrides" on public.map_layer_point_overrides;
create policy "Admin gestiona overrides"
on public.map_layer_point_overrides for all to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.map_layer_point_overrides to authenticated;
grant insert, update, delete on public.map_layer_point_overrides to authenticated;

-- ----------------------------------------------------------------------------
-- 5) Verificación
-- ----------------------------------------------------------------------------
select c.slug as categoria, count(s.id) as subcategorias
  from public.map_categories c
  left join public.map_subcategories s on s.category_slug = c.slug
 group by c.slug order by c.slug;

select count(*) as puntos_sin_subcategoria
  from public.map_points where subcategory_id is null;

select policyname, cmd from pg_policies
 where schemaname='public' and tablename in ('map_subcategories','map_layer_point_overrides')
 order by tablename, policyname;
