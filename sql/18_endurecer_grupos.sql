-- ============================================================================
-- sql/18_endurecer_grupos.sql — Cierre de permisos de grupo (2026-11-26)
--
-- Hallazgo de la batería QA: el MANAGER podía actualizar su fila de `groups`
-- por API (nombre, slug, active) porque la política heredada
-- "Admin de grupo edita su grupo" usaba can_manage_group(). La UI no ofrecía
-- esa edición, pero la API sí la permitía.
--
-- Decisión: la gestión de la fila del grupo (nombre, slug, descripción,
-- active) queda SOLO para el ADMIN general. El MANAGER conserva actividades,
-- evento, puntos y muro de su grupo.
--
-- Es idempotente.
-- ============================================================================

drop policy if exists "Admin de grupo edita su grupo" on public.groups;

-- "Admin gestiona grupos" (ALL, is_admin()) sigue cubriendo SELECT/INSERT/
-- UPDATE/DELETE del ADMIN. La política de miembro sigue permitiendo SELECT de
-- su propio grupo.

-- Verificación:
select policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename = 'groups'
order by policyname;
