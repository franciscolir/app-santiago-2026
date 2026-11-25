-- ============================================================================
-- sql/07_terminales.sql  —  Semilla de los 4 TERMINALES DE BUS de la RM
-- Ejecutar DESPUÉS de sql/06_map_points.sql (necesita la tabla `map_points`).
--
-- Contexto (mapas.txt §9 y filtro pedido por el usuario):
--   - NO se muestran paraderos de bus (son 12.000+ y ensucian el mapa).
--   - Se muestran SOLO las cuatro terminales generales de la RM:
--       Terminal Alameda, Terminal Sur, Terminal San Borja y Terminal Pajaritos.
--   - Son puntos GENERALES: los crea el administrador y los ve todo usuario
--     autenticado (RLS de sql/06_map_points.sql).
--
-- Datos: elementos reales de OpenStreetMap (ODbL). Cada fila guarda el
-- `external_id` con el tipo y el id del elemento OSM para poder verificarla:
--   https://www.openstreetmap.org/way/23393749   Terminal Alameda
--   https://www.openstreetmap.org/way/23393750   Terminal Sur de Buses Santiago
--   https://www.openstreetmap.org/way/39330024   Terminal San Borja
--   https://www.openstreetmap.org/node/253282386 Terminal de Buses Pajaritos
-- Coordenadas: centro del elemento OSM (no se inventan posiciones).
--
-- Es idempotente: se puede ejecutar más de una vez sin duplicar filas
-- (upsert por external_id).
--
-- ----------------------------------------------------------------------------
-- FIX 2026-11-25 · error 42P10
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--   Causa: el índice único de `external_id` es PARCIAL
--          (create unique index ... where external_id is not null).
--          PostgreSQL NO puede inferir un índice parcial con
--          `on conflict (external_id)`: hay que repetir el predicado:
--             on conflict (external_id) where external_id is not null
--   Este archivo además crea el índice si falta (por si la migración 06 se
--   ejecutó con una versión anterior) y elimina duplicados previos de las
--   CUATRO terminales para que el índice se pueda crear sin error.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Comprobaciones previas
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.map_points') is null then
    raise exception 'Falta la tabla public.map_points: ejecuta primero sql/06_map_points.sql';
  end if;
end;
$$;

-- Duplicados de las 4 terminales (si la semilla se corrió con otra versión):
-- se conserva la fila más antigua y se borran las demás.
delete from public.map_points p
using (
  select distinct on (external_id) id
  from public.map_points
  where external_id in ('way/23393749','way/23393750','way/39330024','node/253282386')
  order by external_id, created_at, id
) keep
where p.external_id in ('way/23393749','way/23393750','way/39330024','node/253282386')
  and p.id <> keep.id;

-- Índice único PARCIAL (el mismo que crea sql/06). Es el "arbiter" del
-- ON CONFLICT de abajo: por eso el `where external_id is not null` en ambos
-- lados debe coincidir exactamente.
create unique index if not exists map_points_external_id_idx
  on public.map_points (external_id) where external_id is not null;

-- ----------------------------------------------------------------------------
-- 1) Inserción/actualización de las cuatro terminales
-- ----------------------------------------------------------------------------
insert into public.map_points (
  name, description, category, subcategory, icon,
  latitude, longitude, address, comuna, source, external_id,
  tipo, created_by, visible, active
)
values
  ('Terminal Alameda',
   'Terminal de buses interurbanos de Alameda.',
   'transporte', 'Terminal de buses', 'directions_bus',
   -33.453897, -70.686544,
   'Avenida Libertador Bernardo O''Higgins 3750', 'Estación Central',
   'OpenStreetMap', 'way/23393749',
   'general', (select p.id from public.profiles p where p.role = 'admin' and p.active order by p.created_at limit 1),
   true, true),

  ('Terminal Sur de Buses Santiago',
   'Terminal de buses interurbanos del sur (ex Terminal Sur / Estación Central).',
   'transporte', 'Terminal de buses', 'directions_bus',
   -33.454207, -70.688216,
   'Avenida Libertador Bernardo O''Higgins 3850', 'Estación Central',
   'OpenStreetMap', 'way/23393750',
   'general', (select p.id from public.profiles p where p.role = 'admin' and p.active order by p.created_at limit 1),
   true, true),

  ('Terminal San Borja',
   'Terminal de buses interurbanos San Borja (también conocido como Terminal Norte).',
   'transporte', 'Terminal de buses', 'directions_bus',
   -33.454547, -70.679840,
   'San Francisco de Borja 235', 'Estación Central',
   'OpenStreetMap', 'way/39330024',
   'general', (select p.id from public.profiles p where p.role = 'admin' and p.active order by p.created_at limit 1),
   true, true),

  ('Terminal de Buses Pajaritos',
   'Terminal de buses interurbanos Pajaritos (Ruta 68).',
   'transporte', 'Terminal de buses', 'directions_bus',
   -33.457569, -70.715913,
   'Ruta 68', 'Lo Prado',
   'OpenStreetMap', 'node/253282386',
   'general', (select p.id from public.profiles p where p.role = 'admin' and p.active order by p.created_at limit 1),
   true, true)
 on conflict (external_id) where external_id is not null do update
   set name        = excluded.name,
       description = excluded.description,
       category    = excluded.category,
       subcategory = excluded.subcategory,
       icon        = excluded.icon,
       latitude    = excluded.latitude,
       longitude   = excluded.longitude,
       address     = excluded.address,
       comuna       = excluded.comuna,
       source      = excluded.source,
       tipo        = 'general',
       visible     = true,
       active      = true,
       updated_at  = now();

-- ----------------------------------------------------------------------------
-- 2) VERIFICACIÓN
-- ----------------------------------------------------------------------------
select id, name, category, subcategory, latitude, longitude, address, comuna,
       source, external_id, tipo, visible, active
from public.map_points
where tipo = 'general' and external_id in ('way/23393749','way/23393750','way/39330024','node/253282386')
order by name;
