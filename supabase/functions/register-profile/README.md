# `register-profile` — registro con contraseña de grupo

Edge Function que crea un perfil nuevo en un grupo existente (flujo de registro del documento de acceso).

## Contrato

Todas las acciones son `POST` con JSON y **Verify JWT desactivado**:

```http
POST /functions/v1/register-profile
Content-Type: application/json
```

| `action` | Body | Respuesta |
|---|---|---|
| `validar-grupo` | `{ group, group_password }` | `200 { ok, group:{id,slug,name} }` · `400` grupo inválido/sin contraseña · `403` contraseña incorrecta |
| `sugerir-usuario` | `{ username }` | `200 { disponible:true, username }` o `200 { disponible:false, sugerencias:[…] }` |
| `registrar` | `{ group, group_password, username, password }` | `200 { session, user:{…, group} }` · `409 { code:"USERNAME_TAKEN", sugerencias }` |

- `group` acepta slug o uuid.
- `username`: 3–30 caracteres, `[a-z0-9._-]` (se normaliza a minúsculas; el nombre visible conserva lo escrito en `full_name`).
- `password`: mínimo 6 caracteres (Supabase Auth lo hashea; no se guarda en las tablas de la app).

## Requisitos

1. `sql/14_registro_perfiles.sql` aplicado (agrega `groups.join_password_hash`, las RPC y los GRANT por columna).
2. Una contraseña de grupo definida:
   ```sql
   select public.definir_password_grupo('principal', 'TU_CONTRASEÑA_DE_GRUPO');
   ```
   Sin contraseña, `validar-grupo` responde “Este grupo todavía no acepta registros”.
3. Variables de entorno del proyecto (`APP_SUPABASE_*`).

## Seguridad

- La contraseña de grupo se verifica con `public.verificar_password_grupo()` (bcrypt, `service_role` solamente). El hash **no** sale de la base ni llega al frontend.
- El nombre de usuario es **único global** (decisión del proyecto): el índice de la BD es la barrera final ante dos registros simultáneos.
- El correo del usuario es sintético (`uuid@usuarios.appsantiago2026.cl`, `email_confirm:true`); no se envía correo ni se expone.
- Revisar rate limiting antes de producción (la contraseña de grupo es un secreto compartido).

## Despliegue

```bash
supabase functions deploy register-profile --no-verify-jwt
```

O Dashboard → Edge Functions → `register-profile` → pegar `index.ts` → Deploy.

> El editor puede marcar `ts(2307)`/`ts(2304)` si no tiene la extensión de Deno; el archivo lleva `@ts-nocheck` intencional y no afecta el despliegue.
