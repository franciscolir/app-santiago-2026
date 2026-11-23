-- ============================================================================
-- 05_grants_admin.sql  —  GRANT para la administración (idempotente)
-- Ejecutar DESPUÉS de sql/02_grants.sql.
--
-- Contexto (query G del 2026-11-23): "authenticated" solo tenía SELECT en
-- events, profiles, activity_user_details, emergency_contacts y
-- activity_attachments → cualquier escritura admin fallaría con 42501.
--
-- Estos GRANT solo abren la puerta a la TABLA. La barrera por fila sigue
-- siendo RLS: todas estas tablas ya tienen política "Admin gestiona ..."
-- con using/with_check = is_admin(), así que un usuario normal NO verá
-- ni podrá escribir nada aunque tenga el GRANT.
--
-- No toca datos, no deshabilita RLS, se puede ejecutar muchas veces.
-- ============================================================================

-- Eventos: crear, editar, publicar y cerrar eventos (antes: solo SELECT)
GRANT INSERT, UPDATE, DELETE ON TABLE public.events TO authenticated;

-- Perfiles: el admin edita nombre, rol y activo (antes: solo SELECT).
-- No se concede INSERT/DELETE: los perfiles los crea el trigger
-- on_auth_user_created al registrarse el usuario.
GRANT UPDATE ON TABLE public.profiles TO authenticated;

-- Instrucciones por usuario: el admin crea/edita/borra (antes: solo SELECT)
GRANT INSERT, UPDATE, DELETE ON TABLE public.activity_user_details TO authenticated;

-- Contactos de emergencia: el admin gestiona (antes: solo SELECT)
GRANT INSERT, UPDATE, DELETE ON TABLE public.emergency_contacts TO authenticated;

-- Adjuntos (metadatos): el admin gestiona (antes: solo SELECT).
-- OJO: la subida real al bucket requiere además políticas de Storage,
-- que todavía NO existen (query H = 0 filas). Ver AGENT.md §14.
GRANT INSERT, UPDATE, DELETE ON TABLE public.activity_attachments TO authenticated;


-- ----------------------------------------------------------------------------
-- VERIFICACIÓN: debe listar los privilegios de "authenticated" en las 5 tablas.
-- Lo esperado tras ejecutar:
--   events                  -> DELETE, INSERT, SELECT, UPDATE
--   profiles                -> SELECT, UPDATE
--   activity_user_details   -> DELETE, INSERT, SELECT, UPDATE
--   emergency_contacts      -> DELETE, INSERT, SELECT, UPDATE
--   activity_attachments    -> DELETE, INSERT, SELECT, UPDATE
-- (además de REFERENCES/TRIGGER/TRUNCATE, defaults de Supabase)
-- ----------------------------------------------------------------------------
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee = 'authenticated'
  AND table_name IN ('events', 'profiles', 'activity_user_details',
                     'emergency_contacts', 'activity_attachments')
ORDER BY table_name, privilege_type;
