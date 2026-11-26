// @ts-nocheck
// ============================================================================
// supabase/functions/register-profile/index.ts
// Registro de perfiles con contraseña de grupo (2026-11-26).
//
// Contrato (POST, Verify JWT DESACTIVADO):
//   { action: "validar-grupo", group, group_password }
//     → 200 { ok: true, group: { id, slug, name } }
//     → 400 grupo inválido / sin contraseña · 403 contraseña incorrecta
//
//   { action: "sugerir-usuario", username }
//     → 200 { disponible: true, username }
//     → 200 { disponible: false, sugerencias: ["..."] }
//
//   { action: "registrar", group, group_password, username, password }
//     → 200 { session, user: { id, username, full_name, role,
//                              group: { id, slug, name } } }
//     → 409 { code: "USERNAME_TAKEN", sugerencias: [...] }
//     → 400/403 errores de validación
//
// Reglas:
//   - El nombre de usuario es ÚNICO GLOBAL (decisión del usuario). El índice
//     único de la BD es la barrera final ante registros simultáneos.
//   - La contraseña de grupo se verifica con la RPC
//     public.verificar_password_grupo() (bcrypt, solo service_role): el hash
//     nunca sale de la base.
//   - La contraseña personal se entrega a Supabase Auth (createUser), que la
//     almacena con su hash seguro. No se guarda en nuestras tablas.
//   - El perfil lo crea el trigger handle_new_user() con el group_id validado.
//   - Email sintético interno (no se envía correo; email_confirm: true).
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_RE = /^[a-z0-9._-]{3,30}$/;   // se valida ya normalizado a minúsculas

function normalizarUsuario(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

async function buscarGrupo(admin: ReturnType<typeof createClient>, ref: unknown) {
  const refStr = String(ref ?? "").trim();
  if (!refStr) return { group: null, error: "Indica el grupo." };

  const base = admin
    .from("groups")
    .select("id, slug, name, active, join_password_hash");

  const { data, error } = await (UUID_RE.test(refStr)
    ? base.eq("id", refStr)
    : base.eq("slug", refStr.toLowerCase())
  ).maybeSingle();

  if (error) {
    console.error("register-profile: groups", error.message);
    return { group: null, error: "No se pudo verificar el grupo." };
  }
  if (!data || !data.active) {
    return { group: null, error: "El grupo no existe o está inactivo." };
  }
  return { group: data, error: "" };
}

// Valida grupo + contraseña de grupo. Devuelve { group } o { error, status }.
async function verificarGrupo(
  admin: ReturnType<typeof createClient>,
  groupRef: unknown,
  groupPassword: unknown,
) {
  const { group, error } = await buscarGrupo(admin, groupRef);
  if (!group) return { group: null, error, status: 400 };

  if (!group.join_password_hash) {
    return {
      group: null,
      error: "Este grupo todavía no acepta registros (falta configurar su contraseña).",
      status: 400,
    };
  }

  const { data: ok, error: rpcError } = await admin.rpc("verificar_password_grupo", {
    p_slug: group.slug,
    p_password: String(groupPassword ?? ""),
  });

  if (rpcError) {
    console.error("register-profile: verificar_password_grupo", rpcError.message);
    return { group: null, error: "No se pudo validar la contraseña del grupo.", status: 500 };
  }
  if (!ok) {
    return { group: null, error: "La contraseña del grupo es incorrecta.", status: 403 };
  }
  return { group, error: "", status: 200 };
}

async function existeUsuario(admin: ReturnType<typeof createClient>, username: string) {
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

// Alternativas comprobadas (solo devuelve las que están libres).
async function alternativas(admin: ReturnType<typeof createClient>, base: string) {
  const raiz = base.slice(0, 28);
  const candidatos: string[] = [];
  for (const n of [1, 2, 3, 4, 5]) candidatos.push(`${raiz}${n}`);
  for (const l of ["a", "b", "c", "d"]) candidatos.push(`${raiz}${l}`);

  const { data, error } = await admin
    .from("profiles")
    .select("username")
    .in("username", candidatos);

  if (error) {
    console.error("register-profile: alternativas", error.message);
    return [];
  }
  const ocupados = new Set((data || []).map((p: { username: string }) => p.username));
  return candidatos.filter((c) => !ocupados.has(c)).slice(0, 5);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("APP_SUPABASE_URL");
  const serviceKey = Deno.env.get("APP_SUPABASE_SERVICE_ROLE_KEY");
  const publishableKey = Deno.env.get("APP_SUPABASE_PUBLISHABLE_KEY");

  if (!url || !serviceKey || !publishableKey) {
    console.error("register-profile: faltan variables de entorno", {
      APP_SUPABASE_URL: Boolean(url),
      APP_SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceKey),
      APP_SUPABASE_PUBLISHABLE_KEY: Boolean(publishableKey),
    });
    return json({ error: "El registro no está configurado en el servidor." }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Solicitud inválida." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Solicitud inválida." }, 400);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const action = String(body.action ?? "").trim();

  // -------------------------------------------------------------------------
  // 1) Validar grupo + contraseña de grupo
  // -------------------------------------------------------------------------
  if (action === "validar-grupo") {
    const { group, error, status } = await verificarGrupo(admin, body.group, body.group_password);
    if (!group) return json({ error }, status);
    return json({ ok: true, group: { id: group.id, slug: group.slug, name: group.name } });
  }

  // -------------------------------------------------------------------------
  // 2) Disponibilidad de nombre + sugerencias
  // -------------------------------------------------------------------------
  if (action === "sugerir-usuario") {
    const username = normalizarUsuario(body.username);
    if (!USER_RE.test(username)) {
      return json({ error: "El usuario debe tener entre 3 y 30 caracteres (letras, números, punto, guion o guion bajo)." }, 400);
    }
    let ocupado = false;
    try {
      ocupado = await existeUsuario(admin, username);
    } catch (e) {
      console.error("register-profile: sugerir", (e as Error).message);
      return json({ error: "No se pudo comprobar el nombre de usuario." }, 500);
    }
    if (!ocupado) return json({ disponible: true, username });
    return json({ disponible: false, sugerencias: await alternativas(admin, username) });
  }

  // -------------------------------------------------------------------------
  // 3) Registrar el perfil
  // -------------------------------------------------------------------------
  if (action === "registrar") {
    const username = normalizarUsuario(body.username);
    const usernameVisible = String(body.username ?? "").trim();
    const password = String(body.password ?? "");

    if (!USER_RE.test(username)) {
      return json({ error: "El usuario debe tener entre 3 y 30 caracteres (letras, números, punto, guion o guion bajo)." }, 400);
    }
    if (password.length < 6) {
      return json({ error: "La contraseña personal debe tener al menos 6 caracteres." }, 400);
    }

    // Se revalida el grupo: el cliente no puede saltarse el paso anterior.
    const { group, error, status } = await verificarGrupo(admin, body.group, body.group_password);
    if (!group) return json({ error }, status);

    // Comprobación previa; el índice único es la barrera definitiva.
    let ocupado = false;
    try {
      ocupado = await existeUsuario(admin, username);
    } catch (e) {
      console.error("register-profile: comprobar", (e as Error).message);
      return json({ error: "No se pudo comprobar el nombre de usuario." }, 500);
    }
    if (ocupado) {
      return json({
        code: "USERNAME_TAKEN",
        error: "Ese nombre ya está en uso.",
        sugerencias: await alternativas(admin, username),
      }, 409);
    }

    const email = `${crypto.randomUUID()}@usuarios.appsantiago2026.cl`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        full_name: usernameVisible || username,
        group_id: group.id,
      },
    });

    if (createError) {
      const msg = createError.message || "";
      if (/duplicate|unique|profiles_username|already/i.test(msg)) {
        return json({
          code: "USERNAME_TAKEN",
          error: "Ese nombre ya está en uso.",
          sugerencias: await alternativas(admin, username),
        }, 409);
      }
      console.error("register-profile: createUser", msg);
      return json({ error: "No se pudo crear el perfil." }, 500);
    }

    const id = created?.user?.id;
    if (!id) return json({ error: "No se pudo crear el perfil." }, 500);

    // El perfil lo crea handle_new_user() con el group_id de los metadatos.
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, username, full_name, role, active, group_id, group_admin")
      .eq("id", id)
      .maybeSingle();

    if (profileError || !profile) {
      console.error("register-profile: perfil", profileError?.message);
      try { await admin.auth.admin.deleteUser(id); } catch (_) { /* rollback best-effort */ }
      return json({ error: "No se pudo completar el registro." }, 500);
    }

    // Entrar directo con la contraseña recién creada.
    const authClient = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: signIn, error: signInError } = await authClient.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signIn.session) {
      console.error("register-profile: signIn", signInError?.message);
      return json({
        error: "El perfil se creó, pero no se pudo iniciar sesión. Ingresa manualmente con tu usuario y contraseña.",
      }, 500);
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
  }

  return json({ error: "Acción no válida." }, 400);
});
