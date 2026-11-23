-- ============================================================================
-- 01_diagnostico.sql  —  SOLO LECTURA. No modifica nada.
-- Supabase Dashboard → SQL Editor → New query → Run
--
-- Si alguna consulta falla con 42501, anota CUÁL (el error dice la tabla).
-- El resultado de estas 4 consultas es lo que necesito para dar el arreglo
-- exacto. Ninguna de ellas depende de permisos sobre las tablas de negocio.
-- ============================================================================

-- 1) Privilegios actuales por rol (¿qué falta realmente?)
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('profiles','events','activities','activity_assignments',
                     'wall_posts','emergency_contacts','activity_user_details',
                     'activity_attachments')
  AND grantee IN ('anon','authenticated','service_role')
ORDER BY table_name, grantee, privilege_type;

-- 2) ¿RLS está habilitado en cada tabla?
SELECT c.relname AS tabla, c.relrowsecurity AS rls_activado
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- 3) Columnas REALES de activities.
--    Necesito saber si existe "status" (schema.sql NO la define, pero el
--    frontend la consulta) y si las coordenadas son latitude/longitude o lat/long.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'activities'
ORDER BY ordinal_position;

-- 4) Políticas RLS vigentes
SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
