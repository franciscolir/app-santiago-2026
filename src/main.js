import { supabase } from "./supabase.js";
import { EMERGENCY_URL } from "./config.js";
import "./pwa.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const state = { user:null, profile:null, event:null, activities:[], category:"positive", filter:"mine",
  map:null, mapListo:false, markers:null, markerById:new Map(), pendingFit:null, selectedId:null, toastTimer:null,
  mapPoints:[], pointMarkers:new Map(), pointMode:false, mensajeTipo:null };
const statusText = {pending:"Pendiente", in_progress:"En curso", completed:"Completada", cancelled:"Cancelada"};
const venueStatusText = {pending:"Programada", in_progress:"En curso", completed:"Finalizada", cancelled:"Cancelada"};
const viewLabels = {agenda:"Agenda", mapa:"Mapa", muro:"Muro", emergencia:"Emergencia"};
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

function showLogin(){ $("#login-screen").classList.remove("hidden"); $("#app").classList.add("hidden"); }
function showApp(){ $("#login-screen").classList.add("hidden"); $("#app").classList.remove("hidden"); if(!gpsIntentado){gpsIntentado=true;activarGps();} }
function isAdmin(){ return state.profile?.role === "admin"; }
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
  const {data,error}=await supabase.from("profiles").select("id,username,full_name,role,active").eq("id",state.user.id).single();
  if(error){
    console.error("loadProfile: error de Supabase",error);
    const e=new Error(error.message==="Failed to fetch"?"No se pudo conectar con Supabase.":(error.message||"No se pudo cargar tu perfil."));
    e.code=error.code; throw e;
  }
  if(!data?.active){ const e=new Error("Tu usuario está desactivado o no tiene un perfil válido."); e.inactive=true; throw e; }
  state.profile=data;
  const name=data.full_name || data.username || "";
  $("#user-label").textContent=name;
  $("#user-initials").textContent=initials(name);
  $("#admin-create-wrap").classList.toggle("hidden",!isAdmin());
  // Botón de alta de puntos en el mapa: solo para administradores (§9).
  $("#map-add-point")?.classList.toggle("hidden",!isAdmin());
  // Gestión de puntos (lista, renombrar, mostrar/ocultar, borrar): solo admin.
  $("#map-puntos-btn")?.classList.toggle("hidden",!isAdmin());
  if(state.mapListo) renderPuntosMapa();
}
async function usernameLogin(username,password){
  const {data,error}=await supabase.functions.invoke("login-username",{body:{username,password}});
  if(error || !data?.session){
    let msg=data?.error||"";
    if(!msg && error?.context && typeof error.context.clone==="function"){
      try{ const body=await error.context.clone().json(); msg=body?.error||body?.message||""; }catch(_){ /* body no era JSON */ }
    }
    throw new Error(msg || error?.message || "No fue posible iniciar sesión.");
  }
  const {data:sessionData,error:setError}=await supabase.auth.setSession({
    access_token:data.session.access_token, refresh_token:data.session.refresh_token
  });
  if(setError) throw setError;
  state.user=sessionData.user;
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
  try{ await usernameLogin($("#username").value.trim(),$("#password").value); await loadProfile(); $("#password").value=""; showApp(); await refreshAll(); }
  catch(err){ console.error("login:",err); notifyError($("#login-error"),err.message || "Usuario o contraseña incorrectos."); }
  finally{ if(btn) btn.disabled=false; }
});
$("#logout-btn").addEventListener("click",async()=>{
  await supabase.auth.signOut();
  state.user=null;
  state.profile=null;
  $("#password").value="";
  showLogin();
});
supabase.auth.onAuthStateChange((_event,session)=>{
  if(!session){
    state.user=null;
    state.profile=null;
    showLogin();
  }
});

async function refreshAll(){
  // Cada sección carga de forma independiente: un fallo en una no debe impedir las demás.
  const results=await Promise.allSettled([loadEventAndActivities(),loadWall(),loadEmergencyContacts()]);
  results.forEach((r,i)=>{ if(r.status==="rejected") console.error("refreshAll sección "+i+":",r.reason); });
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
  const {data:events,error}=await supabase.from("events").select("*").eq("status","published").order("start_date",{ascending:false});
  if(error){ console.error("loadEventAndActivities: events",error); showAgendaError(describeError(error,"events")); throw error; }
  // Elegir el evento vigente: el que contiene hoy; si no, el próximo más cercano; si no, el más reciente.
  const today=todayStr();
  state.event=(events||[]).find(e=>e.start_date<=today && today<=e.end_date)
    || (events||[]).filter(e=>e.start_date>today).sort((a,b)=>a.start_date.localeCompare(b.start_date))[0]
    || (events||[])[0] || null;
  if(!state.event){
    $("#event-info").innerHTML='<div class="empty">Todavía no hay un evento publicado.</div>';
    $("#agenda-list").innerHTML="";
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
  const base=()=>{let x=supabase.from("activities").select("*,activity_assignments(user_id,status)").eq("event_id",state.event.id).order("activity_date").order("start_time");return isAdmin()?x:x.neq("status","cancelled");};
  let {data,error:actError}=await base();
  if(actError && actError.code==="PGRST204" && /status/i.test(actError.message||"")){
    console.warn('La columna "status" no existe en activities; se omite el filtro de canceladas. Compara el esquema con sql/01_diagnostico.sql.');
    state.statusColumnMissing=true;
    ({data,error:actError}=await supabase.from("activities").select("*,activity_assignments(user_id,status)").eq("event_id",state.event.id).order("activity_date").order("start_time"));
  }
  if(actError){ console.error("loadEventAndActivities: activities",actError); showAgendaError(describeError(actError,"activities")); throw actError; }
  state.activities=data||[];
  renderAgenda(); renderMap();
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
const hasMine = (a)=>(a.activity_assignments||[]).some(x=>x.user_id===state.user?.id);
function syncFilterControls(){
  $$(".filter-tab").forEach(x=>{
    const active=x.dataset.filter===state.filter;
    x.classList.toggle("active",active);
    x.setAttribute("aria-pressed",String(active));
  });
}
function setFilter(f){
  state.filter=f; state.filterTouched=true;
  syncFilterControls();
  renderAgenda();
}
$$(".filter-tab").forEach(b=>b.addEventListener("click",()=>setFilter(b.dataset.filter)));

function renderAgenda(){
  const root=$("#agenda-list"); if(!root) return;
  const mine=state.activities.filter(hasMine);
  $("#count-mine").textContent=mine.length;
  $("#count-all").textContent=state.activities.length;
  // Sin actividades asignadas y el usuario aún no eligió pestaña: mostrar "Todas" para no dejar la agenda vacía.
  if(!state.filterTouched && state.filter==="mine" && !mine.length && state.activities.length) state.filter="all";
  syncFilterControls();
  root.setAttribute("aria-busy","false");
  const list=state.filter==="mine"?mine:state.activities;
  const today=todayStr();

  // Contenedores de la nueva estructura (diseño agenda.html).
  const past=$("#agenda-past-days");
  const activeList=$("#agenda-active-list");
  const upcoming=$("#agenda-upcoming-days");
  const useNewLayout=!!(past&&activeList&&upcoming);

  if(!list.length){
    if(useNewLayout){ activeList.innerHTML='<div class="empty">No hay actividades registradas.</div>'; }
    else { root.innerHTML=state.filter==="mine"
      ? '<div class="empty">No tienes actividades asignadas todavía.<br><button class="secondary mt-2" id="goto-all" type="button">Ver todas las actividades</button></div>'
      : '<div class="empty">No hay actividades registradas.</div>'; }
    $("#goto-all")?.addEventListener("click",()=>setFilter("all"));
    return;
  }

  // Agrupar por fecha.
  const byDate=new Map();
  for(const a of list){ if(!byDate.has(a.activity_date))byDate.set(a.activity_date,[]); byDate.get(a.activity_date).push(a); }
  const fechas=[...byDate.keys()].sort();

  if(useNewLayout){
    past.innerHTML=""; activeList.innerHTML=""; upcoming.innerHTML="";
    for(const date of fechas){
      const items=byDate.get(date);
      const dt=new Date(date+"T12:00:00");
      const isToday=date===today;
      const mineThatDay=items.filter(hasMine);
      const done=mineThatDay.filter(a=>(a.activity_assignments||[]).find(x=>x.user_id===state.user.id)?.status==="completed").length;
      const pct=mineThatDay.length?Math.round(done/mineThatDay.length*100):0;
      const itemsHtml=items.map(activityCard).join("");

      if(isToday){
        // Día activo: tarjeta completa con nodo integrado.
        activeList.innerHTML=itemsHtml;
        $("#active-day-num").textContent=dt.getDate();
        $("#active-day-month").textContent=dt.toLocaleDateString("es-CL",{month:"short"}).toUpperCase();
        $("#active-day-label").textContent=esc(cap(dateFmt.format(dt)));
        $("#active-day-count").textContent=items.length+" Actividad"+(items.length===1?"":"es");
        $("#active-day-progress").textContent=done+"/"+mineThatDay.length+" completadas";
        $("#active-day-progress-bar").style.width=pct+"%";
        $("#agenda-active-day")?.classList.remove("hidden");
      } else {
        const dayNode=dt<today?past:upcoming;
        const dayId="day-"+date.replace(/-/g,"");
        const isPast=dt<today;
        const icon=isPast?"done":"expand_more";
        const cls=isPast?"border-[#CEE8F2] bg-surface-container":"border-[#b1e0ff] bg-surface-container-lowest";
        const titleColor=isPast?"#33647e":"#006492";
        const badgeColor=isPast?"#dfe3e4":"#c9e6ff";
        const badgeTextColor=isPast?"#34647f":"#004262";
        dayNode.innerHTML+=`
          <div class="relative flex items-start gap-3.5 group min-w-0">
            <div class="w-13 h-13 min-w-[52px] min-h-[52px] rounded-full flex flex-col items-center justify-center shadow-sm border-2 ${cls} transition-all flex-shrink-0" style="background-color: ${isPast?"#eaeff0":"#ffffff"};">
              <span class="text-[20px] font-black leading-none" style="color: ${titleColor};">${dt.getDate()}</span>
              <span class="text-[9px] font-bold uppercase tracking-wider leading-none mt-0.5" style="color: ${badgeTextColor};">OCT</span>
            </div>
            <div class="flex-1 min-w-0 bg-surface-container-lowest rounded-lg p-3 shadow-sm border transition-all duration-200" style="border-color: ${isPast?"#CEE8F2":"#CEE8F2"};">
              <button class="w-full min-w-0 flex items-center justify-between gap-2 text-left focus:outline-none" type="button" data-day="${dayId}">
                <div class="min-w-0 pr-2">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-headline-sm text-[16px] font-bold uppercase tracking-tight" style="color: ${titleColor};">${esc(cap(dateFmt.format(dt)))}</span>
                    <span class="px-2 py-0.5 rounded-full font-label-sm text-[11px] font-bold flex items-center gap-1" style="background-color: ${badgeColor}; color: ${badgeTextColor};">
                      <span class="material-symbols-outlined text-[14px]">${isPast?"done":"calendar_today"}</span>
                      ${items.length} actividad${items.length===1?"":"es"}
                    </span>
                  </div>
                  <p class="font-body-sm text-[12px] truncate mt-0.5" style="color: #3f4850;">${esc(items[0].description||"")}</p>
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
    // Botones de toggle de días pasados/futuros (sin onclick inline: main.js
    // es un módulo y sus funciones no son globales en el ámbito de la página).
    const enlazarDias=(raiz)=>raiz.querySelectorAll("button[data-day]").forEach(b=>{
      const id=b.getAttribute("data-day"); if(id) b.addEventListener("click",()=>toggleDay(id));
    });
    enlazarDias(past);
    enlazarDias(upcoming);
  } else {
    // Fallback: lista simple.
    root.innerHTML=[...byDate.entries()].map(([date,items])=>{
      const dt=new Date(date+"T12:00:00");
      const isToday=date===today;
      const mineThatDay=items.filter(hasMine);
      const done=mineThatDay.filter(a=>(a.activity_assignments||[]).find(x=>x.user_id===state.user.id)?.status==="completed").length;
      const pct=mineThatDay.length?Math.round(done/mineThatDay.length*100):0;
      const progress=mineThatDay.length
        ? `<div class="day-progress"><div class="day-track"><div class="day-bar" style="width:${pct}%"></div></div><span>${done}/${mineThatDay.length} completadas</span></div>`
        : `<span class="day-count">${items.length} actividad${items.length===1?"":"es"}</span>`;
      return `<section class="agenda-day">
        <div class="day-heading">
          <span class="day-title${isToday?" is-today":""}">${isToday?"HOY":esc(cap(dateFmt.format(dt)))}</span>
          ${progress}
        </div>
        ${items.map(activityCard).join("")}
      </section>`;
    }).join("");
    root.querySelectorAll("[data-status]").forEach(b=>b.addEventListener("click",()=>updateMyStatus(b.dataset.id,b.dataset.status)));
    root.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openActivity(state.activities.find(a=>a.id===b.dataset.edit))));
    root.querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",()=>deleteActivity(b.dataset.delete)));
    root.querySelectorAll("[data-reopen]").forEach(b=>b.addEventListener("click",()=>reopenActivity(b.dataset.reopen)));
    root.querySelectorAll("[data-cancel]").forEach(b=>b.addEventListener("click",()=>changeActivityStatus(b.dataset.cancel,"cancelled")));
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
    ${assignment?`<div class="activity-actions">${["pending","in_progress","completed"].map(s=>
      `<button class="secondary${myStatus===s?" on":""}" data-id="${a.id}" data-status="${s}" type="button">${statusText[s]}</button>`).join("")}</div>`:""}
    ${isAdmin()?`<div class="activity-actions">
      <button class="secondary" data-edit="${a.id}" type="button">Editar</button>
      ${a.status!=="cancelled"?`<button class="secondary warn" data-cancel="${a.id}" type="button">Cancelar</button>`:""}
      <button class="secondary danger" data-delete="${a.id}" type="button">Eliminar</button>
      ${a.status==="cancelled"?`<button class="secondary" data-reopen="${a.id}" type="button">Reabrir</button>`:""}
    </div>`:""}
  </article>`;
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
    state.map.on("click",(e)=>{
      // Modo edición de puntos (mapas.txt §9): el admin ubica el punto con un clic.
      if(!state.pointMode) return;
      desactivarModoPunto();
      abrirFormPunto(null,e.lngLat.lat,e.lngLat.lng);
    });
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
    a.description?esc(a.description):"",
  ].filter(Boolean);
  const acciones=[{texto:"Ver actividad",icono:"calendar_today",fn:()=>gotoView("agenda")}];
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
$("#map-zoom-in").addEventListener("click",()=>state.map?.zoomIn());
$("#map-zoom-out").addEventListener("click",()=>state.map?.zoomOut());
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
$("#map-satellite").addEventListener("click",alternarSatelite);
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
  const map=state.map, btn=$("#map-satellite");
  if(!map||!state.mapListo)return;
  if(sateliteOn){
    if(map.getLayer("satelite-layer"))map.removeLayer("satelite-layer");
    if(map.getSource("satelite"))map.removeSource("satelite");
    sateliteOn=false;
    btn.classList.remove("bg-primary","text-on-primary");
    btn.setAttribute("aria-pressed","false");
    return;
  }
  const capas=map.getStyle().layers||[];
  const simbolo=capas.find(l=>l.type==="symbol");
  map.addSource("satelite",{type:"raster",
    tiles:["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize:256,maxzoom:19,attribution:"Esri, Maxar, Earthstar Geographics"});
  map.addLayer({id:"satelite-layer",type:"raster",source:"satelite",paint:{}}, simbolo?simbolo.id:undefined);
  sateliteOn=true;
  btn.classList.add("bg-primary","text-on-primary");
  btn.setAttribute("aria-pressed","true");
}

// ==================== VISTA SATÉLITE POR DEFECTO (mapas.txt §3.1) ====================
// La capa satélite se inserta en el primer "load" para que el mapa abra en
// satélite; el botón #map-satellite sigue alternando hacia la vista cartográfica.
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
  "salud":      {color:"#e03131", label:"Hospitales públicos, SAPU y SAR"},
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
const RADIO_PUNTO_MIN=3.5;     // radio (px) del punto entre 10,5 y 11
const RADIO_PUNTO_MEDIO=5;     // radio (px) del punto entre 11 y 11,8
const RADIO_PUNTO_MAX=7;       // radio (px) del punto entre 11,8 y 12,5
const TAM_PUNTO_MIN=7;         // diámetro (px) del punto propio más pequeño
const TAM_PUNTO_MEDIO=10;      // diámetro (px) del punto propio intermedio
const TAM_PUNTO_MAX=14;        // diámetro (px) del punto propio más grande
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
  salud:"health_and_safety",seguridad:"warning",bomberos:"bomberos",servicios:"casa",
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
  map.addSource("transporte-estaciones",{type:"geojson",data:est});
  map.addSource("transporte-lineas",{type:"geojson",data:lineas});

  // Colores referenciales por línea (no son los oficiales del Metro).
  const COLOR_LINEA={L1:"#e30613",L2:"#0f7fd4",L3:"#8a9b16",L4:"#f08a00",L4A:"#f08a00",L5:"#5ec4e8",L6:"#8b5fbf",MTN:"#00a19a",MTR:"#0079c2"};
  // Iconos SVG del Metro: al acercar aparece el icono y DEBAJO el nombre de
  // la estación (sin necesidad de presionarla).
  const idIconoMetro=await asegurarIcono("metro","#e30613");
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
  // en el zoom 10,5; desde 12,5 toma el icono.
  insertarBajoSimbolos({id:"metro-estaciones",type:"circle",source:"transporte-estaciones",
    filter:["==",["get","tipo"],"metro"],minzoom:ZOOM_PUNTO_MIN,maxzoom:ZOOM_ICONO,
    paint:{"circle-color":"#ffffff",
            "circle-radius":["step",["zoom"],
              RADIO_PUNTO_MIN,ZOOM_PUNTO_MEDIO,RADIO_PUNTO_MEDIO,ZOOM_PUNTO_MAX,RADIO_PUNTO_MAX-1],
            "circle-stroke-color":"#181c1d","circle-stroke-width":1.5}});
  insertarBajoSimbolos({id:"metro-estaciones-icono",type:"symbol",source:"transporte-estaciones",
    filter:["==",["get","tipo"],"metro"],minzoom:ZOOM_ICONO,
    layout:{"icon-image":idIconoMetro,
            "icon-size":["interpolate",["linear"],["zoom"],ZOOM_ICONO,ICONO_MIN,ZOOM_ICONO_MAX,ICONO_MAX],
            "icon-allow-overlap":true,"icon-ignore-placement":true}});
  insertarBajoSimbolos({id:"metro-combo",type:"circle",source:"transporte-estaciones",
    filter:["all",["==",["get","tipo"],"metro"],["==",["get","combinaciones"],true]],
    minzoom:ZOOM_PUNTO_MIN,maxzoom:ZOOM_ICONO,
    paint:{"circle-color":"#ffd54f",
            "circle-radius":["step",["zoom"],
              RADIO_PUNTO_MIN+1,ZOOM_PUNTO_MEDIO,RADIO_PUNTO_MEDIO+1,ZOOM_PUNTO_MAX,RADIO_PUNTO_MAX+1],
            "circle-stroke-color":"#181c1d","circle-stroke-width":1.5}});
  insertarBajoSimbolos({id:"metro-combo-icono",type:"symbol",source:"transporte-estaciones",
    filter:["all",["==",["get","tipo"],"metro"],["==",["get","combinaciones"],true]],minzoom:ZOOM_ICONO,
    layout:{"icon-image":idIconoCombo,
            "icon-size":["interpolate",["linear"],["zoom"],ZOOM_ICONO,ICONO_MIN,ZOOM_ICONO_MAX,ICONO_MAX],
            "icon-allow-overlap":true,"icon-ignore-placement":true}});
  insertarBajoSimbolos({id:"metrotren-estaciones",type:"circle",source:"transporte-estaciones",
    filter:["==",["get","tipo"],"metrotren"],minzoom:ZOOM_PUNTO_MIN,
    paint:{"circle-color":"#ffffff",
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
  aplicarCapas();
}

// Carga UNA capa de lugares: su propio archivo, con clustering nativo de
// MapLibre (§11: la RM tiene miles de puntos; se agrupan en vez de pintar
// 10.000 círculos). Al hacer clic en un grupo se hace zoom a su contenido.
// Los puntos sueltos usan los iconos SVG de /icons (§5: identidad visual).
async function cargarLugares(capa){
  const map=state.map;
  if(!map||lugaresCargados.has(capa)) return;
  const cfg=CAPAS_LUGARES[capa]; if(!cfg) return;
  const res=await fetch(`./data/lugares/${capa}.geojson`);
  if(!res.ok) throw new Error(`HTTP ${res.status} al cargar ${capa}`);
  const geo=await res.json();
  if(!state.map||state.map.getSource(`lugares-${capa}`)) return;

  // Icono SVG de esta capa (se descarga y rasteriza una sola vez por sesión).
  const claveIcono=ICONO_LUGAR[capa]||"casa";
  const idIcono=await asegurarIcono(claveIcono,cfg.color);

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
    paint:{"circle-color":cfg.color,
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
    paint:{"circle-color":cfg.color,
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
    {id:"salud",nombre:"Hospitales públicos, SAPU y SAR",capaLugares:"salud"},
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
    state.pointMarkers.forEach(m=>m.getElement().classList.toggle("hidden",!on));
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
  root.innerHTML=CAPAS_DEF.map(g=>`
    <div class="mt-3 first:mt-0">
      <p class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide mb-1.5">${g.grupo}</p>
      <div class="space-y-1">
        ${g.items.map(it=>{
          const on=capasEstado[it.id];
          return `<button type="button" data-capa="${it.id}" aria-pressed="${on}"
            class="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-full bg-surface-container-low active:scale-[0.99] transition-all ${it.pendiente?"opacity-50":""}">
            <span class="text-body-md text-on-surface text-left">${it.nombre}${it.pendiente?' <span class="text-label-sm text-on-surface-variant">· pronto</span>':""}</span>
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
  const it=CAPAS_DEF.flatMap(g=>g.items).find(x=>x.id===fila.dataset.capa);
  if(!it) return;
  if(it.pendiente){ showToast("Capa disponible en una próxima etapa."); return; }
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

// --- carga desde Supabase ---------------------------------------------------
async function cargarPuntosMapa(){
  if(!state.user) return;
  const {data,error}=await supabase.from("map_points").select("*").order("created_at",{ascending:true});
  if(error){
    // La tabla puede no existir todavía (falta ejecutar sql/06_map_points.sql).
    console.warn("cargarPuntosMapa:",error.message);
    state.mapPoints=[]; renderPuntosMapa(); return;
  }
  state.mapPoints=data||[];
  renderPuntosMapa();
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
    const fijo=el.dataset.fijo==="1";
    el.style.setProperty("--icono-tam",tamIcono.toFixed(1)+"px");
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
    el.style.setProperty("--punto-tam",tamPunto.toFixed(1)+"px");
  });
  // Pines de actividad: NO desaparecen (hay que poder seleccionarlos), solo
  // se reducen a un punto de color (12 → 24 px con la rampa nueva).
  const tam=Math.max(12,Math.min(24,Math.round((tamPunto/TAM_PUNTO_MAX)*24)));
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
  const visibles=state.mapPoints.filter(p=>p.visible||isAdmin());  // el admin ve también los ocultos
  visibles.forEach(p=>{
    const el=document.createElement("div");
    el.className="map-point map-point-icono";
    const claveIcono=ICONO_PUNTO[p.icon]||ICONO_PUNTO[p.category]||ICONO_PUNTO.general;
    const defIcono=ICONOS_MAPA[claveIcono]||ICONOS_MAPA.place;
    // El SVG se muestra directo como fondo CSS (es vectorial: se ve nítido en
    // cualquier zoom y no necesita rasterizarse).
    el.style.backgroundImage=`url('./icons/${defIcono.svg}')`;
    // Color del punto cuando el mapa se aleja y el icono se transforma en punto.
    el.style.setProperty("--punto-color",COLOR_PUNTO[p.category]||"#006492");
    // "Vista fija": el icono se muestra siempre, a cualquier zoom.
    el.dataset.fijo=p.fijo?"1":"0";
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
    const tipoTag=p.tipo==="personal"?"<span class=\"muted\" style=\"font-size:10px\">· personal</span>":"<span class=\"muted\" style=\"font-size:10px\">· general</span>";
    const popup=new maplibregl.Popup({offset:22,closeButton:true}).setHTML(
      `<strong>${esc(p.name)}</strong>${tipoTag}`+
      (p.description?`<br>${esc(p.description)}`:"")+
      (p.comuna?`<br><span class="muted">${esc(p.comuna)}</span>`:"")+
      `<br><span class="muted">${esc(CATEGORIA_PUNTO[p.category]||p.category)}</span>`);
    const m=new maplibregl.Marker({element:el,anchor:"bottom"})
      .setLngLat([p.longitude,p.latitude]).setPopup(popup).addTo(map);
    if(isAdmin()){
      // Sin contorno ni color especial: los puntos de vista fija se ven IGUAL
      // que los demás (solo cambia que no se achican al alejar).
      el.addEventListener("click",()=>abrirFormPunto(p));
    }
    state.pointMarkers.set(p.id,m);
  });
  actualizarPuntosSegunZoom();   // icono ⇄ punto según el zoom actual
  aplicarCapas();   // la capa "Puntos personalizados" puede estar apagada
  // Respeta el interruptor del panel para los marcadores de punto
  // (`display` en línea: no depende de las utilidades de Tailwind).
  state.pointMarkers.forEach(m=>m.getElement().style.display=capasEstado.puntos?"":"none");
}

// --- modo edición: clic en el mapa para ubicar el punto --------------------
// Cualquier usuario autenticado puede agregar puntos personales (§9).
// Solo el admin puede crear puntos GENERALES (visibles para todos).
function activarModoPunto(){
  if(!state.user){ showToast("Inicia sesión para agregar puntos."); return; }
  state.pointMode=true;
  $("#map-point-mode")?.classList.remove("hidden");
  showToast(isAdmin()?"Toca el mapa para ubicar un punto (general o personal).":"Toca el mapa para ubicar un punto personal.");
}
function desactivarModoPunto(){
  state.pointMode=false;
  $("#map-point-mode")?.classList.add("hidden");
}
$("#map-add-point")?.addEventListener("click",activarModoPunto);

// --- gestión de puntos (solo admin) -----------------------------------------
// El admin abre una lista de los puntos POR TIPO (general / personal) y puede,
// en cada fila: cambiar el nombre, marcar/desmarcar si se muestra en el mapa y
// borrar el punto. Los cambios se aplican con el botón "Guardar".
const PUNTOS_ELIMINADOS=new Set();   // ids marcados para borrar (se aplican al guardar)
const PUNTOS_EDITADOS=new Map();    // id → {name, visible} (solo lo que cambió)
function abrirGestionPuntos(){
  if(!isAdmin()){ showToast("Solo el administrador puede gestionar los puntos."); return; }
  PUNTOS_ELIMINADOS.clear();
  PUNTOS_EDITADOS.clear();
  renderGestionPuntos();
  $("#puntos-sheet")?.classList.remove("hidden");
}
function cerrarGestionPuntos(){
  $("#puntos-sheet")?.classList.add("hidden");
}
$("#map-puntos-btn")?.addEventListener("click",abrirGestionPuntos);
$("#puntos-close")?.addEventListener("click",cerrarGestionPuntos);
$("#puntos-backdrop")?.addEventListener("click",cerrarGestionPuntos);

function renderGestionPuntos(){
  const root=$("#puntos-lista"); if(!root) return;
  const grupos=[
    {id:"general",titulo:"Puntos generales (visibles para todos)"},
    {id:"personal",titulo:"Puntos personales"},
  ];
  const punto=(p)=>{
    const cat=CATEGORIA_PUNTO[p.category]||p.category;
    const icono=ICONOS_MAPA[ICONO_PUNTO[p.icon]||ICONO_PUNTO[p.category]]||ICONOS_MAPA.place;
    return `<div class="flex items-center gap-2 bg-surface-container-low rounded-xl p-2" data-punto="${p.id}">
      <img src="./icons/${icono.svg}" alt="" width="28" height="28" class="w-7 h-7 flex-shrink-0" loading="lazy">
      <div class="min-w-0 flex-1">
        <input type="text" maxlength="120" value="${esc(p.name)}" data-punto-nombre="${p.id}"
               class="w-full bg-surface-container-lowest rounded-lg px-2 py-1.5 text-sm font-semibold text-on-surface focus:outline-none" aria-label="Nombre del punto">
        <span class="block text-[11px] text-on-surface-variant truncate">${esc(cat)}${p.comuna?" · "+esc(p.comuna):""}</span>
      </div>
      <label class="flex items-center gap-1 flex-shrink-0 px-1" title="Mostrar en el mapa">
        <input type="checkbox" data-punto-visible="${p.id}" ${p.visible?"checked":""} class="w-5 h-5 accent-primary">
      </label>
      <button type="button" data-punto-borrar="${p.id}" aria-label="Borrar punto"
              class="w-9 h-9 rounded-full bg-error-container text-on-error-container flex items-center justify-center flex-shrink-0 active:scale-95 transition-all">
        <span class="material-symbols-outlined text-[18px]">delete</span>
      </button>
    </div>`;
  };
  root.innerHTML=grupos.map(g=>{
    const items=state.mapPoints.filter(p=>(p.tipo||"personal")===g.id);
    return `<section>
      <p class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide mb-1.5">${g.titulo} (${items.length})</p>
      ${items.length?items.map(punto).join(""):'<p class="text-sm text-on-surface-variant px-1">Sin puntos.</p>'}
    </section>`;
  }).join("");
  // Marcar un punto para borrar (se aplica al guardar).
  root.querySelectorAll("[data-punto-borrar]").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.puntoBorrar;
    if(!confirm("¿Borrar este punto del mapa?")) return;
    PUNTOS_ELIMINADOS.add(id);
    PUNTOS_EDITADOS.delete(id);
    b.closest("[data-punto]")?.remove();
  }));
  // Cambiar si se muestra en el mapa: se aplica al guardar.
  root.querySelectorAll("[data-punto-visible]").forEach(c=>c.addEventListener("change",()=>{
    const id=c.dataset.puntoVisible;
    const p=state.mapPoints.find(x=>x.id===id); if(!p) return;
    PUNTOS_EDITADOS.set(id,{name:p.name,visible:c.checked});
  }));
  // Renombrar: se aplica al guardar.
  root.querySelectorAll("[data-punto-nombre]").forEach(i=>i.addEventListener("input",()=>{
    const id=i.dataset.puntoNombre;
    const p=state.mapPoints.find(x=>x.id===id); if(!p) return;
    const visible=PUNTOS_EDITADOS.get(id)?.visible??p.visible;
    PUNTOS_EDITADOS.set(id,{name:i.value,visible});
  }));
}
$("#puntos-guardar")?.addEventListener("click",async()=>{
  if(!isAdmin()) return;
  const btn=$("#puntos-guardar");
  btn.disabled=true;
  try{
    // 1) Borrados (el admin puede moderar cualquier punto: política RLS de
    //    sql/09_admin_gestiona_puntos.sql).
    for(const id of PUNTOS_ELIMINADOS){
      const {error}=await supabase.from("map_points").delete().eq("id",id);
      if(error){ console.error("puntos: borrar",error); showToast("No se pudo borrar un punto: "+describeError(error,"los puntos del mapa")); return; }
    }
    // 2) Cambios de nombre y visibilidad (solo los que realmente cambiaron).
    for(const [id,cambio] of PUNTOS_EDITADOS){
      if(PUNTOS_ELIMINADOS.has(id)) continue;
      const {error}=await supabase.from("map_points")
        .update({name:(cambio.name||"").trim()||"Punto",visible:!!cambio.visible}).eq("id",id);
      if(error){ console.error("puntos: guardar",error); showToast("No se pudo guardar un punto: "+describeError(error,"los puntos del mapa")); return; }
    }
    cerrarGestionPuntos();
    await cargarPuntosMapa();
    showToast("Puntos guardados.");
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

function abrirFormPunto(p=null,lat=null,lng=null){
  if(!state.user) return;
  $("#point-dialog-title").textContent=p?"Editar punto":"Nuevo punto";
  $("#point-id").value=p?.id||"";
  $("#point-name").value=p?.name||"";
  $("#point-description").value=p?.description||"";
  $("#point-category").value=p?.category||"general";
  seleccionarIcono(ICONOS_MAPA[p?.icon]?p.icon:"place");
  $("#point-lat").value=p?p.latitude:(lat??"");
  $("#point-lng").value=p?p.longitude:(lng??"");
  $("#point-visible").checked=p?!!p.visible:true;
  $("#point-fijo").checked=p?!!p.fijo:false;
  // Tipo de punto: admin puede crear general o personal; usuarios solo personal.
  const tipoSel=$("#point-tipo"); const tipoLab=$("#point-tipo-label");
  if(isAdmin()){
    tipoLab?.classList.remove("hidden");
    tipoSel.value=p?.tipo||"general";
  } else {
    tipoLab?.classList.add("hidden");
    tipoSel.value="personal";
  }
  $("#point-delete")?.classList.toggle("hidden",!p||!isAdmin());
  notifyError($("#point-error"),"");
  $("#point-dialog")?.classList.remove("hidden");
}
function cerrarFormPunto(){
  $("#point-dialog")?.classList.add("hidden");
  notifyError($("#point-error"),"");
}
$("#point-close")?.addEventListener("click",cerrarFormPunto);
$("#point-backdrop")?.addEventListener("click",cerrarFormPunto);

// Al cambiar la categoría se propone el icono equivalente (§9: el usuario
// elige el icono, pero partir de la categoría evita combinaciones absurdas).
const ICONO_POR_CATEGORIA={general:"place",seguridad:"warning",salud:"health_and_safety",
  educacion:"school",transporte:"directions_bus",comercio:"store",areas_verdes:"park",otro:"place"};
$("#point-category")?.addEventListener("change",e=>{
  const valor=ICONO_POR_CATEGORIA[e.target.value];
  if(valor) seleccionarIcono(valor);
});

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
  const tipo=isAdmin()?$("#point-tipo").value:"personal";
  const payload={name,description:$("#point-description").value.trim(),
    category:$("#point-category").value,icon:$("#point-icon").value,
    latitude:lat,longitude:lng,visible:$("#point-visible").checked,tipo,
    fijo:$("#point-fijo").checked};
  const guardar=async p=>id
    ? await supabase.from("map_points").update(p).eq("id",id).select("id")
    : await supabase.from("map_points").insert({...p,created_by:state.user.id}).select("id");
  let res=await guardar(payload);
  // Si la columna `fijo` todavía no existe en Supabase (falta aplicar
  // sql/08_puntos_fijos.sql), se guarda el punto sin ella y se avisa.
  if(res.error&&/fijo/i.test(res.error.message||"")){
    const {fijo,...resto}=payload;
    res=await guardar(resto);
    if(!res.error) showToast("Punto guardado. Para usar la vista falta aplicar sql/08_puntos_fijos.sql.");
  }
  if(res.error){
    console.error("point-form: guardar",res.error);
    notifyError($("#point-error"),describeError(res.error,"puntos del mapa")); return;
  }
  cerrarFormPunto();
  await cargarPuntosMapa();
  showToast(id?"Punto actualizado.":"Punto creado y visible para todos.");
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

// ==================== PANTALLA COMPLETA (mapas.txt §3.1) ====================
const marcoMapa=()=>$("#view-mapa .mapa-frame");
if(!document.fullscreenEnabled && !document.webkitFullscreenEnabled) $("#map-fullscreen")?.classList.add("hidden");
$("#map-fullscreen").addEventListener("click",()=>{
  const el=marcoMapa(); if(!el) return;
  const activo=document.fullscreenElement||document.webkitFullscreenElement;
  if(activo){ document.exitFullscreen?.()||document.webkitExitFullscreen?.(); return; }
  let p=null;
  if(el.requestFullscreen) p=el.requestFullscreen();
  else if(el.webkitRequestFullscreen) p=el.webkitRequestFullscreen();
  if(p&&typeof p.catch==="function") p.catch(()=>showToast("Pantalla completa no disponible en este navegador."));
});
["fullscreenchange","webkitfullscreenchange"].forEach(ev=>document.addEventListener(ev,()=>{
  const activo=!!(document.fullscreenElement||document.webkitFullscreenElement);
  const btn=$("#map-fullscreen");
  btn?.setAttribute("aria-pressed",String(activo));
  const ico=btn?.querySelector(".material-symbols-outlined");
  if(ico) ico.textContent=activo?"fullscreen_exit":"fullscreen";
  setTimeout(()=>state.map?.resize(),120);   // MapLibre debe re-medir el contenedor
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

// ==================== ACTIVIDADES (admin) ====================
function openActivity(a=null){
  if(!state.event){ alert("No hay un evento publicado activo: crea o publica un evento antes de agregar actividades."); return; }
  $("#activity-error").textContent=""; $("#activity-dialog-title").textContent=a?"Editar actividad":"Nueva actividad";
  $("#activity-id").value=a?.id||""; $("#activity-title").value=a?.title||""; $("#activity-description").value=a?.description||"";
  $("#activity-date").value=a?.activity_date||state.event?.start_date||""; $("#activity-place").value=a?.place||"";
  $("#activity-start").value=timeFmt(a?.start_time); $("#activity-end").value=timeFmt(a?.end_time);
  $("#activity-lat").value=a?(a.latitude ?? a.lat ?? ""):""; $("#activity-lng").value=a?(a.longitude ?? a.long ?? a.lng ?? ""):""; $("#activity-assignees").value="";
  $("#activity-dialog").showModal();
}
$("#new-activity-btn").addEventListener("click",()=>openActivity());
$("#close-activity").addEventListener("click",()=>$("#activity-dialog").close());
$("#activity-form").addEventListener("submit",async e=>{
  e.preventDefault(); if(!isAdmin()||!state.event)return;
  const id=$("#activity-id").value;
  // Validaciones antes de tocar Supabase (AGENT.md §3/§8: fechas dentro del evento, hora coherente).
  const date=$("#activity-date").value;
  if(state.event?.start_date && date<state.event.start_date){notifyError($("#activity-error"),`La fecha no puede ser anterior al inicio del evento (${state.event.start_date}).`);return;}
  if(state.event?.end_date && date>state.event.end_date){notifyError($("#activity-error"),`La fecha no puede ser posterior al fin del evento (${state.event.end_date}).`);return;}
  const st=$("#activity-start").value, en=$("#activity-end").value;
  if(st&&en&&en<=st){notifyError($("#activity-error"),"La hora de término debe ser posterior a la hora de inicio.");return;}
  // Los asignados se validan ANTES de guardar: un UUID malo no debe dejar la actividad a medias.
  const ids=$("#activity-assignees").value.split(",").map(x=>x.trim()).filter(Boolean);
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalidos=ids.filter(u=>!UUID.test(u));
  if(invalidos.length){notifyError($("#activity-error"),`IDs de usuario inválidos (deben ser UUID): ${invalidos.join(", ")}`);return;}
  const payload={event_id:state.event.id,title:$("#activity-title").value.trim(),description:$("#activity-description").value.trim()||null,
    activity_date:$("#activity-date").value,place:$("#activity-place").value.trim()||null,
    start_time:$("#activity-start").value||null,end_time:$("#activity-end").value||null,
    latitude:$("#activity-lat").value===""?null:Number($("#activity-lat").value),
    longitude:$("#activity-lng").value===""?null:Number($("#activity-lng").value)};
  let result=id
    ? await supabase.from("activities").update(payload).eq("id",id).select("id")
    : await supabase.from("activities").insert({...payload,created_by:state.user.id}).select("id");
  if(result.error){console.error("activity-form: guardar",result.error);notifyError($("#activity-error"),describeError(result.error,"activities"));return;}
  // Asignados: se insertan solo los IDs que aún no estén asignados (evita duplicados por la restricción única).
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
  showToast(id?"Actividad actualizada.":"Actividad creada.");
  await loadEventAndActivities();
  if(avisoAsignados) alert(avisoAsignados);
});
async function deleteActivity(id){if(!confirm("¿Eliminar esta actividad?"))return;const {error}=await supabase.from("activities").delete().eq("id",id);if(error){console.error("deleteActivity",error);alert(describeError(error,"activities"));}else{showToast("Actividad eliminada.");await loadEventAndActivities();}}

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
  const {error}=await supabase.from("wall_posts").insert({user_id:state.user.id,category:state.category,content});
  if(error){console.error("wall-form",error);notifyError($("#wall-error"),describeError(error,"el muro"));return;}
  $("#wall-content").value="";$("#wall-counter").textContent="0/500";
  closeWallModal(); showToast("Publicación compartida.");
  await loadWall();
});
async function loadWall(){
  const {data,error}=await supabase.from("wall_posts").select("id,category,content,created_at,user_id,profiles(username,full_name)").eq("category",state.category).order("created_at",{ascending:false}).limit(100);
  if(error){console.error("loadWall",error);$("#wall-posts").innerHTML=`<p class="error">${esc(describeError(error,"el muro"))}</p>`;return;}
  $("#wall-posts").innerHTML=data?.length?data.map(p=>{
    const name=p.profiles?.full_name||p.profiles?.username||"Participante";
    const when=new Date(p.created_at).toLocaleString("es-CL",{dateStyle:"short",timeStyle:"short"});
    return `<article class="wall-card">
      <header class="wall-head">
        <span class="wall-avatar">${esc(initials(name))}</span>
        <div class="min-w-0 flex-1"><strong>${esc(name)}</strong><span class="muted small">${esc(when)}</span></div>
        ${(isAdmin()||p.user_id===state.user.id)?`<button class="icon-btn" data-wall-delete="${p.id}" type="button" title="Eliminar"><span class="material-symbols-outlined">delete</span></button>`:""}
      </header>
      <p>${esc(p.content)}</p>
    </article>`;}).join(""):'<div class="empty">Todavía no hay publicaciones en esta categoría.</div>';
  $("#wall-posts").querySelectorAll("[data-wall-delete]").forEach(b=>b.addEventListener("click",async()=>{if(confirm("¿Eliminar publicación?")){const {error}=await supabase.from("wall_posts").delete().eq("id",b.dataset.wallDelete);if(error){console.error("wall delete",error);alert(describeError(error,"el muro"));return;}loadWall();}}));
}

// ==================== EMERGENCIA ====================
async function loadEmergencyContacts(){
  const {data,error}=await supabase.from("emergency_contacts").select("*").order("is_general",{ascending:false});
  if(error){console.error("loadEmergencyContacts",error);$("#emergency-contacts").innerHTML=`<p class="error">${esc(describeError(error,"los contactos de emergencia"))}</p>`;return;}
  $("#emergency-contacts").innerHTML=data?.length?data.map(c=>`<article class="contact-card">
    <div class="contact-top">
      <span class="contact-avatar"><span class="material-symbols-outlined">person</span></span>
      <div class="min-w-0 flex-1"><strong>${esc(c.name)}</strong><p>${esc(c.description||"")}</p></div>
    </div>
    ${c.phone?`<a class="secondary contact-call" href="tel:${esc(c.phone)}" type="link"><span class="material-symbols-outlined">call</span> ${esc(c.phone)}</a>`:""}
  </article>`).join(""):'<div class="empty">No hay contactos registrados.</div>';
}
// El sitio externo envía X-Frame-Options: DENY, así que no puede ir en iframe: se abre en pestaña nueva.
$("#emergency-open-link")?.setAttribute("href",EMERGENCY_URL);
// Estado de red REAL (navigator.onLine), no inventado.
function updateNetStatus(){
  const online=navigator.onLine;
  $("#net-status").textContent=online?"Conectado":"Sin conexión";
  $("#net-dot")?.querySelectorAll("span").forEach(s=>{s.style.background=online?"#2e7d32":"#ba1a1a";});
}
window.addEventListener("online",()=>{updateNetStatus();showToast("Conexión restablecida.");});
window.addEventListener("offline",()=>{updateNetStatus();showToast("Sin conexión: los datos pueden estar desactualizados.");});
// Sin backend de alertas: se informa con honestidad en lugar de fingir que se envió.
$("#sosButton").addEventListener("click",()=>showToast("SOS: aún no hay alertas automáticas. Llama o mensajea a los contactos de emergencia."));

updateNetStatus();
boot().catch(e=>{console.error("boot fatal:",e);showLogin();});
