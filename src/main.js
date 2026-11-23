import { supabase } from "./supabase.js";
import { EMERGENCY_URL } from "./config.js";

const $ = (s) => document.querySelector(s);
const state = { user:null, profile:null, event:null, activities:[], category:"positive", map:null, markers:null };
const statusText = {pending:"Pendiente", in_progress:"En curso", completed:"Completada", cancelled:"Cancelada"};
const dateFmt = new Intl.DateTimeFormat("es-CL",{weekday:"long",day:"numeric",month:"long"});
const timeFmt = (v) => v ? v.slice(0,5) : "";
const esc = (v="") => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function showLogin(){ $("#login-screen").classList.remove("hidden"); $("#app").classList.add("hidden"); }
function showApp(){ $("#login-screen").classList.add("hidden"); $("#app").classList.remove("hidden"); }
function isAdmin(){ return state.profile?.role === "admin"; }
function notifyError(el,msg){ el.textContent=msg || ""; }

async function loadProfile(){
  const {data,error}=await supabase.from("profiles").select("id,username,full_name,role,active").eq("id",state.user.id).single();
  if(error || !data?.active) throw new Error("Tu usuario está desactivado o no tiene un perfil válido.");
  state.profile=data; $("#user-label").textContent=data.full_name || data.username;
  $("#admin-create-wrap").classList.toggle("hidden",!isAdmin());
}
async function usernameLogin(username,password){
  const {data,error}=await supabase.functions.invoke("login-username",{body:{username,password}});
  if(error || !data?.session) throw new Error(data?.error || "No fue posible iniciar sesión.");
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
  try { await loadProfile(); showApp(); await refreshAll(); }
  catch(e){ console.error(e); await supabase.auth.signOut(); showLogin(); }
}
$("#login-form").addEventListener("submit",async e=>{
  e.preventDefault(); const btn=e.submitter; btn.disabled=true; notifyError($("#login-error"),"");
  try{ await usernameLogin($("#username").value.trim(),$("#password").value); await loadProfile(); showApp(); await refreshAll(); }
  catch(err){ notifyError($("#login-error"),err.message || "Usuario o contraseña incorrectos."); }
  finally{btn.disabled=false;}
});
$("#logout-btn").addEventListener("click",async()=>{await supabase.auth.signOut();state.user=null;state.profile=null;showLogin();});
supabase.auth.onAuthStateChange((_event,session)=>{if(!session){state.user=null;state.profile=null;}});

async function refreshAll(){ await loadEventAndActivities(); await loadWall(); await loadEmergencyContacts(); }
async function loadEventAndActivities(){
  const {data:events,error}=await supabase.from("events").select("*").eq("status","published").order("start_date",{ascending:false}).limit(1);
  if(error) throw error;
  state.event=events?.[0] || null;
  if(!state.event){$("#event-info").innerHTML='<div class="empty">Todavía no hay un evento publicado.</div>';$("#agenda-list").innerHTML="";state.activities=[];renderMap();return;}
  $("#event-info").innerHTML=`<h2>${esc(state.event.name)}</h2><p>${esc(state.event.description||"")}</p>`;
  $("#event-range").textContent=`${state.event.start_date} – ${state.event.end_date}`;
  const {data,error:actError}=await supabase.from("activities").select("*,activity_assignments(user_id,status)").eq("event_id",state.event.id).neq("status","cancelled").order("activity_date").order("start_time");
  if(actError) throw actError;
  state.activities=data||[]; renderAgenda(); renderMap();
}
function renderAgenda(){
  const root=$("#agenda-list");
  if(!state.activities.length){root.innerHTML='<div class="empty">No hay actividades registradas.</div>';return;}
  const byDate=new Map();
  for(const a of state.activities){if(!byDate.has(a.activity_date))byDate.set(a.activity_date,[]);byDate.get(a.activity_date).push(a);}
  root.innerHTML=[...byDate.entries()].map(([date,items])=>`
    <section class="agenda-day"><div class="day-heading"><span>${esc(dateFmt.format(new Date(date+"T12:00:00")))}</span><small>${items.length} actividad${items.length===1?"":"es"}</small></div>
    ${items.map(activityCard).join("")}</section>`).join("");
  root.querySelectorAll("[data-status]").forEach(b=>b.addEventListener("click",()=>updateMyStatus(b.dataset.id,b.dataset.status)));
  root.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>openActivity(state.activities.find(a=>a.id===b.dataset.edit))));
  root.querySelectorAll("[data-delete]").forEach(b=>b.addEventListener("click",()=>deleteActivity(b.dataset.delete)));
}
function activityCard(a){
  const assignment=(a.activity_assignments||[]).find(x=>x.user_id===state.user.id);
  const myStatus=assignment?.status;
  const status=myStatus || a.status || "pending";
  return `<article class="activity-card"><div class="activity-top"><div><h3>${esc(a.title)}</h3><div class="activity-meta">${timeFmt(a.start_time)}${a.end_time?" – "+timeFmt(a.end_time):""}${a.place?" · "+esc(a.place):""}</div></div><span class="status ${status}">${statusText[status]||status}</span></div>
  ${a.description?`<p>${esc(a.description)}</p>`:""}
  ${assignment?`<div class="activity-actions"><button class="secondary" data-id="${a.id}" data-status="pending">Pendiente</button><button class="secondary" data-id="${a.id}" data-status="in_progress">En curso</button><button class="secondary" data-id="${a.id}" data-status="completed">Completada</button></div>`:""}
  ${isAdmin()?`<div class="activity-actions"><button class="secondary" data-edit="${a.id}">Editar</button><button class="secondary" data-delete="${a.id}">Eliminar</button></div>`:""}
  </article>`;
}
async function updateMyStatus(activityId,status){
  const {error}=await supabase.from("activity_assignments").update({status}).eq("activity_id",activityId).eq("user_id",state.user.id);
  if(error){alert("No se pudo actualizar el estado: "+error.message);return;} await loadEventAndActivities();
}
function renderMap(){
  const root=$("#map-activity-list"); if(!root)return;
  if(!state.map && window.L){state.map=L.map("map").setView([-33.4489,-70.6693],11);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap"}).addTo(state.map);state.markers=L.featureGroup().addTo(state.map);}
  if(!state.map)return;
  state.markers.clearLayers();
  const located=state.activities.filter(a=>Number.isFinite(Number(a.latitude))&&Number.isFinite(Number(a.longitude))&&a.latitude!==null&&a.longitude!==null);
  root.innerHTML=state.activities.length?state.activities.map(a=>`<article class="activity-card"><h3>${esc(a.title)}</h3><p class="activity-meta">${esc(a.activity_date)} · ${esc(a.place||"Lugar por confirmar")}</p></article>`).join(""):'<div class="empty">No hay actividades para mostrar.</div>';
  located.forEach(a=>L.marker([a.latitude,a.longitude]).addTo(state.markers).bindPopup(`<strong>${esc(a.title)}</strong><br>${esc(a.place||"")}`));
  if(located.length)state.map.fitBounds(state.markers.getBounds().pad(.18)); setTimeout(()=>state.map.invalidateSize(),100);
}

function openActivity(a=null){
  $("#activity-error").textContent=""; $("#activity-dialog-title").textContent=a?"Editar actividad":"Nueva actividad";
  $("#activity-id").value=a?.id||""; $("#activity-title").value=a?.title||""; $("#activity-description").value=a?.description||"";
  $("#activity-date").value=a?.activity_date||state.event?.start_date||""; $("#activity-place").value=a?.place||"";
  $("#activity-start").value=timeFmt(a?.start_time); $("#activity-end").value=timeFmt(a?.end_time);
  $("#activity-lat").value=a?.latitude??""; $("#activity-lng").value=a?.longitude??""; $("#activity-assignees").value="";
  $("#activity-dialog").showModal();
}
$("#new-activity-btn").addEventListener("click",()=>openActivity());
$("#close-activity").addEventListener("click",()=>$("#activity-dialog").close());
$("#activity-form").addEventListener("submit",async e=>{
  e.preventDefault(); if(!isAdmin()||!state.event)return;
  const id=$("#activity-id").value;
  const payload={event_id:state.event.id,title:$("#activity-title").value.trim(),description:$("#activity-description").value.trim()||null,
    activity_date:$("#activity-date").value,place:$("#activity-place").value.trim()||null,
    start_time:$("#activity-start").value||null,end_time:$("#activity-end").value||null,
    latitude:$("#activity-lat").value===""?null:Number($("#activity-lat").value),
    longitude:$("#activity-lng").value===""?null:Number($("#activity-lng").value)};
  let result=id?await supabase.from("activities").update(payload).eq("id",id):await supabase.from("activities").insert({...payload,created_by:state.user.id});
  if(result.error){notifyError($("#activity-error"),result.error.message);return;}
  if(!id){const ids=$("#activity-assignees").value.split(",").map(x=>x.trim()).filter(Boolean);if(ids.length){const {error}=await supabase.from("activity_assignments").insert(ids.map(user_id=>({activity_id:result.data?.[0]?.id,user_id})));if(error)console.warn(error);}}
  $("#activity-dialog").close();await loadEventAndActivities();
});
async function deleteActivity(id){if(!confirm("¿Eliminar esta actividad?"))return;const {error}=await supabase.from("activities").delete().eq("id",id);if(error)alert(error.message);else await loadEventAndActivities();}

document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.toggle("active",x===b));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${b.dataset.view}`));
  if(b.dataset.view==="mapa"&&state.map)setTimeout(()=>state.map.invalidateSize(),100);
}));
let wallCategory="positive";
document.querySelectorAll(".wall-tab").forEach(b=>b.addEventListener("click",()=>{wallCategory=b.dataset.category;document.querySelectorAll(".wall-tab").forEach(x=>x.classList.toggle("selected",x===b));loadWall();}));
$("#wall-content").addEventListener("input",()=>$("#wall-counter").textContent=`${$("#wall-content").value.length}/500`);
$("#wall-form").addEventListener("submit",async e=>{
  e.preventDefault();const content=$("#wall-content").value.trim();if(!content)return;
  const {error}=await supabase.from("wall_posts").insert({user_id:state.user.id,category:wallCategory,content});
  if(error){notifyError($("#wall-error"),error.message);return;}$("#wall-content").value="";$("#wall-counter").textContent="0/500";await loadWall();
});
async function loadWall(){
  const {data,error}=await supabase.from("wall_posts").select("id,category,content,created_at,user_id,profiles(username,full_name)").eq("category",wallCategory).order("created_at",{ascending:false}).limit(100);
  if(error){$("#wall-posts").innerHTML=`<p class="error">${esc(error.message)}</p>`;return;}
  $("#wall-posts").innerHTML=data?.length?data.map(p=>`<article class="wall-card"><header><strong>${esc(p.profiles?.full_name||p.profiles?.username||"Participante")}</strong><span class="muted">${new Date(p.created_at).toLocaleString("es-CL",{dateStyle:"short",timeStyle:"short"})}</span></header><p>${esc(p.content)}</p>${(isAdmin()||p.user_id===state.user.id)?`<button class="secondary" data-wall-delete="${p.id}">Eliminar</button>`:""}</article>`).join(""):'<div class="empty">Todavía no hay publicaciones.</div>';
  $("#wall-posts").querySelectorAll("[data-wall-delete]").forEach(b=>b.addEventListener("click",async()=>{if(confirm("¿Eliminar publicación?")){await supabase.from("wall_posts").delete().eq("id",b.dataset.wallDelete);loadWall();}}));
}
async function loadEmergencyContacts(){
  const {data,error}=await supabase.from("emergency_contacts").select("*").order("is_general",{ascending:false});
  if(error){$("#emergency-contacts").innerHTML="";return;}
  $("#emergency-contacts").innerHTML=data?.length?data.map(c=>`<article class="contact-card"><strong>${esc(c.name)}</strong><p>${esc(c.description||"")}</p>${c.phone?`<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>`:""}</article>`).join(""):'<div class="empty">No hay contactos registrados.</div>';
}
$("#view-emergencia iframe")?.setAttribute("src",EMERGENCY_URL);
boot().catch(e=>{console.error(e);showLogin();});
