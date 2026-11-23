-- ============================================================================
-- 03_verificacion.sql  —  PRUEBA FINAL con el rol que usa la app.
-- Ejecutar DESPUÉS de 02_grants.sql.
--
-- Reproduce lo que hace la app después del login (rol authenticated).
-- Si devuelve números > 0, la integración funciona. Si falla, el error dice
-- exactamente qué falta.
-- ============================================================================

-- A) Lectura como la hace la agenda (evento publicado + sus actividades)
SET LOCAL ROLE authenticated;

SELECT 'events'            AS tabla, count(*) AS filas FROM public.events
UNION ALL
SELECT 'activities',       count(*) FROM public.activities
UNION ALL
SELECT 'profiles',         count(*) FROM public.profiles
UNION ALL
SELECT 'wall_posts',       count(*) FROM public.wall_posts
UNION ALL
SELECT 'emergency_contacts', count(*) FROM public.emergency_contacts
ORDER BY tabla;

RESET ROLE;

-- B) ¿Existe la columna status en activities? (si sale vacío, falta migrarla)
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'activities'
  AND column_name = 'status';

-- C) ¿Las columnas geográficas son latitude/longitude o lat/long?
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'activities'
  AND column_name IN ('latitude','longitude','lat','long','lng');
