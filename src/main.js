import { supabase } from "./supabase.js";
import { EMERGENCY_URL } from "./config.js";
import "./pwa.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const state = { user:null, profile:null, event:null, activities:[], category:"positive", filter:"mine",
  map:null, mapListo:false, markers:null, markerById:new Map(), pendingFit:null, selectedId:null, toastTimer:null };
const statusText = {pending:"Pendiente", in_progress:"En curso", completed:"Completada", cancelled:"Cancelada"};
const venueStatusText = {pending:"Programada", in_progress:"En curso", completed:"Finalizada", cancelled:"Cancelada"};
const viewLabels = {agenda:"Agenda", mapa:"Mapa", muro:"Muro", emergencia:"Emergencia"};
const dateFmt = new Intl.DateTimeFormat("es-CL",{weekday:"long",day:"numeric",month:"long"});
const dayFmt = new Intl.DateTimeFormat("es-CL",{day:"numeric",month:"short"});
const timeFmt = (v) => v ? v.slice(0,5) : "";
const esc = (v="") => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const cap = (s) => s ? s[0].toUpperCase()+s.slice(1) : s;
const todayStr = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const initials = (name="") => name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase() || "?";

function showLogin(){ $("#login-screen").classList.remove("hidden"); $("#app").classList.add("hidden"); }
function showApp(){ $("#login-screen").classList.add("hidden"); $("#app").classList.remove("hidden"); if(!gpsIntentado){gpsIntentado=true;activarGps();} }
function isAdmin(){ return state.profile?.role === "admin"; }
function notifyError(el,msg){ el.textContent=msg || ""; }

// Toast honesto: informa sin fingir que algo se guardó.
function showToast(msg){
  const t=$("#toast-msg"); if(!t) return;
  $("#toast-text").textContent=msg;
  t.classList.remove("opacity-0","pointer-events-none");
  clearTimeout(state.toastTimer);
  state.toastTimer=setTimeout(()=>t.classList.add("opacity-0","pointer-events-none"),3000);
}

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
  e.preventDefault(); const btn=e.submitter; btn.disabled=true; notifyError($("#login-error"),"");
  try{ await usernameLogin($("#username").value.trim(),$("#password").value); await loadProfile(); $("#password").value=""; showApp(); await refreshAll(); }
  catch(err){ console.error("login:",err); notifyError($("#login-error"),err.message || "Usuario o contraseña incorrectos."); }
  finally{btn.disabled=false;}
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
  if(name==="mapa")setTimeout(()=>{
    if(!state.map) renderMap();          // mapa perezoso: se crea al abrir la pestaña
    else state.map.resize();
    applyPendingFit();
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
  if(!list.length){
    root.innerHTML=state.filter==="mine"
      ? '<div class="empty">No tienes actividades asignadas todavía.<br><button class="secondary mt-2" id="goto-all" type="button">Ver todas las actividades</button></div>'
      : '<div class="empty">No hay actividades registradas.</div>';
    $("#goto-all")?.addEventListener("click",()=>setFilter("all"));
    return;
  }
  const byDate=new Map();
  for(const a of list){ if(!byDate.has(a.activity_date))byDate.set(a.activity_date,[]); byDate.get(a.activity_date).push(a); }
  const today=todayStr();
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
    state.map.on("load",()=>{
      state.mapListo=true;
      activarSateliteInicial();   // §3.1: la vista satélite es la predeterminada
      cargarComunas();            // §3.2: límites comunales de la RM (async)
      renderMarkers();
      ponerMarcadorUsuario();
      applyPendingFit();
    });
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
function renderMapList(){
  const root=$("#map-activity-list"); if(!root) return;
  const q=($("#map-search")?.value||"").trim().toLowerCase();
  const items=state.activities.filter(a=>!q
    || a.title.toLowerCase().includes(q)
    || (a.place||"").toLowerCase().includes(q)
    || (a.description||"").toLowerCase().includes(q));
  root.innerHTML=items.length
    ? items.map(a=>`<button class="map-item${state.selectedId===a.id?" on":""}" data-select="${a.id}" type="button">
        <span class="map-item-title">${esc(a.title)}</span>
        <span class="map-item-meta">${esc(dayFmt.format(new Date(a.activity_date+"T12:00:00")))} · ${esc(a.place||"Lugar por confirmar")}</span>
      </button>`).join("")
    : '<div class="empty">Sin resultados.</div>';
  root.querySelectorAll("[data-select]").forEach(b=>b.addEventListener("click",()=>selectVenue(state.activities.find(a=>a.id===b.dataset.select))));
}
function resetVenue(){
  state.selectedId=null;
  $("#venue-status").textContent="Selecciona una actividad";
  $("#venue-title").textContent="—";
  $("#venue-time").textContent="—";
  $("#venue-address").textContent="—";
  $("#venue-detail").classList.add("hidden");
  $("#venue-nav").disabled=true;
  renderMapList();
}
function selectVenue(a,pan=true){
  if(!a) return;
  state.selectedId=a.id;
  $("#venue-status").textContent=venueStatusText[a.status]||"Programada";
  $("#venue-title").textContent=a.title;
  $("#venue-time").textContent=`${dayFmt.format(new Date(a.activity_date+"T12:00:00"))} · ${timeFmt(a.start_time)||"Hora por definir"}${a.end_time?" – "+timeFmt(a.end_time):""}`;
  $("#venue-address").textContent=a.place||"Lugar por confirmar";
  $("#venue-detail").classList.remove("hidden");
  const nav=$("#venue-nav");
  if(conCoords(a)){ const c=coords(a); nav.disabled=false; nav.dataset.lat=c.lat; nav.dataset.lng=c.lng; }
  else { nav.disabled=true; delete nav.dataset.lat; delete nav.dataset.lng; }
  renderMapList();
  const m=state.markerById.get(a.id);
  if(m&&state.map&&pan){
    state.map.flyTo({center:m.getLngLat(),zoom:Math.max(state.map.getZoom(),14),duration:600,offset:offsetPanel()});
    if(!m.getPopup()?.isOpen?.()) m.togglePopup();
  }
}
// Desplazamiento vertical para que el punto "centrado" caiga en el área
// visible del mapa (entre la barra de búsqueda y el panel inferior).
function offsetPanel(){
  const cont=$("#map")?.getBoundingClientRect();
  const panel=$("#view-mapa section.absolute.bottom-0")?.getBoundingClientRect();
  const buscador=$("#map-search")?.parentElement?.getBoundingClientRect();
  if(!cont)return [0,0];
  const arriba=buscador?buscador.bottom-cont.top:60;
  const abajo=panel?panel.top-cont.top:cont.height;
  const yMedio=(arriba+abajo)/2;
  return [0,Math.round(yMedio-cont.height/2)];
}
$("#venue-nav").addEventListener("click",e=>{
  const b=e.currentTarget; if(b.disabled) return;
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${b.dataset.lat},${b.dataset.lng}`,"_blank","noopener");
});
$("#venue-go-agenda").addEventListener("click",()=>gotoView("agenda"));
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
// Padding de encuadre: deja libres la barra de búsqueda (arriba) y el panel
// inferior de sede/lista, para que ningún pín quede tapado.
function paddingMapa(){
  const cont=$("#view-mapa .relative.w-full")||$("#map")?.parentElement;
  const panel=$("#view-mapa section.absolute.bottom-0");
  const buscador=$("#map-search")?.parentElement;
  const top=(buscador?buscador.getBoundingClientRect().height+24:70);
  const bottom=(panel?panel.getBoundingClientRect().height+24:40);
  return {top:Math.round(top),bottom:Math.round(bottom),left:24,right:24,_cont:cont};
}
// Atribución visible (mapas.txt §3.1): el control de atribución de MapLibre se
// dibuja abajo a la derecha y el panel inferior de sede/lista lo tapaba. Se
// publica la altura real del panel como variable CSS y el CSS la usa como `bottom`.
(function atribucionSobrePanel(){
  const panel=$("#view-mapa section.absolute.bottom-0"), cont=$("#map");
  if(!panel||!cont||!window.ResizeObserver) return;
  const aplicar=()=>{
    const p=panel.getBoundingClientRect(), c=cont.getBoundingClientRect();
    // `bottom` del CSS se mide desde el borde inferior del mapa: altura del panel
    // = (borde inferior del mapa) − (borde superior del panel) + aire.
    cont.style.setProperty("--mapa-panel-h",Math.max(0,Math.round(c.bottom-p.top)+10)+"px");
  };
  new ResizeObserver(aplicar).observe(panel);
  aplicar();
})();

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
let comunasOn=false;            // estado real de la capa (§10: [ON] Límites comunales)
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

    comunasOn=true;
    const btn=$("#map-comunas");
    btn?.classList.add("bg-primary","text-on-primary");
    btn?.setAttribute("aria-pressed","true");
  }catch(err){
    console.warn("cargarComunas: no se pudieron cargar los límites comunales",err);
  }
}

// Interruptor de la capa (§3.2/§10): alterna sin recargar el mapa.
$("#map-comunas").addEventListener("click",()=>{
  const map=state.map; if(!map||!state.mapListo) return;
  if(!map.getSource("comunas")){ showToast("Los límites comunales aún se están cargando…"); return; }
  comunasOn=!comunasOn;
  const vis=comunasOn?"visible":"none";
  CAPAS_COMUNAS.forEach(id=>{ if(map.getLayer(id)) map.setLayoutProperty(id,"visibility",vis); });
  if(!comunasOn) comunaPopup?.remove();
  const btn=$("#map-comunas");
  btn.classList.toggle("bg-primary",comunasOn);
  btn.classList.toggle("text-on-primary",comunasOn);
  btn.setAttribute("aria-pressed",String(comunasOn));
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
$$(".wall-tab").forEach(b=>b.addEventListener("click",()=>{
  state.category=b.dataset.category;
  $$(".wall-tab").forEach(x=>x.classList.toggle("selected",x.dataset.category===state.category));
  loadWall();
}));
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
