import { supabase } from "./supabase.js";
import { EMERGENCY_URL } from "./config.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const state = { user:null, profile:null, event:null, activities:[], category:"positive", filter:"mine",
  map:null, markers:null, markerById:new Map(), pendingFit:null, selectedId:null, toastTimer:null };
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
function showApp(){ $("#login-screen").classList.add("hidden"); $("#app").classList.remove("hidden"); }
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
    return `Sin permisos para leer ${ctx}: falta un GRANT en la base de datos de Supabase (${m}).`;
  if(error?.code==="PGRST204")
    return `El esquema real no tiene una columna que la app usa (${m}). Revisa sql/01_permisos.sql parte 1c.`;
  if(error?.code==="PGRST301"||/JWT|token/i.test(m)) return `Sesión expirada o inválida vuelve a ingresar. (${ctx})`;
  if(m==="Failed to fetch") return `No se pudo conectar con Supabase (red o CORS). (${ctx})`;
  return `Error al cargar ${ctx}: ${m||error?.code||"desconocido"}`;
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
  try{ await usernameLogin($("#username").value.trim(),$("#password").value); await loadProfile(); showApp(); await refreshAll(); }
  catch(err){ console.error("login:",err); notifyError($("#login-error"),err.message || "Usuario o contraseña incorrectos."); }
  finally{btn.disabled=false;}
});
$("#logout-btn").addEventListener("click",async()=>{await supabase.auth.signOut();state.user=null;state.profile=null;showLogin();});
supabase.auth.onAuthStateChange((_event,session)=>{if(!session){state.user=null;state.profile=null;}});

async function refreshAll(){
  // Cada sección carga de forma independiente: un fallo en una no debe impedir las demás.
  const results=await Promise.allSettled([loadEventAndActivities(),loadWall(),loadEmergencyContacts()]);
  results.forEach((r,i)=>{ if(r.status==="rejected") console.error("refreshAll sección "+i+":",r.reason); });
}

// ==================== NAVEGACIÓN ====================
function gotoView(name){
  $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.view===name));
  $$(".view").forEach(v=>{
    const on=v.id===`view-${name}`;
    v.classList.toggle("active",on);
    v.classList.toggle("hidden",!on);
  });
  $("#header-view-label").textContent=viewLabels[name]||name;
  if(name==="mapa"&&state.map)setTimeout(()=>{state.map.invalidateSize();applyPendingFit();},100);
}
$$(".nav-item").forEach(b=>b.addEventListener("click",()=>gotoView(b.dataset.view)));

// ==================== AGENDA ====================
function showAgendaError(msg){
  $("#event-info").innerHTML="";
  $("#agenda-list").innerHTML=`<div class="error">⚠ ${esc(msg)}</div>`;
}
async function loadEventAndActivities(){
  const {data:events,error}=await supabase.from("events").select("*").eq("status","published").order("start_date",{ascending:false});
  if(error){ console.error("loadEventAndActivities: events",error); showAgendaError(describeError(error,"events")); throw error; }
  // Elegir el evento vigente: el que contiene hoy; si no, el próximo más cercano; si no, el más reciente.
  const today=todayStr();
  state.event=(events||[]).find(e=>e.start_date<=today && today<=e.end_date)
    || (events||[]).filter(e=>e.start_date>today).sort((a,b)=>a.start_date.localeCompare(b.start_date))[0]
    || (events||[])[0] || null;
  if(!state.event){$("#event-info").innerHTML='<div class="empty">Todavía no hay un evento publicado.</div>';$("#agenda-list").innerHTML="";state.activities=[];renderMap();return;}
  $("#event-info").innerHTML=`<h2>${esc(state.event.name)}</h2><p>${esc(state.event.description||"")}</p>`;
  $("#event-range").textContent=`${dayFmt.format(new Date(state.event.start_date+"T12:00:00"))} – ${dayFmt.format(new Date(state.event.end_date+"T12:00:00"))}, ${state.event.start_date.slice(0,4)}`;
  renderEventBadge();
  // El admin debe ver también las canceladas (para poder reabrirlas); el usuario normal no.
  // Si la columna "status" no existe en la BD real, no se rompe toda la agenda:
  // se reintenta sin ese filtro y se avisa por consola (AGENT.md §5: no asumir columnas).
  const base=()=>{let x=supabase.from("activities").select("*,activity_assignments(user_id,status)").eq("event_id",state.event.id).order("activity_date").order("start_time");return isAdmin()?x:x.neq("status","cancelled");};
  let {data,error:actError}=await base();
  if(actError && actError.code==="PGRST204" && /status/i.test(actError.message||"")){
    console.warn('La columna "status" no existe en activities; se omite el filtro de canceladas. Ejecuta sql/01_permisos.sql parte 1c para confirmar.');
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
function setFilter(f){
  state.filter=f; state.filterTouched=true;
  $$(".filter-tab").forEach(x=>x.classList.toggle("active",x.dataset.filter===f));
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
  $$(".filter-tab").forEach(x=>x.classList.toggle("active",x.dataset.filter===state.filter));
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
  if(state.statusColumnMissing){alert("La columna status no existe en activities: no se puede cambiar el estado hasta ejecutar el SQL de migración (sql/01_permisos.sql).");return;}
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

// ==================== MAPA ====================
const coords=(a)=>({lat:Number(a.latitude ?? a.lat),lng:Number(a.longitude ?? a.long ?? a.lng)});
const conCoords=(a)=>{const c=coords(a);return Number.isFinite(c.lat)&&Number.isFinite(c.lng)&&c.lat!==0&&c.lng!==0;};
function renderMap(){
  renderMapList();
  if(!window.L)return;
  if(!state.map){
    state.map=L.map("map").setView([-33.4489,-70.6693],11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap"}).addTo(state.map);
    state.markers=L.featureGroup().addTo(state.map);
  }
  state.markers.clearLayers(); state.markerById.clear();
  state.activities.filter(conCoords).forEach(a=>{
    const c=coords(a);
    const m=L.marker([c.lat,c.lng]).addTo(state.markers).bindPopup(`<strong>${esc(a.title)}</strong><br>${esc(a.place||"")}`);
    m.on("click",()=>selectVenue(a,false));
    state.markerById.set(a.id,m);
  });
  if(state.selectedId && !state.activities.some(a=>a.id===state.selectedId)) resetVenue();
  // fitBounds solo cuando la vista está visible; si no, se aplaza hasta abrir la pestaña Mapa.
  state.pendingFit=state.markers.getLayers().length?state.markers.getBounds().pad(.18):null;
  applyPendingFit();
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
  if(m&&state.map&&pan){ state.map.setView(m.getLatLng(),Math.max(state.map.getZoom(),14)); m.openPopup(); }
}
$("#venue-nav").addEventListener("click",e=>{
  const b=e.currentTarget; if(b.disabled) return;
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${b.dataset.lat},${b.dataset.lng}`,"_blank","noopener");
});
$("#venue-go-agenda").addEventListener("click",()=>gotoView("agenda"));
$("#map-zoom-in").addEventListener("click",()=>state.map?.zoomIn());
$("#map-zoom-out").addEventListener("click",()=>state.map?.zoomOut());
$("#map-recenter").addEventListener("click",()=>{ if(state.map&&state.markers?.getLayers().length) state.map.fitBounds(state.markers.getBounds().pad(.18)); });
$("#map-search").addEventListener("input",renderMapList);
function applyPendingFit(){
  if(!state.map||!state.pendingFit)return;
  if(!$("#view-mapa").classList.contains("active"))return; // vista oculta: Leaflet no calcula bien el tamaño
  state.map.fitBounds(state.pendingFit); state.pendingFit=null;
  setTimeout(()=>state.map.invalidateSize(),100);
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
