-- ============================================================================
-- 04_coordenadas.sql  —  Da coordenadas a las 5 actividades de prueba
-- Ejecutar DESPUÉS de verificar con sql/03_verificacion.sql.
--
-- AGENT.md §7: las actividades de prueba se insertaron en SQL sin coordenadas,
-- por eso el mapa carga la lista pero no muestra ningún marcador.
--
-- IMPORTANTE: las coordenadas de abajo son APROXIMADAS (centro de cada lugar
-- en Santiago). Ajustar si se necesita precisión real.
-- ============================================================================

-- Ver ANTES: cuáles siguen sin coordenadas
SELECT id, title, activity_date, place, latitude, longitude
FROM public.activities
WHERE latitude IS NULL OR longitude IS NULL
ORDER BY activity_date;

UPDATE public.activities SET
  latitude = CASE title
    WHEN 'Reunión de coordinación'      THEN -33.4429
    WHEN 'Inspección técnica'           THEN -33.4500
    WHEN 'Jornada de trabajo'           THEN -33.4436
    WHEN 'Actividad recreativa'         THEN -33.4350
    WHEN 'Cierre y evaluación semanal'  THEN -33.4356
  END,
  longitude = CASE title
    WHEN 'Reunión de coordinación'      THEN -70.6537
    WHEN 'Inspección técnica'           THEN -70.6667
    WHEN 'Jornada de trabajo'           THEN -70.6530
    WHEN 'Actividad recreativa'         THEN -70.6480
    WHEN 'Cierre y evaluación semanal'  THEN -70.6516
  END
WHERE latitude IS NULL
  AND title IN ('Reunión de coordinación','Inspección técnica','Jornada de trabajo',
                'Actividad recreativa','Cierre y evaluación semanal');

-- Ver DESPUÉS: deben salir todas con coordenadas
SELECT title, activity_date, place, latitude, longitude
FROM public.activities
ORDER BY activity_date;
