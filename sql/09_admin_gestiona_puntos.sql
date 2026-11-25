-- ============================================================================
-- sql/09_admin_gestiona_puntos.sql  —  El ADMIN puede gestionar TODOS los
-- puntos del mapa (2026-11-25).
--
-- Contexto:
--   - La app tiene una pantalla de "Gestionar puntos del mapa" (solo admin):
--     lista por tipo, cambiar el nombre, marcar/desmarcar si se muestra en el
--     mapa y borrar; luego un botón "Guardar".
--   - Con las políticas de sql/06_map_points.sql el admin solo podía escribir
--     en los puntos GENERALES: los puntos PERSONALES de otros usuarios
--     quedaban bloqueados por RLS (error 42501 al guardar o borrar).
--   - Esta migración agrega una política que permite al admin escribir en
--     cualquier punto. NO cambia nada para los demás usuarios: las políticas
--     de sql/06 siguen vigente para ellos (cada uno solo edita sus puntos
--     personales).
--
-- Es idempotente: se puede ejecutar más de una vez.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Comprobaciones previas
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.map_points') is null then
    raise exception 'Falta la tabla public.map_points: ejecuta primero sql/06_map_points.sql';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) Política: el administrador gestiona cualquier punto (general o personal)
-- ----------------------------------------------------------------------------
drop policy if exists "Admin gestiona todos los puntos" on public.map_points;

create policy "Admin gestiona todos los puntos"
on public.map_points for all to authenticated
using (is_admin())
with check (is_admin());

-- ----------------------------------------------------------------------------
-- 3) VERIFICACIÓN
-- ----------------------------------------------------------------------------
select policyname, cmd, roles::text, qual, with_check
from pg_policies
where tablename = 'map_points'
order by policyname;

-- Recordatorio: la columna que controla si el punto se ve en el mapa es
-- `visible` (y `active` para desactivar el punto; `fijo` para que su icono
-- no se achique al alejar).
select id, name, tipo, visible, active, fijo
from public.map_points
order by tipo, name;
