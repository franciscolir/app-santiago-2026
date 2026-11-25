-- ============================================================================
-- sql/06_map_points.sql  —  Tabla de puntos personalizados del mapa
-- Ejecutar DESPUÉS de sql/05_grants_admin.sql.
--
-- Contexto (mapas.txt §9, §8 y Etapa 5):
--   - Los administradores pueden agregar puntos GENERALES (visibles para todos)
--     directamente desde el mapa (§9: "el admin dispone un ingreso de puntos
--     públicos a todo usuario").
--   - TODOS los usuarios (incluido admin) pueden registrar puntos PERSONALES
--     presionando un punto en el mapa, indicando nombre y eligiendo icono.
--   - Los puntos son INDEPENDIENTES de los importados de fuentes externas.
--
-- Modelo de datos:
--   - tipo = 'personal' (solo el dueño lo ve/edita) o 'general' (todos lo ven,
--     solo admin lo crea/edita/elimina).
--   - Campos §8: subcategoría, dirección, comuna, fuente, activo, identificación
--     externa, fechas.
--   - PostGIS NO disponible en el proyecto → coordenadas lat/lon simples.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabla (idempotente: si existe, no la recrea)
-- ----------------------------------------------------------------------------
create table if not exists public.map_points (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null check (char_length(btrim(name)) between 1 and 120),
  description text        not null default '',
  category    text        not null default 'general'
              check (category in ('general','seguridad','salud','educacion','transporte','comercio','areas_verdes','otro')),
  subcategory text,
  icon        text        not null default 'place',
  latitude    double precision not null check (latitude between -34.5 and -32.7),
  longitude   double precision not null check (longitude between -72.0 and -69.5),
  address     text,
  comuna      text,
  source      text,
  external_id text,
  active      boolean     not null default true,
  visible     boolean     not null default true,
  tipo        text        not null default 'personal'
              check (tipo in ('personal','general')),
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.map_points is
  'Puntos personalizados del mapa. tipo=personal (solo el autor) o general (admin, visible para todos) (mapas.txt §9).';

-- ----------------------------------------------------------------------------
-- 2) Si la tabla ya existía sin las columnas nuevas, las añade (idempotente)
-- ----------------------------------------------------------------------------
alter table public.map_points add column if not exists subcategory text;
alter table public.map_points add column if not exists address text;
alter table public.map_points add column if not exists comuna text;
alter table public.map_points add column if not exists source text;
alter table public.map_points add column if not exists external_id text;
alter table public.map_points add column if not exists active boolean default true;
alter table public.map_points add column if not exists visible boolean default true;
alter table public.map_points add column if not exists tipo text default 'personal'
              check (tipo in ('personal','general'));

-- ----------------------------------------------------------------------------
-- 3) Índices
-- ----------------------------------------------------------------------------
create index if not exists map_points_visible_idx   on public.map_points (visible);
create index if not exists map_points_tipo_idx       on public.map_points (tipo);
create index if not exists map_points_created_by_idx on public.map_points (created_by);
create index if not exists map_points_coords_idx     on public.map_points (latitude, longitude);
create index if not exists map_points_category_idx   on public.map_points (category);
-- Identificador externo único (id de OSM, etc.): permite reimportar sin duplicar.
create unique index if not exists map_points_external_id_idx
  on public.map_points (external_id) where external_id is not null;

-- ----------------------------------------------------------------------------
-- 4) updated_at automático
-- ----------------------------------------------------------------------------
create or replace function public.set_map_points_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists trg_map_points_updated_at on public.map_points;
create trigger trg_map_points_updated_at
before update on public.map_points
for each row execute function public.set_map_points_updated_at();

-- ----------------------------------------------------------------------------
-- 5) RLS + políticas
-- ----------------------------------------------------------------------------
alter table public.map_points enable row level security;

drop policy if exists "Usuarios consultan puntos del mapa" on public.map_points;
drop policy if exists "Usuarios gestionan sus puntos personales" on public.map_points;
drop policy if exists "Admin gestiona puntos generales" on public.map_points;

-- Lectura (mapas.txt §9):
--   - Los puntos GENERALES activos y visibles los ve cualquier usuario autenticado.
--   - Los puntos PERSONALES solo los ve su autor (created_by = auth.uid()).
--   - El ADMIN ve todos los puntos (puede moderar los personales).
create policy "Usuarios consultan puntos del mapa"
on public.map_points for select to authenticated
using (
  (tipo = 'general' and visible = true and active = true)
  or (tipo = 'personal' and created_by = auth.uid())
  or is_admin()
);

-- Escritura personal: cualquier usuario crea/edita/elimina SUS puntos personales.
create policy "Usuarios gestionan sus puntos personales"
on public.map_points for all to authenticated
using (tipo='personal' and created_by=auth.uid())
with check (tipo='personal' and created_by=auth.uid());

-- Escritura general: solo admin crea/edita/elimina puntos generales.
create policy "Admin gestiona puntos generales"
on public.map_points for all to authenticated
using (tipo='general' and is_admin())
with check (tipo='general' and is_admin());

-- ----------------------------------------------------------------------------
-- 6) GRANTS (idempotente)
-- ----------------------------------------------------------------------------
grant select on public.map_points to authenticated;
grant insert, update, delete on public.map_points to authenticated;

-- ----------------------------------------------------------------------------
-- 7) VERIFICACIÓN
-- ----------------------------------------------------------------------------
select relname, relrowsecurity
from pg_class where relname='map_points';

select policyname, cmd, roles::text
from pg_policies where tablename='map_points' order by policyname;

select table_name, privilege_type
from information_schema.role_table_grants
where table_schema='public' and grantee='authenticated' and table_name='map_points'
order by privilege_type;
