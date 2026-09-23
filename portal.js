/* Accounts and tickets use the same-origin server; secrets never enter this file. */
(() => {
  'use strict';
  const esc=value=>LoraUI.esc(value), $=id=>document.getElementById(id);
  const read=(key,fallback=[])=>{try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));}catch{return fallback;}};
  // Keep the old local records until the administrator explicitly imports them.
  const previous=read('entidades_acceso_lora');
  if(previous.some(x=>x.key)&&!localStorage.getItem('portal_legacy_entities'))localStorage.setItem('portal_legacy_entities',JSON.stringify(previous));
  if(!localStorage.getItem('portal_legacy_stations'))localStorage.setItem('portal_legacy_stations',JSON.stringify(read('estaciones_config')));
  sessionStorage.removeItem('lora_rio_active_session');
  let user=null, users=[], tickets=[], ready=false, ticketBusy=false;
  let stationSave=Promise.resolve();
  const labels={open:'Abierto',in_progress:'En revisión',resolved:'Resuelto',rejected:'No aprobado'};
  async function api(action,data){
    const response=await fetch('/api/portal'+(data?'':'?action='+encodeURIComponent(action)),data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...data})}:{cache:'no-store'});
    let result;try{result=await response.json();}catch{throw new Error('El portal necesita publicarse en Vercel con la carpeta api y las variables indicadas en la guía.');}
    if(!response.ok){
      if(response.status===401&&user&&action!=='login'){
        user=null;ready=false;sessionStorage.removeItem('lora_rio_active_session');
        if(typeof currentUserSession!=='undefined')currentUserSession=null;
        document.querySelectorAll('dialog[open]').forEach(box=>box.close());
        const gate=$('gate-login-overlay')||$('gate-admin-auth');if(gate)gate.classList.remove('hidden');
        refreshChrome();landingButton();
      }
      const error=new Error(result.error||'No se pudo completar la solicitud.');error.status=response.status;throw error;
    }
    return result;
  }
  function session(next){user=next;sessionStorage.setItem('lora_rio_active_session',JSON.stringify(next));document.body.dataset.role=next.role;}
  function loginMarkup(){return `<div class="portal-login-brand"><i data-lucide="waves"></i><h2>Alerta Río &amp; Mar</h2></div><form class="portal-form" data-unified-login><label>Usuario<input name="username" autocomplete="username" required maxlength="48" placeholder="Tu usuario"></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required maxlength="256" placeholder="Tu contraseña"></label><p class="portal-error" role="alert"></p><button class="portal-primary" type="submit">Iniciar sesión</button></form><a class="portal-back" href="index.html">← Volver al inicio</a>`;}
  function installLogin(){
    for(const id of ['gate-login-overlay','gate-admin-auth','modal-landing-login']){
      const container=$(id);if(!container)continue;
      container.innerHTML='<div class="portal-login-card">'+loginMarkup()+'</div>';
      if(id==='modal-landing-login'){
        const close=document.createElement('button');close.type='button';close.className='portal-login-close';close.textContent='×';close.setAttribute('aria-label','Cerrar');
        close.onclick=()=>{container.classList.add('hidden');$('btn-landing-auth')?.focus();};container.firstElementChild.prepend(close);
      }
      container.querySelector('form').onsubmit=async event=>{
        event.preventDefault();const form=event.currentTarget,error=form.querySelector('[role=alert]'),button=form.querySelector('button');
        button.disabled=true;error.textContent='';
        try{const data=new FormData(form);const result=await api('login',{username:data.get('username'),password:data.get('password')});session(result.user);form.reset();
          if(id==='modal-landing-login'){location.href='dashboard_rio.html';return;}
          if(id==='gate-admin-auth'&&user.role!=='admin'){location.href='dashboard_rio.html';return;}
          await loadAccount();container.classList.add('hidden');
        }catch(e){error.textContent=e.message;}finally{button.disabled=false;}
      };
    }
  }
  async function logout(){try{await api('logout',{});}catch(e){await LoraUI.alert(e.message);return;}sessionStorage.removeItem('lora_rio_active_session');location.href='index.html';}
  function showLogin(){const overlay=$('modal-landing-login');if(!overlay)return;overlay.classList.remove('hidden');overlay.querySelector('input').focus();}
  function landingButton(){const b=$('btn-landing-auth');if(!b)return;b.className='portal-profile-icon';b.innerHTML='<i data-lucide="circle-user-round"></i>';b.title=user?'Mis estaciones':'Iniciar sesión';b.setAttribute('aria-label',b.title);b.onclick=()=>user?location.assign('dashboard_rio.html'):showLogin();window.lucide?.createIcons();}
  function refreshChrome(){
    document.body.dataset.role=user?.role||'guest';
    if(typeof currentViewMode!=='undefined')document.body.dataset.view=currentViewMode==='ALL'?'summary':'station';
    if(!user&&$('cloud-indicator'))$('cloud-indicator').hidden=true;
    const nav=document.querySelector('.header-icon-tools');
    if(nav){
      let ticket=$('portal-tickets-button');
      if(!ticket){ticket=document.createElement('button');ticket.id='portal-tickets-button';ticket.className='portal-icon';ticket.innerHTML='<i data-lucide="tickets"></i>';ticket.title='Solicitudes';ticket.setAttribute('aria-label','Solicitudes');ticket.dataset.tooltip='Solicitudes';ticket.onclick=()=>openTickets();nav.append(ticket);}
      let out=$('portal-logout');if(!out){out=document.createElement('button');out.id='portal-logout';out.className='portal-icon';out.innerHTML='<i data-lucide="log-out"></i>';out.title='Cerrar sesión';out.setAttribute('aria-label','Cerrar sesión');out.dataset.tooltip='Cerrar sesión';out.onclick=logout;nav.append(out);}
      ticket.hidden=out.hidden=!user;
    }
    document.querySelectorAll('[onclick="cerrarSesionUsuario()"],[onclick="cerrarSesionAdmin()"]').forEach(b=>{b.hidden=true;});
    const db=$('btn-open-supabase');if(db)db.hidden=user?.role!=='admin'||$('cloud-indicator')?.dataset.connected==='true';
    const manage=$('btn-manage-entities');if(manage){manage.onclick=()=>location.assign('admin.html#usuarios');manage.title='Usuarios y roles';manage.dataset.tooltip='Usuarios y roles';manage.setAttribute('aria-label','Usuarios y roles');}
    const all=$('tab-station-ALL');if(all)all.hidden=user?.role!=='admin';
    document.querySelectorAll('[onclick="cambiarVistaEstacion(\'ALL\')"]').forEach(b=>b.hidden=user?.role!=='admin');
    window.lucide?.createIcons();
  }
  function cacheUsers(){localStorage.setItem('entidades_acceso_lora',JSON.stringify(users.filter(u=>u.role==='user').map(u=>({...u,name:u.entityName||u.name}))));}
  async function loadAccount(){
    const state=await api('stations');
    if(user.role==='admin'){users=(await api('users')).users;cacheUsers();}
    localStorage.setItem('estaciones_config',JSON.stringify(state.stations));
    if(typeof stationsConfig!=='undefined')stationsConfig=state.stations;
    ready=true;
    if(typeof currentUserSession!=='undefined'){
      currentUserSession=user;state.stations.forEach(s=>inicializarStoreEstacion(s.id));aplicarSesionUsuario();
      cambiarVistaEstacion(user.role==='admin'?'ALL':state.stations[0]?.id||'ALL');
    }
    if(typeof initAdminPanel==='function' && user.role==='admin'){$('gate-admin-auth').classList.add('hidden');initAdminPanel();renderUsers();if(location.hash==='#usuarios')switchAdminTab('entities');}
    refreshChrome();landingButton();await refreshTickets();
  }
  function saveStations(stations){
    if(!ready||user?.role!=='admin')return Promise.reject(new Error('Inicia sesión como administrador.'));
    const snapshot=JSON.parse(JSON.stringify(stations));
    const save=()=>api('saveStations',{stations:snapshot}).then(()=>{localStorage.setItem('estaciones_config',JSON.stringify(snapshot));});
    const pending=stationSave.then(save);stationSave=pending.catch(()=>{});return pending;
  }
  function dialog(title,content){
    const box=document.createElement('dialog');box.className='credential-dialog portal-dialog';
    box.innerHTML='<div class="credential-heading"><h2></h2><button type="button" aria-label="Cerrar" data-close>×</button></div>'+content;
    box.querySelector('h2').textContent=title;
    box.querySelector('h2').id='portal-dialog-'+Math.random().toString(36).slice(2);box.setAttribute('aria-labelledby',box.querySelector('h2').id);
    const opener=document.activeElement;
    box.querySelector('[data-close]').onclick=()=>box.close();box.addEventListener('close',()=>{box.remove();opener?.isConnected&&opener.focus();});document.body.append(box);box.showModal();return box;
  }
  async function refreshTickets(){
    if(!user||ticketBusy)return;ticketBusy=true;
    try{tickets=(await api('tickets')).tickets;document.querySelectorAll('[data-ticket-list]').forEach(renderTickets);
      if($('stat-audit-events'))$('stat-audit-events').textContent=tickets.filter(t=>['open','in_progress'].includes(t.status)).length;
      if($('badge-tab-activity'))$('badge-tab-activity').textContent=tickets.length;
      if($('ticket-sync'))$('ticket-sync').textContent='Actualizado '+new Date().toLocaleTimeString();
    }catch(e){if($('ticket-sync'))$('ticket-sync').textContent=e.message;document.querySelectorAll('[data-ticket-list]').forEach(x=>{if(!x.children.length)x.textContent=e.message;});}finally{ticketBusy=false;}
  }
  function renderTickets(container){
    const filter=$('ticket-filter')?.value||'all';
    const rows=tickets.filter(t=>container.closest('dialog')||filter==='all'||t.status===filter);
    container.replaceChildren();if(!rows.length){container.innerHTML='<p class="portal-empty">No hay solicitudes para mostrar.</p>';return;}
    for(const t of rows){const card=document.createElement('article');card.className='portal-ticket';
      card.innerHTML=`<div class="portal-ticket-top"><strong>${t.kind==='add'?'Agregar estación':'Modificar '+esc(t.station)}</strong><span class="portal-state state-${esc(t.status)}">${labels[t.status]}</span></div><small>${esc(t.entity_name||t.user_name)} · ${new Date(t.created_at).toLocaleString()} · #${esc(t.id.slice(0,8))}</small><p>${esc(t.description)}</p>${t.response?'<div class="portal-response"><strong>Respuesta del administrador</strong><p>'+esc(t.response)+'</p></div>':''}`;
      if(user.role==='admin'){const b=document.createElement('button');b.className='portal-secondary';b.textContent='Atender solicitud';b.onclick=()=>editTicket(t);card.append(b);}container.append(card);
    }
  }
  async function openTickets(){
    if(!user)return;const box=dialog('Mis solicitudes','<button class="portal-primary" data-new>Nueva solicitud</button><div data-ticket-list>Cargando solicitudes…</div>');
    box.querySelector('[data-new]').onclick=newTicket;await refreshTickets();renderTickets(box.querySelector('[data-ticket-list]'));
  }
  function newTicket(){
    const stations=read('estaciones_config');
    const box=dialog('Solicitar cambios',`<form class="portal-form"><label>Tipo de solicitud<select name="kind"><option value="add">Agregar estación</option><option value="modify">Modificar estación</option></select></label><label data-station hidden>Estación<select name="station">${stations.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+' · '+esc(s.id)+'</option>').join('')}</select></label><label>Descripción<textarea name="description" rows="4" minlength="10" maxlength="3000" required placeholder="Describe dónde irá la estación o qué necesitas cambiar."></textarea></label><p role="alert" class="portal-error"></p><button class="portal-primary" type="submit">Enviar solicitud</button></form>`);
    const form=box.querySelector('form');form.elements.kind.onchange=()=>{box.querySelector('[data-station]').hidden=form.elements.kind.value!=='modify';form.elements.station.required=form.elements.kind.value==='modify';};
    form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;try{await api('createTicket',Object.fromEntries(new FormData(form)));box.close();await refreshTickets();}catch(err){form.querySelector('[role=alert]').textContent=err.message;}finally{b.disabled=false;}};
  }
  function editTicket(ticket){
    const box=dialog('Atender solicitud',`<p class="portal-ticket-description">${esc(ticket.description)}</p><form class="portal-form"><label>Estado<select name="status">${Object.entries(labels).map(([key,label])=>'<option value="'+key+'" '+(key===ticket.status?'selected':'')+'>'+label+'</option>').join('')}</select></label><label>Respuesta<textarea name="response" rows="4" maxlength="3000">${esc(ticket.response)}</textarea></label><p class="portal-help">Al resolver el ticket, realiza también los cambios necesarios en Gestión de estaciones y Usuarios. El ticket registra la respuesta, no modifica la placa.</p><p role="alert" class="portal-error"></p><button class="portal-primary">Guardar respuesta</button></form>`);
    box.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,b=form.querySelector('button');b.disabled=true;try{await api('updateTicket',{id:ticket.id,...Object.fromEntries(new FormData(form))});box.close();await refreshTickets();}catch(err){form.querySelector('[role=alert]').textContent=err.message;}finally{b.disabled=false;}};
  }
  function renderUsers(){
    const container=$('portal-users-list');if(!container||user?.role!=='admin')return;container.innerHTML='';
    users.forEach(account=>{const card=document.createElement('article');card.className='portal-user-card';card.innerHTML=`<strong>${esc(account.name)}</strong><p>@${esc(account.username)}</p><p>${account.role==='admin'?'Administrador':'Usuario'} · ${account.active?'Activo':'Desactivado'}</p><p>${esc(account.entityName)} · ${account.assignedStations.length} estaciones</p>`;const b=document.createElement('button');b.textContent='Editar cuenta';b.className='portal-secondary';b.onclick=()=>editUser(account);card.append(b);container.append(card);});
    for(const id of ['stat-entities-count','badge-tab-entities'])if($(id))$(id).textContent=users.filter(u=>u.role==='user').length;
    if($('stat-active-users'))$('stat-active-users').textContent=users.filter(u=>u.active).length;
  }
  function editUser(account={}){
    if(user?.role!=='admin')return;
    const stations=read('estaciones_config');
    const box=dialog(account.id?'Editar cuenta':'Crear cuenta',`<form class="portal-form"><label>Nombre<input name="name" value="${esc(account.name)}" required maxlength="160"></label><label>Entidad<input name="entityName" value="${esc(account.entityName)}" required maxlength="160"></label><label>Usuario<input name="username" value="${esc(account.username)}" pattern="[a-zA-Z0-9._-]{3,48}" minlength="3" maxlength="48" autocomplete="off" required></label><label>Contraseña ${account.id?'(vacía para conservarla)':''}<input name="password" type="password" minlength="8" maxlength="256" autocomplete="new-password" ${account.id?'':'required'}></label><label>Rol<select name="role"><option value="user">Usuario</option><option value="admin" ${account.role==='admin'?'selected':''}>Administrador</option></select></label><label class="portal-check"><input name="active" type="checkbox" ${account.active===false?'':'checked'}> Cuenta activa</label><fieldset><legend>Estaciones asignadas</legend>${stations.map(s=>`<label class="portal-check"><input type="checkbox" name="station" value="${esc(s.id)}" ${(account.assignedStations||[]).includes(s.id)?'checked':''}>${esc(s.name)} · ${esc(s.id)}</label>`).join('')||'<p>No hay estaciones registradas.</p>'}</fieldset><p role="alert" class="portal-error"></p><button class="portal-primary">Guardar cuenta</button></form>`);
    box.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form),b=form.querySelector('button');b.disabled=true;
      try{await api('saveUser',{user:{id:account.id,name:data.get('name'),entityName:data.get('entityName'),username:data.get('username'),password:data.get('password'),role:data.get('role'),active:data.has('active'),assignedStations:data.getAll('station')}});box.close();
        if(account.id===user.id){sessionStorage.removeItem('lora_rio_active_session');location.reload();return;}
        users=(await api('users')).users;cacheUsers();renderUsers();if(typeof renderEstacionesAdmin==='function')renderEstacionesAdmin();
      }catch(e){form.querySelector('[role=alert]').textContent=e.message;}finally{b.disabled=false;}
    };
  }
  async function importLegacy(){
    const legacy=read('portal_legacy_entities'),stations=read('portal_legacy_stations');
    const box=dialog('Importar cuentas anteriores','<p>Revisa cada usuario antes de guardarlo. Se conservan sus estaciones; escribe una contraseña nueva si la anterior tiene menos de 8 caracteres.</p><div data-import-list></div><button class="portal-secondary" data-import-stations>Importar estaciones anteriores</button><p role="status"></p>');
    for(const old of legacy){const b=document.createElement('button');b.className='portal-secondary';b.textContent='Importar '+old.name;b.onclick=()=>editUser({name:old.name,entityName:old.name,username:String(old.name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'_').slice(0,40),assignedStations:old.assignedStations,role:'user'});box.querySelector('[data-import-list]').append(b);}
    if(!legacy.length)box.querySelector('[data-import-list]').textContent='No hay cuentas antiguas en este navegador.';
    box.querySelector('[data-import-stations]').onclick=async()=>{
      const current=read('estaciones_config'),combined=[...current,...stations.filter(s=>!current.some(c=>c.id===s.id))];
      try{await saveStations(combined);if(typeof stationsConfig!=='undefined')stationsConfig=combined;if(typeof renderEstacionesAdmin==='function')renderEstacionesAdmin();box.querySelector('[role=status]').textContent='Estaciones importadas. Se respetaron las que ya estaban registradas.';}catch(e){box.querySelector('[role=status]').textContent=e.message;}
    };
  }
  function stationStatus(){
    const button=$('station-health-card');if(!button||typeof currentViewMode==='undefined')return;
    const store=typeof telemetryStore==='undefined'?null:telemetryStore[currentViewMode];
    let title='Sin señal',message='La estación no ha enviado una lectura reciente. Revisa su alimentación y el enlace de radio.',issue=true;
    const gateway=typeof estadoConexionGateway==='function'?estadoConexionGateway():null;
    if(store?.hasReceivedLive&&!store.isOffline){
      const status=store.latest?.status;
      if(status==='OK' && store.latest.distance>20){title='Conectada';message='Estación transmitiendo correctamente.';issue=false;}
      else{title='Revisar sensor';const messages={OK:'El agua está dentro de la zona ciega del sensor. Revisa el nivel: no hay una medición fiable.',SIN_ECO:'No se obtuvo eco válido. Revisa orientación, alimentación y cableado del sensor.',ERR_CABLE:'El sensor reporta un problema de conexión. Revisa el cableado.',FUERA_RANGO:'La lectura está fuera del rango válido del sensor.',MUY_CERCA:'El agua está demasiado cerca del sensor; no hay una medición fiable.',ERR_DESBORDE:'La lectura indica proximidad al sensor. Revisa el nivel del agua.'};message=messages[status]||'El sensor reportó una lectura anómala: '+(status||'sin diagnóstico')+'.';}
    }else if(!gateway?.connected){message='No hay comunicación reciente del gateway. Revisa su alimentación y conexión Wi-Fi; aún no se puede confirmar el estado de la estación.';}
    button.querySelector('[data-health-title]').textContent=title;button.dataset.issue=String(issue);button.disabled=!issue;button.querySelector('[data-health-help]').textContent=issue?'Ver detalle del problema':'Funcionando correctamente';
    button.onclick=()=>{if(issue)dialog('Estado de la estación','<p class="portal-ticket-description">'+esc(message)+'</p>').classList.add('portal-compact');};
  }
  async function bootstrap(){
    installLogin();landingButton();refreshChrome();stationStatus();
    try{const result=await api('me');session(result.user);
      if($('gate-admin-auth')&&user.role!=='admin'){location.href='dashboard_rio.html';return;}
      await loadAccount();
    }catch(e){if(e.status!==401)document.querySelectorAll('[data-unified-login] [role=alert]').forEach(el=>el.textContent=e.message);}
    setInterval(()=>{stationStatus();if(document.visibilityState!=='hidden')refreshTickets();},15000);
    const status=$('cloud-indicator');if(status)new MutationObserver(refreshChrome).observe(status,{attributes:true,attributeFilter:['data-connected']});
    const sensor=$('sensor-status-text');if(sensor)new MutationObserver(stationStatus).observe(sensor,{childList:true,characterData:true,subtree:true});
  }
  window.Portal={api,get user(){return user;},get ready(){return ready;},logout,showLogin,landingButton,refreshChrome,saveStations,refreshTickets,renderUsers,editUser,importLegacy,openTickets,stationStatus};
  document.addEventListener('DOMContentLoaded',bootstrap);
})();
