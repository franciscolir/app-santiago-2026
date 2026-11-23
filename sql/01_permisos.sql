-- ============================================================================
-- DIAGNÓSTICO DE PERMISOS — APP SANTIAGO 2026
-- Supabase Dashboard → SQL Editor → New query → Run
--
-- IMPORTANTE (corrección al diagnóstico inicial):
--   La primera prueba se hizo SIN sesión, o sea con el rol "anon".
--   schema.sql solo otorga permisos a "authenticated" y "service_role",
--   por eso "anon" recibe 42501. Eso NO prueba que "authenticated" tenga
--   el problema. Este script comprueba el rol que realmente usa la app
--   después del login.
--
-- Ejecutar primero la PARTE 1 (solo lectura) y pegar el resultado.
-- La PARTE 2 solo si la Parte 1 muestra permisos faltantes.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PARTE 1 — DIAGNÓSTICO (solo lectura, no modifica nada)
-- ----------------------------------------------------------------------------

-- 1a. Privilegios actuales por rol de las tablas que usa el frontend
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('profiles','events','activities','activity_assignments',
                     'wall_posts','emergency_contacts','activity_user_details',
                     'activity_attachments')
  AND grantee IN ('anon','authenticated','service_role')
ORDER BY table_name, grantee, privilege_type;

-- 1b. Políticas RLS
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 1c. ¿EXISTE la columna status en activities?
--     schema.sql NO la define, pero el frontend la consulta en varias partes
--     (AGENT.md §5: "no asumir nombres de columnas").
--     Si esta consulta vuelve VACÍA, esa es la causa de que la agenda no cargue.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'activities'
ORDER BY ordinal_position;

-- 1d. Columnas geográficas reales (¿latitude/longitude o lat/long?)
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'activities'
  AND column_name IN ('latitude','longitude','lat','long','lng');

-- 1e. ¿RLS habilitado en cada tabla?
SELECT relname AS tabla, relrowsecurity AS rls_activado
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
ORDER BY relname;

-- 1f. Verificación funcional con el rol autenticado (la prueba definitiva):
--     devuelve 1 fila si authenticated puede leer, 0 si no.
SET LOCAL ROLE authenticated;
SELECT (SELECT count(*) FROM public.events)            AS eventos_visibles,
       (SELECT count(*) FROM public.activities)        AS actividades_visibles,
       (SELECT count(*) FROM public.profiles)          AS perfiles_visibles,
       (SELECT count(*) FROM public.wall_posts)        AS muro_visible,
       (SELECT count(*) FROM public.emergency_contacts) AS contactos_visibles;
RESET ROLE;


-- ----------------------------------------------------------------------------
-- PARTE 2 — ARREGLO (solo si 1a/1f muestran permisos faltantes)
-- GRANT es idempotente: repetirlo no rompe nada.
-- ----------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (full_name) ON TABLE public.profiles TO authenticated;

GRANT SELECT ON TABLE public.events TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activities TO authenticated;

GRANT SELECT, INSERT, DELETE ON TABLE public.activity_assignments TO authenticated;
GRANT UPDATE (status) ON TABLE public.activity_assignments TO authenticated;

GRANT SELECT ON TABLE public.activity_user_details TO authenticated;

GRANT SELECT, INSERT, DELETE ON TABLE public.wall_posts TO authenticated;

GRANT SELECT ON TABLE public.emergency_contacts TO authenticated;

GRANT SELECT ON TABLE public.activity_attachments TO authenticated;


-- ----------------------------------------------------------------------------
-- PARTE 3 — ¿FALTA LA COLUMNA status EN activities?
-- Si 1c salió vacío, esto la agrega. Solo ejecutar si 1c lo confirmó.
-- (No borrar datos: add column sin DEFAULT no toca las filas existentes.)
-- ----------------------------------------------------------------------------

-- ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS status text
--   DEFAULT 'pending'
--   CHECK (status IN ('pending','in_progress','completed','cancelled'));
