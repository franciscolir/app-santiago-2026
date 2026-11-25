-- ============================================================================
-- sql/08_puntos_fijos.sql  —  Opción "VISTA FIJA" de los puntos del mapa
-- Ejecutar DESPUÉS de sql/06_map_points.sql (si la tabla ya existe, basta
-- con este archivo; si no, ejecuta primero sql/06).
--
-- Contexto (2026-11-25):
--   Al alejar el mapa, los puntos muestran su icono solo cerca; lejos se
--   convierten en un punto de color que se achica hasta desaparecer.
--   Los puntos marcados como "vista fija" conservan SIEMPRE su icono, a
--   cualquier zoom.
--
-- Es idempotente: se puede ejecutar más de una vez sin error.
-- ============================================================================

-- 1) Columna `fijo` (por defecto false: el comportamiento normal es el
--    "punto de color" al alejar).
alter table public.map_points
  add column if not exists fijo boolean not null default false;

comment on column public.map_points.fijo is
  'Vista fija: true = el punto muestra siempre su icono, sin convertirse en un punto de color al alejar el mapa.';

-- 2) RLS: no hacen falta políticas nuevas (la columna no cambia las reglas de
--    lectura ni de escritura: sigue mandando `tipo` + `created_by` + `is_admin`).
--    Se comprueba que las políticas sigan vigentes.
select policyname, cmd, roles::text
from pg_policies where tablename='map_points' order by policyname;

-- 3) VERIFICACIÓN
select id, name, category, tipo, visible, activo, fijo
from public.map_points
order by created_at desc
limit 20;
