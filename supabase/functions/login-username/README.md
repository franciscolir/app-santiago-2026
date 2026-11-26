# `login-username` — login por usuario + contraseña + grupo

Edge Function de Supabase que autentica a un usuario **solo si pertenece al grupo indicado** (UPDATE.md §1.3).

## Contrato

```http
POST /functions/v1/login-username
Content-Type: application/json

{ "username": "test", "password": "••••••", "group": "principal" }
```

| Código | Significado |
|---|---|
| 200 | `{ session, user: { id, username, role, group: { id, slug, name } } }` |
| 400 | Falta un campo, o el grupo no existe / está inactivo |
| 401 | Usuario o contraseña incorrectos |
| 403 | Usuario desactivado o perteneciente a otro grupo |
| 500 | Configuración o error interno (sin filtrar secretos) |

`group` acepta el **slug** (`principal`) o el **uuid** del grupo.

## Requisitos

1. Haber ejecutado `sql/10_grupos.sql` (crea `public.groups` y concede `select` a `service_role`).
2. Variables de entorno del proyecto (ya existentes):
   - `APP_SUPABASE_URL`
   - `APP_SUPABASE_SERVICE_ROLE_KEY`
   - `APP_SUPABASE_PUBLISHABLE_KEY`
3. **Verify JWT desactivado** en la función (se invoca sin sesión, como antes).

## Despliegue

### Opción A — CLI

```bash
supabase functions deploy login-username --no-verify-jwt
```

### Opción B — Panel de Supabase

1. Edge Functions → `login-username` → editar.
2. Reemplazar el contenido por `index.ts` de esta carpeta.
3. Deploy.
4. Confirmar que **Verify JWT** siga desactivado.

## Orden de despliegue recomendado

1. Ejecutar `sql/10_grupos.sql`.
2. Ejecutar `sql/11_rls_grupos.sql`.
3. Desplegar esta función.
4. Publicar el frontend.

Si el frontend se publica antes, sigue funcionando: envía `group` a la función antigua (que lo ignora) y **revalida la pertenencia** después de iniciar sesión; la separación real la aplican las políticas RLS.
