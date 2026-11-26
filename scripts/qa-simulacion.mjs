// ============================================================================
// QA de integración/seguridad — 3 grupos × 10 usuarios (2026-11-26)
//
// Ejecuta una simulación real contra Supabase con la clave publicable:
//   QA_CONFIRM=1 QA_ADMIN_PASSWORD=... node scripts/qa-simulacion.mjs
//
// Requisitos:
//   - El usuario QA_ADMIN_USER (por defecto `test`) debe tener role='admin'
//     temporalmente. Al terminar, devuélvelo a `manager` con SQL.
//   - Usa un proyecto de pruebas: crea grupos/usuarios/eventos/actividades/
//     muro/puntos y deja los auth.users para que los borre el SQL de limpieza
//     que imprime al final (o el que acompaña a PRUEBAS.md).
//
// No imprime tokens ni contraseñas en el reporte.
// ============================================================================
import { randomUUID } from "node:crypto";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../src/config.js";

if (process.env.QA_CONFIRM !== "1") {
  console.error("Rechazado: ejecuta con QA_CONFIRM=1 (crea datos de prueba).");
  process.exit(2);
}

const URL = SUPABASE_URL.replace(/\/$/, "");
const KEY = SUPABASE_PUBLISHABLE_KEY;
const ADMIN_USER = process.env.QA_ADMIN_USER || "test";
const ADMIN_PASS = process.env.QA_ADMIN_PASSWORD || "";
const RUN = (process.env.QA_RUN || Date.now().toString(36).slice(-6)).toLowerCase();
const PREFIX = `qa${RUN}`;
const GROUP_PASS = `${PREFIX}Group!`;
const USER_PASS = `${PREFIX}User!`;
const DATES = [
  ["2026-12-01", "2026-12-10"],
  ["2026-12-05", "2026-12-15"],
  ["2026-12-08", "2026-12-20"],
];

let pass = 0, fail = 0;
const fallos = [];
function ok(nombre, cond, detalle = "") {
  if (cond) { pass++; console.log(`  ✅ ${nombre}`); }
  else { fail++; fallos.push(`${nombre}${detalle ? ` · ${detalle}` : ""}`); console.log(`  ❌ ${nombre}${detalle ? ` · ${detalle}` : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { token, method = "GET", body, headers = {} } = {}) {
  const h = { apikey: KEY, "Content-Type": "application/json", ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if ((method === "POST" || method === "PATCH") && !h.Prefer) h.Prefer = "return=representation";
  const res = await fetch(`${URL}${path}`, {
    method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, text };
}
const rest = (path, opts = {}) => api(`/rest/v1/${path}`, opts);
const rpc = (name, token, args = {}) => api(`/rest/v1/rpc/${name}`, { token, method: "POST", body: args });
async function login(username, password) {
  return api("/functions/v1/login-username", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}` },
    body: { username, password },
  });
}
async function registrar(group, username, password) {
  return api("/functions/v1/register-profile", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}` },
    body: { action: "registrar", group, group_password: GROUP_PASS, username, password },
  });
}
const rows = (r) => Array.isArray(r.data) ? r.data : [];
const blocked = (r) => r.status === 401 || r.status === 403 || (r.status < 300 && rows(r).length === 0);

if (!ADMIN_PASS) {
  console.error("Falta QA_ADMIN_PASSWORD.");
  process.exit(2);
}

console.log(`\n=== QA ${PREFIX} · ${URL} ===\n`);
const adminLogin = await login(ADMIN_USER, ADMIN_PASS);
if (!adminLogin.data?.session) {
  console.error("No se pudo entrar como ADMIN:", adminLogin.status, adminLogin.text.slice(0, 200));
  process.exit(1);
}
const adminToken = adminLogin.data.session.access_token;
const adminId = adminLogin.data.user?.id || adminLogin.data.session.user?.id;
const adminProfile = rows(await rest(`profiles?select=id,username,role&id=eq.${adminId}`, { token: adminToken }))[0];
ok("El usuario de QA es ADMIN", adminProfile?.role === "admin", adminProfile?.role || "sin rol");
if (adminProfile?.role !== "admin") process.exit(1);

const groups = [];
const users = [];
const activities = [];
const wallPosts = [];
const points = [];
let contactId = null;

try {
  // ---------------------------------------------------------------- grupos --
  console.log("\n[1] Grupos y eventos solapados");
  for (let i = 0; i < 3; i++) {
    const n = i + 1;
    const slug = `${PREFIX}g${n}`;
    const name = `QA Grupo ${n}`;
    const g = await rest("groups?select=id,slug,name,active", {
      token: adminToken, method: "POST",
      body: { slug, name, description: `QA ${PREFIX}`, active: true },
    });
    ok(`grupo ${n} creado`, g.status === 201 && g.data?.[0]?.id, `${g.status} ${g.text.slice(0, 90)}`);
    if (g.status !== 201) throw new Error("No se pudo crear el grupo " + n);
    const group = { ...g.data[0], password: GROUP_PASS, event: null, manager: null };
    groups.push(group);

    const pw = await rpc("definir_password_grupo", adminToken, { p_slug: slug, p_password: GROUP_PASS });
    ok(`grupo ${n}: contraseña definida`, pw.status === 204 || pw.status === 200, `${pw.status}`);

    const ev = await rest("events?select=id,name,group_id,start_date,end_date,status", {
      token: adminToken, method: "POST",
      body: {
        name: `QA Evento ${n}`, description: `QA evento ${PREFIX}`,
        start_date: DATES[i][0], end_date: DATES[i][1], status: "published",
        group_id: group.id, created_by: adminId,
      },
    });
    ok(`grupo ${n}: evento creado`, ev.status === 201 && ev.data?.[0]?.id, `${ev.status}`);
    group.event = ev.data?.[0] || null;
  }
  ok("los 3 eventos se solapan en fechas",
    groups.every((g) => g.event?.start_date <= groups[2].event.end_date && g.event?.end_date >= groups[0].event.start_date));

  // --------------------------------------------------------------- usuarios --
  console.log("\n[2] 30 usuarios (10 por grupo) y 1 MANAGER por grupo");
  for (let i = 0; i < 3; i++) {
    for (let j = 1; j <= 10; j++) {
      const username = `${PREFIX}u${i + 1}${String(j).padStart(2, "0")}`;
      const reg = await registrar(groups[i].slug, username, USER_PASS);
      ok(`registro ${username}`, reg.status === 200 && reg.data?.session?.access_token, `${reg.status} ${reg.text.slice(0, 80)}`);
      if (reg.status !== 200) continue;
      const u = {
        id: reg.data.user?.id, username, group: groups[i],
        token: reg.data.session.access_token, session: reg.data.session, manager: false,
      };
      users.push(u);
      if (j === 1) {
        const up = await rest(`profiles?id=eq.${u.id}&select=id,username,role`, {
          token: adminToken, method: "PATCH", headers: { Prefer: "return=representation" },
          body: { role: "manager" },
        });
        ok(`MANAGER ${username}`, up.status < 300 && (rows(up)[0]?.role === "manager"), `${up.status} ${up.text.slice(0, 90)}`);
        u.manager = true;
        groups[i].manager = u;
      }
      await sleep(60);
    }
  }
  ok("30 usuarios registrados", users.length === 30, `${users.length}`);

  const gp = rows(await rpc("admin_grupos", adminToken));
  for (let i = 0; i < 3; i++) {
    const g = gp.find((x) => x.id === groups[i].id);
    ok(`grupos RPC: ${groups[i].slug} con 10 miembros`, Number(g?.member_count) === 10, `${g?.member_count}`);
    ok(`grupos RPC: ${groups[i].slug} con 1 manager`, Number(g?.manager_count) === 1, `${g?.manager_count}`);
  }

  // El MANAGER no debe poder editar la fila del grupo (sql/18).
  const g1Name = groups[0].name;
  const gEdit = await rest(`groups?id=eq.${groups[0].id}`, {
    token: groups[0].manager.token, method: "PATCH", body: { name: `${g1Name} HACK` },
  });
  ok("MANAGER no edita la fila del grupo", gEdit.status === 403 || gEdit.status === 204, `${gEdit.status}`);
  ok("el nombre del grupo no cambió",
    rows(await rest(`groups?id=eq.${groups[0].id}&select=name`, { token: adminToken }))[0]?.name === g1Name);

  // El hash de la contraseña de grupo no es legible desde la API.
  const ordinaryG1 = users.find((u) => u.group === groups[0] && !u.manager);
  const hashRead = await rest(`groups?select=join_password_hash&id=eq.${groups[0].id}`, { token: ordinaryG1.token });
  ok("usuario no lee join_password_hash", hashRead.status === 403, `${hashRead.status}`);
  const verifyRpc = await rpc("verificar_password_grupo", ordinaryG1.token, { p_slug: groups[0].slug, p_password: GROUP_PASS });
  ok("usuario no ejecuta verificar_password_grupo", verifyRpc.status === 403, `${verifyRpc.status}`);

  // Aislamiento de perfiles: cada usuario ve los 10 de su grupo.
  for (const u of users) {
    const vis = rows(await rest("profiles?select=id,group_id&active=eq.true", { token: u.token }));
    ok(`perfiles aislados ${u.username}`, vis.length === 10 && vis.every((p) => p.group_id === u.group.id), `${vis.length}`);
  }

  // ------------------------------------------------------------- actividades --
  console.log("\n[3] Actividades del ADMIN y de los MANAGER");
  const series = randomUUID();
  for (const g of groups) {
    const a = await rest("activities?select=id,title,group_id,event_id,series_id", {
      token: adminToken, method: "POST",
      body: {
        event_id: g.event.id, group_id: g.id, title: `QA General ${PREFIX}`,
        description: "Actividad multi-grupo", activity_date: "2026-12-09",
        start_time: "09:00", end_time: "10:00", place: "QA lugar",
        series_id: series, created_by: adminId,
      },
    });
    ok(`ADMIN crea actividad en ${g.slug}`, a.status === 201, `${a.status} ${a.text.slice(0, 80)}`);
    if (a.data?.[0]) activities.push({ ...a.data[0], group: g, admin: true });
  }
  ok("la serie del ADMIN tiene 3 filas",
    activities.filter((a) => a.admin).length === 3 &&
    new Set(activities.filter((a) => a.admin).map((a) => a.series_id)).size === 1);

  for (const g of groups) {
    const a = await rest("activities?select=id,title,group_id,event_id", {
      token: g.manager.token, method: "POST",
      body: {
        event_id: g.event.id, group_id: g.id, title: `QA Manager ${g.slug}`,
        description: "Actividad del MANAGER", activity_date: "2026-12-10",
        start_time: "11:00", end_time: "12:00", place: "QA manager",
        created_by: g.manager.id,
      },
    });
    ok(`MANAGER crea actividad en ${g.slug}`, a.status === 201, `${a.status} ${a.text.slice(0, 80)}`);
    if (a.data?.[0]) activities.push({ ...a.data[0], group: g, admin: false });
  }

  // Cada usuario ve solo las 2 actividades de su grupo.
  for (const u of users) {
    const vis = rows(await rest("activities?select=id,title,group_id&order=activity_date", { token: u.token }));
    ok(`actividades aisladas ${u.username}`,
      vis.length === 2 && vis.every((a) => a.group_id === u.group.id),
      `${vis.length} ${vis.map((a) => a.group_id).join(",")}`);
  }

  // IDOR: actividad de otro grupo.
  const actG2 = activities.find((a) => a.group === groups[1] && !a.admin);
  const userG1 = users.find((u) => u.group === groups[0] && !u.manager);
  ok("usuario g1 no lee actividad de g2",
    rows(await rest(`activities?id=eq.${actG2.id}&select=id`, { token: userG1.token })).length === 0);
  const hack = await rest(`activities?id=eq.${actG2.id}`, {
    token: userG1.token, method: "PATCH", headers: { Prefer: "return=representation" },
    body: { title: "HACKEADA" },
  });
  ok("usuario g1 no modifica actividad de g2", blocked(hack), `${hack.status}`);
  const hackDel = await rest(`activities?id=eq.${actG2.id}`, {
    token: userG1.token, method: "DELETE", headers: { Prefer: "return=representation" },
  });
  ok("usuario g1 no borra actividad de g2", blocked(hackDel), `${hackDel.status}`);
  ok("la actividad de g2 sigue intacta",
    rows(await rest(`activities?id=eq.${actG2.id}&select=title`, { token: adminToken }))[0]?.title === actG2.title);
  const noAct = await rest("activities", {
    token: userG1.token, method: "POST",
    body: { event_id: groups[0].event.id, group_id: groups[0].id, title: "No permitida", activity_date: "2026-12-09", created_by: userG1.id },
  });
  ok("usuario normal no crea actividades", noAct.status === 403, `${noAct.status}`);

  // Manager no puede tocar otro grupo.
  const managerHack = await rest(`activities?id=eq.${actG2.id}`, {
    token: groups[0].manager.token, method: "PATCH", headers: { Prefer: "return=representation" },
    body: { title: "MANAGER HACK" },
  });
  ok("MANAGER g1 no modifica actividad de g2", blocked(managerHack), `${managerHack.status}`);

  // --------------------------------------------------------------- muro ------
  console.log("\n[4] Muro aislado por grupo");
  for (const u of users) {
    const p = await rest("wall_posts?select=id,content,group_id", {
      token: u.token, method: "POST",
      body: { user_id: u.id, category: "positive", content: `QAWALL:${PREFIX}:${u.group.slug}:${u.username}` },
    });
    ok(`publica en muro ${u.username}`, p.status === 201, `${p.status} ${p.text.slice(0, 80)}`);
    if (p.data?.[0]) wallPosts.push({ ...p.data[0], user: u });
  }
  for (const u of users) {
    const vis = rows(await rest("wall_posts?select=id,content,group_id,user_id", { token: u.token }));
    const propios = vis.filter((p) => String(p.content).startsWith(`QAWALL:${PREFIX}:`));
    ok(`muro aislado ${u.username}`, propios.length === 10 && propios.every((p) => p.group_id === u.group.id), `${propios.length}`);
  }
  const postG2 = wallPosts.find((p) => p.user.group === groups[1]);
  ok("usuario g1 no lee post de g2 por ID",
    rows(await rest(`wall_posts?id=eq.${postG2.id}&select=id`, { token: userG1.token })).length === 0);
  const postG1Other = wallPosts.find((p) => p.user.group === groups[0] && p.user.id !== userG1.id);
  const delOther = await rest(`wall_posts?id=eq.${postG1Other.id}`, {
    token: userG1.token, method: "DELETE", headers: { Prefer: "return=representation" },
  });
  ok("usuario no borra post de otro usuario", blocked(delOther), `${delOther.status}`);
  ok("el post sigue existiendo",
    rows(await rest(`wall_posts?id=eq.${postG1Other.id}&select=id`, { token: adminToken })).length === 1);

  // XSS / inyección almacenada.
  const xss = await rest("wall_posts?select=id,content", {
    token: userG1.token, method: "POST",
    body: { user_id: userG1.id, category: "positive", content: `<img src=x onerror="window.__qaxss=1">` },
  });
  ok("XSS almacenado como texto", xss.status === 201 && xss.data?.[0]?.content.includes("<img"), `${xss.status}`);
  const sqlPost = await rest("wall_posts?select=id,content", {
    token: userG1.token, method: "POST",
    body: { user_id: userG1.id, category: "positive", content: `x'); DROP TABLE public.wall_posts;--` },
  });
  ok("payload SQL almacenado sin ejecutarse", sqlPost.status === 201, `${sqlPost.status}`);
  ok("la tabla wall_posts sigue existiendo", (await rest("wall_posts?select=id&limit=1", { token: adminToken })).status === 200);

  // --------------------------------------------------------------- puntos ----
  console.log("\n[5] Puntos, permisos y bloqueo");
  const pp = await rest("map_points?select=id,name,group_id,tipo,scope", {
    token: userG1.token, method: "POST",
    body: { name: `QA personal ${PREFIX}`, category: "general", icon: "place", latitude: -33.45, longitude: -70.65, tipo: "personal", scope: "group", group_id: groups[0].id, visible: true, active: true, fijo: false, created_by: userG1.id },
  });
  ok("usuario crea punto personal en su grupo", pp.status === 201 && pp.data?.[0]?.group_id === groups[0].id, `${pp.status}`);
  if (pp.data?.[0]) points.push(pp.data[0]);
  const ppOther = await rest("map_points?select=id,group_id", {
    token: userG1.token, method: "POST",
    body: { name: `QA cross ${PREFIX}`, category: "general", icon: "place", latitude: -33.46, longitude: -70.66, tipo: "personal", scope: "group", group_id: groups[1].id, visible: true, active: true, fijo: false, created_by: userG1.id },
  });
  ok("punto personal no queda en otro grupo",
    ppOther.status === 403 || rows(ppOther)[0]?.group_id === groups[0].id, `${ppOther.status}`);
  if (rows(ppOther)[0]?.id) points.push(rows(ppOther)[0]);
  ok("usuario g2 no ve punto personal de g1",
    rows(await rest(`map_points?id=eq.${pp.data[0].id}&select=id`, { token: users.find((u) => u.group === groups[1] && !u.manager).token })).length === 0);

  const mgPoint = await rest("map_points?select=id,name,group_id,tipo,scope", {
    token: groups[0].manager.token, method: "POST",
    body: { name: `QA general manager ${PREFIX}`, category: "general", icon: "place", latitude: -33.47, longitude: -70.67, tipo: "general", scope: "group", group_id: groups[0].id, visible: true, active: true, fijo: false, created_by: groups[0].manager.id },
  });
  ok("MANAGER crea punto general de su grupo", mgPoint.status === 201, `${mgPoint.status}`);
  if (mgPoint.data?.[0]) points.push(mgPoint.data[0]);
  const globalPoint = await rest("map_points", {
    token: groups[0].manager.token, method: "POST",
    body: { name: `QA global manager ${PREFIX}`, category: "general", icon: "place", latitude: -33.48, longitude: -70.68, tipo: "general", scope: "global", group_id: null, visible: true, active: true, fijo: false, created_by: groups[0].manager.id },
  });
  ok("MANAGER no crea punto global", globalPoint.status === 403, `${globalPoint.status}`);

  const locked = await rest("map_points?select=id,name,bloqueado", {
    token: adminToken, method: "POST",
    body: { name: `QA bloqueado ${PREFIX}`, category: "general", icon: "place", latitude: -33.49, longitude: -70.69, tipo: "general", scope: "global", group_id: null, visible: true, active: true, fijo: true, bloqueado: true, created_by: adminId },
  });
  ok("ADMIN crea punto bloqueado", locked.status === 201 && locked.data?.[0]?.bloqueado === true, `${locked.status}`);
  if (locked.data?.[0]) points.push(locked.data[0]);
  const lockHack = await rest(`map_points?id=eq.${locked.data[0].id}`, {
    token: groups[0].manager.token, method: "PATCH", headers: { Prefer: "return=representation" }, body: { name: "HACK" },
  });
  ok("MANAGER no modifica punto bloqueado", blocked(lockHack), `${lockHack.status}`);
  const lockDel = await rest(`map_points?id=eq.${locked.data[0].id}`, {
    token: groups[0].manager.token, method: "DELETE", headers: { Prefer: "return=representation" },
  });
  ok("MANAGER no borra punto bloqueado", blocked(lockDel), `${lockDel.status}`);
  ok("el punto bloqueado sigue con su nombre",
    rows(await rest(`map_points?id=eq.${locked.data[0].id}&select=name`, { token: adminToken }))[0]?.name === `QA bloqueado ${PREFIX}`);

  // ------------------------------------------------------------ emergencia ---
  console.log("\n[6] Contactos de emergencia");
  const c = await rest("emergency_contacts?select=id,name", {
    token: adminToken, method: "POST",
    body: { name: `QA Contacto ${PREFIX}`, phone: "+56 9 0000 0000", description: "QA", is_general: true, user_id: null },
  });
  ok("ADMIN crea contacto general", c.status === 201, `${c.status}`);
  contactId = c.data?.[0]?.id || null;
  ok("usuario ve contacto general",
    rows(await rest(`emergency_contacts?select=id&id=eq.${contactId}`, { token: userG1.token })).length === 1);
  const cHack = await rest("emergency_contacts", {
    token: groups[0].manager.token, method: "POST",
    body: { name: "QA manager", phone: "1", is_general: true, user_id: null },
  });
  ok("MANAGER no crea contactos generales", cHack.status === 403, `${cHack.status}`);

  // ------------------------------------------------------------- seguridad ---
  console.log("\n[7] Seguridad: anon, JWT, roles y escalada");
  const anon = {};
  for (const t of ["activities", "events", "wall_posts", "profiles", "groups", "map_points"]) {
    const r = await rest(`${t}?select=id&limit=1`);
    anon[t] = r;
    ok(`anon no lee ${t}`, r.status === 401 || r.status === 403 || rows(r).length === 0, `${r.status} ${rows(r).length}`);
  }
  const tampered = adminToken.slice(0, -4) + "AAAA";
  const badJwt = await rest("profiles?select=id&limit=1", { token: tampered });
  ok("JWT manipulado rechazado", badJwt.status === 401, `${badJwt.status}`);

  const injectLogin = await login(`' OR 1=1 --`, "x");
  ok("inyección SQL en login no autentica", injectLogin.status !== 200 || !injectLogin.data?.session, `${injectLogin.status}`);
  const injectUser = await registrar(groups[0].slug, `qa';drop table public.wall_posts;--`, USER_PASS);
  ok("username con inyección rechazado", injectUser.status === 400 || injectUser.status === 409, `${injectUser.status}`);
  ok("wall_posts sigue existiendo tras inyección", (await rest("wall_posts?select=id&limit=1", { token: adminToken })).status === 200);
  const injectSlug = await rpc("definir_password_grupo", adminToken, { p_slug: `x';drop table public.groups;--`, p_password: "12345678" });
  ok("inyección en slug de grupo no ejecuta SQL", injectSlug.status >= 400, `${injectSlug.status}`);
  ok("groups sigue existiendo", (await rest("groups?select=id&limit=1", { token: adminToken })).status === 200);

  const managerRole = await rest(`profiles?id=eq.${groups[0].manager.id}&select=role`, {
    token: groups[0].manager.token, method: "PATCH", headers: { Prefer: "return=representation" }, body: { role: "admin" },
  });
  ok("MANAGER no se asciende a ADMIN", blocked(managerRole), `${managerRole.status}`);
  ok("MANAGER sigue siendo manager",
    rows(await rest(`profiles?id=eq.${groups[0].manager.id}&select=role`, { token: adminToken }))[0]?.role === "manager");
  const groupHack = await rest("groups", {
    token: groups[0].manager.token, method: "POST",
    body: { slug: `${PREFIX}hack`, name: "Hack", active: true },
  });
  ok("MANAGER no crea grupos", groupHack.status === 403, `${groupHack.status}`);
  const pwHack = await rpc("definir_password_grupo", groups[0].manager.token, { p_slug: groups[0].slug, p_password: "12345678" });
  ok("MANAGER no cambia contraseñas de grupo", pwHack.status === 403, `${pwHack.status}`);
  const adminRpcHack = await rpc("admin_grupos", groups[0].manager.token);
  ok("MANAGER no consulta admin_grupos", adminRpcHack.status === 403, `${adminRpcHack.status}`);
  const anonRpc = await rpc("definir_password_grupo", null, { p_slug: groups[0].slug, p_password: "12345678" });
  ok("anon no cambia contraseñas", anonRpc.status === 401 || anonRpc.status === 403, `${anonRpc.status}`);

  const noAdmin = await rpc("admin_grupos", userG1.token);
  ok("usuario normal no consulta admin_grupos", noAdmin.status === 403, `${noAdmin.status}`);

  // ------------------------------------------------------------- asignación --
  console.log("\n[8] Asignaciones y estado");
  const assigned = users.find((u) => u.group === groups[0] && u.username.endsWith("03")) || userG1;
  const ga = activities.find((a) => a.group === groups[0] && a.admin);
  const asg = await rest("activity_assignments?select=id,activity_id,user_id,status", {
    token: adminToken, method: "POST",
    body: { activity_id: ga.id, user_id: assigned.id, status: "pending" },
  });
  ok("ADMIN asigna actividad", asg.status === 201, `${asg.status}`);
  const upd = await rest(`activity_assignments?id=eq.${asg.data[0].id}`, {
    token: assigned.token, method: "PATCH", headers: { Prefer: "return=representation" }, body: { status: "in_progress" },
  });
  ok("usuario actualiza su estado", upd.status < 300 && rows(upd)[0]?.status === "in_progress", `${upd.status}`);
  const otherUser = users.find((u) => u.group === groups[0] && !u.manager && u.id !== assigned.id) || userG1;
  const updOther = await rest(`activity_assignments?id=eq.${asg.data[0].id}`, {
    token: otherUser.token, method: "PATCH", headers: { Prefer: "return=representation" }, body: { status: "completed" },
  });
  ok("otro usuario no actualiza la asignación", blocked(updOther), `${updOther.status}`);

  console.log(`\n=== RESULTADO: ${pass} OK · ${fail} fallos ===`);
  if (fail) console.log("Fallos:\n- " + fallos.join("\n- "));
  console.log(`\nPrefijo QA: ${PREFIX} (grupos ${groups.map((g) => g.slug).join(", ")})\n`);
  process.exitCode = fail ? 1 : 0;
} catch (err) {
  console.error("\nERROR FATAL:", err.message);
  console.error(err.stack?.split("\n").slice(0, 4).join("\n"));
  process.exitCode = 1;
} finally {
  // La limpieza de app/auth se hace con el SQL de PRUEBAS.md usando PREFIX.
  console.log(`Limpieza: usa PREFIX=${PREFIX} en el SQL de limpieza de PRUEBAS.md.`);
}
