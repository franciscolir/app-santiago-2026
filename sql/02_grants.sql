-- ============================================================================
-- 02_grants.sql  —  ARREGLO de permisos (idempotente, no toca datos)
-- Ejecutar DESPUÉS de 01_diagnostico.sql.
--
-- Otorga al rol "authenticated" (el que usa la app tras el login) los permisos
-- que schema.sql definía pero que no estaban aplicados.
-- GRANT no modifica filas ni deshabilita RLS: RLS sigue filtrando por fila.
-- Se puede ejecutar muchas veces sin efecto secundario.
-- ============================================================================

-- Esquema
GRANT USAGE ON SCHEMA public TO authenticated;

-- Perfiles: la app lee rol/nombre/estado tras el login
GRANT SELECT ON TABLE public.profiles TO authenticated;

-- Eventos: la agenda solo lee los publicados (RLS lo filtra)
GRANT SELECT ON TABLE public.events TO authenticated;

-- Actividades: lectura para todos + escritura para el admin (RLS restringe a admin)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activities TO authenticated;

-- Asignaciones: leer las propias, insertar (admin) y actualizar el estado propio
GRANT SELECT, INSERT, DELETE ON TABLE public.activity_assignments TO authenticated;
GRANT UPDATE (status) ON TABLE public.activity_assignments TO authenticated;

-- Detalles particulares por usuario (instrucciones / JSON)
GRANT SELECT ON TABLE public.activity_user_details TO authenticated;

-- Muro: leer todo, publicar, borrar lo propio (RLS lo limita)
GRANT SELECT, INSERT, DELETE ON TABLE public.wall_posts TO authenticated;

-- Contactos de emergencia: solo lectura
GRANT SELECT ON TABLE public.emergency_contacts TO authenticated;

-- Adjuntos: solo lectura (carga/administración la hace el admin vía RLS + Storage)
GRANT SELECT ON TABLE public.activity_attachments TO authenticated;


-- ----------------------------------------------------------------------------
-- VERIFICACIÓN: debe listar privilegios para "authenticated" en todas las tablas.
-- ----------------------------------------------------------------------------
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'authenticated'
  AND table_name IN ('profiles','events','activities','activity_assignments',
                     'wall_posts','emergency_contacts','activity_user_details',
                     'activity_attachments')
ORDER BY table_name, privilege_type;
