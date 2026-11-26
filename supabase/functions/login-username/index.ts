// @ts-nocheck
// ============================================================================
// supabase/functions/login-username/index.ts
// Login por usuario + contraseña; el GRUPO se detecta del perfil.
// (Adaptación 2026-11-26 del flujo de acceso.)
//
// Contrato:
//   POST { "username": "...", "password": "..." }
//   200  { session, user: { id, username, full_name, role, group_admin,
//                           group: { id, slug, name } } }
//   400  { error }  → faltan datos
//   401  { error }  → contraseña incorrecta
//   403  { error }  → usuario o grupo inactivo
//   404  { code: "USER_NOT_FOUND", error } → el usuario no existe (el frontend
//          ofrece el registro)
//   500  { error }  → configuración o error interno
//
// Reglas:
//   - El nombre de usuario es ÚNICO GLOBAL (decisión del usuario): no hay
//     ambigüedad entre grupos y no se pide el grupo al entrar.
//   - El campo `group` de versiones anteriores se ignora.
//   - No se registran ni devuelven claves. `service_role` solo en el servidor.
//
// Variables: APP_SUPABASE_URL, APP_SUPABASE_SERVICE_ROLE_KEY,
//            APP_SUPABASE_PUBLISHABLE_KEY. Verify JWT DESACTIVADO.
//
// NOTA: `@ts-nocheck` es intencional (Deno resuelve `npm:` y define `Deno`;
// un editor sin la extensión de Deno marca ts(2307)/ts(2304)).
// ============================================================================

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("APP_SUPABASE_URL");
  const serviceKey = Deno.env.get("APP_SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = Deno.env.get("APP_SUPABASE_PUBLISHABLE_KEY");

  if (!url || !serviceKey || !publishableKey) {
    console.error("login-username: faltan variables de entorno", {
      APP_SUPABASE_URL: Boolean(url),
      APP_SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceKey),
      APP_SUPABASE_PUBLISHABLE_KEY: Boolean(publishableKey),
    });
    return json({ error: "El inicio de sesión no está configurado en el servidor." }, 500);
  }

  let body: { username?: unknown; password?: unknown };
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

  if (!username || !password) {
    return json({ error: "Indica tu usuario y contraseña." }, 400);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Perfil por nombre de usuario (único global).
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
    // Se informa para que el frontend ofrezca el registro (el documento lo pide).
    return json({
      code: "USER_NOT_FOUND",
      error: "No existe un perfil con ese nombre de usuario.",
    }, 404);
  }
  if (!profile.active) {
    return json({ error: "Tu usuario está desactivado. Contacta a un administrador." }, 403);
  }

  // 2) Grupo del perfil (se detecta solo; no se pide al usuario).
  const { data: group, error: groupError } = await admin
    .from("groups")
    .select("id, slug, name, active")
    .eq("id", profile.group_id)
    .maybeSingle();

  if (groupError) {
    console.error("login-username: groups", groupError.message);
    return json({ error: "No se pudo verificar el grupo del usuario." }, 500);
  }
  if (!group || !group.active) {
    return json({ error: "El grupo de este perfil no está activo." }, 403);
  }

  // 3) Email de Auth (solo en el servidor).
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(profile.id);
  const email = authUser?.user?.email;
  if (authError || !email) {
    console.error("login-username: getUserById", authError?.message);
    return json({ error: "No se pudo verificar el usuario." }, 500);
  }

  // 4) Contraseña personal con el cliente público.
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

  return json({
    session: signIn.session,
    user: {
      id: profile.id,
      username: profile.username,
      full_name: profile.full_name,
      role: profile.role,
      group_admin: Boolean(profile.group_admin),
      group: { id: group.id, slug: group.slug, name: group.name },
    },
  });
});
