-- ============================================================================
-- sql/16_jw_actividades.sql — Categoría JW y vínculo actividad ↔ punto JW
-- (2026-11-26, Fase 3 = Etapa 4 del UPDATE.md).
--
-- Ejecutar DESPUÉS de sql/10, sql/11, sql/14 y sql/15.
--
-- Qué hace:
--   1. Agrega `activities.map_point_id` (FK a map_points, ON DELETE SET NULL).
--   2. Trigger que exige que el punto sea de categoría `jw` y que pertenezca al
--      mismo grupo de la actividad (o sea global).
--   3. Índice por `map_point_id`.
--
-- La categoría `jw` ya existe en `map_categories` (sql/15), con icono `salon`
-- por defecto. El tamaño +20 % y el icono permanente los aplica el frontend.
--
-- Es idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Comprobaciones previas
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.activities') is null then
    raise exception 'Falta public.activities: aplica primero el esquema base.';
  end if;
  if to_regclass('public.map_points') is null then
    raise exception 'Falta public.map_points: ejecuta primero sql/06_map_points.sql';
  end if;
  if not exists (select 1 from public.map_categories where slug = 'jw') then
    raise exception 'Falta la categoría jw: ejecuta primero sql/15_categorias_puntos.sql';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1) Columna y FK
-- ----------------------------------------------------------------------------
-- El catálogo de iconos lo valida la app (ICONOS_MAPA). El CHECK antiguo de la
-- tabla no conoce los SVG nuevos (salon, betel, predicación, exhibidor, …).
alter table public.map_points drop constraint if exists map_points_icon_check;

alter table public.activities
  add column if not exists map_point_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'activities_map_point_id_fkey'
      and conrelid = 'public.activities'::regclass
  ) then
    alter table public.activities
      add constraint activities_map_point_id_fkey
      foreign key (map_point_id) references public.map_points(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists activities_map_point_idx
  on public.activities (map_point_id);

comment on column public.activities.map_point_id is
  'Punto JW donde se realiza la actividad (UPDATE.md §4). Si se borra el punto, la actividad conserva sus coordenadas.';

-- ----------------------------------------------------------------------------
-- 2) Trigger de validación
-- ----------------------------------------------------------------------------
create or replace function public.validar_punto_actividad()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_categoria text;
  v_scope text;
  v_group uuid;
  v_act_group uuid;
begin
  if new.map_point_id is null then
    return new;
  end if;

  select p.category, p.scope, p.group_id
    into v_categoria, v_scope, v_group
    from public.map_points p
   where p.id = new.map_point_id;

  if not found then
    raise exception 'El punto JW de la actividad no existe.'
      using errcode = '23503';
  end if;

  if v_categoria <> 'jw' then
    raise exception 'La actividad debe usar un punto de categoría JW (el punto es %).', v_categoria
      using errcode = '23514';
  end if;

  v_act_group := coalesce(
    new.group_id,
    (select e.group_id from public.events e where e.id = new.event_id)
  );

  if v_scope = 'group' and v_group is distinct from v_act_group then
    raise exception 'El punto JW pertenece a otro grupo.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists activities_validar_punto on public.activities;
create trigger activities_validar_punto
  before insert or update of map_point_id on public.activities
  for each row execute function public.validar_punto_actividad();

-- ----------------------------------------------------------------------------
-- 3) VERIFICACIÓN
-- ----------------------------------------------------------------------------
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'activities'
  and column_name = 'map_point_id';

select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.activities'::regclass
  and conname = 'activities_map_point_id_fkey';

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'activities'
  and indexname = 'activities_map_point_idx';

select tgname, tgrelid::regclass as tabla
from pg_trigger
where tgname = 'activities_validar_punto';

-- Recordatorio:
--   - Crear/editar un punto JW desde el mapa (categoría JW).
--   - Al crear/editar una actividad, elegir el punto JW; si no hay, usar
--     "Marcar actividad en el mapa".
--   - El frontend muestra los JW siempre con icono (nunca como punto de color)
--     y un 20 % más grandes.
