import { supabase } from "./supabase.js";
import { EMERGENCY_URL } from "./config.js";
import { ahoraChile, estadoJW } from "./jw-tiempo.js";
import "./pwa.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const state = { user:null, profile:null, event:null, activities:[], category:"positive",
  map:null, mapListo:false, markers:null, markerById:new Map(), pendingFit:null, selectedId:null, toastTimer:null,
  mapPoints:[], pointMarkers:new Map(), mensajeTipo:null,
  // Grupo activo (UPDATE.md Etapa 1). `groupId` filtra TODAS las consultas;
  // `groups` alimenta el registro y el chip del header.
  groups:[], groupId:null, group:null, groupsListos:false, groupsCargando:false,
  // Registro progresivo: grupo validado + su contraseña (solo en memoria).
  regGroup:null, regGroupPassword:"",
  // Fase 2: categorías, colores y gestión por categoría.
  categorias:[], categoriasPorSlug:{}, categoriasCargadas:false,
  subcategorias:[], subcategoriasPorId:{}, overrides:[], capaAdmin:{modo:"categorias",categoria:null,subcategoria:null},
  geoCapas:{}, geoTranporte:null, capaPuntos:null,
  gestion:{modo:"categorias",categoria:null,buscar:""}, categoriasEditadas:new Map(),
  // Fase 3: JW y actividades.
  jwPuntos:[], puntoParaActividad:false, actividadPendiente:null, puntoBloqueadoOriginal:false,
  // Jerarquía ADMIN/MANAGER (sql/17): grupos/eventos para la vista del ADMIN.
  adminGroups:[], adminEventos:[], adminFiltroGrupo:"", grupoMiembros:[], contactos:[] };
const statusText = {pending:"Pendiente", in_progress:"En curso", completed:"Completada", cancelled:"Cancelada"};
const venueStatusText = {pending:"Programada", in_progress:"En curso", completed:"Finalizada", cancelled:"Cancelada"};
const viewLabels = {agenda:"Agenda", mapa:"Mapa", muro:"Muro", emergencia:"Emergencia", grupos:"Grupos", actividades:"Actividades"};
const dateFmt = new Intl.DateTimeFormat("es-CL",{weekday:"long",day:"numeric",month:"long"});
const dayFmt = new Intl.DateTimeFormat("es-CL",{day:"numeric",month:"short"});
const timeFmt = (v) => v ? v.slice(0,5) : "";
const esc = (v="") => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cap = (s) => s ? s[0].toUpperCase()+s.slice(1) : s;
// Coordenadas legibles para los popups (§6). Formato chileno: -33,45450.
const coordTexto = (c) => {
  const lon=Number(c?.[0]), lat=Number(c?.[1]);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) return "";
  return `${lat.toFixed(5).replace(".", ",")} · ${lon.toFixed(5).replace(".", ",")}`;
};
const todayStr = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const initials = (name="") => name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase() || "?";

function showLogin(){ $("#login-screen").classList.remove("hidden"); $("#app").classList.add("hidden"); mostrarRegistro(false); if(!state.groupsListos) cargarGruposRegistro(); }
function showApp(){ $("#login-screen").classList.add("hidden"); $("#app").classList.remove("hidden"); if(!gpsIntentado){gpsIntentado=true;activarGps();} if(state.profile) configurarVistaPorRol(); }
// Jerarquía sql/17: admin = ADMIN general; manager = MANAGER de su grupo.
function esAdminGeneral(){ return state.profile?.role === "admin"; }
function esManager(){ return state.profile?.role === "manager"; }
function esGestorDeGrupo(){ return esAdminGeneral() || esManager(); }
function isAdmin(){ return esAdminGeneral(); } // compatibilidad: poderes globales
function notifyError(el,msg){ el.textContent=msg || ""; }

// Toast honesto: informa sin fingir que algo se guardó.
function showToast(msg){
  const t=$("#toast-msg"); if(!t) return;
  state.mensajeTipo="aviso";
  $("#toast-title").textContent="";
  $("#toast-title").classList.add("hidden");
  $("#toast-icon").textContent="info";
  $("#toast-text").textContent=msg;
  $("#toast-acciones").innerHTML="";
  $("#toast-acciones").classList.add("hidden");
  $("#toast-close").classList.add("hidden");
  t.classList.remove("opacity-0","pointer-events-none");
  clearTimeout(state.toastTimer);
  state.toastTimer=setTimeout(()=>t.classList.add("opacity-0","pointer-events-none"),3500);
}

// Cuadro de mensaje enriquecido: título, detalles y acciones. Se usa para
// mostrar la ficha de un LUGAR o de un EVENTO del mapa (2026-11-25: se eliminó
// el panel inferior y sus datos se muestran aquí).
// `detalle` es HTML ya escapado por quien llama; `acciones` son botones.
function mostrarMensaje({titulo="",detalle="",acciones=[],icono="info",tipo="detalle"}={}){
  const t=$("#toast-msg"); if(!t) return;
  state.mensajeTipo=tipo;
  const cTitulo=$("#toast-title");
  cTitulo.textContent=titulo;
  cTitulo.classList.toggle("hidden",!titulo);
  $("#toast-icon").textContent=icono;
  $("#toast-text").innerHTML=detalle;
  const caja=$("#toast-acciones");
  caja.innerHTML="";
  if(acciones.length){
    caja.classList.remove("hidden");
    acciones.forEach(a=>{
      const b=document.createElement("button");
      b.type="button";
      b.className="h-9 px-3 rounded-full bg-white/15 hover:bg-white/25 text-inverse-on-surface text-sm font-bold flex items-center gap-1.5 active:scale-95 transition-all";
      b.textContent=a.texto;
      b.addEventListener("click",()=>{ cerrarMensaje(); a.fn?.(); });
      caja.appendChild(b);
    });
  } else caja.classList.add("hidden");
  $("#toast-close").classList.remove("hidden");
  t.classList.remove("opacity-0","pointer-events-none");
  clearTimeout(state.toastTimer);
}
function cerrarMensaje(){
  const t=$("#toast-msg"); if(!t) return;
  state.mensajeTipo=null;
  t.classList.add("opacity-0","pointer-events-none");
  clearTimeout(state.toastTimer);
}
$("#toast-close")?.addEventListener("click",cerrarMensaje);

// Traduce errores de PostgREST/Supabase a mensajes concretos y accionables.
function describeError(error,ctx){
  const m=error?.message||"";
  if(error?.code==="42501"||/permission denied/i.test(m))
    return `Sin permisos para ${ctx}: revisa los GRANT y las políticas RLS en Supabase (${m}).`;
  if(error?.code==="PGRST204")
    return `El esquema real no tiene una columna que la app usa (${m}). Compara el esquema con sql/01_diagnostico.sql.`;
  if(error?.code==="PGRST301"||/JWT|token/i.test(m)) return `Sesión expirada o inválida: vuelve a ingresar. (${ctx})`;
  if(m==="Failed to fetch") return `No se pudo conectar con Supabase (red o CORS). (${ctx})`;
  return `Error al procesar ${ctx}: ${m||error?.code||"desconocido"}`;
}

async function loadProfile(){
  // Grupo (UPDATE.md Fase 1). Si sql/10_grupos.sql todavía no se aplicó, se
  // usa el select base: el login no debe romperse por eso.
  const base="id,username,full_name,role,active";
  let res=await supabase.from("profiles").select(base+",group_id").eq("id",state.user.id).single();
  if(res.error && /group_id/i.test(res.error.message||"")){
    console.warn("loadProfile: falta la columna de grupo (ejecuta sql/10_grupos.sql). Se continúa sin grupo.");
    res=await supabase.from("profiles").select(base).eq("id",state.user.id).single();
    if(res.data){ res.data.group_id=null; }
  }
  const {data,error}=res;
  if(error){
    console.error("loadProfile: error de Supabase",error);
    const e=new Error(error.message==="Failed to fetch"?"No se pudo conectar con Supabase.":(error.message||"No se pudo cargar tu perfil."));
    e.code=error.code; throw e;
  }
  if(!data?.active){ const e=new Error("Tu usuario está desactivado o no tiene un perfil válido."); e.inactive=true; throw e; }
  state.profile=data;
  state.groupId=data.group_id||null;
  sincronizarGrupoVisible();
  const name=data.full_name || data.username || "";
  $("#user-label").textContent=name;
  $("#user-initials").textContent=initials(name);
  // Alta de actividades y puntos: ADMIN general y MANAGER de grupo.
  $("#admin-create-wrap").classList.toggle("hidden",!esGestorDeGrupo());
  // Alta de puntos: se hace con clic o pulsación larga en el mapa.
  // La gestión de capas/puntos se abre desde el engranaje de Capas (solo ADMIN).
  $("#capas-admin-btn")?.classList.toggle("hidden",!isAdmin());
  // Editar/crear el evento general: ADMIN o MANAGER (el MANAGER solo el suyo).
  $("#event-edit-btn")?.classList.toggle("hidden",!esGestorDeGrupo() || esAdminGeneral());
  if(state.mapListo) renderPuntosMapa();
  iniciarAnimacionesJW();
  configurarVistaPorRol();
}
// Muestra el chip del grupo en el header. Si la lista de grupos aún no llegó,
// se completa cuando termina cargarGruposRegistro().
function sincronizarGrupoVisible(){
  state.group = state.groups.find(g=>g.id===state.groupId) || state.group || null;
  const el=$("#group-label");
  if(!el) return;
  el.textContent=state.group?.name||"";
  el.classList.toggle("hidden",!state.group?.name);
}
// ==================== ACCESO Y REGISTRO ====================
// Login: usuario + contraseña; el grupo se detecta del perfil (sql/14).
// Registro progresivo: grupo + contraseña del grupo → usuario + contraseña
// personal. La separación REAL de datos la aplican las políticas RLS.
// ¿El usuario actual puede gestionar ESTE punto? El MANAGER solo los de su
// grupo; los globales y los bloqueados quedan para el ADMIN.
function puntoGestionable(p){
  if(p.bloqueado) return esAdminGeneral();
  if(esAdminGeneral()) return true;
  return esManager() && scopeDe(p)!=="global" && !!p.group_id && p.group_id===state.groupId;
}
// Filtra una consulta por el grupo activo. Si la migración aún no está aplicada
// (state.groupId null), la deja tal cual: la app sigue funcionando.
function filtrarGrupo(q){ return state.groupId ? q.eq("group_id",state.groupId) : q; }

// Convierte el error de una Edge Function en un Error con `code` y `status`,
// para distinguir USER_NOT_FOUND de una contraseña incorrecta.
async function errorDeFuncion(error,data){
  let payload=(data && typeof data==="object") ? data : null;
  if(!payload && error?.context && typeof error.context.clone==="function"){
    try{ payload=await error.context.clone().json(); }catch(_){ /* sin JSON */ }
  }
  const err=new Error(payload?.error || error?.message || "No fue posible completar la operación.");
  err.code=payload?.code || "";
  err.status=error?.context?.status || 0;
  err.sugerencias=Array.isArray(payload?.sugerencias)?payload.sugerencias:[];
  return err;
}

// Carga los grupos del REGISTRO (RPC de sql/14). Incluye `abierto` (el grupo
// ya tiene contraseña). Si sql/14 no está aplicado, cae a grupos_publicos().
async function cargarGruposRegistro(){
  const sel=$("#reg-group"); if(!sel || state.groupsCargando) return;
  state.groupsCargando=true;
  const hint=$("#reg-group-hint");
  try{
    let grupos=[];
    const {data,error}=await supabase.rpc("grupos_para_registro");
    if(!error && Array.isArray(data)) grupos=data;
    if(!grupos.length){
      const r=await supabase.rpc("grupos_publicos");
      if(!r.error && Array.isArray(r.data)) grupos=r.data.map(g=>({...g,abierto:true}));
    }
    if(!grupos.length){
      grupos=[{id:null,slug:"principal",name:"Grupo principal",abierto:false}];
      if(hint){
        hint.textContent="No hay grupos disponibles. Un administrador debe crear un grupo y definir su contraseña.";
        hint.classList.remove("hidden");
      }
    }
    state.groups=grupos;
    state.groupsListos=true;
    sel.innerHTML=grupos.map(g=>{
      const abierto=g.abierto!==false;
      return `<option value="${esc(g.slug)}"${abierto?"":" disabled"}>${esc(g.name)}${abierto?"":" (sin contraseña)"}</option>`;
    }).join("");
    if(hint && grupos.every(g=>g.abierto===false)){
      hint.textContent="Los grupos aún no tienen contraseña de registro. Pide al administrador que la configure.";
      hint.classList.remove("hidden");
    }
    sincronizarGrupoVisible();
  }catch(err){
    console.warn("cargarGruposRegistro:",err);
    state.groups=[]; state.groupsListos=true;
    sel.innerHTML='<option value="">Registro no disponible</option>';
    if(hint){ hint.textContent="No se pudieron cargar los grupos."; hint.classList.remove("hidden"); }
  }finally{
    state.groupsCargando=false;
  }
}

// ==================== VISTA ADMIN (sql/17) ====================
// El ADMIN general no tiene agenda: gestiona grupos, actividades, mapa y
// contactos. `admin_grupos()` devuelve solo campos seguros (nunca el hash).
async function cargarGruposAdmin(){
  const {data,error}=await supabase.rpc("admin_grupos");
  if(error){
    console.error("cargarGruposAdmin",error);
    // Respaldo: si sql/17 aún no está aplicado, al menos se listan los grupos.
    const r=await supabase.from("groups").select("id,slug,name,description,active").order("slug");
    if(r.error){ showToast("No se pudieron cargar los grupos: "+describeError(r.error,"los grupos")); return; }
    state.adminGroups=(r.data||[]).map(g=>({...g,has_password:false,member_count:0,manager_count:0}));
  }else{
    state.adminGroups=data||[];
  }
  state.groups=state.adminGroups.map(g=>({id:g.id,slug:g.slug,name:g.name,description:g.description,active:g.active,abierto:!!g.has_password}));
  const sel=$("#actividades-filtro"); if(sel) sel.dataset.listo="";
  if(state.mapListo) renderPuntosMapa();
}
async function cargarActividadesAdmin(){
  const {data:eventos,error:e1}=await supabase.from("events").select("*").order("start_date",{ascending:false});
  const {data:acts,error:e2}=await supabase.from("activities")
    .select("*,activity_assignments(user_id,status)")
    .order("activity_date",{ascending:false}).order("start_time",{ascending:false});
  if(e1||e2){
    console.error("cargarActividadesAdmin",e1||e2);
    showToast("No se pudieron cargar las actividades: "+describeError(e1||e2,"las actividades"));
    return;
  }
  state.adminEventos=eventos||[];
  state.activities=acts||[];
  if(state.mapListo) renderMap();
}
function grupoPorId(id){ return state.adminGroups.find(g=>g.id===id) || state.groups.find(g=>g.id===id) || null; }
function eventoActualDeGrupo(groupId,fecha){
  const evs=(state.adminEventos||[]).filter(e=>e.group_id===groupId);
  const pub=evs.filter(e=>e.status==="published");
  const lista=pub.length?pub:evs;
  return lista.find(e=>fecha && e.start_date<=fecha && fecha<=e.end_date)
    || lista.filter(e=>fecha && e.start_date>fecha).sort((a,b)=>a.start_date.localeCompare(b.start_date))[0]
    || lista[0] || null;
}
async function asegurarEventoGrupo(groupId,fecha){
  let ev=eventoActualDeGrupo(groupId,fecha);
  if(ev) return ev;
  const g=grupoPorId(groupId);
  const f=fecha||todayStr();
  const {data,error}=await supabase.from("events").insert({
    name:`Evento ${g?.name||"del grupo"}`, description:"Evento creado desde Actividades.",
    start_date:f, end_date:f, status:"published",
    group_id:groupId, created_by:state.user.id
  }).select("*").single();
  if(error){ console.error("asegurarEventoGrupo",error); throw error; }
  state.adminEventos.push(data);
  return data;
}
function renderGruposAdmin(){
  const root=$("#grupos-lista"); if(!root) return;
  if(!state.adminGroups.length){
    root.innerHTML='<div class="empty">Todavía no hay grupos. Crea el primero.</div>';
    return;
  }
  root.innerHTML=state.adminGroups.map(g=>{
    const ev=g.event_id?`${esc(g.event_name||"Evento")} · ${esc(g.event_start||"")}${g.event_end&&g.event_end!==g.event_start?" → "+esc(g.event_end):""}`:"Sin evento";
    return `<article class="group-card" data-group-card="${g.id}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="group-number">Grupo ${esc(g.slug)}</p>
          <h3 class="group-name">${esc(g.name)}</h3>
          <p class="group-desc">${esc(g.description||"")}</p>
        </div>
        <span class="status ${g.active?"completed":"cancelled"}">${g.active?"Activo":"Inactivo"}</span>
      </div>
      <div class="group-meta">
        <span>${g.member_count||0} miembro${Number(g.member_count)===1?"":"s"}</span>
        <span>${g.manager_count||0} manager${Number(g.manager_count)===1?"":"s"}</span>
        <span>${g.has_password?"Contraseña definida":"Sin contraseña"}</span>
      </div>
      <p class="group-event">${ev}</p>
      <div class="group-actions">
        <button class="secondary" data-group-edit="${g.id}" type="button">Editar</button>
        <button class="secondary" data-group-members="${g.id}" type="button">Miembros</button>
        <button class="secondary" data-group-event="${g.id}" type="button">Evento</button>
      </div>
    </article>`;
  }).join("");
  root.querySelectorAll("[data-group-edit]").forEach(b=>b.addEventListener("click",()=>abrirFormGrupo(state.adminGroups.find(g=>g.id===b.dataset.groupEdit))));
  root.querySelectorAll("[data-group-members]").forEach(b=>b.addEventListener("click",()=>abrirMiembrosGrupo(b.dataset.groupMembers)));
  root.querySelectorAll("[data-group-event]").forEach(b=>b.addEventListener("click",()=>abrirFormGrupo(state.adminGroups.find(g=>g.id===b.dataset.groupEvent),"evento")));
}
function renderActividadesAdmin(){
  const root=$("#actividades-lista"); if(!root) return;
  const sel=$("#actividades-filtro");
  if(sel && !sel.dataset.listo){
    sel.innerHTML=`<option value="">Todos los grupos</option>`+state.adminGroups.map(g=>`<option value="${esc(g.id)}">Grupo ${esc(g.slug)} · ${esc(g.name)}</option>`).join("");
    sel.dataset.listo="1";
    sel.value=state.adminFiltroGrupo||"";
  }
  const acts=(state.activities||[]).filter(a=>!state.adminFiltroGrupo||a.group_id===state.adminFiltroGrupo);
  if(!acts.length){ root.innerHTML='<div class="empty">No hay actividades para este filtro.</div>'; return; }
  root.innerHTML=acts.map(a=>{
    const g=grupoPorId(a.group_id);
    const ev=state.adminEventos.find(e=>e.id===a.event_id);
    const hora=`${timeFmt(a.start_time)}${a.end_time?" – "+timeFmt(a.end_time):""}`;
    return `<article class="activity-card admin-activity">
      <div class="activity-top">
        <div class="min-w-0 flex-1">
          <p class="activity-group">Grupo ${esc(g?.slug||"")}${g?.name?" · "+esc(g.name):""}</p>
          <h3>${esc(a.title)}</h3>
          <div class="activity-meta">${esc(a.activity_date)} · ${esc(hora)}${a.place?" · "+esc(a.place):""}</div>
          ${ev?`<div class="activity-meta">Evento: ${esc(ev.name)}</div>`:""}
        </div>
        <span class="status ${a.status||"pending"}">${statusText[a.status]||a.status||"Pendiente"}</span>
      </div>
      ${a.description?`<p class="activity-desc">${esc(a.description)}</p>`:""}
      <div class="activity-actions">
        <button class="secondary" data-mapa="${a.id}" type="button">Ver en mapa</button>
        <button class="secondary" data-edit="${a.id}" type="button">Editar</button>
        <button class="secondary danger" data-delete="${a.id}" type="button">Eliminar</button>
      </div>
    </article>`;
  }).join("");
  enlazarTarjetasActividad(root);
}
$("#actividades-filtro")?.addEventListener("change",e=>{
  state.adminFiltroGrupo=e.target.value;
  renderActividadesAdmin();
});
$("#new-activity-admin")?.addEventListener("click",()=>openActivity());
$("#grupo-nuevo-btn")?.addEventListener("click",()=>abrirFormGrupo());
$("#grupo-close")?.addEventListener("click",()=>$("#grupo-dialog").close());
$("#miembros-close")?.addEventListener("click",()=>$("#miembros-dialog").close());
$("#contacto-close")?.addEventListener("click",()=>$("#contacto-dialog").close());
$("#contacto-nuevo-btn")?.addEventListener("click",()=>abrirFormContacto());

function abrirFormGrupo(g=null){
  if(!esAdminGeneral()) return;
  const hoy=todayStr();
  $("#grupo-dialog-title").textContent=g?"Editar grupo":"Nuevo grupo";
  $("#grupo-id").value=g?.id||"";
  $("#grupo-slug").value=g?.slug||"";
  $("#grupo-slug").readOnly=!!g;
  $("#grupo-name").value=g?.name||"";
  $("#grupo-description").value=g?.description||"";
  $("#grupo-password").value="";
  $("#grupo-password").required=!g;
  $("#grupo-password-hint").textContent=g
    ? "Déjala vacía para conservar la contraseña actual."
    : "Obligatoria para que los usuarios puedan registrarse en este grupo (mínimo 6).";
  $("#grupo-active").checked=g?g.active!==false:true;
  $("#grupo-event-name").value=g?.event_name||"";
  $("#grupo-event-start").value=g?.event_start||hoy;
  $("#grupo-event-end").value=g?.event_end||sumarDias(hoy,7);
  notifyError($("#grupo-form-error"),"");
  $("#grupo-dialog").showModal();
}
$("#grupo-form")?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!esAdminGeneral()) return;
  const id=$("#grupo-id").value;
  const slug=$("#grupo-slug").value.trim().toLowerCase();
  const name=$("#grupo-name").value.trim();
  const password=$("#grupo-password").value;
  const active=$("#grupo-active").checked;
  if(!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(slug)){ notifyError($("#grupo-form-error"),"El número/slug debe empezar con letra o número y usar solo minúsculas, números, _ o -."); return; }
  if(name.length<2){ notifyError($("#grupo-form-error"),"El nombre del grupo es obligatorio (mínimo 2 caracteres)."); return; }
  if(!id && password.length<6){ notifyError($("#grupo-form-error"),"La contraseña del grupo debe tener al menos 6 caracteres."); return; }
  if(password && password.length<6){ notifyError($("#grupo-form-error"),"La contraseña del grupo debe tener al menos 6 caracteres."); return; }
  if(password && !active){ notifyError($("#grupo-form-error"),"Activa el grupo para poder definir su contraseña."); return; }
  let groupId=id;
  if(!id){
    const {data,error}=await supabase.from("groups").insert({
      slug,name,description:$("#grupo-description").value.trim()||null,active
    }).select("id").single();
    if(error){ notifyError($("#grupo-form-error"),describeError(error,"el grupo")); return; }
    groupId=data.id;
  }else{
    const {error}=await supabase.from("groups").update({
      name,description:$("#grupo-description").value.trim()||null,active
    }).eq("id",id);
    if(error){ notifyError($("#grupo-form-error"),describeError(error,"el grupo")); return; }
  }
  if(password){
    const {error}=await supabase.rpc("definir_password_grupo",{p_slug:slug,p_password:password});
    if(error){ notifyError($("#grupo-form-error"),describeError(error,"la contraseña del grupo")); return; }
  }
  const evName=$("#grupo-event-name").value.trim()||`Evento ${name}`;
  const evStart=$("#grupo-event-start").value||todayStr();
  const evEnd=$("#grupo-event-end").value||sumarDias(evStart,7);
  if(evEnd<evStart){ notifyError($("#grupo-form-error"),"La fecha de término del evento no puede ser anterior al inicio."); return; }
  const gActual=state.adminGroups.find(x=>x.id===groupId);
  const evPayload={name:evName,start_date:evStart,end_date:evEnd,status:"published",group_id:groupId};
  if(gActual?.event_id){
    const {error}=await supabase.from("events").update(evPayload).eq("id",gActual.event_id);
    if(error){ notifyError($("#grupo-form-error"),describeError(error,"el evento del grupo")); return; }
  }else{
    const {error}=await supabase.from("events").insert({...evPayload,created_by:state.user.id});
    if(error){ notifyError($("#grupo-form-error"),describeError(error,"el evento del grupo")); return; }
  }
  $("#grupo-dialog").close();
  showToast(id?"Grupo actualizado.":"Grupo creado.");
  await cargarGruposAdmin(); await cargarActividadesAdmin();
  renderGruposAdmin(); renderActividadesAdmin();
});

async function abrirMiembrosGrupo(groupId){
  if(!esAdminGeneral()) return;
  const g=grupoPorId(groupId);
  $("#miembros-title").textContent=`Miembros · ${g?.name||"Grupo"}`;
  $("#miembros-lista").innerHTML='<div class="empty">Cargando…</div>';
  notifyError($("#miembros-error"),"");
  $("#miembros-dialog").showModal();
  const {data,error}=await supabase.from("profiles")
    .select("id,username,full_name,role,active")
    .eq("group_id",groupId).order("username");
  if(error){ notifyError($("#miembros-error"),describeError(error,"los miembros")); $("#miembros-lista").innerHTML=""; return; }
  state.grupoMiembros=data||[];
  renderMiembrosGrupo(groupId);
}
function renderMiembrosGrupo(groupId){
  const root=$("#miembros-lista"); if(!root) return;
  if(!state.grupoMiembros.length){ root.innerHTML='<div class="empty">El grupo no tiene miembros.</div>'; return; }
  root.innerHTML=state.grupoMiembros.map(p=>{
    const rol=p.role==="admin"?"ADMIN":(p.role==="manager"?"MANAGER":"Usuario");
    const accion=p.role==="admin"
      ? ""
      : `<button type="button" class="secondary${p.role==="manager"?" warn":""}" data-miembro-rol="${p.id}" data-rol="${p.role==="manager"?"user":"manager"}">${p.role==="manager"?"Quitar manager":"Hacer manager"}</button>`;
    return `<div class="flex items-center gap-2 bg-surface-container-low rounded-xl p-2.5">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-on-surface truncate">${esc(p.full_name||p.username)}</p>
        <p class="text-[11px] text-on-surface-variant">@${esc(p.username)} · ${rol}${p.active===false?" · inactivo":""}</p>
      </div>
      ${accion}
    </div>`;
  }).join("");
  root.querySelectorAll("[data-miembro-rol]").forEach(b=>b.addEventListener("click",async()=>{
    const {error}=await supabase.from("profiles").update({role:b.dataset.rol}).eq("id",b.dataset.miembroRol);
    if(error){ notifyError($("#miembros-error"),describeError(error,"el rol del miembro")); return; }
    await abrirMiembrosGrupo(groupId);
    await cargarGruposAdmin(); renderGruposAdmin();
  }));
}

async function abrirFormContacto(c=null){
  if(!esAdminGeneral()) return;
  $("#contacto-dialog-title").textContent=c?"Editar contacto":"Nuevo contacto";
  $("#contacto-id").value=c?.id||"";
  $("#contacto-name").value=c?.name||"";
  $("#contacto-phone").value=c?.phone||"";
  $("#contacto-description").value=c?.description||"";
  notifyError($("#contacto-error"),"");
  $("#contacto-dialog").showModal();
}
$("#contacto-form")?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!esAdminGeneral()) return;
  const id=$("#contacto-id").value;
  const name=$("#contacto-name").value.trim();
  const phone=$("#contacto-phone").value.trim();
  if(!name||!phone){ notifyError($("#contacto-error"),"Nombre y teléfono son obligatorios."); return; }
  const payload={name,phone,description:$("#contacto-description").value.trim()||null,is_general:true,user_id:null};
  const q=id?supabase.from("emergency_contacts").update(payload).eq("id",id)
           :supabase.from("emergency_contacts").insert(payload);
  const {error}=await q;
  if(error){ notifyError($("#contacto-error"),describeError(error,"los contactos de emergencia")); return; }
  $("#contacto-dialog").close();
  showToast(id?"Contacto actualizado.":"Contacto agregado.");
  await loadEmergencyContacts();
});
async function usernameLogin(username,password){
  const {data,error}=await supabase.functions.invoke("login-username",{body:{username,password}});
  if(error || !data?.session) throw await errorDeFuncion(error,data);
  const {data:sessionData,error:setError}=await supabase.auth.setSession({
    access_token:data.session.access_token, refresh_token:data.session.refresh_token
  });
  if(setError) throw setError;
  state.user=sessionData.user;
  return data;
}

// --- registro progresivo -----------------------------------------------------
function mostrarRegistro(on){
  $("#register-panel")?.classList.toggle("hidden",!on);
  $("#login-form")?.classList.toggle("hidden",on);
}
function volverLogin(){
  mostrarRegistro(false);
  notifyError($("#reg-grupo-error"),"");
  notifyError($("#reg-perfil-error"),"");
  $("#username")?.focus();
}
async function abrirRegistro(usuario=""){
  if(!state.groupsListos) await cargarGruposRegistro();
  state.regGroup=null; state.regGroupPassword="";
  $("#reg-step-grupo")?.classList.remove("hidden");
  $("#reg-step-perfil")?.classList.add("hidden");
  $("#reg-sugerencias")?.classList.add("hidden");
  $("#reg-group-password").value="";
  $("#reg-password").value=""; $("#reg-password2").value="";
  $("#reg-username").value=String(usuario||"").trim();
  notifyError($("#reg-grupo-error"),""); notifyError($("#reg-perfil-error"),"");
  $("#reg-intro").textContent = usuario
    ? `No existe un perfil con el usuario “${usuario}”. Para crear uno necesitas la contraseña del grupo.`
    : "Para crear tu perfil necesitas la contraseña del grupo al que perteneces.";
  mostrarRegistro(true);
  $("#reg-group")?.focus();
}
async function validarGrupoRegistro(){
  const grupo=$("#reg-group")?.value||"";
  const password=$("#reg-group-password")?.value||"";
  if(!grupo){ notifyError($("#reg-grupo-error"),"Selecciona un grupo."); return; }
  if(!password){ notifyError($("#reg-grupo-error"),"Escribe la contraseña del grupo."); return; }
  const btn=$("#reg-validar"); if(btn) btn.disabled=true;
  notifyError($("#reg-grupo-error"),"");
  try{
    const {data,error}=await supabase.functions.invoke("register-profile",{
      body:{action:"validar-grupo",group:grupo,group_password:password}
    });
    if(error || !data?.ok) throw await errorDeFuncion(error,data);
    state.regGroup=data.group; state.regGroupPassword=password;
    $("#reg-grupo-elegido").textContent="Grupo: "+(data.group?.name||grupo);
    $("#reg-step-grupo").classList.add("hidden");
    $("#reg-step-perfil").classList.remove("hidden");
    $("#reg-username")?.focus();
  }catch(err){
    notifyError($("#reg-grupo-error"),err.message||"No se pudo validar el grupo.");
  }finally{ if(btn) btn.disabled=false; }
}
function mostrarSugerencias(lista){
  const cont=$("#reg-sugerencias"), root=$("#reg-sugerencias-lista");
  if(!cont||!root) return;
  root.innerHTML=(lista||[]).map(s=>
    `<button type="button" data-sugerencia="${esc(s)}" class="px-3 py-1.5 rounded-full bg-surface-container-lowest border border-outline-variant font-label-sm text-label-sm font-bold text-primary active:scale-95 transition-all">${esc(s)}</button>`
  ).join("");
  cont.classList.toggle("hidden",!(lista||[]).length);
  root.querySelectorAll("[data-sugerencia]").forEach(b=>b.addEventListener("click",()=>{
    $("#reg-username").value=b.dataset.sugerencia;
    cont.classList.add("hidden");
    notifyError($("#reg-perfil-error"),"Nombre actualizado. Presiona “Crear perfil” para confirmar.");
  }));
}
async function crearPerfil(){
  if(!state.regGroup){ notifyError($("#reg-perfil-error"),"Valida el grupo primero."); return; }
  const usuario=$("#reg-username")?.value.trim()||"";
  const pass=$("#reg-password")?.value||"";
  const pass2=$("#reg-password2")?.value||"";
  if(!/^[a-zA-Z0-9._-]{3,30}$/.test(usuario)){
    notifyError($("#reg-perfil-error"),"El usuario debe tener entre 3 y 30 caracteres (letras, números, punto, guion o guion bajo)."); return;
  }
  if(pass.length<6){ notifyError($("#reg-perfil-error"),"La contraseña debe tener al menos 6 caracteres."); return; }
  if(pass!==pass2){ notifyError($("#reg-perfil-error"),"Las contraseñas no coinciden."); return; }
  const btn=$("#reg-crear"); if(btn) btn.disabled=true;
  notifyError($("#reg-perfil-error"),"");
  try{
    const {data,error}=await supabase.functions.invoke("register-profile",{
      body:{action:"registrar",group:state.regGroup.slug,group_password:state.regGroupPassword,username:usuario,password:pass}
    });
    if(error || !data?.session) throw await errorDeFuncion(error,data);
    const {data:sessionData,error:setError}=await supabase.auth.setSession({
      access_token:data.session.access_token, refresh_token:data.session.refresh_token
    });
    if(setError) throw setError;
    state.user=sessionData.user;
    state.regGroup=null; state.regGroupPassword="";
    $("#reg-password").value=""; $("#reg-password2").value=""; $("#reg-group-password").value="";
    mostrarRegistro(false);
    await loadProfile();
    showApp(); await refreshAll();
    showToast("Perfil creado. ¡Bienvenido!");
  }catch(err){
    if(err.code==="USERNAME_TAKEN"){
      mostrarSugerencias(err.sugerencias);
      notifyError($("#reg-perfil-error"),err.message||"Ese nombre ya está en uso.");
    }else{
      notifyError($("#reg-perfil-error"),err.message||"No se pudo crear el perfil.");
    }
  }finally{ if(btn) btn.disabled=false; }
}
async function boot(){
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){showLogin();return;}
  state.user=session.user;
  try { await loadProfile(); }
  catch(e){
    // Solo se cierra la sesión si el perfil está ausente/inactivo (problema del usuario).
    // Un error de red/permisos NO debe expulsar al usuario: se muestra y se reintenta al recargar.
    console.error("boot:",e);
    if(e.inactive || e.code==="PGRST116") await supabase.auth.signOut();
    showLogin(); notifyError($("#login-error"),e.message); return;
  }
  showApp(); await refreshAll();
}
$("#login-form").addEventListener("submit",async e=>{
  e.preventDefault(); const btn=e.submitter||$("#login-form button[type=submit]"); if(btn) btn.disabled=true; notifyError($("#login-error"),"");
  const usuario=$("#username").value.trim();
  try{
    await usernameLogin(usuario,$("#password").value);
    await loadProfile();
    $("#password").value=""; showApp(); await refreshAll();
  }catch(err){
    if(err.code==="USER_NOT_FOUND"){
      // El documento pide ofrecer el registro cuando el usuario no existe.
      await abrirRegistro(usuario);
    }else{
      console.error("login:",err);
      notifyError($("#login-error"),err.message || "Usuario o contraseña incorrectos.");
    }
  }
  finally{ if(btn) btn.disabled=false; }
});
$("#login-register-link")?.addEventListener("click",()=>abrirRegistro($("#username")?.value.trim()||""));
$("#reg-volver")?.addEventListener("click",volverLogin);
$("#reg-validar")?.addEventListener("click",validarGrupoRegistro);
$("#reg-crear")?.addEventListener("click",crearPerfil);
$("#reg-group-password")?.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); validarGrupoRegistro(); } });
$("#reg-password2")?.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); crearPerfil(); } });
$("#logout-btn").addEventListener("click",async()=>{
  await supabase.auth.signOut();
  state.user=null;
  state.profile=null;
  state.groupId=null;
  state.group=null;
  state.adminGroups=[]; state.adminEventos=[]; state.groups=[]; state.groupsListos=false;
  document.body.classList.remove("modo-admin");
  $("#group-label")?.classList.add("hidden");
  $("#password").value="";
  showLogin();
  cargarGruposRegistro();
});
supabase.auth.onAuthStateChange((_event,session)=>{
  if(!session){
    state.user=null;
    state.profile=null;
    state.groupId=null;
    state.group=null;
    state.adminGroups=[]; state.adminEventos=[]; state.groups=[]; state.groupsListos=false;
    document.body.classList.remove("modo-admin");
    showLogin();
  }
});
// Cargar los grupos del registro desde el arranque (el login ya no pide grupo).
cargarGruposRegistro();

async function refreshAll(){
  // El ADMIN general no carga agenda ni muro: solo grupos, actividades,
  // mapa, puntos y contactos. MANAGER y usuarios conservan las secciones.
  if(esAdminGeneral()){
    const results=await Promise.allSettled([
      cargarGruposAdmin(), cargarActividadesAdmin(), cargarPuntosMapa(),
      loadEmergencyContacts(), cargarCategorias()
    ]);
    results.forEach((r,i)=>{ if(r.status==="rejected") console.error("refreshAll admin sección "+i+":",r.reason); });
    renderGruposAdmin(); renderActividadesAdmin();
    return;
  }
  // Cada sección carga de forma independiente: un fallo en una no debe impedir las demás.
  const results=await Promise.allSettled([loadEventAndActivities(),loadWall(),loadEmergencyContacts(),cargarCategorias()]);
  results.forEach((r,i)=>{ if(r.status==="rejected") console.error("refreshAll sección "+i+":",r.reason); });
}
// Ajusta la navegación según el rol. El ADMIN general ve una app simplificada;
// MANAGER y usuarios conservan Agenda/Mapa/Emergencia/Muro.
function configurarVistaPorRol(){
  const admin=esAdminGeneral();
  document.body.classList.toggle("modo-admin",admin);
  $$(".nav-item").forEach(b=>{
    const v=b.dataset.view;
    if(v==="grupos" || v==="actividades") b.classList.toggle("hidden",!admin);
    if(v==="agenda" || v==="muro") b.classList.toggle("hidden",admin);
  });
  $("#group-label")?.classList.toggle("hidden",admin || !state.group?.name);
  $("#admin-create-wrap")?.classList.toggle("hidden",!esGestorDeGrupo() || admin);
  $("#contacto-nuevo-btn")?.classList.toggle("hidden",!admin);
  if(admin){
    // El ADMIN no usa la agenda ni el muro; su inicio es Grupos.
    const actual=[...$$(".view")].find(v=>v.classList.contains("active"))?.id;
    if(actual==="view-agenda" || actual==="view-muro" || actual==="view-actividades" || !actual) gotoView("grupos");
  }else{
    const actual=[...$$(".view")].find(v=>v.classList.contains("active"))?.id;
    if(actual==="view-grupos" || actual==="view-actividades" || !actual) gotoView("agenda");
  }
}

// ==================== NAVEGACIÓN ====================
function gotoView(name){
  $$(".nav-item").forEach(x=>{
    const active=x.dataset.view===name;
    x.classList.toggle("active",active);
    if(active)x.setAttribute("aria-current","page");
    else x.removeAttribute("aria-current");
  });
  $$(".view").forEach(v=>{
    const on=v.id===`view-${name}`;
    v.classList.toggle("active",on);
    v.classList.toggle("hidden",!on);
  });
  $("#header-view-label").textContent=viewLabels[name]||name;
  // En la vista Mapa se oculta el header de la app para que el mapa use
  // todo el espacio de la pantalla.
  document.body.classList.toggle("vista-mapa",name==="mapa");
  document.body.classList.toggle("vista-emergencia",name==="emergencia");
  if(name==="mapa")setTimeout(()=>{
    if(!state.map) renderMap();          // mapa perezoso: se crea al abrir la pestaña
    else state.map.resize();
    applyPendingFit();
    actualizarAlturaPanelMapa();         // la atribución se reposa sobre el panel
  },100);
}
$$(".nav-item").forEach(b=>b.addEventListener("click",()=>gotoView(b.dataset.view)));

// ==================== AGENDA ====================
function showAgendaError(msg){
  const agendaRoot=$("#agenda-list");
  $("#event-info").innerHTML="";
  agendaRoot.innerHTML=`<div class="error" role="alert">⚠ ${esc(msg)}</div>`;
  agendaRoot.setAttribute("aria-busy","false");
}
async function loadEventAndActivities(){
  const agendaRoot=$("#agenda-list");
  if(agendaRoot)agendaRoot.setAttribute("aria-busy","true");
  const consultaEventos=filtrarGrupo(supabase.from("events").select("*").eq("status","published"));
  const {data:events,error}=await consultaEventos.order("start_date",{ascending:false});
  if(error){ console.error("loadEventAndActivities: events",error); showAgendaError(describeError(error,"events")); throw error; }
  // Elegir el evento vigente: el que contiene hoy; si no, el próximo más cercano; si no, el más reciente.
  const today=todayStr();
  state.event=(events||[]).find(e=>e.start_date<=today && today<=e.end_date)
    || (events||[]).filter(e=>e.start_date>today).sort((a,b)=>a.start_date.localeCompare(b.start_date))[0]
    || (events||[])[0] || null;
  if(!state.event){
    $("#event-info").innerHTML='<div class="empty">Todavía no hay un evento publicado.</div>';
    $("#agenda-list").innerHTML="";
    // Limpiar también la estructura de días: al cambiar de grupo el DOM
    // anterior no debe quedar visible (evita mostrar actividades de otro grupo).
    ["#agenda-past-days","#agenda-active-list","#agenda-upcoming-days"].forEach(s=>{
      const el=$(s); if(el) el.innerHTML="";
    });
    $("#agenda-active-day")?.classList.add("hidden");
    $("#agenda-list").setAttribute("aria-busy","false");
    state.activities=[];
    renderMap();
    return;
  }
  $("#event-info").innerHTML=`<h2>${esc(state.event.name)}</h2><p>${esc(state.event.description||"")}</p>`;
  $("#event-range").textContent=`${dayFmt.format(new Date(state.event.start_date+"T12:00:00"))} – ${dayFmt.format(new Date(state.event.end_date+"T12:00:00"))}, ${state.event.start_date.slice(0,4)}`;
  renderEventBadge();
  // El admin debe ver también las canceladas (para poder reabrirlas); el usuario normal no.
  // Si la columna "status" no existe en la BD real, no se rompe toda la agenda:
  // se reintenta sin ese filtro y se avisa por consola (AGENT.md §5: no asumir columnas).
  const base=()=>{let x=filtrarGrupo(supabase.from("activities").select("*,activity_assignments(user_id,status)").eq("event_id",state.event.id)).order("activity_date").order("start_time");return esGestorDeGrupo()?x:x.neq("status","cancelled");};
  let {data,error:actError}=await base();
  if(actError && actError.code==="PGRST204" && /status/i.test(actError.message||"")){
    console.warn('La columna "status" no existe en activities; se omite el filtro de canceladas. Compara el esquema con sql/01_diagnostico.sql.');
    state.statusColumnMissing=true;
    ({data,error:actError}=await filtrarGrupo(supabase.from("activities").select("*,activity_assignments(user_id,status)").eq("event_id",state.event.id)).order("activity_date").order("start_time"));
  }
  if(actError){ console.error("loadEventAndActivities: activities",actError); showAgendaError(describeError(actError,"activities")); throw actError; }
  state.activities=data||[];
  renderAgenda(); renderMap();
  // Los popups de los puntos JW listan sus actividades: refrescarlos.
  if(state.mapListo) renderPuntosMapa();
}
function renderEventBadge(){
  const el=$("#event-day-badge"); if(!el) return;
  if(!state.event){ el.classList.add("hidden"); return; }
  const {start_date:s,end_date:e}=state.event, t=todayStr();
  if(t>=s && t<=e){
    const day=Math.round((new Date(t+"T00:00:00")-new Date(s+"T00:00:00"))/864e5)+1;
    const total=Math.round((new Date(e+"T00:00:00")-new Date(s+"T00:00:00"))/864e5)+1;
    $("#event-day-badge-text").textContent=`Día ${day} de ${total}`;
    el.classList.remove("hidden");
  } else el.classList.add("hidden");
}

// ==================== EVENTO GENERAL EDITABLE (Fase 4) ====================
function sumarDias(fecha,n){
  const d=new Date(fecha+"T12:00:00");
  d.setDate(d.getDate()+n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function openEventForm(){
  if(!esGestorDeGrupo()) return;
  const e=state.event;
  $("#event-dialog-title").textContent=e?"Editar evento":"Crear evento";
  $("#event-id").value=e?.id||"";
  $("#event-name").value=e?.name||"";
  $("#event-description").value=e?.description||"";
  $("#event-start").value=e?.start_date||todayStr();
  $("#event-end").value=e?.end_date||sumarDias(todayStr(),7);
  notifyError($("#event-form-error"),"");
  $("#event-dialog").showModal();
}
$("#event-edit-btn")?.addEventListener("click",openEventForm);
$("#event-close")?.addEventListener("click",()=>$("#event-dialog").close());
$("#event-form")?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!esGestorDeGrupo()) return;
  const id=$("#event-id").value;
  const nombre=$("#event-name").value.trim();
  const descripcion=$("#event-description").value.trim()||null;
  const inicio=$("#event-start").value, fin=$("#event-end").value;
  if(!nombre){ notifyError($("#event-form-error"),"El nombre del evento es obligatorio."); return; }
  if(!inicio||!fin){ notifyError($("#event-form-error"),"Indica la fecha de inicio y de término."); return; }
  if(fin<inicio){ notifyError($("#event-form-error"),"La fecha de término no puede ser anterior a la de inicio."); return; }
  const payload={name:nombre,description:descripcion,start_date:inicio,end_date:fin,status:"published"};
  if(state.groupId) payload.group_id=state.groupId;
  const guardar=async p=>id
    ? await supabase.from("events").update(p).eq("id",id).select("id")
    : await supabase.from("events").insert({...p,created_by:state.user.id}).select("id");
  let res=await guardar(payload);
  // Compatibilidad: si la BD aún no tiene events.group_id (pre-sql/10).
  if(res.error && /group_id/i.test(res.error.message||"")){
    const {group_id,...resto}=payload;
    res=await guardar(resto);
  }
  if(res.error){
    console.error("event-form: guardar",res.error);
    notifyError($("#event-form-error"),describeError(res.error,"el evento"));
    return;
  }
  $("#event-dialog").close();
  showToast(id?"Evento actualizado.":"Evento creado.");
  await loadEventAndActivities();
});

const hasMine = (a)=>(a.activity_assignments||[]).some(x=>x.user_id===state.user?.id);

function renderAgenda(){
  const root=$("#agenda-list"); if(!root) return;
  root.setAttribute("aria-busy","false");
  const today=todayStr();
  const past=$("#agenda-past-days");
  const activeList=$("#agenda-active-list");
  const upcoming=$("#agenda-upcoming-days");
  const useNewLayout=!!(past&&activeList&&upcoming);

  // TODOS los días del evento, incluidos los que no tienen actividades.
  const fechas=[];
  if(state.event){
    for(let d=state.event.start_date; d<=state.event.end_date; d=sumarDias(d,1)) fechas.push(d);
  }
  const byDate=new Map();
  for(const a of state.activities){
    if(!byDate.has(a.activity_date)) byDate.set(a.activity_date,[]);
    byDate.get(a.activity_date).push(a);
  }
  const itemsDe=(date)=>byDate.get(date)||[];
  const progreso=(items)=>{
    const mineThatDay=items.filter(hasMine);
    const done=mineThatDay.filter(a=>(a.activity_assignments||[]).find(x=>x.user_id===state.user.id)?.status==="completed").length;
    return {mineThatDay,done,pct:mineThatDay.length?Math.round(done/mineThatDay.length*100):0};
  };
  const mes=(dt)=>dt.toLocaleDateString("es-CL",{month:"short"}).toUpperCase();

  if(useNewLayout){
    past.innerHTML=""; activeList.innerHTML=""; upcoming.innerHTML="";
    // La tarjeta del día activo se oculta y solo reaparece si HOY está en el evento.
    $("#agenda-active-day")?.classList.add("hidden");
    for(const date of fechas){
      const items=itemsDe(date);
      const dt=new Date(date+"T12:00:00");
      const isToday=date===today;
      const {mineThatDay,done,pct}=progreso(items);
      const itemsHtml=items.length
        ? items.map(activityCard).join("")
        : '<div class="empty">Sin actividades registradas.</div>';

      if(isToday){
        // Día activo: tarjeta completa, expandido por defecto.
        activeList.innerHTML=itemsHtml;
        $("#active-day-num").textContent=dt.getDate();
        $("#active-day-month").textContent=mes(dt);
        $("#active-day-label").textContent=cap(dateFmt.format(dt));
        $("#active-day-subtitle").textContent=items[0]?.description||"Sin actividades programadas";
        $("#active-day-count").textContent=items.length+" Actividad"+(items.length===1?"":"es");
        $("#active-day-progress").textContent=done+" de "+mineThatDay.length+" completadas";
        $("#active-day-progress-bar").style.width=pct+"%";
        $("#agenda-active-day")?.classList.remove("hidden");
      } else {
        const isPast=date<today;
        const dayNode=isPast?past:upcoming;
        const dayId="day-"+date.replace(/-/g,"");
        const icon=isPast?"done":"expand_more";
        const cls=isPast?"border-[#CEE8F2] bg-surface-container":"border-[#b1e0ff] bg-surface-container-lowest";
        const titleColor=isPast?"#33647e":"#006492";
        const badgeColor=isPast?"#dfe3e4":"#c9e6ff";
        const badgeTextColor=isPast?"#34647f":"#004262";
        dayNode.innerHTML+=`
          <div class="relative flex items-start gap-3.5 group min-w-0">
            <div class="w-13 h-13 min-w-[52px] min-h-[52px] rounded-full flex flex-col items-center justify-center shadow-sm border-2 ${cls} transition-all flex-shrink-0" style="background-color: ${isPast?"#eaeff0":"#ffffff"};">
              <span class="text-[20px] font-black leading-none" style="color: ${titleColor};">${dt.getDate()}</span>
              <span class="text-[9px] font-bold uppercase tracking-wider leading-none mt-0.5" style="color: ${badgeTextColor};">${mes(dt)}</span>
            </div>
            <div class="flex-1 min-w-0 bg-surface-container-lowest rounded-lg p-3 shadow-sm border transition-all duration-200" style="border-color: #CEE8F2;">
              <button class="w-full min-w-0 flex items-center justify-between gap-2 text-left focus:outline-none" type="button" data-day="${dayId}">
                <div class="min-w-0 pr-2">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-headline-sm text-[16px] font-bold uppercase tracking-tight" style="color: ${titleColor};">${esc(cap(dateFmt.format(dt)))}</span>
                    <span class="px-2 py-0.5 rounded-full font-label-sm text-[11px] font-bold flex items-center gap-1" style="background-color: ${badgeColor}; color: ${badgeTextColor};">
                      <span class="material-symbols-outlined text-[14px]">${isPast?"done":"calendar_today"}</span>
                      ${items.length} actividad${items.length===1?"":"es"}
                    </span>
                  </div>
                  <p class="font-body-sm text-[12px] truncate mt-0.5" style="color: #3f4850;">${esc(items[0]?.description||"Sin actividades")}</p>
                </div>
                <span class="material-symbols-outlined text-outline flex-shrink-0 transition-transform duration-200" id="${dayId}-icon">${icon}</span>
              </button>
              <div class="hidden mt-2 pt-2 border-t border-slate-100 space-y-1.5" id="${dayId}-content">
                ${itemsHtml}
              </div>
            </div>
          </div>`;
      }
    }
    const enlazarDias=(raiz)=>raiz.querySelectorAll("button[data-day]").forEach(b=>{
      const id=b.getAttribute("data-day"); if(id) b.addEventListener("click",()=>toggleDay(id));
    });
    enlazarDias(past);
    enlazarDias(upcoming);
    [past,activeList,upcoming].forEach(enlazarTarjetasActividad);
  } else {
    // Fallback: lista simple con todos los días del evento.
    root.innerHTML=fechas.map(date=>{
      const items=itemsDe(date);
      const dt=new Date(date+"T12:00:00");
      const isToday=date===today;
      const {mineThatDay,done,pct}=progreso(items);
      const progress=mineThatDay.length
        ? `<div class="day-progress"><div class="day-track"><div class="day-bar" style="width:${pct}%"></div></div><span>${done}/${mineThatDay.length} completadas</span></div>`
        : `<span class="day-count">${items.length} actividad${items.length===1?"":"es"}</span>`;
      return `<section class="agenda-day">
        <div class="day-heading">
          <span class="day-title${isToday?" is-today":""}">${isToday?"HOY":esc(cap(dateFmt.format(dt)))}</span>
          ${progress}
        </div>
        ${items.length?items.map(activityCard).join(""):'<div class="empty">Sin actividades registradas.</div>'}
      </section>`;
    }).join("");
    enlazarTarjetasActividad(root);
  }
}
function toggleDay(dayId){
  const content=document.getElementById(dayId+"-content");
  const icon=document.getElementById(dayId+"-icon");
  if(!content||!icon) return;   // el nodo puede haber sido recreado por un re-render
  if(content.classList.contains("hidden")){ content.classList.remove("hidden"); icon.textContent="expand_less"; }
  else { content.classList.add("hidden"); icon.textContent="expand_more"; }
}
async function changeActivityStatus(id,status){
  if(state.statusColumnMissing){alert("La columna status no existe en activities: no se puede cambiar el estado. Compara el esquema real con sql/01_diagnostico.sql.");return;}
  const {error}=await supabase.from("activities").update({status}).eq("id",id);
  if(error){console.error("changeActivityStatus",error);if(error.code==="PGRST204")state.statusColumnMissing=true;alert(describeError(error,"activities"));return;}
  showToast(status==="cancelled"?"Actividad cancelada.":"Actividad reabierta.");
  await loadEventAndActivities();
}
async function reopenActivity(id){ return changeActivityStatus(id,"pending"); }
function activityCard(a){
  const assignment=(a.activity_assignments||[]).find(x=>x.user_id===state.user.id);
  const myStatus=assignment?.status;
  const status=myStatus || a.status || "pending";
  const time=`${timeFmt(a.start_time)}${a.end_time?" – "+timeFmt(a.end_time):""}`;
  return `<article class="activity-card${a.status==="cancelled"?" is-cancelled":""}">
    <div class="activity-top">
      <div class="min-w-0 flex-1">
        <h3>${esc(a.title)}</h3>
        <div class="activity-meta">${esc(time)}${a.place?" · "+esc(a.place):""}</div>
      </div>
      <span class="status ${status}">${statusText[status]||status}</span>
    </div>
    ${a.description?`<p class="activity-desc">${esc(a.description)}</p>`:""}
    <div class="activity-actions">
      <button class="secondary" data-mapa="${a.id}" type="button">Ver en mapa</button>
    </div>
    ${assignment?`<div class="activity-actions">${["pending","in_progress","completed"].map(s=>
      `<button class="secondary${myStatus===s?" on":""}" data-id="${a.id}" data-status="${s}" type="button">${statusText[s]}</button>`).join("")}</div>`:""}
    ${esGestorDeGrupo()?`<div class="activity-actions">
      <button class="secondary" data-edit="${a.id}" type="button">Editar</button>
      ${a.status!=="cancelled"?`<button class="secondary warn" data-cancel="${a.id}" type="button">Cancelar</button>`:""}
      <button class="secondary danger" data-delete="${a.id}" type="button">Eliminar</button>
      ${a.status==="cancelled"?`<button class="secondary" data-reopen="${a.id}" type="button">Reabrir</button>`:""}
    </div>`:""}
  </article>`;
}
// Enlaza los botones de las tarjetas de actividad (también en el diseño nuevo
// de días, donde antes solo se enlazaban los toggles de día).
function enlazarTarjetasActividad(root){
  if(!root) return;
  root.querySelectorAll("[data-status]").forEach(b=>b.addEventListener("click",()=>updateMyStatus(b.dataset.id,b.dataset.status)));
  root.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openActivity(state.activities.find(a=>a.id===b.dataset.edit))));
  root.querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",()=>deleteActivity(b.dataset.delete)));
  root.querySelectorAll("[data-reopen]").forEach(b=>b.addEventListener("click",()=>reopenActivity(b.dataset.reopen)));
  root.querySelectorAll("[data-cancel]").forEach(b=>b.addEventListener("click",()=>changeActivityStatus(b.dataset.cancel,"cancelled")));
  root.querySelectorAll("[data-mapa]").forEach(b=>b.addEventListener("click",()=>verActividadEnMapa(state.activities.find(a=>a.id===b.dataset.mapa))));
}

// Lleva al mapa a la ubicación de la actividad: usa su punto JW si lo tiene.
function verActividadEnMapa(a){
  if(!a) return;
  const p=a.map_point_id?state.mapPoints.find(x=>x.id===a.map_point_id):null;
  const lat=Number(p?.latitude ?? a.latitude), lng=Number(p?.longitude ?? a.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat===0||lng===0){
    showToast("La actividad no tiene ubicación en el mapa."); return;
  }
  gotoView("mapa");
  // Cierra popups previos (p. ej. el de la comuna) para que se vea el del JW.
  document.querySelectorAll(".maplibregl-popup-close-button").forEach(b=>b.click());
  const volar=(intentos=0)=>{
    if(!state.map){ if(intentos<15) setTimeout(()=>volar(intentos+1),200); return; }
    state.map.flyTo({center:[lng,lat],zoom:Math.max(state.map.getZoom(),15),duration:700});
    if(a.map_point_id){
      setTimeout(()=>{
        const marker=state.pointMarkers.get(a.map_point_id);
        if(!marker) return;
        const popup=marker.getPopup?.();
        // Abrir solo si está cerrado (togglePopup lo cerraría si ya estaba abierto).
        if(!popup || !popup.isOpen()) marker.togglePopup();
      },600);
    }
  };
  setTimeout(()=>volar(),250);
}

async function updateMyStatus(activityId,status){
  const {error}=await supabase.from("activity_assignments").update({status}).eq("activity_id",activityId).eq("user_id",state.user.id);
  if(error){console.error("updateMyStatus",error);alert("No se pudo actualizar el estado: "+describeError(error,"tu asignación"));return;}
  showToast(`Estado: ${statusText[status]}.`);
  await loadEventAndActivities();
}

// ==================== MAPA (MapLibre GL + OpenStreetMap) ====================
// Mismo stack que territorio-gps-movil: MapLibre + estilo OpenFreeMap (positron).
// Vista INFORMATIVA: muestra los eventos/actividades públicos y dónde estás tú.
// No gestiona estados de recorrido ni reportes (eso es territorio-gps).
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const coords=(a)=>({lat:Number(a.latitude ?? a.lat),lng:Number(a.longitude ?? a.long ?? a.lng)});
const conCoords=(a)=>{const c=coords(a);return Number.isFinite(c.lat)&&Number.isFinite(c.lng)&&c.lat!==0&&c.lng!==0;};

// El estilo "positron" de OpenFreeMap declara la fuente ráster "ne2_shaded"
// (relieve de Natural Earth) pero NINGUNA capa la usa: la base de la app es la
// vista satelital (§3.1). Si esa fuente se demora o falla, MapLibre nunca
// termina de "cargar" el estilo → el mapa se queda en blanco.
// En MapLibre 4.7.1 el estilo NO se puede pasar como OBJETO al constructor:
// `Style.loadJSON()` aplaza la carga a un `requestAnimationFrame` y, si la
// pestaña está en segundo plano (o el navegador no pinta), ese frame nunca
// llega: el mapa quedaría en blanco. Por eso el mapa se crea con la URL del
// estilo (ruta que no depende de rAF) y la fuente inútil se elimina en el
// evento `style.load`, ANTES de añadir las capas propias: quitarla después
// recargaba el estilo entero y borraba lo ya añadido.
function limpiarEstiloBase(){
  const map=state.map; if(!map) return;
  try{
    if(!map.getSource?.("ne2_shaded")) return;
    const capas=(map.getStyle()?.layers||[]).filter(l=>l.source==="ne2_shaded").map(l=>l.id);
    capas.forEach(id=>{ try{ map.removeLayer(id); }catch(_){/* se ignora */} });
    map.removeSource("ne2_shaded");
  }catch(err){
    console.warn("mapa: no se pudo quitar la fuente ne2_shaded:",err.message);
  }
}

function renderMap(){
  renderMapList();
  if(!window.maplibregl)return;
  if(!state.map){
    // El mapa solo se instancia con la vista visible (contenedor con tamaño);
    // si aún no se abrió la pestaña Mapa, solo se deja preparado el fitBounds.
    if(!$("#view-mapa").classList.contains("active")){ state.pendingFit=markersBounds(); return; }
    state.map=new maplibregl.Map({
      container:"map", style:MAP_STYLE, center:[-70.6693,-33.4489], zoom:11,
      attributionControl:{compact:false}   // atribución siempre visible (§3.1: Esri + ODbL)
    });
    state.markers=[];
    window.__mapa=state.map;   // enganche de depuración (consola del navegador)
    // Crear punto: clic en zona vacía o pulsación larga. No se abre al tocar
    // marcadores/popups ni al hacer clic sobre una capa de datos.
    state.map.on("click",(e)=>{
      if(state.suppressMapClick){ state.suppressMapClick=false; return; }
      const target=e.originalEvent?.target;
      if(target?.closest?.(".map-point,.map-pin,.maplibregl-popup,button,input,select,textarea")) return;
      const propias=(state.map.getStyle()?.layers||[])
        .filter(l=>/^(lugares-|metro|metrotren)/.test(l.id))
        .map(l=>l.id).filter(id=>state.map.getLayer(id));
      if(propias.length && state.map.queryRenderedFeatures(e.point,{layers:propias}).length) return;
      abrirFormPunto(null,e.lngLat.lat,e.lngLat.lng);
    });
    // Pulsación larga (móvil o mouse): abre el formulario sin depender del click.
    const canvas=state.map.getCanvas();
    let pressTimer=null, pressStart=null;
    const limpiarPress=()=>{ if(pressTimer){clearTimeout(pressTimer);pressTimer=null;} pressStart=null; };
    canvas.addEventListener("pointerdown",(ev)=>{
      if(ev.pointerType==="mouse" && ev.button!==0) return;
      pressStart={x:ev.clientX,y:ev.clientY};
      const rect=canvas.getBoundingClientRect();
      const lngLat=state.map.unproject([ev.clientX-rect.left,ev.clientY-rect.top]);
      pressTimer=setTimeout(()=>{
        pressTimer=null;
        state.suppressMapClick=true;
        abrirFormPunto(null,lngLat.lat,lngLat.lng);
      },600);
    });
    canvas.addEventListener("pointermove",(ev)=>{
      if(!pressStart||!pressTimer) return;
      if(Math.hypot(ev.clientX-pressStart.x,ev.clientY-pressStart.y)>10) limpiarPress();
    });
    ["pointerup","pointercancel","pointerleave"].forEach(t=>canvas.addEventListener(t,limpiarPress));
    canvas.addEventListener("contextmenu",(ev)=>ev.preventDefault());
    // Al cambiar el zoom, los iconos se convierten en puntos de color (§5).
    state.map.on("zoom",actualizarPuntosSegunZoom);
    // El arranque se hace con `style.load` (el estilo ya está aplicado y se
    // pueden añadir sources/layers). Si alguna fuente del estilo se demora,
    // el vigilante reintenta: `addSource` lanza si el estilo no está listo.
    let mapaIniciado=false, iniciando=false;
    const iniciarMapa=()=>{
      if(mapaIniciado||iniciando) return;
      iniciando=true;
      try{
        state.mapListo=true;
        // §10: se respetan las preferencias guardadas del usuario (vista
        // satelital y límites comunales se encienden según su última elección).
        if(capasEstado.satelite) activarSateliteInicial();
        cargarComunas().catch(err=>console.warn("comunas:",err));   // §3.2 (async)
        cargarPuntosMapa().catch(err=>console.warn("puntos:",err)); // §9 (async)
        renderMarkers();
        ponerMarcadorUsuario();
        applyPendingFit();
        // Las capas que el usuario dejó encendidas se recuperan (§10): las de
        // lugares (un archivo por capa) y las que necesitan una fuente propia
        // (transporte: metro y metrotren). Sin esto, el interruptor quedaría
        // "encendido" pero sin datos en el mapa.
        CAPAS_DEF.forEach(g=>g.items.forEach(it=>{
          if(!capasEstado[it.id]) return;
          if(it.requiere) asegurarFuente(it.requiere).catch(err=>console.warn("capa",it.id,err));
          if(it.capaLugares) cargarLugares(it.capaLugares).catch(err=>console.warn("capa",it.id,err));
        }));
        mapaIniciado=true;
      }catch(err){
        // El estilo todavía no está listo: se reintenta en el siguiente tick.
        console.warn("mapa: aún no se puede iniciar",err.message);
      }finally{ iniciando=false; }
    };
    // Al cargar el estilo se quita la fuente inútil y, solo después, se añaden
    // las capas propias: así el estilo puede terminar de cargar y el mapa pinta.
    state.map.on("style.load",()=>{ limpiarEstiloBase(); iniciarMapa(); });
    state.map.on("load",iniciarMapa);
    const vigilante=setInterval(()=>{
      if(mapaIniciado){ clearInterval(vigilante); return; }
      iniciarMapa();
    },1000);
    setTimeout(()=>clearInterval(vigilante),30000);
  }
  if(state.mapListo) renderMarkers();
}
function renderMarkers(){
  if(!state.map||!state.mapListo)return;
  state.markers.forEach(m=>m.remove());
  state.markers=[]; state.markerById.clear();
  state.activities.filter(conCoords).forEach(a=>{
    const c=coords(a);
    const el=document.createElement("div");
    el.className="map-pin";
    el.dataset.est=a.status||"pending";
    el.innerHTML=`<span class="material-symbols-outlined">${PIN_ICON[a.status]||"event"}</span>`;
    const popup=new maplibregl.Popup({offset:24,closeButton:true}).setHTML(
      `<strong>${esc(a.title)}</strong><br>${esc(a.place||"")}`);
    const m=new maplibregl.Marker({element:el,anchor:"bottom"})
      .setLngLat([c.lng,c.lat]).setPopup(popup).addTo(state.map);
    m.getElement().addEventListener("click",()=>selectVenue(a,false));
    state.markers.push(m);
    state.markerById.set(a.id,m);
  });
  actualizarPuntosSegunZoom();   // los pines de actividad también se reducen al alejar
  aplicarActividades();   // respeta el interruptor "Actividades" del panel de capas
  if(state.selectedId && !state.activities.some(a=>a.id===state.selectedId)) resetVenue();
  // fitBounds solo cuando la vista está visible; si no, se aplaza hasta abrir la pestaña Mapa.
  state.pendingFit=markersBounds();
  applyPendingFit();
}
// Icono Material por estado de la actividad (pines con color por estado)
const PIN_ICON = {pending:"event", in_progress:"directions_walk", completed:"check_circle", cancelled:"event_busy"};
// Bounds [[lngMin,latMin],[lngMax,latMax]] de los marcadores con coordenadas
function markersBounds(){
  const cs=state.activities.filter(conCoords).map(coords);
  if(!cs.length)return null;
  const lats=cs.map(c=>c.lat), lngs=cs.map(c=>c.lng);
  return [[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]];
}
// Búsqueda en el mapa: los resultados se muestran en el cuadro de mensaje
// (no hay panel inferior). Cada resultado se puede presionar para ver la
// ficha de la actividad y centrar el mapa.
function renderMapList(){
  const q=($("#map-search")?.value||"").trim().toLowerCase();
  if(!q){
    // Sin búsqueda no se muestra nada: si el cuadro tenía resultados, se cierra.
    if(state.mensajeTipo==="busqueda") cerrarMensaje();
    return;
  }
  const items=state.activities.filter(a=>!q
    || a.title.toLowerCase().includes(q)
    || (a.place||"").toLowerCase().includes(q)
    || (a.description||"").toLowerCase().includes(q));
  const detalle=items.length
    ? items.map(a=>`<button type="button" data-map-sel="${a.id}"
        class="w-full text-left px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 transition-colors mb-1.5 last:mb-0">
        <span class="block font-bold text-sm">${esc(a.title)}</span>
        <span class="block text-xs opacity-75">${esc(dayFmt.format(new Date(a.activity_date+"T12:00:00")))} · ${esc(a.place||"Lugar por confirmar")}</span>
      </button>`).join("")
    : '<span class="opacity-80">Sin coincidencias.</span>';
  mostrarMensaje({
    titulo:`${items.length} resultado${items.length===1?"":"s"}`,
    detalle, icono:"search", tipo:"busqueda",
  });
  $("#toast-text").querySelectorAll("[data-map-sel]").forEach(b=>b.addEventListener("click",()=>{
    const a=state.activities.find(x=>x.id===b.dataset.mapSel);
    if(a) selectVenue(a);
  }));
}
function resetVenue(){
  state.selectedId=null;
  if(state.mensajeTipo==="detalle") cerrarMensaje();
}
function selectVenue(a,pan=true){
  if(!a) return;
  state.selectedId=a.id;
  const cuando=`${dayFmt.format(new Date(a.activity_date+"T12:00:00"))} · ${timeFmt(a.start_time)||"Hora por definir"}${a.end_time?" – "+timeFmt(a.end_time):""}`;
  const partes=[
    `<span class="opacity-80 font-semibold">${esc(venueStatusText[a.status]||"Programada")}</span>`,
    esc(cuando),
    a.place?esc(a.place):"Lugar por confirmar",
    esAdminGeneral()&&a.group_id?`Grupo: ${esc(grupoPorId(a.group_id)?.name||"")}`:"",
    a.description?esc(a.description):"",
  ].filter(Boolean);
  const acciones=[{texto:esAdminGeneral()?"Editar actividad":"Ver actividad",icono:"calendar_today",
    fn:()=>esAdminGeneral()?openActivity(a):gotoView("agenda")}];
  if(conCoords(a)){
    const c=coords(a);
    acciones.push({texto:"Cómo llegar",icono:"navigation",fn:()=>window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`,"_blank","noopener")});
  }
  mostrarMensaje({titulo:a.title,detalle:partes.join("<br>"),acciones,icono:"event",tipo:"detalle"});
  const m=state.markerById.get(a.id);
  if(m&&state.map&&pan){
    state.map.flyTo({center:m.getLngLat(),zoom:Math.max(state.map.getZoom(),14),duration:600,offset:offsetPanel()});
  }
}
// Desplazamiento vertical para que el punto "centrado" caiga en el área
// visible del mapa (debajo de la barra de búsqueda).
function offsetPanel(){
  const cont=$("#map")?.getBoundingClientRect();
  const buscador=$("#map-search-wrap")?.getBoundingClientRect();
  if(!cont)return [0,0];
  const abierto=buscador&&!buscador.classList.contains("hidden");
  const arriba=(abierto&&buscador.height)?buscador.bottom-cont.top:60;
  const yMedio=(arriba+cont.height)/2;
  return [0,Math.round(yMedio-cont.height/2)];
}
// Recentrar en todas las actividades (encuadra el bounds calculado)
$("#map-recenter").addEventListener("click",()=>{
  const b=markersBounds(); if(!state.map||!b)return;
  const p=paddingMapa();
  state.map.fitBounds(b,{padding:{top:p.top,bottom:p.bottom,left:p.left,right:p.right},duration:600,maxZoom:14});
});
// Centrar en mi ubicación (GPS)
$("#map-locate").addEventListener("click",()=>{
  if(!gpsPos){ activarGps({centrar:true}); showToast("Buscando tu ubicación…"); return; }
  state.map?.flyTo({center:[gpsPos.lng,gpsPos.lat],zoom:Math.max(state.map.getZoom(),16),duration:600,offset:offsetPanel()});
});
$("#map-near-me")?.addEventListener("click",()=>{
  showToast("Cerca de mí: función en la próxima etapa.");
});
$("#map-search").addEventListener("input",renderMapList);

// --- Buscador colapsable (lupa arriba a la izquierda) ------------------------
const abrirBuscador=()=>{
  const wrap=$("#map-search-wrap"); if(!wrap) return;
  wrap.classList.remove("hidden");
  $("#map-search-toggle")?.setAttribute("aria-expanded","true");
  $("#map-search")?.focus();
};
const cerrarBuscador=()=>{
  const wrap=$("#map-search-wrap"); if(!wrap) return;
  wrap.classList.add("hidden");
  $("#map-search-toggle")?.setAttribute("aria-expanded","false");
  if($("#map-search")) $("#map-search").value="";
  // Si el cuadro de mensaje mostraba los resultados de la búsqueda, se cierra.
  if(state.mensajeTipo==="busqueda") cerrarMensaje();
};
$("#map-search-toggle")?.addEventListener("click",()=>{
  const wrap=$("#map-search-wrap");
  if(wrap?.classList.contains("hidden")) abrirBuscador(); else cerrarBuscador();
});
$("#map-search-close")?.addEventListener("click",cerrarBuscador);

// --- Controles del mapa colapsables (botón con flecha hacia abajo) ----------
$("#map-controls-toggle")?.addEventListener("click",()=>{
  const fila=$("#map-controls-row"); if(!fila) return;
  const abierto=fila.classList.contains("hidden");
  fila.classList.toggle("hidden",!abierto);
  $("#map-controls-toggle")?.setAttribute("aria-expanded",String(abierto));
  // El botón es una flecha hacia abajo; al desplegarse rota 180° (apunta arriba).
  $("#map-controls-icon")?.classList.toggle("rotate-180",abierto);
});

// --- Panel inferior de actividades: ELIMINADO (2026-11-25) -----------------
// Los detalles de un lugar o evento se muestran en el cuadro de mensaje
// (`mostrarMensaje`) y los resultados de la búsqueda también.

// Padding de encuadre: deja libre la barra de búsqueda (arriba).
function paddingMapa(){
  const buscador=$("#map-search-wrap");
  const altoBuscador=buscador&&!buscador.classList.contains("hidden")?buscador.getBoundingClientRect().height:0;
  const top=(altoBuscador?altoBuscador+24:70);
  return {top:Math.round(top),bottom:80,left:24,right:24};
}
// Atribución visible (mapas.txt §3.1): el control de MapLibre se dibuja abajo a
// la derecha. Ya no hay panel inferior, así que queda a 0 (se mantiene la
// variable por si vuelve a usarse un panel).
function actualizarAlturaPanelMapa(){
  $("#map")?.style.setProperty("--mapa-panel-h","0px");
}

function applyPendingFit(){
  if(!state.map||!state.pendingFit)return;
  if(!$("#view-mapa").classList.contains("active"))return; // vista oculta: el mapa aún no tiene tamaño
  const b=state.pendingFit;
  const aplicar=()=>{
    if(!state.map)return;
    const p=paddingMapa();
    state.map.fitBounds(b,{padding:{top:p.top,bottom:p.bottom,left:p.left,right:p.right},duration:0,maxZoom:14});
  };
  aplicar();
  // Re-aplica tras estabilizar el layout (panel y barra con su altura final)
  setTimeout(aplicar,300);
  state.pendingFit=null;
  setTimeout(()=>state.map?.resize(),100);
}

// ==================== VISTA SATÉLITE (Esri World Imagery) ====================
// Misma técnica que territorio-gps-movil: la capa satélite se inserta bajo la
// primera capa de símbolos, para que los rótulos queden legibles encima.
let sateliteOn=false;
function alternarSatelite(){
  const map=state.map;
  if(!map||!state.mapListo)return;
  if(sateliteOn){
    if(map.getLayer("satelite-layer"))map.removeLayer("satelite-layer");
    if(map.getSource("satelite"))map.removeSource("satelite");
    sateliteOn=false;
    return;
  }
  const capas=map.getStyle().layers||[];
  const simbolo=capas.find(l=>l.type==="symbol");
  map.addSource("satelite",{type:"raster",
    tiles:["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize:256,maxzoom:19,attribution:"Esri, Maxar, Earthstar Geographics"});
  map.addLayer({id:"satelite-layer",type:"raster",source:"satelite",paint:{}}, simbolo?simbolo.id:undefined);
  sateliteOn=true;
}

// ==================== VISTA SATÉLITE POR DEFECTO (mapas.txt §3.1) ====================
// La capa satélite se inserta en el primer "load" para que el mapa abra en
// satélite; se alterna desde la capa "Vista satelital" del panel de capas.
function activarSateliteInicial(){
  if(sateliteOn) return;
  alternarSatelite();
}

// ==================== LÍMITES COMUNALES DE LA RM (mapas.txt §3.2) ====================
// Fuente: data/comunas-rm.geojson — 52 comunas reales de OpenStreetMap (ODbL),
// generadas con scripts/importar-comunas.mjs desde Overpass. Geometrías reales,
// NO delimitaciones dibujadas a mano. Se cargan una vez por sesión y se cachean
// en el service worker (§11: no volver a descargar al cambiar de capa).
const COMUNAS_URL="./data/comunas-rm.geojson";
const CAPAS_COMUNAS=["comunas-fill","comunas-hover","comunas-line"];
let comunaPopup=null;

// Inserta una capa POR DEBAJO de los rótulos, para que las etiquetas del estilo
// sigan leyéndose sobre la cartografía satélite y sobre el relleno de comunas.
function insertarBajoSimbolos(layer){
  const map=state.map; if(!map) return;
  const simbolo=(map.getStyle().layers||[]).find(l=>l.type==="symbol");
  map.addLayer(layer, simbolo?simbolo.id:undefined);
}

async function cargarComunas(){
  const map=state.map;
  if(!map||!state.mapListo||map.getSource("comunas")) return;
  try{
    const res=await fetch(COMUNAS_URL);
    if(!res.ok) throw new Error("HTTP "+res.status);
    const geo=await res.json();
    if(!state.map||!state.map.getSource||state.map.getSource("comunas")) return;
    map.addSource("comunas",{type:"geojson",data:geo});
    insertarBajoSimbolos({id:"comunas-fill",type:"fill",source:"comunas",
      paint:{"fill-color":"#8fd3ff","fill-opacity":0.08}});
    insertarBajoSimbolos({id:"comunas-hover",type:"fill",source:"comunas",
      filter:["==",["get","nombre"],""],
      paint:{"fill-color":"#ffd54f","fill-opacity":0.30}});
    insertarBajoSimbolos({id:"comunas-line",type:"line",source:"comunas",
      paint:{"line-color":"#ffffff","line-width":1.2,"line-opacity":0.8}});

    comunaPopup=new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:12,className:"comuna-popup"});
    const nombreDe=(e)=>e.features?.[0]?.properties?.nombre||"";
    const mostrarComuna=(e)=>{
      const nombre=nombreDe(e); if(!nombre) return;
      map.setFilter("comunas-hover",["==",["get","nombre"],nombre]);
      comunaPopup.setLngLat(e.lngLat).setHTML(esc(nombre)).addTo(map);
      map.getCanvas().style.cursor="pointer";
    };
    const ocultarComuna=()=>{
      if(!map.getSource("comunas")) return;
      map.setFilter("comunas-hover",["==",["get","nombre"],""]);
      comunaPopup.remove();
      map.getCanvas().style.cursor="";
    };
    map.on("mousemove","comunas-fill",mostrarComuna);
    map.on("mouseleave","comunas-fill",ocultarComuna);
    map.on("click","comunas-fill",mostrarComuna);   // táctil: tocar la comuna muestra su nombre

    // §10: la capa nace [ON]; si el usuario ya la apagó antes de que cargara,
    // se respeta ese estado en vez de forzarla visible.
    comunasOn=capasEstado.comunas;
    CAPAS_COMUNAS.forEach(id=>{ if(map.getLayer(id))
      map.setLayoutProperty(id,"visibility",comunasOn?"visible":"none"); });
  }catch(err){
    console.warn("cargarComunas: no se pudieron cargar los límites comunales",err);
  }
}

// ==================== PANEL DE CAPAS (mapas.txt §4 y §10) ====================
// Un interruptor por capa, cambios al instante y sin recargar el mapa.
// Cada ítem apunta a capas de MapLibre; los datos se cargan UNA sola vez por
// sesión y quedan en caché (§11: cambiar de capa no vuelve a descargar nada).
let comunasOn=true;                       // estado real de la capa (§10: [ON])
let actividadesOn=true;                   // pines de actividades (§10: [ON])

// ---------------------------------------------------------- fuentes/capas --
// Se cargan perezosamente: transporte al primer uso (38+16 KB) y cada capa de
// lugares en SU propio archivo (data/lugares/<capa>.geojson), descargado solo
// cuando el usuario enciende ese interruptor (§11: no cargar todas las
// categorías indiscriminadamente; evitar volver a descargarlas al cambiarlas).
const FUENTES_CAPA={
  transporte:{cargada:false,promesa:null,cargar:cargarTransporte},
};

// Color y etiqueta de cada capa de lugares (un interruptor = un archivo).
const CAPAS_LUGARES={
  "parques":    {color:"#2e9e4f", label:"Parques grandes, cerros y zoológicos"},
  "plazas":     {color:"#8bc34a", label:"Plazas de Armas"},
  "comercio":   {color:"#e8590c", label:"Centros comerciales (Malls)"},
  "salud_hospital": {color:"#e03131", label:"Hospitales públicos", dataKey:"salud",
    filter:(f)=>f.properties?.subcategoria!=="SAPU / SAR"},
  "salud_sapu":    {color:"#e03131", label:"SAPU / SAR", dataKey:"salud",
    filter:(f)=>f.properties?.subcategoria==="SAPU / SAR"},
  "seguridad":  {color:"#1c7ed6", label:"Policía, Comisarías y Tenencias"},
  "bomberos":   {color:"#c92a2a", label:"Cuarteles de bomberos"},
  "servicios":  {color:"#0ca678", label:"Municipalidades"},
};

// Zoom de los iconos: al alejar, cada lugar se dibuja como un punto de color
// que se achica hasta desaparecer; al acercar aparece el icono.
//
// Calibración del 2026-11-26 (§26 de AGENT.md): el usuario marcó los
// momentos exactos con el medidor de zoom:
//   1) Punto/círculo de color → se achica en 3 saltos al ALEJAR el mapa
//      (12,5 → 11,8 → 11) y DESAPARECE en el zoom 10,5.
//   2) Círculo ↔ icono        → corte nítido en 12,5: en 12,4 no hay ni
//      icono ni texto y en 12,5 vuelven los dos.
//   3) Texto bajo el icono    → nace pequeño en 12,5 y sube en 2 saltos
//      hasta el tamaño máximo actual (11 px).
const ZOOM_PUNTO_MIN=10.5;     // el punto de color desaparece
const ZOOM_PUNTO_MEDIO=11;     // 3.er salto: el punto queda en su tamaño mínimo
const ZOOM_PUNTO_MAX=11.8;     // 2.º salto: tamaño intermedio
const ZOOM_ICONO=12.5;         // 1.er salto: icono + texto (corte nítido)
const ZOOM_ICONO_MAX=15;       // el icono deja de crecer
// Disminución del **15 %** en los puntos que reemplazan a los iconos, pedida
// el 2026-11-26: un solo factor (`ESCALA_PUNTO`) multiplica TODA la rampa, así
// los 3 saltos bajan proporcionalmente y la forma de la rampa no cambia.
//   radios (GeoJSON): 3,5 → 5 → 7 px  quedan en  2,975 → 4,25 → 5,95 px
//   diámetros (HTML): 7 → 10 → 14 px  quedan en  5,95 → 8,5 → 11,9 px
const ESCALA_PUNTO=0.85;        // −15 % sobre la rampa de puntos
const RADIO_PUNTO_MIN=3.5*ESCALA_PUNTO;   // radio (px) del punto entre 10,5 y 11
const RADIO_PUNTO_MEDIO=5*ESCALA_PUNTO;   // radio (px) del punto entre 11 y 11,8
const RADIO_PUNTO_MAX=7*ESCALA_PUNTO;     // radio (px) del punto entre 11,8 y 12,5
const TAM_PUNTO_MIN=7*ESCALA_PUNTO;       // diámetro (px) del punto propio más pequeño
const TAM_PUNTO_MEDIO=10*ESCALA_PUNTO;    // diámetro (px) del punto propio intermedio
const TAM_PUNTO_MAX=14*ESCALA_PUNTO;      // diámetro (px) del punto propio más grande
// Pines de actividad (no reemplazan a un icono, pero siguen la misma rampa):
// mismo −15 %, para que la proporción con los puntos no se despegue.
const TAM_PIN_MIN=12*ESCALA_PUNTO;        // mínimo seleccionable (10,2 px)
const TAM_PIN_MAX=24*ESCALA_PUNTO;        // máximo (20,4 px)
// Texto bajo el icono: aparece pequeño en 12,5 y crece en 2 saltos hasta 11 px.
const TEXTO_MIN=9;             // px al aparecer el texto (zoom 12,5)
const TEXTO_MEDIO=10;          // px desde el primer salto
const TEXTO_MAX=11;            // px: tamaño máximo actual (no vuelve a crecer)
const ZOOM_TEXTO_MEDIO=13.5;   // 1.er salto del texto (9 → 10 px)
const ZOOM_TEXTO_MAX=14.5;     // 2.º salto del texto (10 → 11 px)
// Las líneas del metro se siguen viendo alejadas y desaparecen en el zoom 9,3.
const ZOOM_LINEAS_METRO=9.3;
// Calibrado el 2026-11-26 con los medidores temporales (§26 de AGENT.md):
// `icon-size` 1 ≈ 64 px en pantalla (128 px rasterizados con pixelRatio 2),
// así que 0,25 → 16 px al aparecer y 0,375 → 24 px como máximo (techo que
// pidió el usuario; antes 0,45 llegaba a 28,8 px).
const ICONO_MIN=0.25;          // icon-size al aparecer el icono (16 px)
const ICONO_MAX=0.375;         // icon-size máximo (24 px: crece "un poco")

// =============================================================================
// ICONOS DEL MAPA (SVG) — §5
// Catálogo: clave -> archivo SVG en /icons. El PNG original de cada icono queda
// en /icons/png/ y se usa SOLO como respaldo si el SVG no se puede rasterizar.
// La clave es lo que se guarda en la columna `icon` de `map_points`.
// =============================================================================
const ICONOS_MAPA={
  place:{svg:"casa.svg",label:"Lugar"},
  warning:{svg:"policia.svg",label:"Alerta"},
  bomberos:{svg:"bomberos.svg",label:"Bomberos"},
  health_and_safety:{svg:"urgencias.svg",label:"Salud"},
  hospital:{svg:"hospital.svg",label:"Hospital"},
  school:{svg:"trebol.svg",label:"Educación"},
  directions_bus:{svg:"buses.svg",label:"Transporte"},
  metro:{svg:"metro.svg",label:"Metro"},
  metro_combinacion:{svg:"metro-combinacion.svg",label:"Metro con combinación"},
  store:{svg:"mall.svg",label:"Comercio"},
  park:{svg:"parque.svg",label:"Parque"},
  planetario:{svg:"planetario.svg",label:"Planetario"},
  info:{svg:"exhibidor.svg",label:"Información"},
  evento:{svg:"evento.svg",label:"Evento"},
  salon:{svg:"salon.svg",label:"Salón"},
  predicacion:{svg:"predicacion.svg",label:"Predicción"},
  betel:{svg:"betel.svg",label:"Betel"},
  casa:{svg:"casa.svg",label:"Casa"},
};

// Icono de cada capa de lugares (§4/§5: identidad visual coherente).
const ICONO_LUGAR={
  parques:"park",plazas:"park",comercio:"store",
  salud_hospital:"hospital",salud_sapu:"health_and_safety",
  seguridad:"warning",bomberos:"bomberos",servicios:"casa",
};

// Icono por categoría de punto personalizado (§9) y por el icono que el
// usuario elige en el formulario. El valor elegido (columna `icon`) manda;
// si no existe o no se reconoce, se usa el de la categoría.
const ICONO_PUNTO={
  general:"place",seguridad:"warning",salud:"health_and_safety",educacion:"school",
  transporte:"directions_bus",comercio:"store",areas_verdes:"park",otro:"place",
};

// Carga un icono como imagen de MapLibre (solo una vez por sesión).
// MapLibre NO acepta SVG: hay que rasterizarlo. Se descarga el SVG con
// `fetch`, se dibuja en un <canvas> y se añade con `addImage`.
// NOTA: `map.loadImage()` puede quedarse SIN RESPONDER (el callback nunca se
// dispara y la promesa se cuelga, dejando la capa sin añadir) — por eso NO se
// usa. `addImage` LANZA si la id ya existe: se comprueba con `hasImage`.
const imagenesCargadas=new Set();
const TIMEOUT_ICONO_MS=12000;
const LADO_ICONO_MAX=128;   // px del icono rasterizado (en el mapa se ve a ~32 px)
function conTimeout(ms,generador){
  return Promise.race([
    generador(),
    new Promise((_,rej)=>setTimeout(()=>rej(new Error(`timeout de ${ms} ms cargando icono`)),ms)),
  ]);
}

// Convierte el texto de un SVG en ImageData (lo que MapLibre puede pintar).
async function rasterizarSVG(texto,ladoMax=LADO_ICONO_MAX){
  const vb=(texto.match(/viewBox\s*=\s*"([^"]+)"/i)||[])[1];
  let vw=0,vh=0;
  if(vb){
    const p=vb.trim().split(/[\s,]+/).map(Number);
    vw=p[2]; vh=p[3];
  }
  const url=URL.createObjectURL(new Blob([texto],{type:"image/svg+xml;charset=utf-8"}));
  try{
    const img=new Image();
    img.decoding="async";
    const listo=new Promise((res,rej)=>{
      img.onload=()=>res();
      img.onerror=()=>rej(new Error("el SVG no se pudo decodificar"));
    });
    img.src=url;
    await listo;
    const w=vw||img.naturalWidth||ladoMax, h=vh||img.naturalHeight||ladoMax;
    const escala=Math.min(1,ladoMax/Math.max(w,h));
    const cw=Math.max(1,Math.round(w*escala)), ch=Math.max(1,Math.round(h*escala));
    const c=document.createElement("canvas"); c.width=cw; c.height=ch;
    const g=c.getContext("2d");
    g.drawImage(img,0,0,cw,ch);
    return g.getImageData(0,0,cw,ch);
  } finally { URL.revokeObjectURL(url); }
}

// Descarga el icono: primero el SVG; si falla, el PNG de respaldo.
// Ambos se reducen al mismo lado máximo para que el mapa los pinte igual.
async function cargarImagenIcono(svg){
  try{
    const res=await fetch(`./icons/${svg}`,{cache:"force-cache"});
    if(res.ok) return await rasterizarSVG(await res.text());
  }catch(_){/* se intenta el PNG de respaldo */}
  const png=svg.replace(/\.svg$/i,".png");
  const res=await fetch(`./icons/png/${png}`,{cache:"force-cache"});
  if(!res.ok) throw new Error(`no se encontró ${svg} ni su PNG de respaldo`);
  const bmp=await createImageBitmap(await res.blob());
  const escala=Math.min(1,LADO_ICONO_MAX/Math.max(bmp.width,bmp.height));
  const w=Math.max(1,Math.round(bmp.width*escala)), h=Math.max(1,Math.round(bmp.height*escala));
  const c=document.createElement("canvas"); c.width=w; c.height=h;
  c.getContext("2d").drawImage(bmp,0,0,w,h);
  return c.getContext("2d").getImageData(0,0,w,h);
}

// Devuelve la id de imagen de MapLibre del icono (p. ej. "icono-parque.svg").
async function cargarIcono(clave){
  const map=state.map; if(!map) throw new Error("sin mapa");
  const def=ICONOS_MAPA[clave]||ICONOS_MAPA.place;
  const id=`icono-${def.svg}`;
  if(map.hasImage?.(id)){ imagenesCargadas.add(clave); return id; }

  const imagen=await conTimeout(TIMEOUT_ICONO_MS,()=>cargarImagenIcono(def.svg));
  if(!map.hasImage?.(id)) map.addImage(id,imagen,{pixelRatio:2});
  imagenesCargadas.add(clave);
  return id;
}

// Respaldo si un icono no se puede decodificar: un pin de color relleno, para
// que el punto nunca quede invisible en el mapa (§5: marcador identificable).
function crearPinRespaldo(color){
  const c=document.createElement("canvas"); c.width=64; c.height=64;
  const g=c.getContext("2d");
  g.fillStyle=color; g.strokeStyle="#ffffff"; g.lineWidth=4;
  g.beginPath(); g.arc(32,26,20,0,Math.PI*2); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(20,38); g.lineTo(32,60); g.lineTo(44,38); g.closePath();
  g.fill(); g.stroke();
  return g.getImageData(0,0,64,64);
}
async function asegurarIcono(clave,color){
  const def=ICONOS_MAPA[clave]||ICONOS_MAPA.place;
  const id=`icono-${def.svg}`;
  try{ return await cargarIcono(clave); }
  catch(err){
    console.warn(`No se pudo cargar el icono ${def.svg}, se usa un pin de respaldo:`,err.message);
    if(!state.map?.hasImage?.(id)) state.map?.addImage(id,crearPinRespaldo(color||"#006492"));
    imagenesCargadas.add(clave);
    return id;
  }
}
const lugaresCargados=new Set();   // capas ya descargadas en esta sesión

async function cargarTransporte(){
  const map=state.map;
  const [est,lineas]=await Promise.all([
    fetch("./data/transporte-estaciones.geojson").then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}),
    fetch("./data/transporte-lineas.geojson").then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}),
  ]);
  if(!state.map) return;
  state.geoTranporte=est;
  const estFiltrado=JSON.parse(JSON.stringify(est));
  if(estFiltrado?.features?.length) estFiltrado.features=estFiltrado.features.filter(f=>!overrideOculto(f.properties?.tipo,f.properties?.gtfs_stop_id));
  map.addSource("transporte-estaciones",{type:"geojson",data:estFiltrado});
  map.addSource("transporte-lineas",{type:"geojson",data:lineas});

  // Colores referenciales por línea (no son los oficiales del Metro).
  const COLOR_LINEA={L1:"#e30613",L2:"#0f7fd4",L3:"#8a9b16",L4:"#f08a00",L4A:"#f08a00",L5:"#5ec4e8",L6:"#8b5fbf",MTN:"#00a19a",MTR:"#0079c2"};
  // Iconos SVG del Metro: al acercar aparece el icono y DEBAJO el nombre de
  // la estación (sin necesidad de presionarla). El color de la subcategoría
  // `metro` (sql/19) se usa en el punto circular al alejar.
  const colorMetro=subcategoriaDeCapa("metro")?.color || colorCategoria("metro","#ffffff");
  const claveMetro=subcategoriaDeCapa("metro")?.icon || "metro";
  const idIconoMetro=await asegurarIcono(claveMetro,"#e30613");
  const idIconoCombo=await asegurarIcono("metro_combinacion","#f08a00");
  // Líneas: se siguen viendo ALEJADAS (sobreviven a los puntos de color, que
  // se apagan en 10,5) y desaparecen por debajo del zoom 9,3 (pedido el
  // 2026-11-26): por eso el corte es `minzoom`, no `maxzoom`.
  insertarBajoSimbolos({id:"metro-lineas",type:"line",source:"transporte-lineas",
    filter:["==",["get","tipo"],"metro"],minzoom:ZOOM_LINEAS_METRO,
    paint:{"line-color":["match",["get","linea"],...Object.entries(COLOR_LINEA).flatMap(([k,v])=>[k,v]),"#e30613"],
           "line-width":3,"line-opacity":0.9}});
  insertarBajoSimbolos({id:"metrotren-lineas",type:"line",source:"transporte-lineas",
    filter:["==",["get","tipo"],"metrotren"],minzoom:ZOOM_LINEAS_METRO,
    paint:{"line-color":"#0079c2","line-width":3,"line-opacity":0.9}});
  // Estaciones: punto de color en 3 saltos (12,5 → 11,8 → 11) que desaparece
  // en el zoom 10,5; desde 12,5 toma el icono. Los ajustes de tamaño entre
  // capas (±1 px) también se escalan con ESCALA_PUNTO (±0,85 px): las
  // estaciones quedan un pelín más chicas que los lugares y las combinaciones
  // un pelín más grandes, igual que antes del −15 %.
  insertarBajoSimbolos({id:"metro-estaciones",type:"circle",source:"transporte-estaciones",
    filter:["==",["get","tipo"],"metro"],minzoom:ZOOM_PUNTO_MIN,maxzoom:ZOOM_ICONO,
    paint:{"circle-color":colorMetro,
            "circle-radius":["step",["zoom"],
              RADIO_PUNTO_MIN,ZOOM_PUNTO_MEDIO,RADIO_PUNTO_MEDIO,ZOOM_PUNTO_MAX,RADIO_PUNTO_MAX-ESCALA_PUNTO],
            "circle-stroke-color":"#181c1d","circle-stroke-width":1.5}});
  insertarBajoSimbolos({id:"metro-estaciones-icono",type:"symbol",source:"transporte-estaciones",
    filter:["==",["get","tipo"],"metro"],minzoom:ZOOM_ICONO,
    layout:{"icon-image":idIconoMetro,
            "icon-size":["interpolate",["linear"],["zoom"],ZOOM_ICONO,ICONO_MIN,ZOOM_ICONO_MAX,ICONO_MAX],
            "icon-allow-overlap":true,"icon-ignore-placement":true}});
  insertarBajoSimbolos({id:"metro-combo",type:"circle",source:"transporte-estaciones",
    filter:["all",["==",["get","tipo"],"metro"],["==",["get","combinaciones"],true]],
    minzoom:ZOOM_PUNTO_MIN,maxzoom:ZOOM_ICONO,
    paint:{"circle-color":subcategoriaDeCapa("metro")?.color || colorCategoria("metro","#ffd54f"),
            "circle-radius":["step",["zoom"],
              RADIO_PUNTO_MIN+ESCALA_PUNTO,ZOOM_PUNTO_MEDIO,RADIO_PUNTO_MEDIO+ESCALA_PUNTO,ZOOM_PUNTO_MAX,RADIO_PUNTO_MAX+ESCALA_PUNTO],
            "circle-stroke-color":"#181c1d","circle-stroke-width":1.5}});
  insertarBajoSimbolos({id:"metro-combo-icono",type:"symbol",source:"transporte-estaciones",
    filter:["all",["==",["get","tipo"],"metro"],["==",["get","combinaciones"],true]],minzoom:ZOOM_ICONO,
    layout:{"icon-image":idIconoCombo,
            "icon-size":["interpolate",["linear"],["zoom"],ZOOM_ICONO,ICONO_MIN,ZOOM_ICONO_MAX,ICONO_MAX],
            "icon-allow-overlap":true,"icon-ignore-placement":true}});
  insertarBajoSimbolos({id:"metrotren-estaciones",type:"circle",source:"transporte-estaciones",
    filter:["==",["get","tipo"],"metrotren"],minzoom:ZOOM_PUNTO_MIN,
    paint:{"circle-color":subcategoriaDeCapa("metrotren")?.color || colorMetro,
            "circle-radius":["step",["zoom"],
              RADIO_PUNTO_MIN,ZOOM_PUNTO_MEDIO,RADIO_PUNTO_MEDIO,ZOOM_PUNTO_MAX,RADIO_PUNTO_MAX],
            "circle-stroke-color":"#0079c2","circle-stroke-width":2}});

  // Rótulos de estación: nombre DEBAJO del icono, al acercar el mapa.
  // `text-font` EXPLÍCITO: sin él se usa el fontstack por defecto de MapLibre
  // ("Open Sans Regular"), que tiles.openfreemap.org NO sirve (404). Ese 404
  // hace que el worker rechace el tile entero → las capas symbol de ESTA fuente
  // (iconos y nombres del metro) dejan de renderizar en los zooms medios.
  // Texto: corte NÍTIDO en 12,5 (en 12,4 desaparece, en 12,5 aparece) y
  // tamaño en 2 saltos: 9 px al nacer → 10 px → 11 px (tamaño máximo).
  map.addLayer({id:"metro-nombres",type:"symbol",source:"transporte-estaciones",
    filter:["==",["get","tipo"],"metro"],minzoom:ZOOM_ICONO,
    layout:{"text-field":["get","nombre"],
             "text-size":["step",["zoom"],TEXTO_MIN,ZOOM_TEXTO_MEDIO,TEXTO_MEDIO,ZOOM_TEXTO_MAX,TEXTO_MAX],
             "text-offset":[0,2.2],"text-anchor":"top",
             "text-max-width":14,"text-allow-overlap":false,"text-font":["Noto Sans Regular"]},
    paint:{"text-color":"#ffffff","text-halo-color":"#0b2b3d","text-halo-width":1.6}});

  // Popups (§6: nombre, categoría, dirección, comuna, coordenadas, fuente, fecha).
  const popupLugar=new maplibregl.Popup({closeButton:true,offset:14,maxWidth:"260px"});
  const abrirPopup=(ids)=>map.on("click",ids,(e)=>{
    const f=e.features?.[0]; if(!f) return;
    const p=f.properties;
    // `lineas` puede venir como array o como texto serializado.
    let lineasP=p.lineas;
    if(typeof lineasP==="string"){ try{ lineasP=JSON.parse(lineasP); }catch(_){ lineasP=[lineasP]; } }
    if(!Array.isArray(lineasP)) lineasP=lineasP?[lineasP]:[];
    comunaPopup?.remove();   // no dejar dos popups superpuestos
    popupLugar.setLngLat(e.lngLat).setHTML(
      `<strong>${esc(p.nombre)}</strong>`+
      (lineasP.length?`<br>${lineasP.map(esc).join(" · ")}`:"")+
      (p.combinaciones?`<br><span class="muted">Estación de combinación</span>`:"")+
      (p.comuna?`<br><span class="muted">${esc(p.comuna)}</span>`:"")+
      `<br><span class="muted" style="font-size:11px">${coordTexto(f.geometry?.coordinates||[e.lngLat.lng,e.lngLat.lat])}</span>`+
      `<br><span class="muted" style="font-size:11px">${p.tipo==="metrotren"?"EFE Trenes de Chile":"Metro de Santiago"} · DTPM GTFS</span>`
    ).addTo(map);
  });
  abrirPopup(["metro-estaciones","metro-estaciones-icono","metro-combo","metro-combo-icono","metrotren-estaciones"]);
  const cursorPuntero=(ids)=>{map.on("mouseenter",ids,()=>map.getCanvas().style.cursor="pointer");
    map.on("mouseleave",ids,()=>map.getCanvas().style.cursor="");};
  cursorPuntero(["metro-estaciones","metro-estaciones-icono","metro-combo","metro-combo-icono","metrotren-estaciones"]);
  // La visibilidad de las capas de transporte la fija el panel de capas.
  aplicarComportamientoCapa("transporte");
  aplicarCapas();
}

// Carga UNA capa de lugares: su propio archivo, con clustering nativo de
// MapLibre (§11: la RM tiene miles de puntos; se agrupan en vez de pintar
// 10.000 círculos). Al hacer clic en un grupo se hace zoom a su contenido.
// Los puntos sueltos usan los iconos SVG de /icons (§5: identidad visual).
// --- filtros globales de puntos externos (sql/19) ---------------------------
function externalIdDe(layerKey, props){
  return props?.osm_id || props?.gtfs_stop_id || props?.id || props?.nombre || "";
}
function overrideOculto(layerKey, externalId){
  return (state.overrides||[]).some(o=>o.layer_key===layerKey && o.external_id===String(externalId) && o.visible===false);
}
function filtrarGeoOverrides(layerKey, geo){
  if(!geo?.features?.length) return geo;
  geo.features=geo.features.filter(f=>!overrideOculto(layerKey,externalIdDe(layerKey,f.properties)));
  return geo;
}

function modoCapa(layerKey){ return subcategoriaDeCapa(layerKey)?.render_mode || "auto"; }
function aplicarComportamientoCapa(capa){
  const map=state.map; if(!map||!state.mapListo) return;
  if(CAPAS_LUGARES[capa]){
    const fuente=`lugares-${capa}`;
    const item=CAPAS_DEF.flatMap(g=>g.items).find(it=>it.capaLugares===capa);
    const on=item?capasEstado[item.id]!==false:true;
    const icono=map.getLayer(`${fuente}-puntos`);
    const mini=map.getLayer(`${fuente}-puntos-mini`);
    if(modoCapa(capa)==="icon"){
      if(icono) map.setLayerZoomRange(`${fuente}-puntos`,ZOOM_PUNTO_MIN,24);
      if(mini) map.setLayoutProperty(`${fuente}-puntos-mini`,"visibility","none");
    }else{
      if(icono) map.setLayerZoomRange(`${fuente}-puntos`,ZOOM_ICONO,24);
      if(mini) map.setLayoutProperty(`${fuente}-puntos-mini`,"visibility",on?"visible":"none");
    }
  }
  if(capa==="transporte"){
    const iconMode=modoCapa("metro")==="icon";
    ["metro-estaciones-icono","metro-combo-icono"].forEach(id=>{
      if(map.getLayer(id)) map.setLayerZoomRange(id,iconMode?ZOOM_PUNTO_MIN:ZOOM_ICONO,24);
    });
    ["metro-estaciones","metro-combo"].forEach(id=>{
      if(map.getLayer(id)) map.setLayoutProperty(id,"visibility",iconMode||capasEstado.metro===false?"none":"visible");
    });
  }
}
function aplicarComportamientosCapas(){
  Object.keys(CAPAS_LUGARES).forEach(aplicarComportamientoCapa);
  aplicarComportamientoCapa("transporte");
}

async function cargarLugares(capa){
  const map=state.map;
  if(!map||lugaresCargados.has(capa)) return;
  const cfg=CAPAS_LUGARES[capa]; if(!cfg) return;
  const res=await fetch(`./data/lugares/${cfg.dataKey||capa}.geojson`);
  if(!res.ok) throw new Error(`HTTP ${res.status} al cargar ${capa}`);
  const raw=await res.json();
  const base=JSON.parse(JSON.stringify(raw));
  if(typeof cfg.filter==="function") base.features=base.features.filter(cfg.filter);
  state.geoCapas[capa]=base;
  const geo=filtrarGeoOverrides(capa,JSON.parse(JSON.stringify(base)));
  if(!state.map||state.map.getSource(`lugares-${capa}`)) return;

  // Icono SVG de esta capa (se descarga y rasteriza una sola vez por sesión).
  const claveIcono=iconoDeCapa(capa,ICONO_LUGAR[capa]||"casa");
  // Color de la subcategoría/capa (sql/19), con respaldo en map_categories.
  const colorLugar=colorDeCapa(capa,cfg.color);
  const idIcono=await asegurarIcono(claveIcono,colorLugar);

  const fuente=`lugares-${capa}`;
  // El clustering sigue activo (la RM tiene miles de puntos), pero SIN grupo
  // visible: un grupo se pinta como UN SOL punto del mismo tamaño que los
  // sueltos y sin número (pedido el 2026-11-26: "si hay muchos cerca solo
  // muestra 1 pequeño; al ir acercando se muestran los demás"). Al llegar al
  // zoom 12 los puntos dejan de agruparse y se separan hasta el icono (12,5).
  // OJO: `clusterMaxZoom` DEBE ser un entero — Supercluster hace
  // `new Array(maxZoom+1)` y con 12,5 revienta con "Invalid array length".
  map.addSource(fuente,{type:"geojson",data:geo,cluster:true,clusterMaxZoom:12,clusterRadius:52});

  // Grupo = un punto de color más, sin burbuja ni número. Se apaga en los
  // mismos 3 saltos que los sueltos y desaparece en el zoom 10,5.
  insertarBajoSimbolos({id:`${fuente}-cluster`,type:"circle",source:fuente,
    filter:["has","point_count"],minzoom:ZOOM_PUNTO_MIN,maxzoom:ZOOM_ICONO,
    paint:{"circle-color":colorLugar,
           "circle-radius":["step",["zoom"],
             RADIO_PUNTO_MIN,ZOOM_PUNTO_MEDIO,RADIO_PUNTO_MEDIO,ZOOM_PUNTO_MAX,RADIO_PUNTO_MAX],
           "circle-opacity":0.92,
           "circle-stroke-color":"#ffffff","circle-stroke-width":1}});
  // Puntos sueltos: icono SVG en vez de círculo de color.
  // - Cerca (zoom >= ZOOM_ICONO): se ve el icono, que aparece PEQUEÑO y crece
  //   apenas hasta ICONO_MAX (nunca un tamaño grande).
  // - Lejos (10,5 <= zoom < 12,5): punto de color que se achica en 3 saltos
  //   (12,5 → 11,8 → 11) y desaparece por debajo del zoom 10,5.
  insertarBajoSimbolos({id:`${fuente}-puntos`,type:"symbol",source:fuente,
    filter:["!",["has","point_count"]],minzoom:ZOOM_ICONO,
    layout:{"icon-image":idIcono,
            "icon-size":["interpolate",["linear"],["zoom"],ZOOM_ICONO,ICONO_MIN,ZOOM_ICONO_MAX,ICONO_MAX],
            "icon-allow-overlap":true,"icon-ignore-placement":true}});
  insertarBajoSimbolos({id:`${fuente}-puntos-mini`,type:"circle",source:fuente,
    filter:["!",["has","point_count"]],minzoom:ZOOM_PUNTO_MIN,maxzoom:ZOOM_ICONO,
    paint:{"circle-color":colorLugar,
            "circle-radius":["step",["zoom"],
              RADIO_PUNTO_MIN,ZOOM_PUNTO_MEDIO,RADIO_PUNTO_MEDIO,ZOOM_PUNTO_MAX,RADIO_PUNTO_MAX],
            "circle-opacity":0.92,
            "circle-stroke-color":"#ffffff","circle-stroke-width":1}});

  // Popup con nombre, categoría, dirección, comuna, coordenadas, fuente y fecha (§6).
  const popup=new maplibregl.Popup({closeButton:true,offset:[0,-14],maxWidth:"260px"});
  map.on("click",`${fuente}-puntos`,(e)=>{
    const f=e.features?.[0]; if(!f) return;
    const p=f.properties;
    comunaPopup?.remove();   // no dejar dos popups superpuestos
    const fecha=p.actualizado?`${p.actualizado.slice(0,10)}`:"";
    popup.setLngLat(e.lngLat).setHTML(
      `<strong>${esc(p.nombre)}</strong>`+
      (p.subcategoria?`<br>${esc(p.subcategoria)}`:"")+
      (p.categoria_label?`<br><span class="muted">${esc(p.categoria_label)}</span>`:"")+
      (p.direccion?`<br><span class="muted">${esc(p.direccion)}</span>`:"")+
      (p.comuna?`<br><span class="muted">${esc(p.comuna)}</span>`:"")+
      (p.area_m2?`<br><span class="muted">${Math.round(p.area_m2).toLocaleString("es-CL")} m²</span>`:"")+
      `<br><span class="muted" style="font-size:11px">${coordTexto(f.geometry?.coordinates||[e.lngLat.lng,e.lngLat.lat])}</span>`+
      (fecha?`<br><span class="muted" style="font-size:11px">OSM · ODbL · ${fecha}</span>`:`<br><span class="muted" style="font-size:11px">OpenStreetMap · ODbL</span>`)
    ).addTo(map);
  });
  map.on("mouseenter",`${fuente}-puntos`,()=>map.getCanvas().style.cursor="pointer");
  map.on("mouseleave",`${fuente}-puntos`,()=>map.getCanvas().style.cursor="");
  // El punto de color (alejado) también abre el popup y muestra el cursor.
  map.on("click",`${fuente}-puntos-mini`,(e)=>{
    const f=e.features?.[0]; if(!f) return;
    const p=f.properties;
    comunaPopup?.remove();
    const fecha=p.actualizado?`${p.actualizado.slice(0,10)}`:"";
    popup.setLngLat(e.lngLat).setHTML(
      `<strong>${esc(p.nombre)}</strong>`+
      (p.subcategoria?`<br>${esc(p.subcategoria)}`:"")+
      (p.categoria_label?`<br><span class="muted">${esc(p.categoria_label)}</span>`:"")+
      (p.direccion?`<br><span class="muted">${esc(p.direccion)}</span>`:"")+
      (p.comuna?`<br><span class="muted">${esc(p.comuna)}</span>`:"")+
      (p.area_m2?`<br><span class="muted">${Math.round(p.area_m2).toLocaleString("es-CL")} m²</span>`:"")+
      `<br><span class="muted" style="font-size:11px">${coordTexto(f.geometry?.coordinates||[e.lngLat.lng,e.lngLat.lat])}</span>`+
      (fecha?`<br><span class="muted" style="font-size:11px">OSM · ODbL · ${fecha}</span>`:`<br><span class="muted" style="font-size:11px">OpenStreetMap · ODbL</span>`)
    ).addTo(map);
  });
  map.on("mouseenter",`${fuente}-puntos-mini`,()=>map.getCanvas().style.cursor="pointer");
  map.on("mouseleave",`${fuente}-puntos-mini`,()=>map.getCanvas().style.cursor="");

  // Clic en un grupo → zoom a su contenido.
  map.on("click",`${fuente}-cluster`,async(e)=>{
    const f=e.features?.[0]; if(!f) return;
    const zoom=await map.getSource(fuente).getClusterExpansionZoom(f.properties.cluster_id);
    map.easeTo({center:f.geometry.coordinates,zoom,offset:offsetPanel(),duration:500});
  });
  map.on("mouseenter",`${fuente}-cluster`,()=>map.getCanvas().style.cursor="pointer");
  map.on("mouseleave",`${fuente}-cluster`,()=>map.getCanvas().style.cursor="");

  lugaresCargados.add(capa);
  aplicarComportamientoCapa(capa);
  aplicarCapas();
}

async function asegurarFuente(nombre){
  const f=FUENTES_CAPA[nombre]; if(!f) return;
  if(f.cargada) return;
  if(!f.promesa){
    f.promesa=f.cargar().then(()=>{f.cargada=true;})
      .catch(err=>{f.promesa=null;throw err;});
  }
  await f.promesa;
}

// Espera a que el mapa termine de cargar (máx. 15 s).
function esperarMapaListo(){
  return new Promise(resolve=>{
    if(state.mapListo) return resolve();
    const t0=Date.now();
    const iv=setInterval(()=>{
      if(state.mapListo||Date.now()-t0>15000){ clearInterval(iv); resolve(); }
    },120);
  });
}

// ------------------------------------------------------------- definición --
// `capas` = ids de capas MapLibre; `custom` = lógica especial.
const CAPAS_DEF=[
  {grupo:"Cartografía",items:[
    {id:"satelite",nombre:"Vista satelital",defecto:true,custom:"satelite"},
    {id:"comunas",nombre:"Límites comunales",defecto:true,custom:"comunas"},
  ]},
  {grupo:"Transporte",items:[
    {id:"metro",nombre:"Metro (estaciones y líneas)",requiere:"transporte",
      capas:["metro-estaciones","metro-estaciones-icono","metro-combo","metro-combo-icono","metro-nombres","metro-lineas"]},
    {id:"metrotren",nombre:"MetroTren",requiere:"transporte",capas:["metrotren-estaciones","metrotren-lineas"]},
  ]},
  {grupo:"Áreas verdes",items:[
    {id:"parques",nombre:"Parques grandes, cerros y zoológicos",capaLugares:"parques"},
    {id:"plazas",nombre:"Plazas de Armas",capaLugares:"plazas"},
  ]},
  {grupo:"Comercio",items:[
    {id:"comercio",nombre:"Centros comerciales (Malls)",capaLugares:"comercio"},
  ]},
  {grupo:"Servicios",items:[
    {id:"salud_hospital",nombre:"Hospitales públicos",capaLugares:"salud_hospital"},
    {id:"salud_sapu",nombre:"SAPU / SAR",capaLugares:"salud_sapu"},
    {id:"seguridad",nombre:"Policía, Comisarías y Tenencias",capaLugares:"seguridad"},
    {id:"bomberos",nombre:"Cuarteles de bomberos",capaLugares:"bomberos"},
    {id:"servicios",nombre:"Municipalidades",capaLugares:"servicios"},
  ]},
  {grupo:"Aplicación",items:[
    {id:"actividades",nombre:"Actividades",defecto:true,custom:"actividades"},
    {id:"puntos",nombre:"Puntos personalizados",defecto:true,custom:"puntos"},
  ]},
];
const capasEstado={};
CAPAS_DEF.forEach(g=>g.items.forEach(it=>{capasEstado[it.id]=!!it.defecto;}));

// §10: "Los estados de las capas pueden conservarse localmente para cada
// usuario". Se guardan en localStorage (no en Supabase): la preferencia es
// personal y no modifica los datos compartidos.
const LLAVE_CAPAS="app-santiago-2026:capas";
function cargarPreferenciasCapas(){
  try{
    const raw=localStorage.getItem(LLAVE_CAPAS); if(!raw) return;
    const prefs=JSON.parse(raw);
    if(!prefs||typeof prefs!=="object") return;
    CAPAS_DEF.forEach(g=>g.items.forEach(it=>{
      if(typeof prefs[it.id]==="boolean") capasEstado[it.id]=prefs[it.id];
    }));
  }catch(err){ console.warn("No se pudieron leer las preferencias de capas:",err); }
}
function guardarPreferenciasCapas(){
  try{ localStorage.setItem(LLAVE_CAPAS,JSON.stringify(capasEstado)); }
  catch(err){ console.warn("No se pudieron guardar las preferencias de capas:",err); }
}
cargarPreferenciasCapas();

function aplicarCapas(){
  const map=state.map; if(!map||!state.mapListo) return;
  CAPAS_DEF.forEach(g=>g.items.forEach(it=>{
    const vis=capasEstado[it.id]?"visible":"none";
    if(it.capas) it.capas.forEach(id=>{ if(map.getLayer(id)) map.setLayoutProperty(id,"visibility",vis); });
    if(it.capaLugares){
      const f=`lugares-${it.capaLugares}`;
      [`${f}-cluster`,`${f}-puntos`,`${f}-puntos-mini`].forEach(id=>{
        if(map.getLayer(id)) map.setLayoutProperty(id,"visibility",vis);
      });
    }
  }));
  Object.keys(CAPAS_LUGARES).forEach(aplicarComportamientoCapa);
  aplicarComportamientoCapa("transporte");
}

// Alterna una capa: refleja el estado al instante y carga la fuente si toca.
async function alternarCapa(it,on){
  const map=state.map;
  if(!map){ showToast("Abre el mapa para cambiar las capas."); return; }
  // Si el mapa todavía está cargando, se espera en vez de fallar (§10).
  if(!state.mapListo) await esperarMapaListo();
  if(!state.map||!state.mapListo){ showToast("El mapa aún no está listo."); return; }
  capasEstado[it.id]=on;
  pintarInterruptor(it);
  guardarPreferenciasCapas();

  if(it.custom==="satelite"){ if(on!==sateliteOn) alternarSatelite(); return; }
  if(it.custom==="comunas"){
    if(!map.getSource("comunas")){ showToast("Los límites comunales aún se están cargando…"); }
    CAPAS_COMUNAS.forEach(id=>{ if(map.getLayer(id)) map.setLayoutProperty(id,"visibility",on?"visible":"none"); });
    if(!on) comunaPopup?.remove();
    comunasOn=on; return;
  }
  if(it.custom==="actividades"){ aplicarActividades(); return; }
  if(it.custom==="puntos"){
    // Los marcadores de punto son elementos DOM: se ocultan, no se ocultan capas.
    // Los puntos BLOQUEADOS no se pueden ocultar (sql/17).
    state.pointMarkers.forEach((m,id)=>{
      const p=state.mapPoints.find(x=>x.id===id);
      if(p?.bloqueado) m.getElement().classList.remove("hidden");
      else m.getElement().classList.toggle("hidden",!on);
    });
    return;
  }

  if(on&&it.requiere){
    try{ await asegurarFuente(it.requiere); }
    catch(err){
      console.warn("No se pudo cargar la fuente de la capa",it.requiere,err);
      capasEstado[it.id]=false; pintarInterruptor(it); guardarPreferenciasCapas();
      showToast("No se pudo cargar esa capa. Revisa tu conexión.");
      return;
    }
  }
  // Capa de lugares: su propio archivo se descarga la primera vez que se enciende.
  if(on&&it.capaLugares){
    try{ await cargarLugares(it.capaLugares); }
    catch(err){
      console.warn("No se pudo cargar la capa",it.capaLugares,err);
      capasEstado[it.id]=false; pintarInterruptor(it); guardarPreferenciasCapas();
      showToast("No se pudo cargar esa capa. Revisa tu conexión.");
      return;
    }
  }
  aplicarCapas();
}

function aplicarActividades(){
  // Se usa `display` en línea (y no la clase `hidden` de Tailwind) para que el
  // interruptor siga funcionando aunque el CDN de Tailwind no cargue.
  (state.markers||[]).forEach(m=>m.getElement().style.display=actividadesOn?"":"none");
}

// ------------------------------------------------------------- pintado UI --
function pintarInterruptor(it){
  const fila=$(`#capas-lista [data-capa="${it.id}"]`); if(!fila) return;
  const on=capasEstado[it.id];
  fila.setAttribute("aria-pressed",String(on));
  const sw=fila.querySelector(".capa-switch");
  sw.classList.toggle("bg-primary",on);
  sw.classList.toggle("bg-surface-variant",!on);
  fila.querySelector(".capa-switch-dot").classList.toggle("translate-x-[22px]",on);
  fila.classList.toggle("opacity-50",!!it.pendiente);
}

function pintarPanelCapas(){
  const root=$("#capas-lista"); if(!root) return;
  const custom=(state.subcategorias||[]).filter(s=>!s.layer_key && s.slug!=="general" && s.active!==false);
  const grupos=CAPAS_DEF.map(g=>({
    grupo:g.grupo,
    items:g.items.map(it=>{
      const sub=subcategoriaDeCapa(it.id);
      return {...it,nombre:sub?.name||it.nombre,color:sub?.color||null};
    })
  }));
  if(custom.length) grupos.push({grupo:"Capas propias",items:custom.map(s=>({
    id:`sub:${s.id}`,nombre:s.name,color:s.color,customSub:s,defecto:true
  }))});
  grupos.forEach(g=>g.items.forEach(it=>{
    if(it.customSub && capasEstado[it.id]===undefined) capasEstado[it.id]=true;
  }));
  root.innerHTML=grupos.map(g=>`
    <div class="mt-3 first:mt-0">
      <p class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide mb-1.5">${g.grupo}</p>
      <div class="space-y-1">
        ${g.items.map(it=>{
          const on=it.customSub?capasEstado[it.id]!==false:capasEstado[it.id];
          return `<button type="button" data-capa="${it.id}" aria-pressed="${on}"
            class="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-full bg-surface-container-low active:scale-[0.99] transition-all ${it.pendiente?"opacity-50":""}">
            <span class="flex items-center gap-2 min-w-0 text-body-md text-on-surface text-left">
              ${it.color?`<span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${esc(it.color)}"></span>`:""}
              <span class="truncate">${it.nombre}${it.pendiente?' <span class="text-label-sm text-on-surface-variant">· pronto</span>':""}</span>
            </span>
            <span class="capa-switch relative shrink-0 w-11 h-6 rounded-full transition-colors ${on?"bg-primary":"bg-surface-variant"}">
              <span class="capa-switch-dot absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on?"translate-x-[22px]":""}"></span>
            </span>
          </button>`;}).join("")}
      </div>
    </div>`).join("");
}

// ------------------------------------------------------------- apertura UI --
function abrirPanelCapas(){
  pintarPanelCapas();
  $("#capas-sheet")?.classList.remove("hidden");
  $("#map-layers")?.setAttribute("aria-expanded","true");
}
function cerrarPanelCapas(){
  $("#capas-sheet")?.classList.add("hidden");
  $("#map-layers")?.setAttribute("aria-expanded","false");
}
$("#map-layers").addEventListener("click",abrirPanelCapas);
$("#capas-close").addEventListener("click",cerrarPanelCapas);
$("#capas-backdrop").addEventListener("click",cerrarPanelCapas);
document.addEventListener("keydown",(e)=>{ if(e.key==="Escape") cerrarPanelCapas(); });
$("#capas-lista").addEventListener("click",(e)=>{
  const fila=e.target.closest("[data-capa]"); if(!fila) return;
  const id=fila.dataset.capa;
  let it=CAPAS_DEF.flatMap(g=>g.items).find(x=>x.id===id);
  if(!it && id.startsWith("sub:")){
    const sub=state.subcategoriasPorId[id.slice(4)];
    if(sub) it={id,nombre:sub.name,customSub:sub};
  }
  if(!it) return;
  if(it.pendiente){ showToast("Capa disponible en una próxima etapa."); return; }
  if(it.customSub){
    const on=capasEstado[id]!==false;
    capasEstado[id]=!on;
    pintarInterruptor(it);
    guardarPreferenciasCapas();
    renderPuntosMapa();
    return;
  }
  alternarCapa(it,!capasEstado[it.id]);
});

// ==================== PUNTOS PERSONALIZADOS (mapas.txt §9, Etapa 5) =========
// Tabla `map_points` en Supabase. Solo los ADMINISTRADORES escriben (RLS con
// is_admin()); todos los autenticados los leen para verlos en el mapa.
// Los puntos importados de OSM/GTFS (data/*.geojson) son solo lectura y NO
// se mezclan con estos: son independientes por diseño (§9).
const CATEGORIA_PUNTO={general:"General",seguridad:"Seguridad",salud:"Salud",educacion:"Educación",
  transporte:"Transporte",comercio:"Comercio",areas_verdes:"Áreas verdes",otro:"Otro"};
const COLOR_PUNTO={general:"#006492",seguridad:"#c92a2a",salud:"#e03131",educacion:"#7048e8",
  transporte:"#0f7fd4",comercio:"#e8590c",areas_verdes:"#2e9e4f",otro:"#5f6871"};

// Catálogo de respaldo mientras no esté aplicado sql/15 (o si falla la carga).
// Después de la migración manda la tabla map_categories.
const CATEGORIAS_RESPALDO=[
  {slug:"general",name:"General",icon:"place",color:"#006492"},
  {slug:"seguridad",name:"Seguridad",icon:"warning",color:"#c92a2a"},
  {slug:"salud",name:"Salud",icon:"health_and_safety",color:"#e03131"},
  {slug:"educacion",name:"Educación",icon:"school",color:"#7048e8"},
  {slug:"transporte",name:"Transporte",icon:"directions_bus",color:"#0f7fd4"},
  {slug:"comercio",name:"Comercio",icon:"store",color:"#e8590c"},
  {slug:"areas_verdes",name:"Áreas verdes",icon:"park",color:"#2e9e4f"},
  {slug:"otro",name:"Otro",icon:"place",color:"#5f6871"},
];

function categoriaDe(slug){ return state.categoriasPorSlug[slug]||null; }
function nombreCategoria(slug){ return categoriaDe(slug)?.name || CATEGORIA_PUNTO[slug] || slug || "General"; }
function colorCategoria(slug,fallback="#006492"){
  return categoriaDe(slug)?.color || COLOR_PUNTO[slug] || fallback;
}
function iconoCategoria(slug,icon){
  if(icon && ICONOS_MAPA[icon]) return icon;
  return categoriaDe(slug)?.icon || ICONO_PUNTO[slug] || "place";
}
function scopeDe(p){ return p.scope || (p.tipo==="general"?"global":"group"); }

// Color de una capa de lugares según su categoría (sql/15).
const CATEGORIA_DE_CAPA={parques:"parque",plazas:"parque",comercio:"mall",
  salud_hospital:"salud",salud_sapu:"salud",
  seguridad:"policia",bomberos:"bomberos",servicios:"otros"};
function colorDeCapa(capa,fallback){ return subcategoriaDeCapa(capa)?.color || colorCategoria(CATEGORIA_DE_CAPA[capa],fallback); }
function iconoDeCapa(capa,fallback){ const s=subcategoriaDeCapa(capa); return s && ICONOS_MAPA[s.icon] ? s.icon : fallback; }

async function actualizarIconosCapas(){
  const map=state.map; if(!map||!state.mapListo) return;
  for(const capa of Object.keys(CAPAS_LUGARES)){
    if(!lugaresCargados.has(capa)) continue;
    const clave=iconoDeCapa(capa,ICONO_LUGAR[capa]||"casa");
    const id=await asegurarIcono(clave,colorDeCapa(capa,"#006492"));
    if(map.getLayer(`lugares-${capa}-puntos`)) map.setLayoutProperty(`lugares-${capa}-puntos`,"icon-image",id);
  }
  if(lugaresCargados.has("transporte") && map.getLayer("metro-estaciones-icono")){
    const id=await asegurarIcono(iconoDeCapa("metro","metro"),subcategoriaDeCapa("metro")?.color||"#e30613");
    map.setLayoutProperty("metro-estaciones-icono","icon-image",id);
  }
}

async function cargarCategorias(){
  try{
    const [cats,subs,ovs]=await Promise.all([
      supabase.from("map_categories").select("slug,name,icon,color,sort,active").order("sort"),
      supabase.from("map_subcategories").select("*").order("sort"),
      supabase.from("map_layer_point_overrides").select("layer_key,external_id,visible,subcategory_id"),
    ]);
    if(cats.error) throw cats.error;
    state.categorias=(cats.data||[]);
    state.subcategorias=subs.error?[]:(subs.data||[]);
    state.overrides=ovs.error?[]:(ovs.data||[]);
    state.categoriasCargadas=true;
  }catch(err){
    console.warn("cargarCategorias: se usa el catálogo de respaldo.",err?.message||err);
    state.categorias=CATEGORIAS_RESPALDO.slice();
    state.categoriasCargadas=false;
    state.subcategorias=[];
    state.overrides=[];
  }
  state.categoriasPorSlug=Object.fromEntries(state.categorias.map(c=>[c.slug,c]));
  state.subcategoriasPorId=Object.fromEntries((state.subcategorias||[]).map(s=>[s.id,s]));
  poblarCategoriasFormulario();
  if(state.mapListo) aplicarColoresCategorias();
}

function subcategoriaDe(p){
  if(p?.subcategory_id && state.subcategoriasPorId[p.subcategory_id]) return state.subcategoriasPorId[p.subcategory_id];
  return (state.subcategorias||[]).find(s=>s.category_slug===p?.category && s.slug==="general") || null;
}
function colorDePunto(p){
  return subcategoriaDe(p)?.color || colorCategoria(p?.category);
}
function iconoDePunto(p){
  return subcategoriaDe(p)?.icon || iconoCategoria(p?.category,p?.icon);
}
function modoRenderPunto(p){
  const sub=subcategoriaDe(p);
  return (p?.category==="jw" || sub?.category_slug==="jw") ? "icon" : (sub?.render_mode || "auto");
}
function subcategoriaDeCapa(layerKey){
  return (state.subcategorias||[]).find(s=>s.layer_key===layerKey && s.active!==false) || null;
}

function poblarCategoriasFormulario(){
  const sel=$("#point-category"); if(!sel) return;
  const actual=sel.value;
  const activas=state.categorias.filter(c=>c.active!==false);
  sel.innerHTML=activas.map(c=>`<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join("");
  if(!sel.options.length) sel.innerHTML='<option value="general">General</option>';
  if(actual && [...sel.options].some(o=>o.value===actual)) sel.value=actual;
  poblarSubcategoriasFormulario(sel.value);
}
function subcategoriasDeCategoria(slug){
  return (state.subcategorias||[])
    .filter(s=>s.category_slug===slug && s.active!==false)
    .sort((a,b)=>(a.sort||100)-(b.sort||100));
}
function poblarSubcategoriasFormulario(categorySlug, selected=null){
  const sel=$("#point-subcategory"); if(!sel) return;
  const lista=subcategoriasDeCategoria(categorySlug);
  sel.innerHTML=lista.length
    ? lista.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")
    : '<option value="">General</option>';
  if(selected && lista.some(s=>s.id===selected)) sel.value=selected;
  else {
    const general=lista.find(s=>s.slug==="general") || lista[0];
    if(general) sel.value=general.id;
  }
}

// Actualiza los colores de las capas GeoJSON ya cargadas (lugares, metro y
// MetroTren) cuando cambia una categoría. Los marcadores HTML se re-renderizan.
function aplicarColoresCategorias(){
  const map=state.map; if(!map||!state.mapListo) return;
  Object.entries(CATEGORIA_DE_CAPA).forEach(([capa,slug])=>{
    if(!lugaresCargados.has(capa)) return;
    const color=colorDeCapa(capa,"#006492");
    ["-cluster","-puntos-mini"].forEach(suf=>{
      const id=`lugares-${capa}${suf}`;
      if(map.getLayer(id)) map.setPaintProperty(id,"circle-color",color);
    });
  });
  const colorMetro=subcategoriaDeCapa("metro")?.color || colorCategoria("metro","#ffffff");
  ["metro-estaciones","metro-combo"].forEach(id=>{
    if(map.getLayer(id)) map.setPaintProperty(id,"circle-color",colorMetro);
  });
  if(map.getLayer("metrotren-estaciones")){
    map.setPaintProperty("metrotren-estaciones","circle-color",subcategoriaDeCapa("metrotren")?.color || colorCategoria("metro","#ffffff"));
  }
  renderPuntosMapa();
}

// --- carga desde Supabase ---------------------------------------------------
async function cargarPuntosMapa(){
  if(!state.user) return;
  if(!state.categorias.length) await cargarCategorias();
  const {data,error}=await supabase.from("map_points").select("*").order("created_at",{ascending:true});
  if(error){
    // La tabla puede no existir todavía (falta ejecutar sql/06_map_points.sql).
    console.warn("cargarPuntosMapa:",error.message);
    state.mapPoints=[]; renderPuntosMapa(); return;
  }
  // RLS ya limita a los usuarios normales. El ADMIN general recibe todos los
  // grupos; el MANAGER recibe los globales + su grupo.
  state.mapPoints=(data||[]).filter(p=>{
    if(esAdminGeneral()) return true;
    if(state.groupId && p.tipo==="personal" && p.group_id && p.group_id!==state.groupId) return false;
    if(state.groupId && p.tipo==="general") return scopeDe(p)==="global" || p.group_id===state.groupId;
    return true;
  });
  renderPuntosMapa();
}

// --- puntos JW para las actividades (Fase 3) --------------------------------
async function cargarPuntosJW(){
  const {data,error}=await supabase.from("map_points")
    .select("id,name,category,scope,group_id,latitude,longitude,address,comuna,active,visible")
    .eq("category","jw").eq("active",true).order("name");
  if(error){
    console.warn("cargarPuntosJW:",error.message);
    state.jwPuntos=[]; return;
  }
  state.jwPuntos=(data||[]).filter(p=>esAdminGeneral() || !state.groupId || p.scope==="global" || p.group_id===state.groupId);
}

// --- animaciones JW (Fase 6) ------------------------------------------------
// Se calcula con la hora de Chile y las actividades ya cargadas: no consulta
// Supabase. Un temporizador de 60 s actualiza destello/latido sin recargar.
let temporizadorJW=null;
function aplicarEstadoJW(){
  if(!state.user || !state.mapListo) return;
  const ahora=ahoraChile();
  state.pointMarkers.forEach((m,id)=>{
    const el=m.getElement&&m.getElement(); if(!el || el.dataset.jw!=="1") return;
    const acts=(state.activities||[])
      .filter(a=>a.map_point_id===id)
      .map(a=>({
        titulo:a.title,
        fecha:a.activity_date,
        inicio:timeFmt(a.start_time),
        fin:timeFmt(a.end_time),
        cancelada:a.status==="cancelled",
      }));
    const {estado}=estadoJW(acts,ahora.iso);
    el.classList.toggle("jw-destello",estado==="destello");
    el.classList.toggle("jw-latido",estado==="latido");
    el.dataset.jwEstado=estado||"";
  });
}
function iniciarAnimacionesJW(){
  if(temporizadorJW) return;
  aplicarEstadoJW();
  temporizadorJW=setInterval(aplicarEstadoJW,60000);
}

// Comportamiento de los marcadores según el zoom (3 momentos, 2026-11-25):
//   1) Muy alejado  → punto diminuto, casi imperceptible.
//   2) Acercándose  → el punto crece poco hasta su tamaño actual y ahí se
//                      mantiene (meseta) hasta que aparece el icono.
//   3) Icono        → aparece pequeño, crece apenas hasta un máximo discreto
//                      y muestra el nombre debajo (p. ej. terminales de bus).
//   - Los puntos marcados como "vista fija" (columna `fijo`) conservan siempre
//     su icono: no se achican ni desaparecen.
// Los pines de actividad también se reducen a un punto de color, pero con un
// tamaño mínimo: siempre se deben poder seleccionar.
function interpolarRampa(z, puntos){
  // puntos: [[zoom, valor], ...] ordenados. Devuelve el valor interpolado.
  if(z<=puntos[0][0]) return puntos[0][1];
  for(let i=1;i<puntos.length;i++){
    if(z<=puntos[i][0]){
      const [z0,v0]=puntos[i-1],[z1,v1]=puntos[i];
      const t=(z-z0)/(z1-z0);
      return v0+(v1-v0)*t;
    }
  }
  return puntos[puntos.length-1][1];
}

// Igual que `interpolarRampa`, pero el valor cambia DE GOLPE en cada zoom
// (los "saltos" que pidió el usuario el 2026-11-26): es el equivalente JS de
// `["step",["zoom"],...]` de MapLibre, para que los marcadores HTML sigan la
// misma rampa escalonada que las capas GeoJSON.
//   pasos: [[zoom, valor], ...] de menor a mayor; antes del primer zoom se
//   queda en el primer valor.
function saltoRampa(z, pasos){
  let valor=pasos[0][1];
  for(const [zw,val] of pasos){ if(z>=zw) valor=val; }
  return valor;
}

function actualizarPuntosSegunZoom(){
  const map=state.map; if(!map) return;
  const z=map.getZoom();
  // Diámetro del punto (px): se achica en 3 saltos al ALEJAR el mapa
  // (12,5 → 11,8 → 11) y desaparece por debajo del zoom 10,5. Es el mismo
  // escalón que las capas GeoJSON (["step",["zoom"],...]).
  const tamPunto=saltoRampa(z,[
    [ZOOM_PUNTO_MIN,TAM_PUNTO_MIN],     // 10,5 → 11: 7 px
    [ZOOM_PUNTO_MEDIO,TAM_PUNTO_MEDIO], // 11 → 11,8: 10 px
    [ZOOM_PUNTO_MAX,TAM_PUNTO_MAX],     // 11,8 → 12,5: 14 px
  ]);
  // Tamaño del icono (px): pequeño al aparecer → mismo techo que las capas
  // GeoJSON (calibrado 2026-11-26: 16 px al zoom 12,5 → 24 px al zoom 15).
  const tamIcono=interpolarRampa(z,[[ZOOM_ICONO,16],[ZOOM_ICONO_MAX,24]]);
  // Texto bajo el icono: nace pequeño en el zoom 12,5 y sube en 2 saltos
  // hasta el tamaño máximo actual (11 px).
  const tamTexto=saltoRampa(z,[
    [ZOOM_ICONO,TEXTO_MIN],         // 12,5 → 13,5: 9 px
    [ZOOM_TEXTO_MEDIO,TEXTO_MEDIO], // 13,5 → 14,5: 10 px
    [ZOOM_TEXTO_MAX,TEXTO_MAX],     // desde 14,5: 11 px (no vuelve a crecer)
  ]);
  state.pointMarkers.forEach(m=>{
    const el=m.getElement&&m.getElement(); if(!el) return;
    const esJW=el.dataset.jw==="1";
    // Los JW se muestran siempre con icono (nunca como punto de color) y un
    // 20 % más grandes que el resto (16→24 px pasa a 19,2→28,8 px).
    const fijo=el.dataset.fijo==="1" || esJW || el.dataset.siempreIcono==="icon";
    el.style.setProperty("--icono-tam",(esJW?tamIcono*1.2:tamIcono).toFixed(1)+"px");
    el.style.setProperty("--nombre-tam",tamTexto+"px");
    // Texto: corte NÍTIDO en 12,5 (en 12,4 desaparece y en 12,5 aparece).
    // Vale también para los puntos de "vista fija": ellos conservan el icono,
    // pero el nombre obedece al mismo corte que el resto.
    el.classList.toggle("map-point-con-nombre",z>=ZOOM_ICONO);
    // Los puntos de vista fija nunca se achican ni desaparecen.
    if(fijo){
      el.classList.remove("map-point-punto","map-point-oculto");
      el.style.removeProperty("--punto-tam");
      return;
    }
    // Cerca (zoom >= 12,5): icono.
    if(z>=ZOOM_ICONO){
      el.classList.remove("map-point-punto","map-point-oculto");
      el.style.removeProperty("--punto-tam");
      return;
    }
    // Lejos: punto de color en 3 saltos; por debajo de 10,5 desaparece.
    if(z<ZOOM_PUNTO_MIN){
      el.classList.add("map-point-oculto");
      el.classList.remove("map-point-punto");
      return;
    }
    el.classList.remove("map-point-oculto");
    el.classList.add("map-point-punto");
    // 2 decimales: con el −15 % los valores quedan en 5,95 / 8,5 / 11,9 px y
    // toFixed(1) los redondeaba a 6,0.
    el.style.setProperty("--punto-tam",tamPunto.toFixed(2)+"px");
  });
  // Pines de actividad: NO desaparecen (hay que poder seleccionarlos), solo
  // se reducen a un punto de color. Llevan el mismo −15 % que el resto de la
  // rampa (ESCALA_PUNTO): 10,2 → 20,4 px (antes 12 → 24), para mantener la
  // proporción con los puntos.
  const tam=Math.max(TAM_PIN_MIN,Math.min(TAM_PIN_MAX,Math.round((tamPunto/TAM_PUNTO_MAX)*TAM_PIN_MAX)));
  state.markers.forEach(m=>{
    const el=m.getElement&&m.getElement(); if(!el) return;
    el.classList.toggle("modo-punto",z<ZOOM_ICONO);
    el.style.setProperty("--pin-tam",tam+"px");
  });
}

// --- render (marcadores propios, independientes de las actividades) ---------
function renderPuntosMapa(){
  state.pointMarkers.forEach(m=>m.remove());
  state.pointMarkers.clear();
  const map=state.map; if(!map||!state.mapListo) return;
  const admin=esGestorDeGrupo();
  // El admin ve también los deshabilitados (atenuados) para poder ubicarlos.
  const visibles=state.mapPoints.filter(p=>{
    const sub=subcategoriaDe(p);
    if(sub && !sub.layer_key && sub.slug!=="general" && capasEstado[`sub:${sub.id}`]===false) return false;
    return admin || (p.visible!==false && p.active!==false);
  });
  visibles.forEach(p=>{
    const el=document.createElement("div");
    el.className="map-point map-point-icono";
    const cat=categoriaDe(p.category);
    const claveIcono=iconoDePunto(p);
    const defIcono=ICONOS_MAPA[claveIcono]||ICONOS_MAPA.place;
    // El SVG se muestra directo como fondo CSS (es vectorial: se ve nítido en
    // cualquier zoom y no necesita rasterizarse).
    const urlIcono=`url('./icons/${defIcono.svg}')`;
    const esJW=p.category==="jw";
    if(esJW){
      // Icono interior: el latido/destello escala ESTE elemento (origen
      // centrado) y no el marcador, que MapLibre posiciona con `transform`.
      const anim=document.createElement("span");
      anim.className="map-point-jw-anim";
      anim.setAttribute("aria-hidden","true");
      anim.style.backgroundImage=urlIcono;
      el.appendChild(anim);
    }else{
      el.style.backgroundImage=urlIcono;
    }
    // Color del punto cuando el mapa se aleja: color de la CATEGORÍA (sql/15).
    el.style.setProperty("--punto-color",colorDePunto(p));
    // "Vista fija": el icono se muestra siempre, a cualquier zoom.
    el.dataset.fijo=p.fijo?"1":"0";
    el.dataset.bloqueado=p.bloqueado?"1":"0";
    if(p.bloqueado) el.classList.add("map-point-bloqueado");
    // JW: siempre icono (nunca punto de color) y +20 % de tamaño.
    el.dataset.jw=p.category==="jw"?"1":"0";
    el.dataset.siempreIcono=modoRenderPunto(p);
    el.classList.toggle("map-point-jw",p.category==="jw");
    el.classList.toggle("map-point-oculto-admin",admin && (p.visible===false || p.active===false));
    el.style.backgroundSize="contain";
    el.style.backgroundRepeat="no-repeat";
    el.style.backgroundPosition="center";
    el.title=p.name;
    // Nombre debajo del icono (p. ej. "Terminal Alameda"): se ve al acercar el
    // mapa, sin necesidad de presionar el punto.
    const etiqueta=document.createElement("span");
    etiqueta.className="map-point-nombre";
    etiqueta.textContent=p.name;
    el.appendChild(etiqueta);
    const scope=scopeDe(p);
    const grupoNombre=p.group_id?(state.groups.find(g=>g.id===p.group_id)?.name||""):"";
    const actividadesJW=p.category==="jw"?(state.activities||[]).filter(a=>a.map_point_id===p.id):[];
    const popup=new maplibregl.Popup({offset:22,closeButton:true}).setHTML(
      `<strong>${esc(p.name)}</strong>`+
      `<span class="muted" style="font-size:10px"> · ${p.tipo==="personal"?"personal":(scope==="global"?"global":"grupo")}</span>`+
      (p.description?`<br>${esc(p.description)}`:"")+
      (p.comuna?`<br><span class="muted">${esc(p.comuna)}</span>`:"")+
      `<br><span class="muted">${esc(nombreCategoria(p.category))}</span>`+
      (p.tipo==="general"&&grupoNombre?`<br><span class="muted">${esc(grupoNombre)}</span>`:"")+
      (p.bloqueado?`<br><span class="muted">Punto fijo (solo ADMIN)</span>`:"")+
      (actividadesJW.length?`<br><span class="muted">Actividades: ${actividadesJW.map(a=>esc(a.title)).join(" · ")}</span>`:"")+
      (p.visible===false?`<br><span class="muted">Oculto en el mapa</span>`:"")
    );
    const m=new maplibregl.Marker({element:el,anchor:"bottom"})
      .setLngLat([p.longitude,p.latitude]).setPopup(popup).addTo(map);
    if(admin && puntoGestionable(p)){
      el.addEventListener("click",()=>abrirFormPunto(p));
    }
    state.pointMarkers.set(p.id,m);
  });
  actualizarPuntosSegunZoom();   // icono ⇄ punto según el zoom actual
  aplicarCapas();   // la capa "Puntos personalizados" puede estar apagada
  // Los puntos BLOQUEADOS se muestran siempre, aunque la capa de puntos esté
  // apagada: ningún usuario/manager puede ocultarlos.
  state.pointMarkers.forEach((m,id)=>{
    const p=state.mapPoints.find(x=>x.id===id);
    m.getElement().style.display=(p?.bloqueado || capasEstado.puntos)?"":"none";
  });
  aplicarEstadoJW();
}

// --- alta de punto: gesto sobre el mapa ------------------------------------
// Cualquier usuario autenticado puede agregar puntos personales; MANAGER/ADMIN
// pueden crear generales de su alcance. No hay botón lateral: se usa clic o
// pulsación larga (ver handler de `state.map.on("click")`).

// --- gestión de puntos por categoría (admin global o de grupo) --------------
// El admin entra a una categoría, busca, selecciona/deselecciona puntos,
// renombra, ubica o borra, y puede cambiar el color de la categoría (solo el
// admin global). Los cambios se aplican con "Guardar".
const PUNTOS_ELIMINADOS=new Set();   // ids marcados para borrar
const PUNTOS_EDITADOS=new Map();     // id → {name, visible}

function abrirGestionPuntos(){
  if(!esGestorDeGrupo()){ showToast("Solo los administradores pueden gestionar los puntos."); return; }
  PUNTOS_ELIMINADOS.clear();
  PUNTOS_EDITADOS.clear();
  state.categoriasEditadas.clear();
  state.gestion={modo:"categorias",categoria:null,buscar:""};
  renderGestionPuntos();
  $("#puntos-sheet")?.classList.remove("hidden");
  if(!state.categorias.length) cargarCategorias().then(()=>renderGestionPuntos());
}
function cerrarGestionPuntos(){ $("#puntos-sheet")?.classList.add("hidden"); }

// ==================== ADMIN DE CAPAS / SUBCATEGORÍAS (sql/19) ===============
function capasExternas(){
  const out=[
    {id:"metro",nombre:"Metro"},
    {id:"metrotren",nombre:"MetroTren"},
  ];
  CAPAS_DEF.forEach(g=>g.items.forEach(it=>{
    if(it.capaLugares) out.push({id:it.id,nombre:it.nombre});
  }));
  return out;
}
function abrirAdminCapas(){
  if(!isAdmin()) return;
  cerrarPanelCapas();
  renderAdminCapas();
  $("#capas-admin-dialog")?.showModal();
}
function renderAdminCapas(){
  const root=$("#capas-admin-lista"); if(!root) return;
  root.innerHTML=(state.categorias||[]).map(c=>{
    const subs=subcategoriasDeCategoria(c.slug);
    return `<div class="rounded-xl bg-surface-container-low p-3 space-y-2">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-sm font-bold text-on-surface">${esc(c.name)} <span class="text-[11px] font-normal text-on-surface-variant">/${esc(c.slug)}</span></p>
          <p class="text-[11px] text-on-surface-variant">${subs.length} subcategoría${subs.length===1?"":"s"}</p>
        </div>
        <div class="flex gap-1">
          <button type="button" class="secondary" data-capa-cat-edit="${esc(c.slug)}">Editar</button>
          <button type="button" class="secondary" data-capa-sub-new="${esc(c.slug)}">+ Sub</button>
        </div>
      </div>
      <div class="space-y-1">
        ${subs.map(s=>`<div class="flex items-center gap-2 bg-white rounded-lg px-2.5 py-2">
          <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${esc(s.color)}"></span>
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-on-surface truncate">${esc(s.name)}</p>
            <p class="text-[10px] text-on-surface-variant">${esc(s.render_mode==="icon"?"siempre icono":"icono ↔ punto")}${s.layer_key?" · capa "+esc(s.layer_key):""}</p>
          </div>
          ${s.layer_key?`<button type="button" class="secondary" data-capa-sub-puntos="${esc(s.id)}">Puntos</button>`:""}
          <button type="button" class="secondary" data-capa-sub-edit="${esc(s.id)}">Editar</button>
        </div>`).join("")}
      </div>
    </div>`;
  }).join("") || '<div class="empty">No hay categorías.</div>';
  root.querySelectorAll("[data-capa-cat-edit]").forEach(b=>b.addEventListener("click",()=>abrirCapaForm("categoria",b.dataset.capaCatEdit)));
  root.querySelectorAll("[data-capa-sub-new]").forEach(b=>b.addEventListener("click",()=>abrirCapaForm("subcategoria",null,b.dataset.capaSubNew)));
  root.querySelectorAll("[data-capa-sub-edit]").forEach(b=>b.addEventListener("click",()=>abrirCapaForm("subcategoria",b.dataset.capaSubEdit)));
  root.querySelectorAll("[data-capa-sub-puntos]").forEach(b=>b.addEventListener("click",()=>abrirCapaPuntos(state.subcategoriasPorId[b.dataset.capaSubPuntos])));
}
function abrirCapaForm(tipo,id=null,categorySlug=null){
  const cat=id && tipo==="categoria"?state.categoriasPorSlug[id]:null;
  const sub=id && tipo==="subcategoria"?state.subcategoriasPorId[id]:null;
  $("#capa-form-tipo").value=tipo;
  $("#capa-form-id").value=id||"";
  $("#capa-form-title").textContent=id?(tipo==="categoria"?"Editar categoría":"Editar subcategoría"):(tipo==="categoria"?"Nueva categoría":"Nueva subcategoría");
  $("#capa-form-error").textContent="";
  $("#capa-category-wrap").classList.toggle("hidden",tipo==="categoria");
  $("#capa-sub-wrap").classList.toggle("hidden",tipo==="categoria");
  const selCat=$("#capa-category");
  selCat.innerHTML=state.categorias.map(c=>`<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join("");
  if(categorySlug) selCat.value=categorySlug;
  if(sub) selCat.value=sub.category_slug;
  const obj=cat||sub||{};
  $("#capa-name").value=obj.name||"";
  $("#capa-slug").value=obj.slug||"";
  $("#capa-slug").readOnly=!!id;
  $("#capa-color").value=obj.color||"#006492";
  $("#capa-sort").value=obj.sort??100;
  $("#capa-active").checked=obj.active!==false;
  const selIcon=$("#capa-icon");
  selIcon.innerHTML=Object.entries(ICONOS_MAPA).map(([k,v])=>`<option value="${esc(k)}">${esc(v.label)}</option>`).join("");
  selIcon.value=obj.icon||"place";
  $("#capa-render").value=obj.render_mode||(obj.slug==="jw"?"icon":"auto");
  const selLayer=$("#capa-layer");
  const externas=capasExternas();
  if(obj.layer_key && !externas.some(x=>x.id===obj.layer_key)) externas.push({id:obj.layer_key,nombre:obj.layer_key});
  selLayer.innerHTML='<option value="">Puntos manuales / sin capa</option>'+
    externas.map(x=>`<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join("");
  selLayer.value=obj.layer_key||"";
  $("#capa-form-dialog")?.showModal();
}
$("#capas-admin-close")?.addEventListener("click",()=>$("#capas-admin-dialog")?.close());
$("#capa-form-close")?.addEventListener("click",()=>$("#capa-form-dialog")?.close());
$("#capa-nueva-categoria")?.addEventListener("click",()=>abrirCapaForm("categoria"));
$("#capa-form")?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!isAdmin()) return;
  const tipo=$("#capa-form-tipo").value, id=$("#capa-form-id").value;
  const name=$("#capa-name").value.trim();
  const slug=$("#capa-slug").value.trim().toLowerCase();
  if(name.length<2||!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(slug)){
    notifyError($("#capa-form-error"),"Nombre y slug válidos son obligatorios."); return;
  }
  const base={name,slug,color:$("#capa-color").value,icon:$("#capa-icon").value,sort:Number($("#capa-sort").value)||100,active:$("#capa-active").checked};
  let res;
  if(tipo==="categoria"){
    res=id
      ? await supabase.from("map_categories").update(base).eq("slug",id)
      : await supabase.from("map_categories").insert(base);
  }else{
    const payload={...base,category_slug:$("#capa-category").value,render_mode:$("#capa-render").value,
      layer_key:$("#capa-layer").value||null};
    if(payload.category_slug==="jw") payload.render_mode="icon";
    res=id
      ? await supabase.from("map_subcategories").update(payload).eq("id",id)
      : await supabase.from("map_subcategories").insert(payload);
  }
  if(res.error){ notifyError($("#capa-form-error"),describeError(res.error,"la capa")); return; }
  $("#capa-form-dialog")?.close();
  await cargarCategorias();
  await actualizarIconosCapas();
  aplicarComportamientosCapas();
  renderAdminCapas();
  showToast("Capa guardada.");
});

async function abrirCapaPuntos(sub){
  if(!isAdmin()||!sub?.layer_key) return;
  const root=$("#capa-puntos-lista");
  $("#capa-puntos-title").textContent=`Puntos · ${sub.name}`;
  $("#capa-puntos-error").textContent="";
  root.innerHTML='<div class="empty">Cargando…</div>';
  $("#capa-puntos-dialog")?.showModal();
  let features=[];
  try{
    if(sub.layer_key==="metro"||sub.layer_key==="metrotren"){
      const geo=state.geoTranporte || await fetch("./data/transporte-estaciones.geojson").then(r=>r.json());
      features=geo.features.filter(f=>f.properties?.tipo===sub.layer_key);
    }else{
      const cfg=CAPAS_LUGARES[sub.layer_key];
      const dataKey=cfg?.dataKey||sub.layer_key;
      const cache=state.geoCapas[sub.layer_key];
      const geo=cache || await fetch(`./data/lugares/${dataKey}.geojson`).then(r=>r.json());
      features=geo.features||[];
      if(!cache && typeof cfg?.filter==="function") features=features.filter(cfg.filter);
    }
  }catch(err){ notifyError($("#capa-puntos-error"),describeError(err,"los puntos de la capa")); root.innerHTML=""; return; }
  const ocultos=new Set((state.overrides||[]).filter(o=>o.layer_key===sub.layer_key&&o.visible===false).map(o=>o.external_id));
  state.capaPuntos={sub,items:features.map(f=>{
    const id=externalIdDe(sub.layer_key,f.properties);
    return {id,name:f.properties?.nombre||id,visible:!ocultos.has(id)};
  })};
  renderCapaPuntos();
}
function renderCapaPuntos(){
  const root=$("#capa-puntos-lista"); if(!root||!state.capaPuntos) return;
  const q=($("#capa-puntos-buscar")?.value||"").trim().toLowerCase();
  const items=state.capaPuntos.items.filter(x=>!q||x.name.toLowerCase().includes(q));
  root.innerHTML=items.length?items.map(x=>`<label class="flex items-center gap-2 bg-surface-container-low rounded-lg px-3 py-2">
    <input type="checkbox" data-capa-punto="${esc(x.id)}" ${x.visible?"checked":""} class="w-5 h-5 accent-primary">
    <span class="text-sm text-on-surface min-w-0 truncate">${esc(x.name)}</span>
  </label>`).join(""):'<div class="empty">Sin puntos.</div>';
  root.querySelectorAll("[data-capa-punto]").forEach(cb=>cb.addEventListener("change",()=>{
    const it=state.capaPuntos.items.find(x=>x.id===cb.dataset.capaPunto);
    if(it) it.visible=cb.checked;
  }));
}
$("#capa-puntos-buscar")?.addEventListener("input",renderCapaPuntos);
$("#capa-puntos-close")?.addEventListener("click",()=>$("#capa-puntos-dialog")?.close());
$("#capa-puntos-guardar")?.addEventListener("click",async()=>{
  if(!state.capaPuntos) return;
  const {sub,items}=state.capaPuntos;
  // Solo se guardan las EXCEPCIONES (puntos ocultos). Un punto sin fila = visible.
  const rows=items.filter(x=>!x.visible).map(x=>({layer_key:sub.layer_key,external_id:String(x.id),visible:false,subcategory_id:sub.id,updated_by:state.user.id}));
  const del=await supabase.from("map_layer_point_overrides").delete().eq("layer_key",sub.layer_key);
  if(del.error){ notifyError($("#capa-puntos-error"),describeError(del.error,"la visibilidad de la capa")); return; }
  if(rows.length){
    const {error}=await supabase.from("map_layer_point_overrides").insert(rows);
    if(error){ notifyError($("#capa-puntos-error"),describeError(error,"la visibilidad de la capa")); return; }
  }
  state.overrides=(state.overrides||[]).filter(o=>o.layer_key!==sub.layer_key).concat(rows.map(r=>({layer_key:r.layer_key,external_id:r.external_id,visible:false,subcategory_id:r.subcategory_id})));
  await aplicarOverridesMapa();
  $("#capa-puntos-dialog")?.close();
  showToast("Visibilidad de la capa guardada.");
});
async function aplicarOverridesMapa(){
  const map=state.map; if(!map||!state.mapListo) return;
  Object.entries(state.geoCapas).forEach(([capa,raw])=>{
    const src=map.getSource(`lugares-${capa}`);
    if(src?.setData) src.setData(filtrarGeoOverrides(capa,JSON.parse(JSON.stringify(raw))));
  });
  if(state.geoTranporte){
    const src=map.getSource("transporte-estaciones");
    if(src?.setData){
      const g=JSON.parse(JSON.stringify(state.geoTranporte));
      g.features=g.features.filter(f=>!overrideOculto(f.properties?.tipo,f.properties?.gtfs_stop_id));
      src.setData(g);
    }
  }
  aplicarColoresCategorias();
}

$("#capas-admin-btn")?.addEventListener("click",abrirAdminCapas);
$("#puntos-close")?.addEventListener("click",cerrarGestionPuntos);
$("#puntos-backdrop")?.addEventListener("click",cerrarGestionPuntos);
$("#puntos-volver")?.addEventListener("click",()=>{
  state.gestion={modo:"categorias",categoria:null,buscar:""};
  renderGestionPuntos();
});

function renderGestionPuntos(){
  const root=$("#puntos-lista"); if(!root) return;
  const g=state.gestion;
  const enPuntos=g.modo==="puntos";
  $("#puntos-volver")?.classList.toggle("hidden",!enPuntos);
  $("#puntos-buscar-wrap")?.classList.toggle("hidden",!enPuntos);
  $("#puntos-acciones")?.classList.toggle("hidden",!enPuntos);
  const inpBuscar=$("#puntos-buscar");
  if(inpBuscar && document.activeElement!==inpBuscar) inpBuscar.value=g.buscar||"";
  const titulo=$("#puntos-title");
  if(!enPuntos){
    if(titulo) titulo.textContent="Gestionar puntos del mapa";
    const total=state.mapPoints.filter(p=>puntoGestionable(p)&&!PUNTOS_ELIMINADOS.has(p.id)).length;
    $("#puntos-resumen").textContent=`${total} punto${total===1?"":"s"} en total`;
    root.innerHTML=renderCategoriasGestion();
    enlazarCategoriasGestion();
  }else{
    const cat=categoriaDe(g.categoria);
    if(titulo) titulo.textContent=cat?.name||"Puntos";
    root.innerHTML=renderPuntosCategoria();
    enlazarPuntosGestion();
    actualizarResumenGestion();
  }
}

function renderCategoriasGestion(){
  const editarColor=isAdmin();
  return `<div class="space-y-2">`+state.categorias.map(c=>{
    const items=state.mapPoints.filter(p=>p.category===c.slug && puntoGestionable(p) && !PUNTOS_ELIMINADOS.has(p.id));
    const vis=items.filter(p=>p.visible!==false).length;
    const color=state.categoriasEditadas.get(c.slug)||c.color;
    const icono=ICONOS_MAPA[c.icon]||ICONOS_MAPA.place;
    return `<div class="flex items-center gap-2 bg-surface-container-low rounded-xl p-2">
      <img src="./icons/${icono.svg}" alt="" width="26" height="26" class="w-7 h-7 flex-shrink-0" loading="lazy">
      <button type="button" data-cat-abrir="${esc(c.slug)}" class="min-w-0 flex-1 text-left">
        <span class="block text-sm font-semibold text-on-surface truncate">${esc(c.name)}</span>
        <span class="block text-[11px] text-on-surface-variant">${vis}/${items.length} visibles</span>
      </button>
      ${editarColor
        ? `<input type="color" value="${esc(color)}" data-cat-color="${esc(c.slug)}" class="w-8 h-8 rounded-full border border-outline-variant bg-transparent p-0 cursor-pointer flex-shrink-0" title="Color de la categoría" aria-label="Color de ${esc(c.name)}">`
        : `<span class="w-6 h-6 rounded-full border border-outline-variant flex-shrink-0" style="background:${esc(color)}"></span>`}
      <span class="material-symbols-outlined text-outline text-[20px] flex-shrink-0">chevron_right</span>
    </div>`;
  }).join("")+`</div>`;
}

function enlazarCategoriasGestion(){
  const root=$("#puntos-lista"); if(!root) return;
  root.querySelectorAll("[data-cat-abrir]").forEach(b=>b.addEventListener("click",()=>{
    state.gestion={modo:"puntos",categoria:b.dataset.catAbrir,buscar:""};
    renderGestionPuntos();
  }));
  root.querySelectorAll("[data-cat-color]").forEach(inp=>inp.addEventListener("input",()=>{
    state.categoriasEditadas.set(inp.dataset.catColor,inp.value);
  }));
}

function renderPuntosCategoria(){
  const slug=state.gestion.categoria;
  const buscar=(state.gestion.buscar||"").trim().toLowerCase();
  const items=state.mapPoints
    .filter(p=>p.category===slug && puntoGestionable(p) && !PUNTOS_ELIMINADOS.has(p.id))
    .filter(p=>!buscar || p.name.toLowerCase().includes(buscar))
    .sort((a,b)=>a.name.localeCompare(b.name,"es"));
  if(!items.length){
    return `<p class="text-sm text-on-surface-variant px-1">${buscar?"Sin coincidencias.":"No hay puntos en esta categoría."}</p>`;
  }
  return `<div class="space-y-2">`+items.map(p=>{
    const icono=ICONOS_MAPA[iconoDePunto(p)]||ICONOS_MAPA.place;
    const edit=PUNTOS_EDITADOS.get(p.id);
    const nombre=edit?.name ?? p.name;
    const visible=edit?.visible ?? (p.visible!==false);
    const scope=scopeDe(p);
    const grupo=p.group_id?(state.groups.find(g=>g.id===p.group_id)?.name||""):"";
    return `<div class="flex items-center gap-1.5 bg-surface-container-low rounded-xl p-2" data-punto="${p.id}">
      <img src="./icons/${icono.svg}" alt="" width="26" height="26" class="w-7 h-7 flex-shrink-0" loading="lazy">
      <div class="min-w-0 flex-1">
        <input type="text" maxlength="120" value="${esc(nombre)}" data-punto-nombre="${p.id}"
               class="w-full bg-surface-container-lowest rounded-lg px-2 py-1.5 text-sm font-semibold text-on-surface focus:outline-none" aria-label="Nombre del punto">
        <span class="block text-[11px] text-on-surface-variant truncate">${esc(p.tipo==="personal"?"personal":(scope==="global"?"global":"grupo"))}${grupo?" · "+esc(grupo):""}${p.comuna?" · "+esc(p.comuna):""}</span>
      </div>
      <label class="flex items-center gap-1 flex-shrink-0 px-0.5" title="Mostrar en el mapa">
        <input type="checkbox" data-punto-visible="${p.id}" ${visible?"checked":""} class="w-5 h-5 accent-primary">
      </label>
      <button type="button" data-punto-ubicar="${p.id}" aria-label="Ubicar en el mapa"
              class="w-8 h-8 rounded-full bg-surface-container-lowest text-primary flex items-center justify-center flex-shrink-0 active:scale-95 transition-all">
        <span class="material-symbols-outlined text-[18px]">my_location</span>
      </button>
      <button type="button" data-punto-borrar="${p.id}" aria-label="Borrar punto"
              class="w-8 h-8 rounded-full bg-error-container text-on-error-container flex items-center justify-center flex-shrink-0 active:scale-95 transition-all">
        <span class="material-symbols-outlined text-[18px]">delete</span>
      </button>
    </div>`;
  }).join("")+`</div>`;
}

function enlazarPuntosGestion(){
  const root=$("#puntos-lista"); if(!root) return;
  root.querySelectorAll("[data-punto-nombre]").forEach(i=>i.addEventListener("input",()=>{
    const id=i.dataset.puntoNombre;
    const p=state.mapPoints.find(x=>x.id===id); if(!p) return;
    const visible=PUNTOS_EDITADOS.get(id)?.visible ?? (p.visible!==false);
    PUNTOS_EDITADOS.set(id,{name:i.value,visible});
  }));
  root.querySelectorAll("[data-punto-visible]").forEach(c=>c.addEventListener("change",()=>{
    const id=c.dataset.puntoVisible;
    const p=state.mapPoints.find(x=>x.id===id); if(!p) return;
    const nombre=PUNTOS_EDITADOS.get(id)?.name ?? p.name;
    PUNTOS_EDITADOS.set(id,{name:nombre,visible:c.checked});
    actualizarResumenGestion();
  }));
  root.querySelectorAll("[data-punto-borrar]").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.puntoBorrar;
    if(!confirm("¿Borrar este punto del mapa?")) return;
    PUNTOS_ELIMINADOS.add(id);
    PUNTOS_EDITADOS.delete(id);
    b.closest("[data-punto]")?.remove();
    actualizarResumenGestion();
  }));
  root.querySelectorAll("[data-punto-ubicar]").forEach(b=>b.addEventListener("click",()=>{
    const p=state.mapPoints.find(x=>x.id===b.dataset.puntoUbicar); if(!p) return;
    cerrarGestionPuntos();
    gotoView("mapa");
    setTimeout(()=>{
      state.map?.flyTo({center:[p.longitude,p.latitude],zoom:Math.max(state.map.getZoom(),15),duration:600});
    },250);
    showToast("Punto: "+p.name);
  }));
}

function actualizarResumenGestion(){
  const cat=state.gestion.categoria;
  const items=state.mapPoints.filter(p=>p.category===cat && puntoGestionable(p) && !PUNTOS_ELIMINADOS.has(p.id));
  const vis=items.filter(p=>{
    const e=PUNTOS_EDITADOS.get(p.id);
    return e?.visible ?? (p.visible!==false);
  }).length;
  const filtro=(state.gestion.buscar||"").trim();
  $("#puntos-resumen").textContent=`${vis} de ${items.length} visibles${filtro?` · filtro “${filtro}”`:""}`;
}

$("#puntos-buscar")?.addEventListener("input",e=>{
  state.gestion.buscar=e.target.value;
  renderGestionPuntos();
});

function aplicarVisibilidadGestion(valor){
  const buscar=(state.gestion.buscar||"").trim().toLowerCase();
  const items=state.mapPoints.filter(p=>p.category===state.gestion.categoria && puntoGestionable(p) && !PUNTOS_ELIMINADOS.has(p.id))
    .filter(p=>!buscar || p.name.toLowerCase().includes(buscar));
  items.forEach(p=>{
    const e=PUNTOS_EDITADOS.get(p.id)||{name:p.name,visible:p.visible!==false};
    PUNTOS_EDITADOS.set(p.id,{name:e.name,visible:valor});
    const cb=document.querySelector(`[data-punto-visible="${p.id}"]`);
    if(cb) cb.checked=valor;
  });
  actualizarResumenGestion();
}
$("#puntos-todos")?.addEventListener("click",()=>aplicarVisibilidadGestion(true));
$("#puntos-ninguno")?.addEventListener("click",()=>aplicarVisibilidadGestion(false));

$("#puntos-guardar")?.addEventListener("click",async()=>{
  if(!esGestorDeGrupo()) return;
  const btn=$("#puntos-guardar");
  btn.disabled=true;
  try{
    // 1) Colores de categoría (solo admin global).
    if(isAdmin()){
      for(const [slug,color] of state.categoriasEditadas){
        const {error}=await supabase.from("map_categories").update({color}).eq("slug",slug);
        if(error){ console.error("puntos: color",error); showToast("No se pudo guardar un color: "+describeError(error,"las categorías")); return; }
      }
    }
    // 2) Borrados.
    for(const id of PUNTOS_ELIMINADOS){
      const {error}=await supabase.from("map_points").delete().eq("id",id);
      if(error){ console.error("puntos: borrar",error); showToast("No se pudo borrar un punto: "+describeError(error,"los puntos del mapa")); return; }
    }
    // 3) Visibilidad en bloque.
    const activar=[],desactivar=[];
    for(const [id,c] of PUNTOS_EDITADOS){
      if(PUNTOS_ELIMINADOS.has(id)) continue;
      (c.visible?activar:desactivar).push(id);
    }
    if(activar.length){
      const {error}=await supabase.from("map_points").update({visible:true}).in("id",activar);
      if(error){ console.error("puntos: visibles",error); showToast("No se pudo guardar la visibilidad: "+describeError(error,"los puntos del mapa")); return; }
    }
    if(desactivar.length){
      const {error}=await supabase.from("map_points").update({visible:false}).in("id",desactivar);
      if(error){ console.error("puntos: ocultos",error); showToast("No se pudo guardar la visibilidad: "+describeError(error,"los puntos del mapa")); return; }
    }
    // 4) Nombres (solo los que cambiaron).
    for(const [id,c] of PUNTOS_EDITADOS){
      if(PUNTOS_ELIMINADOS.has(id)) continue;
      const nombre=(c.name||"").trim()||"Punto";
      const p=state.mapPoints.find(x=>x.id===id);
      if(p && p.name===nombre) continue;
      const {error}=await supabase.from("map_points").update({name:nombre}).eq("id",id);
      if(error){ console.error("puntos: nombre",error); showToast("No se pudo guardar un nombre: "+describeError(error,"los puntos del mapa")); return; }
    }
    state.categoriasEditadas.clear();
    await cargarCategorias();
    await cargarPuntosMapa();
    aplicarColoresCategorias();
    cerrarGestionPuntos();
    showToast("Puntos y colores guardados.");
  }finally{ btn.disabled=false; }
});

// --- formulario -------------------------------------------------------------
// Selector visual de iconos: se construye con el catálogo ICONOS_MAPA, así que
// basta con añadir un SVG a /icons y su entrada al catálogo para que aparezca.
function renderSelectorIconos(){
  const grid=$("#point-icon-grid");
  if(!grid||grid.dataset.listo) return;
  grid.dataset.listo="1";
  grid.innerHTML=Object.entries(ICONOS_MAPA).map(([clave,def])=>
    `<button type="button" class="icono-selector" data-icon="${clave}" role="radio" aria-checked="false" title="${esc(def.label)}" aria-label="${esc(def.label)}">`+
    `<img src="./icons/${def.svg}" alt="" width="24" height="24" loading="lazy" draggable="false"></button>`).join("");
  grid.addEventListener("click",e=>{
    const btn=e.target.closest("[data-icon]");
    if(!btn) return;
    seleccionarIcono(btn.dataset.icon);
  });
}
function seleccionarIcono(clave){
  const input=$("#point-icon");
  if(!input||!ICONOS_MAPA[clave]) return;
  input.value=clave;
  $$("#point-icon-grid [data-icon]").forEach(b=>{
    const act=b.dataset.icon===clave;
    b.classList.toggle("icono-selector-activo",act);
    b.setAttribute("aria-checked",act?"true":"false");
  });
}
renderSelectorIconos();

async function abrirFormPunto(p=null,lat=null,lng=null){
  if(!state.user) return;
  if(!state.categorias.length) await cargarCategorias();
  $("#point-dialog-title").textContent=p?"Editar punto":"Nuevo punto";
  $("#point-id").value=p?.id||"";
  $("#point-name").value=p?.name||"";
  $("#point-description").value=p?.description||"";
  poblarCategoriasFormulario();
  const selCat=$("#point-category");
  const catSlug=(!p && state.puntoParaActividad)?"jw":(p?.category||"general");
  if(selCat && ![...selCat.options].some(o=>o.value===catSlug)){
    selCat.insertAdjacentHTML("beforeend",`<option value="${esc(catSlug)}">${esc(nombreCategoria(catSlug))}</option>`);
  }
  if(selCat) selCat.value=catSlug;
  poblarSubcategoriasFormulario(catSlug,p?.subcategory_id);
  $("#point-icon-block")?.classList.toggle("hidden",!isAdmin());
  const subSel=p?.subcategory_id || $("#point-subcategory")?.value || "";
  seleccionarIcono(iconoDePunto({category:catSlug,subcategory_id:subSel,icon:p?.icon}));
  if(!p && state.puntoParaActividad && !$("#point-name").value.trim()){
    $("#point-name").value="Punto JW de actividad";
  }
  $("#point-lat").value=p?p.latitude:(lat??"");
  $("#point-lng").value=p?p.longitude:(lng??"");
  $("#point-visible").checked=p?p.visible!==false:true;
  $("#point-fijo").checked=p?!!p.fijo:false;
  if($("#point-bloqueado")) $("#point-bloqueado").checked=p?!!p.bloqueado:false;
  state.puntoBloqueadoOriginal=!!p?.bloqueado;

  // Tipo / alcance / grupo (Fase 2).
  const admin=esGestorDeGrupo(); const global=isAdmin();
  const tipoSel=$("#point-tipo");
  const tipo=p?.tipo || (admin?"general":"personal");
  if(tipoSel) tipoSel.value=tipo;
  $("#point-tipo-label")?.classList.toggle("hidden",!admin);
  $("#point-bloqueado-label")?.classList.toggle("hidden",!global);

  const grupos=(state.groups||[]).filter(g=>g.id);
  const disponibles=global?grupos:grupos.filter(g=>g.id===state.groupId);
  const selGrupo=$("#point-group");
  if(selGrupo){
    selGrupo.innerHTML=disponibles.map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");
    if(!disponibles.length && state.groupId){
      selGrupo.innerHTML=`<option value="${esc(state.groupId)}">${esc(state.group?.name||"Mi grupo")}</option>`;
    }
  }
  const scope=p?.scope || "group";
  const selScope=$("#point-scope"); if(selScope) selScope.value=scope;
  const grupoId=p?.group_id || state.groupId || "";
  if(selGrupo && grupoId) selGrupo.value=grupoId;

  actualizarCamposPunto();
  $("#point-delete")?.classList.toggle("hidden",!p || !puntoGestionable(p));
  notifyError($("#point-error"),"");
  $("#point-dialog")?.classList.remove("hidden");
}
// Ajusta qué campos se ven según tipo (personal/general), alcance y rol.
function actualizarCamposPunto(){
  const tipo=$("#point-tipo")?.value||"personal";
  const admin=esGestorDeGrupo(); const global=isAdmin();
  const bloqueado=global && !!$("#point-bloqueado")?.checked;
  if(bloqueado){
    if($("#point-tipo")) $("#point-tipo").value="general";
    if($("#point-scope")) $("#point-scope").value="global";
    if($("#point-visible")) $("#point-visible").checked=true;
    if($("#point-fijo")) $("#point-fijo").checked=true;
  }
  const scope=$("#point-scope")?.value||"group";
  if(admin && !global && tipo==="general" && $("#point-scope")) $("#point-scope").value="group";
  const ambito=bloqueado?"global":($("#point-scope")?.value||"group");
  $("#point-tipo-label")?.classList.toggle("hidden",!admin);
  $("#point-bloqueado-label")?.classList.toggle("hidden",!global);
  $("#point-scope-label")?.classList.toggle("hidden",!(admin && global && tipo==="general") || bloqueado);
  $("#point-group-label")?.classList.toggle("hidden",!(admin && global && tipo==="general" && ambito==="group") || bloqueado);
  $("#point-visible")?.toggleAttribute("disabled",bloqueado);
  $("#point-fijo")?.toggleAttribute("disabled",bloqueado);
  const lab=$("#point-visible-label");
  if(lab){
    lab.textContent = bloqueado
      ? "Punto fijo bloqueado: visible siempre para todos"
      : tipo==="general"
      ? (ambito==="global"&&global ? "Visible para todos los grupos" : "Visible para el grupo")
      : "Visible en el mapa";
  }
}
function cerrarFormPunto(){
  $("#point-dialog")?.classList.add("hidden");
  notifyError($("#point-error"),"");
}
$("#point-close")?.addEventListener("click",cerrarFormPunto);
$("#point-backdrop")?.addEventListener("click",cerrarFormPunto);
// Si se cierra el formulario del punto durante "Marcar actividad en el mapa",
// se descarta la actividad pendiente (no se creó el punto).
["#point-close","#point-backdrop"].forEach(s=>$(s)?.addEventListener("click",()=>{
  if(state.puntoParaActividad){ state.puntoParaActividad=false; state.actividadPendiente=null; }
}));

// Al cambiar la categoría se propone su icono por defecto (Fase 2: el icono
// sale de map_categories, con respaldo en ICONO_PUNTO).
$("#point-category")?.addEventListener("change",e=>{
  poblarSubcategoriasFormulario(e.target.value);
  const sub=state.subcategoriasPorId[$("#point-subcategory")?.value];
  if(sub?.icon) seleccionarIcono(sub.icon);
});
$("#point-subcategory")?.addEventListener("change",()=>{
  const sub=state.subcategoriasPorId[$("#point-subcategory")?.value];
  if(sub?.icon) seleccionarIcono(sub.icon);
});
$("#point-tipo")?.addEventListener("change",actualizarCamposPunto);
$("#point-scope")?.addEventListener("change",actualizarCamposPunto);
$("#point-bloqueado")?.addEventListener("change",actualizarCamposPunto);

// --- guardar / eliminar -----------------------------------------------------
$("#point-form")?.addEventListener("submit",async e=>{
  e.preventDefault();
  if(!state.user){ notifyError($("#point-error"),"Inicia sesión para guardar puntos."); return; }
  const id=$("#point-id").value;
  const name=$("#point-name").value.trim();
  const lat=Number($("#point-lat").value), lng=Number($("#point-lng").value);
  if(!name){ notifyError($("#point-error"),"El nombre es obligatorio."); return; }
  if(!Number.isFinite(lat)||!Number.isFinite(lng)){ notifyError($("#point-error"),"Coordenadas inválidas."); return; }
  // Rango de la Región Metropolitana (mismo check que la tabla en SQL).
  if(lat<-34.5||lat>-32.7||lng<-72||lng>-69.5){
    notifyError($("#point-error"),"Las coordenadas deben estar dentro de la Región Metropolitana."); return; }
  const admin=esGestorDeGrupo();
  const tipo=admin?$("#point-tipo").value:"personal";
  let scope="group", grupoId=state.groupId;
  if(tipo==="general" && isAdmin()){
    scope=$("#point-scope").value==="global"?"global":"group";
    grupoId=scope==="global"?null:($("#point-group").value||state.groupId);
  }
  const bloqueado=!!(isAdmin() && $("#point-bloqueado")?.checked);
  if(bloqueado){ scope="global"; grupoId=null; }
  const payload={name,description:$("#point-description").value.trim(),
    category:$("#point-category").value,subcategory_id:$("#point-subcategory")?.value||null,icon:$("#point-icon").value,
    latitude:lat,longitude:lng,visible:bloqueado?true:$("#point-visible").checked,tipo:bloqueado?"general":tipo,
    scope,group_id:grupoId,fijo:bloqueado?true:$("#point-fijo").checked};
  if(isAdmin() && (bloqueado || state.puntoBloqueadoOriginal)) payload.bloqueado=bloqueado;
  const guardar=async p=>id
    ? await supabase.from("map_points").update(p).eq("id",id).select("id")
    : await supabase.from("map_points").insert({...p,created_by:state.user.id}).select("id");
  let intento={...payload};
  let res=await guardar(intento);
  let faltante="";
  // Compatibilidad: si la BD aún no tiene `fijo` (sql/08) o `scope/group_id`
  // (sql/15), se guarda sin esos campos y se avisa.
  if(res.error && /fijo/i.test(res.error.message||"")){
    delete intento.fijo; faltante="sql/08_puntos_fijos.sql"; res=await guardar(intento);
  }
  if(res.error && /(scope|group_id)/i.test(res.error.message||"")){
    delete intento.scope; delete intento.group_id; faltante="sql/15_categorias_puntos.sql"; res=await guardar(intento);
  }
  if(res.error && /fijo/i.test(res.error.message||"") && "fijo" in intento){
    delete intento.fijo; faltante="sql/08_puntos_fijos.sql"; res=await guardar(intento);
  }
  if(!res.error && faltante){
    showToast("Punto guardado. Para completar la función falta aplicar "+faltante+".");
  }
  if(res.error){
    console.error("point-form: guardar",res.error);
    notifyError($("#point-error"),describeError(res.error,"puntos del mapa")); return;
  }
  const nuevoId=id || (res.data && res.data[0] ? res.data[0].id : null);
  cerrarFormPunto();
  await cargarPuntosMapa();
  // Flujo "Marcar actividad en el mapa": al guardar el punto JW se reabre la
  // actividad con ese punto seleccionado.
  if(!id && state.puntoParaActividad && nuevoId){
    state.puntoParaActividad=false;
    await cargarPuntosJW();
    await reabrirActividadPendiente(nuevoId);
    return;
  }
  showToast(id?"Punto actualizado.":
    tipo==="personal"?"Punto personal creado.":
    (scope==="global"?"Punto global creado.":"Punto del grupo creado."));
});
$("#point-delete")?.addEventListener("click",async()=>{
  const id=$("#point-id").value; if(!id) return;
  if(!confirm("¿Eliminar este punto del mapa?")) return;
  const {error}=await supabase.from("map_points").delete().eq("id",id);
  if(error){ console.error("point delete",error); notifyError($("#point-error"),describeError(error,"puntos del mapa")); return; }
  cerrarFormPunto();
  await cargarPuntosMapa();
  showToast("Punto eliminado.");
});

// ==================== PANTALLA COMPLETA ====================
// Se retiró el botón lateral; la vista de mapa ya ocupa la pantalla completa
// de la app. Se conserva el helper de resize si el navegador entra en
// fullscreen por otro medio.
["fullscreenchange","webkitfullscreenchange"].forEach(ev=>document.addEventListener(ev,()=>{
  setTimeout(()=>state.map?.resize(),120);
}));

// ==================== GPS DEL DISPOSITIVO (informativo) ====================
// Pide permiso al entrar: punto azul con tu posición y badge "GPS ACTIVO"
// en el mapa. Si no se concede: "UBICACIÓN NO DISPONIBLE".
let gpsPos=null, gpsWatchId=null, gpsEstado="pendiente", gpsMarker=null, gpsIntentado=false;
function setGpsEstado(e){
  gpsEstado=e;
  const dot=$("#gps-dot"), txt=$("#gps-text"), badge=$("#gps-badge");
  if(!dot||!txt||!badge)return;
  badge.classList.remove("hidden");
  dot.className="w-2 h-2 rounded-full "+(e==="activo"?"bg-primary animate-pulse":e==="nodisponible"?"bg-error":"bg-surface-variant");
  txt.textContent=e==="activo"?"GPS activo":e==="nodisponible"?"Ubicación no disponible":"Buscando ubicación…";
}
function activarGps({centrar=false}={}){
  if(!navigator.geolocation){setGpsEstado("nodisponible");return;}
  if(gpsWatchId!=null){navigator.geolocation.clearWatch(gpsWatchId);gpsWatchId=null;}
  setGpsEstado("pendiente");
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      gpsPos={lat:pos.coords.latitude,lng:pos.coords.longitude};
      setGpsEstado("activo");
      ponerMarcadorUsuario();
      if(centrar)state.map?.flyTo({center:[gpsPos.lng,gpsPos.lat],zoom:Math.max(state.map.getZoom(),16),duration:600,offset:offsetPanel()});
      gpsWatchId=navigator.geolocation.watchPosition((p)=>{
        gpsPos={lat:p.coords.latitude,lng:p.coords.longitude};
        ponerMarcadorUsuario();
      },()=>{},{enableHighAccuracy:true,maximumAge:15000});
    },
    ()=>setGpsEstado("nodisponible"),
    {enableHighAccuracy:true,timeout:10000,maximumAge:30000}
  );
}
function ponerMarcadorUsuario(){
  if(!state.mapListo||!state.map||!gpsPos)return;
  if(!gpsMarker){
    const el=document.createElement("div");
    el.className="user-dot";
    gpsMarker=new maplibregl.Marker({element:el}).setLngLat([gpsPos.lng,gpsPos.lat]).addTo(state.map);
  } else gpsMarker.setLngLat([gpsPos.lng,gpsPos.lat]);
}

// ==================== ACTIVIDADES (ADMIN / MANAGER) ====================
// El ADMIN puede elegir varios grupos: se crea una fila por grupo, unidas por
// series_id. El MANAGER solo trabaja con el evento de su grupo.
function gruposActividadSeleccionados(){
  return [...($("#activity-groups")?.selectedOptions||[])].map(o=>o.value).filter(Boolean);
}
function poblarGruposActividad(a){
  const block=$("#activity-groups-block");
  const sel=$("#activity-groups");
  if(!block || !sel) return;
  block.classList.toggle("hidden",!esAdminGeneral());
  if(!esAdminGeneral()) return;
  const grupos=(state.adminGroups||[]).filter(g=>g.active!==false);
  sel.innerHTML=grupos.map(g=>`<option value="${esc(g.id)}">Grupo ${esc(g.slug)} · ${esc(g.name)}</option>`).join("");
  let ids=[];
  if(a?.series_id){
    ids=state.activities.filter(x=>x.series_id===a.series_id).map(x=>x.group_id);
  }else if(a?.group_id){
    ids=[a.group_id];
  }else if(state.adminFiltroGrupo){
    ids=[state.adminFiltroGrupo];
  }else if(grupos[0]){
    ids=[grupos[0].id];
  }
  // Al editar, incluir también grupos inactivos que ya forman parte de la serie.
  const faltan=ids.filter(id=>id && !grupos.some(g=>g.id===id));
  faltan.forEach(id=>{
    const g=grupoPorId(id);
    if(g) sel.insertAdjacentHTML("beforeend",`<option value="${esc(g.id)}">Grupo ${esc(g.slug)} · ${esc(g.name)}${g.active===false?" (inactivo)":""}</option>`);
  });
  [...sel.options].forEach(o=>{ o.selected=ids.includes(o.value); });
  if(!sel.options.length) sel.innerHTML='<option value="">No hay grupos activos</option>';
}
async function openActivity(a=null){
  if(!esAdminGeneral() && !state.event){
    alert("No hay un evento publicado activo: crea o publica un evento antes de agregar actividades."); return;
  }
  state.actividadEditada=a||null;
  $("#activity-error").textContent=""; $("#activity-dialog-title").textContent=a?"Editar actividad":"Nueva actividad";
  $("#activity-id").value=a?.id||""; $("#activity-title").value=a?.title||""; $("#activity-description").value=a?.description||"";
  $("#activity-date").value=a?.activity_date||(esAdminGeneral()?todayStr():state.event?.start_date)||"";
  $("#activity-place").value=a?.place||"";
  $("#activity-start").value=timeFmt(a?.start_time); $("#activity-end").value=timeFmt(a?.end_time);
  $("#activity-assignees").value="";
  $("#activity-assignees-block")?.classList.toggle("hidden",esAdminGeneral());
  poblarGruposActividad(a);
  await cargarPuntosJW();
  const sel=$("#activity-point");
  if(sel){
    sel.innerHTML=`<option value="">Sin punto JW</option>`+
      state.jwPuntos.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    const seleccionado=a?.map_point_id && state.jwPuntos.some(p=>p.id===a.map_point_id)?a.map_point_id:"";
    sel.value=seleccionado;
  }
  const vacio=state.jwPuntos.length===0;
  $("#activity-jw-empty")?.classList.toggle("hidden",!vacio);
  $("#activity-jw-hint")?.classList.toggle("hidden",vacio);
  actualizarPreviewActividad();
  $("#activity-dialog").showModal();
}
function actualizarPreviewActividad(){
  const id=$("#activity-point")?.value||"";
  const p=state.jwPuntos.find(x=>x.id===id);
  const prev=$("#activity-point-preview");
  if(!prev) return;
  prev.textContent=p
    ? `${p.name}${p.address?" · "+p.address:""}${p.comuna?" · "+p.comuna:""} (${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)})`
    : "";
}
$("#activity-point")?.addEventListener("change",()=>{
  actualizarPreviewActividad();
  const p=state.jwPuntos.find(x=>x.id===$("#activity-point").value);
  if(p){
    const place=$("#activity-place");
    if(place && !place.value.trim()) place.value=p.name;
  }
});
$("#new-activity-btn").addEventListener("click",()=>openActivity());
$("#close-activity").addEventListener("click",()=>$("#activity-dialog").close());
// "Marcar actividad en el mapa": cierra la actividad, activa el modo punto con
// categoría JW y, al guardar el punto, reabre la actividad con el punto elegido.
$("#activity-mark-map")?.addEventListener("click",()=>{
  const titulo=$("#activity-title").value.trim();
  if(!titulo){ notifyError($("#activity-error"),"Escribe el título de la actividad antes de marcarla en el mapa."); return; }
  state.actividadPendiente={
    title:titulo,
    description:$("#activity-description").value,
    activity_date:$("#activity-date").value,
    start_time:$("#activity-start").value,
    end_time:$("#activity-end").value,
    place:$("#activity-place").value,
    assignees:$("#activity-assignees").value,
    groups:gruposActividadSeleccionados(),
    editId:$("#activity-id").value||""
  };
  state.puntoParaActividad=true;
  $("#activity-dialog").close();
  gotoView("mapa");
  showToast("Toca el mapa para ubicar el punto JW de la actividad.");
});
async function reabrirActividadPendiente(puntoId){
  const pend=state.actividadPendiente; if(!pend) return;
  state.actividadPendiente=null;
  const edit=pend.editId?state.activities.find(a=>a.id===pend.editId):null;
  await openActivity(edit);
  $("#activity-title").value=pend.title||"";
  $("#activity-description").value=pend.description||"";
  $("#activity-date").value=pend.activity_date||"";
  $("#activity-start").value=pend.start_time||"";
  $("#activity-end").value=pend.end_time||"";
  $("#activity-place").value=pend.place||"";
  $("#activity-assignees").value=pend.assignees||"";
  if(esAdminGeneral() && Array.isArray(pend.groups)){
    [...($("#activity-groups")?.options||[])].forEach(o=>{ o.selected=pend.groups.includes(o.value); });
  }
  await cargarPuntosJW();
  const sel=$("#activity-point");
  if(sel){
    sel.innerHTML=`<option value="">Sin punto JW</option>`+
      state.jwPuntos.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    sel.value=puntoId;
  }
  const p=state.jwPuntos.find(x=>x.id===puntoId);
  if(p && !$("#activity-place").value.trim()) $("#activity-place").value=p.name;
  actualizarPreviewActividad();
  showToast("Punto JW creado. Completa y guarda la actividad.");
}
$("#activity-form").addEventListener("submit",async e=>{
  e.preventDefault(); if(!esGestorDeGrupo())return;
  const id=$("#activity-id").value;
  const edit=state.actividadEditada;
  const date=$("#activity-date").value;
  const st=$("#activity-start").value, en=$("#activity-end").value;
  if(!date){notifyError($("#activity-error"),"La fecha es obligatoria.");return;}
  if(st&&en&&en<=st){notifyError($("#activity-error"),"La hora de término debe ser posterior a la hora de inicio.");return;}
  // El MANAGER solo agenda dentro del evento de su grupo.
  if(!esAdminGeneral()){
    if(!state.event){notifyError($("#activity-error"),"No hay un evento publicado activo.");return;}
    if(state.event.start_date && date<state.event.start_date){notifyError($("#activity-error"),`La fecha no puede ser anterior al inicio del evento (${state.event.start_date}).`);return;}
    if(state.event.end_date && date>state.event.end_date){notifyError($("#activity-error"),`La fecha no puede ser posterior al fin del evento (${state.event.end_date}).`);return;}
  }
  // Los asignados (solo MANAGER) se validan antes de guardar.
  let ids=[];
  if(!esAdminGeneral()){
    ids=$("#activity-assignees").value.split(",").map(x=>x.trim()).filter(Boolean);
    const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invalidos=ids.filter(u=>!UUID.test(u));
    if(invalidos.length){notifyError($("#activity-error"),`IDs de usuario inválidos (deben ser UUID): ${invalidos.join(", ")}`);return;}
  }
  const puntoId=$("#activity-point")?.value||"";
  const punto=puntoId?state.jwPuntos.find(p=>p.id===puntoId):null;
  const grupos=esAdminGeneral()?gruposActividadSeleccionados():[];
  if(esAdminGeneral() && !grupos.length){notifyError($("#activity-error"),"Selecciona al menos un grupo.");return;}
  if(esAdminGeneral() && grupos.length>1 && punto && punto.scope!=="global"){
    notifyError($("#activity-error"),"Para varios grupos el punto JW debe ser global. Crea el punto como global o elige uno por actividad.");
    return;
  }
  let lat=null, lng=null;
  if(punto){
    lat=Number(punto.latitude); lng=Number(punto.longitude);
  }else if(id && edit){
    lat=Number(edit.latitude); lng=Number(edit.longitude);
    if(!Number.isFinite(lat)) lat=null;
    if(!Number.isFinite(lng)) lng=null;
  }
  const base={title:$("#activity-title").value.trim(),description:$("#activity-description").value.trim()||null,
    activity_date:date,place:$("#activity-place").value.trim()||punto?.name||null,
    start_time:st||null,end_time:en||null,
    latitude:lat,longitude:lng,map_point_id:puntoId||null};
  if(!base.title){notifyError($("#activity-error"),"El título es obligatorio.");return;}

  if(esAdminGeneral()){
    // Una fila por grupo; series_id las mantiene unidas.
    const seriesId=edit?.series_id || (grupos.length>1 ? crypto.randomUUID() : null);
    const existentes=edit?.series_id
      ? state.activities.filter(x=>x.series_id===edit.series_id)
      : (edit?[edit]:[]);
    const eventos={};
    try{
      for(const gid of grupos) eventos[gid]=await asegurarEventoGrupo(gid,date);
    }catch(err){ notifyError($("#activity-error"),describeError(err,"el evento del grupo")); return; }
    for(const gid of grupos){
      const fila=existentes.find(x=>x.group_id===gid);
      const eventId=fila?.event_id || eventos[gid]?.id;
      const payload={...base,event_id:eventId,group_id:gid};
      if(seriesId) payload.series_id=seriesId;
      const res=fila
        ? await supabase.from("activities").update(payload).eq("id",fila.id)
        : await supabase.from("activities").insert({...payload,created_by:state.user.id});
      if(res.error){console.error("activity-form admin: guardar",res.error);notifyError($("#activity-error"),describeError(res.error,"activities"));return;}
    }
    // Quitar de la serie los grupos que se desmarcaron.
    const sobrantes=existentes.filter(x=>!grupos.includes(x.group_id));
    for(const fila of sobrantes){
      const {error}=await supabase.from("activities").delete().eq("id",fila.id);
      if(error){console.error("activity-form admin: limpiar serie",error);notifyError($("#activity-error"),describeError(error,"activities"));return;}
    }
    $("#activity-dialog").close();
    state.actividadEditada=null; state.actividadPendiente=null; state.puntoParaActividad=false;
    showToast(id?"Actividad actualizada.":"Actividad creada.");
    await cargarGruposAdmin(); await cargarActividadesAdmin();
    renderGruposAdmin(); renderActividadesAdmin();
    return;
  }

  const payload={...base,event_id:state.event.id,group_id:state.groupId};
  const guardarActividad=async p=>id
    ? await supabase.from("activities").update(p).eq("id",id).select("id")
    : await supabase.from("activities").insert({...p,created_by:state.user.id}).select("id");
  let result=await guardarActividad(payload);
  if(result.error && /map_point_id/i.test(result.error.message||"")){
    const {map_point_id,...resto}=payload;
    result=await guardarActividad(resto);
    if(!result.error) showToast("Actividad guardada. Para vincular el punto JW falta aplicar sql/16_jw_actividades.sql.");
  }
  if(result.error){console.error("activity-form: guardar",result.error);notifyError($("#activity-error"),describeError(result.error,"activities"));return;}
  let avisoAsignados="";
  if(ids.length){
    const activityId=id||result.data?.[0]?.id;
    const {data:existing,error:errRead}=await supabase.from("activity_assignments").select("user_id").eq("activity_id",activityId);
    if(errRead){console.warn("assignees: lectura previa",errRead);}
    const yaAsignados=new Set((existing||[]).map(x=>x.user_id));
    const nuevos=ids.filter(u=>!yaAsignados.has(u)).map(user_id=>({activity_id:activityId,user_id}));
    if(nuevos.length){
      const {error:errIns}=await supabase.from("activity_assignments").insert(nuevos);
      if(errIns){console.warn("assignees: inserción",errIns);avisoAsignados="Actividad guardada, pero los asignados fallaron: "+errIns.message;}
    }
  }
  $("#activity-dialog").close();
  state.actividadEditada=null; state.actividadPendiente=null; state.puntoParaActividad=false;
  showToast(id?"Actividad actualizada.":"Actividad creada.");
  await loadEventAndActivities();
  if(avisoAsignados) alert(avisoAsignados);
});
async function deleteActivity(id){
  const a=state.activities.find(x=>x.id===id);
  if(!a) return;
  const serie=esAdminGeneral() && a.series_id;
  if(!confirm(serie?"¿Eliminar esta actividad de TODOS los grupos de la serie?":"¿Eliminar esta actividad?")) return;
  const q=serie?supabase.from("activities").delete().eq("series_id",a.series_id)
              :supabase.from("activities").delete().eq("id",id);
  const {error}=await q;
  if(error){console.error("deleteActivity",error);alert(describeError(error,"activities"));}
  else{
    showToast("Actividad eliminada.");
    if(esAdminGeneral()){ await cargarActividadesAdmin(); renderActividadesAdmin(); }
    else await loadEventAndActivities();
  }
}

// ==================== MURO ====================
function openWallModal(){
  const m=$("#wall-modal");
  m.classList.remove("opacity-0","pointer-events-none"); m.setAttribute("aria-hidden","false");
  m.querySelector("form").classList.remove("translate-y-full");
  $("#wall-content").focus();
}
function closeWallModal(){
  const m=$("#wall-modal");
  m.classList.add("opacity-0","pointer-events-none"); m.setAttribute("aria-hidden","true");
  m.querySelector("form").classList.add("translate-y-full");
  notifyError($("#wall-error"),"");
}
$("#open-wall-modal").addEventListener("click",openWallModal);
$("#close-wall-modal").addEventListener("click",closeWallModal);
$("#wall-modal").addEventListener("click",e=>{ if(e.target===$("#wall-modal")) closeWallModal(); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&!$("#wall-modal").classList.contains("pointer-events-none")) closeWallModal(); });
// Hay dos juegos de pestañas (vista y modal): se sincronizan por categoría.
// Al elegir "Descárgate" el muro se pinta de naranja y el botón de la pestaña
// queda blanco con las letras naranjas (2026-11-25).
function pintarMuro(categoria){
  const muro=$("#view-muro");
  if(!muro) return;
  const vent=categoria==="vent";
  muro.classList.toggle("muro-vent",vent);
  $$(".wall-tab").forEach(x=>x.classList.toggle("vent-activo",vent&&x.dataset.category==="vent"));
}
$$(".wall-tab").forEach(b=>b.addEventListener("click",()=>{
  state.category=b.dataset.category;
  $$(".wall-tab").forEach(x=>x.classList.toggle("selected",x.dataset.category===state.category));
  pintarMuro(state.category);
  loadWall();
}));
pintarMuro(state.category);
$("#wall-content").addEventListener("input",()=>$("#wall-counter").textContent=`${$("#wall-content").value.length}/500`);
$("#wall-form").addEventListener("submit",async e=>{
  e.preventDefault();const content=$("#wall-content").value.trim();if(!content)return;
  const payload={user_id:state.user.id,category:state.category,content};
  if(state.groupId) payload.group_id=state.groupId;   // el trigger también lo rellena
  const {error}=await supabase.from("wall_posts").insert(payload);
  if(error){console.error("wall-form",error);notifyError($("#wall-error"),describeError(error,"el muro"));return;}
  $("#wall-content").value="";$("#wall-counter").textContent="0/500";
  closeWallModal(); showToast("Publicación compartida.");
  await loadWall();
});
async function loadWall(){
  const consulta=filtrarGrupo(supabase.from("wall_posts").select("id,category,content,created_at,user_id,profiles(username,full_name)").eq("category",state.category));
  const {data,error}=await consulta.order("created_at",{ascending:false}).limit(100);
  if(error){console.error("loadWall",error);$("#wall-posts").innerHTML=`<p class="error">${esc(describeError(error,"el muro"))}</p>`;return;}
  $("#wall-posts").innerHTML=data?.length?data.map(p=>{
    const name=p.profiles?.full_name||p.profiles?.username||"Participante";
    const when=new Date(p.created_at).toLocaleString("es-CL",{dateStyle:"short",timeStyle:"short"});
    return `<article class="wall-card">
      <header class="wall-head">
        <span class="wall-avatar">${esc(initials(name))}</span>
        <div class="min-w-0 flex-1"><strong>${esc(name)}</strong><span class="muted small">${esc(when)}</span></div>
        ${(esGestorDeGrupo()||p.user_id===state.user.id)?`<button class="icon-btn" data-wall-delete="${p.id}" type="button" title="Eliminar"><span class="material-symbols-outlined">delete</span></button>`:""}
      </header>
      <p>${esc(p.content)}</p>
    </article>`;}).join(""):'<div class="empty">Todavía no hay publicaciones en esta categoría.</div>';
  $("#wall-posts").querySelectorAll("[data-wall-delete]").forEach(b=>b.addEventListener("click",async()=>{if(confirm("¿Eliminar publicación?")){const {error}=await supabase.from("wall_posts").delete().eq("id",b.dataset.wallDelete);if(error){console.error("wall delete",error);alert(describeError(error,"el muro"));return;}loadWall();}}));
}

// ==================== EMERGENCIA ====================
async function loadEmergencyContacts(){
  const {data,error}=await supabase.from("emergency_contacts").select("*").order("is_general",{ascending:false});
  if(error){console.error("loadEmergencyContacts",error);$("#emergency-contacts").innerHTML=`<p class="error">${esc(describeError(error,"los contactos de emergencia"))}</p>`;return;}
  // Solo los generales y los propios: un ADMIN no debe ver los personales de otros.
  const lista=(data||[]).filter(c=>c.is_general || c.user_id===state.user?.id);
  state.contactos=lista;
  const admin=esAdminGeneral();
  $("#emergency-contacts").innerHTML=lista.length?lista.map(c=>`<article class="contact-card">
    <div class="contact-top">
      <span class="contact-avatar"><span class="material-symbols-outlined">person</span></span>
      <div class="min-w-0 flex-1"><strong>${esc(c.name)}</strong><p>${esc(c.description||"")}</p></div>
      ${admin&&c.is_general?`<div class="flex items-center gap-1">
        <button type="button" class="icon-btn" data-contacto-edit="${c.id}" title="Editar"><span class="material-symbols-outlined">edit</span></button>
        <button type="button" class="icon-btn" data-contacto-delete="${c.id}" title="Eliminar"><span class="material-symbols-outlined">delete</span></button>
      </div>`:""}
    </div>
    ${c.phone?`<a class="secondary contact-call" href="tel:${esc(c.phone)}" type="link"><span class="material-symbols-outlined">call</span> ${esc(c.phone)}</a>`:""}
  </article>`).join(""):'<div class="empty">No hay contactos registrados.</div>';
  $("#emergency-contacts").querySelectorAll("[data-contacto-edit]").forEach(b=>b.addEventListener("click",()=>abrirFormContacto(state.contactos.find(c=>c.id===b.dataset.contactoEdit))));
  $("#emergency-contacts").querySelectorAll("[data-contacto-delete]").forEach(b=>b.addEventListener("click",async()=>{
    if(!confirm("¿Eliminar este contacto de emergencia?")) return;
    const {error}=await supabase.from("emergency_contacts").delete().eq("id",b.dataset.contactoDelete);
    if(error){ showToast(describeError(error,"el contacto")); return; }
    showToast("Contacto eliminado."); await loadEmergencyContacts();
  }));
}
// El sitio externo envía X-Frame-Options: DENY, así que no puede ir en iframe: se abre en pestaña nueva.
$("#emergency-open-link")?.setAttribute("href",EMERGENCY_URL);
// SOS flotante: enlace directo al sistema externo (pestaña nueva, sin opener).
$("#sos-fab")?.setAttribute("href",EMERGENCY_URL);
// Estado de red REAL (navigator.onLine), no inventado.
function updateNetStatus(){
  const online=navigator.onLine;
  const status=$("#net-status");
  if(status) status.textContent=online?"Conectado":"Sin conexión";
  $("#net-dot")?.querySelectorAll("span").forEach(s=>{s.style.background=online?"#2e7d32":"#ba1a1a";});
}
window.addEventListener("online",()=>{updateNetStatus();showToast("Conexión restablecida.");});
window.addEventListener("offline",()=>{updateNetStatus();showToast("Sin conexión: los datos pueden estar desactualizados.");});
// El botón inferior de la vista abre el sistema externo de emergencia.
$("#sos-fab")?.setAttribute("href",EMERGENCY_URL);

updateNetStatus();
boot().catch(e=>{console.error("boot fatal:",e);showLogin();});
