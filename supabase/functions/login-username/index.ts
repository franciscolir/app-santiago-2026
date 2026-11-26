// @ts-nocheck
// ============================================================================
// supabase/functions/login-username/index.ts
// Login por usuario + contraseña + GRUPO (UPDATE.md Etapa 1.3, 2026-11-26).
//
// Contrato:
//   POST { "username": "...", "password": "...", "group": "<slug o uuid>" }
//   200  { session: { access_token, refresh_token, ... },
//          user: { id, username, full_name, role,
//                  group: { id, slug, name } } }
//   400  { error }  → falta un campo o el grupo no existe/está inactivo
//   401  { error }  → usuario o contraseña incorrectos
//   403  { error }  → usuario desactivado o de otro grupo
//   500  { error }  → configuración o error interno (sin filtrar detalles)
//
// Reglas:
//   - El grupo se valida ANTES de autenticar: si el usuario no pertenece al
//     grupo, no se crea sesión.
//   - `username` sigue siendo único global (profiles_username_key). Para
//     permitir el mismo username en dos grupos habría que cambiar la
//     restricción y la búsqueda; no es el caso de esta entrega.
//   - No se registran ni devuelven claves. `service_role` solo se usa aquí,
//     en el servidor.
//
// Variables de entorno (ya configuradas en el proyecto):
//   APP_SUPABASE_URL, APP_SUPABASE_SERVICE_ROLE_KEY, APP_SUPABASE_PUBLISHABLE_KEY
// IMPORTANTE: desplegar con "Verify JWT" DESACTIVADO (se invoca sin sesión).
// ============================================================================

// NOTA: `@ts-nocheck` es intencional. Este archivo se ejecuta en Deno
// (Supabase Edge Functions), que resuelve los especificadores `npm:` y define
// `Deno`. El servidor de TypeScript de un editor sin la extensión de Deno
// marca ts(2307) / ts(2304); no son fallos del despliegue. Si trabajas con
// Deno activado en VS Code puedes quitar esta línea.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Método no permitido." }, 405);
  }

  const url = Deno.env.get("APP_SUPABASE_URL");
  const serviceKey = Deno.env.get("APP_SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = Deno.env.get("APP_SUPABASE_PUBLISHABLE_KEY");

  if (!url || !serviceKey || !publishableKey) {
    // Solo booleanos de presencia: nunca el contenido de las claves.
    console.error("login-username: faltan variables de entorno", {
      APP_SUPABASE_URL: Boolean(url),
      APP_SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceKey),
      APP_SUPABASE_PUBLISHABLE_KEY: Boolean(publishableKey),
    });
    return json({ error: "El inicio de sesión no está configurado en el servidor." }, 500);
  }

  let body: { username?: unknown; password?: unknown; group?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Solicitud inválida." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Solicitud inválida." }, 400);
  }

  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const groupRef = String(body.group ?? "").trim();

  if (!username || !password || !groupRef) {
    return json({ error: "Indica usuario, contraseña y grupo." }, 400);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Grupo activo (por slug o por uuid).
  const groupQuery = admin
    .from("groups")
    .select("id, slug, name, active");

  const { data: group, error: groupError } = await (UUID_RE.test(groupRef)
    ? groupQuery.eq("id", groupRef)
    : groupQuery.eq("slug", groupRef.toLowerCase())
  ).maybeSingle();

  if (groupError) {
    console.error("login-username: groups", groupError.message);
    return json({ error: "No se pudo verificar el grupo." }, 500);
  }
  if (!group || !group.active) {
    return json({ error: "El grupo seleccionado no existe o está inactivo." }, 400);
  }

  // 2) Perfil por nombre de usuario (único global).
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, username, full_name, role, active, group_id, group_admin")
    .eq("username", username)
    .maybeSingle();

  if (profileError) {
    console.error("login-username: profiles", profileError.message);
    return json({ error: "No se pudo verificar el usuario." }, 500);
  }
  if (!profile) {
    return json({ error: "Usuario o contraseña incorrectos." }, 401);
  }
  if (!profile.active) {
    return json({ error: "Tu usuario está desactivado. Contacta a un administrador." }, 403);
  }
  if (profile.group_id !== group.id) {
    return json({ error: "El usuario no pertenece al grupo seleccionado." }, 403);
  }

  // 3) Email de Auth del usuario (solo en el servidor).
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(profile.id);
  const email = authUser?.user?.email;
  if (authError || !email) {
    console.error("login-username: getUserById", authError?.message);
    return json({ error: "No se pudo verificar el usuario." }, 500);
  }

  // 4) Contraseña con el cliente público.
  const authClient = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInError } = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !signIn.session) {
    return json({ error: "Usuario o contraseña incorrectos." }, 401);
  }

  // 5) Respuesta compatible con el frontend actual.
  return json({
    session: signIn.session,
    user: {
      id: profile.id,
      username: profile.username,
      full_name: profile.full_name,
      role: profile.role,
      group: { id: group.id, slug: group.slug, name: group.name },
    },
  });
});
