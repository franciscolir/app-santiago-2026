# `login-username` — login por usuario + contraseña

Edge Function de Supabase que autentica por **nombre de usuario + contraseña** y **detecta el grupo del perfil** (no se pide el grupo al entrar).

## Contrato

```http
POST /functions/v1/login-username
Content-Type: application/json

{ "username": "francisco", "password": "••••••" }
```

| Código | Significado |
|---|---|
| 200 | `{ session, user: { id, username, full_name, role, group_admin, group:{id,slug,name} } }` |
| 400 | Faltan usuario o contraseña |
| 401 | Contraseña incorrecta |
| 403 | Usuario o grupo inactivo |
| 404 | `{ code:"USER_NOT_FOUND" }` → el frontend ofrece **crear perfil** |
| 500 | Configuración o error interno (sin filtrar secretos) |

El campo `group` que enviaban versiones anteriores se **ignora** (compatibilidad).

## Requisitos

1. `sql/10_grupos.sql` y `sql/11_rls_grupos.sql` aplicados.
2. Variables de entorno del proyecto (ya existentes):
   - `APP_SUPABASE_URL`
   - `APP_SUPABASE_SERVICE_ROLE_KEY`
   - `APP_SUPABASE_PUBLISHABLE_KEY`
3. **Verify JWT desactivado** (se invoca sin sesión).

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

## Orden recomendado

1. `sql/10_grupos.sql` → `sql/11_rls_grupos.sql` → `sql/14_registro_perfiles.sql`.
2. Definir la contraseña de grupo (`definir_password_grupo`).
3. Desplegar `login-username` (v2) y `register-profile`.
4. Publicar el frontend nuevo (el login ya no envía grupo; el login viejo exige grupo, así que el frontend va al final).

> `@ts-nocheck` es intencional: Deno resuelve `npm:` y define `Deno`; un editor sin la extensión de Deno marca ts(2307)/ts(2304), pero no afecta el despliegue.
