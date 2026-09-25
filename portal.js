/* Accounts and tickets use the same-origin server; secrets never enter this file. */
(() => {
  'use strict';
  const esc=value=>LoraUI.esc(value), $=id=>document.getElementById(id);
  const legacyRead=(key,fallback=[])=>{try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));}catch{return fallback;}};
  // Keep the old local records until the administrator explicitly imports them.
  const previous=legacyRead('entidades_acceso_lora');
  if(previous.some(x=>x.key)&&!localStorage.getItem('portal_legacy_entities'))localStorage.setItem('portal_legacy_entities',JSON.stringify(previous));
  if(!localStorage.getItem('portal_legacy_stations'))localStorage.setItem('portal_legacy_stations',JSON.stringify(legacyRead('estaciones_config')));
  const read=(key,fallback=[])=>{try{return JSON.parse(sessionStorage.getItem(key)||JSON.stringify(fallback));}catch{return fallback;}};
  const newTabId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
  let tabId=sessionStorage.getItem('portal_tab_id');
  if(!/^[a-f0-9]{32}$/.test(tabId||'')){tabId=newTabId();sessionStorage.setItem('portal_tab_id',tabId);}
  // Login rotates this tab's cookie namespace, including duplicated browser tabs.
  function hideLogin(){for(const id of ['gate-login-overlay','gate-admin-auth','modal-landing-login']){const el=$(id);if(el){el.hidden=true;el.classList.add('hidden');}}}
  let selectedUser=null;
  let user=null, users=[], tickets=[], ready=false, ticketBusy=false;
  let stationSave=Promise.resolve();
  const labels={open:'Pendiente',in_progress:'Pendiente',approved:'Aprobada · pendiente de aplicar',resolved:'Completada',rejected:'Rechazada'};
  const actionLabels={add:'Agregar estación',modify:'Modificar estación',delete:'Eliminar estación',password:'Cambiar contraseña'};
  async function api(action,data){
    const response=await fetch('/api/portal'+(data?'':'?action='+encodeURIComponent(action)),data?{method:'POST',headers:{'Content-Type':'application/json','X-Portal-Tab':tabId},body:JSON.stringify({action,...data})}:{cache:'no-store',headers:{'X-Portal-Tab':tabId}});
    let result;try{result=await response.json();}catch{throw new Error('El portal necesita publicarse en Vercel con la carpeta api y las variables indicadas en la guía.');}
    if(!response.ok){
      if(response.status===401&&user&&action!=='login'){
        user=null;ready=false;sessionStorage.removeItem('lora_rio_active_session');
        if(typeof currentUserSession!=='undefined')currentUserSession=null;
        document.querySelectorAll('dialog[open]').forEach(box=>box.close());
        const gate=$('gate-login-overlay')||$('gate-admin-auth');if(gate){gate.hidden=false;gate.classList.remove('hidden');}
        refreshChrome();landingButton();
      }
      const error=new Error(result.error||'No se pudo completar la solicitud.');error.status=response.status;throw error;
    }
    return result;
  }
  function session(next){user=next;sessionStorage.setItem('lora_rio_active_session',JSON.stringify(next));document.body.dataset.role=next.role;}
  function loginMarkup(){return `<div class="portal-login-brand"><i data-lucide="waves"></i><h2>Hackeando las inundaciones</h2></div><form class="portal-form" data-unified-login><label>Usuario<input name="username" autocomplete="username" required maxlength="48" placeholder="Tu usuario"></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required maxlength="256" placeholder="Tu contraseña"></label><p class="portal-error" role="alert"></p><button class="portal-primary" type="submit">Iniciar sesión</button></form><a class="portal-back" href="index.html">← Volver al inicio</a>`;}
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
        try{tabId=newTabId();sessionStorage.setItem('portal_tab_id',tabId);const data=new FormData(form);const result=await api('login',{username:data.get('username'),password:data.get('password')});session(result.user);form.reset();hideLogin();
          if(id==='modal-landing-login'){location.href='dashboard_rio.html';return;}
          if(id==='gate-admin-auth'&&user.role!=='admin'){location.href='dashboard_rio.html';return;}
          await loadAccount();container.classList.add('hidden');
        }catch(e){if(container.hidden)accountError(e);else error.textContent=e.message;}finally{button.disabled=false;}
      };
    }
  }
  async function logout(){if(!await LoraUI.confirm('Se cerrará únicamente la sesión de esta pestaña.'))return;try{await api('logout',{});}catch(e){await LoraUI.alert(e.message);return;}sessionStorage.removeItem('lora_rio_active_session');location.href='index.html';}
  function showLogin(){const overlay=$('modal-landing-login');if(!overlay)return;overlay.hidden=false;overlay.classList.remove('hidden');overlay.querySelector('input').focus();}
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
  function cacheUsers(){sessionStorage.setItem('entidades_acceso_lora',JSON.stringify(users.filter(u=>u.role==='user').map(u=>({...u,name:u.entityName||u.name}))));}
  let entityRefreshBusy=false;
  async function refreshEntityGroups(){
    if(!ready||user?.role!=='admin'||entityRefreshBusy)return;
    entityRefreshBusy=true;
    try{
      users=(await api('users')).users;
      cacheUsers();
      if(typeof renderGridEstaciones==='function')renderGridEstaciones();
      if(typeof renderEstacionesAdmin==='function')renderEstacionesAdmin();
      renderUsers();
    }catch(error){console.warn('No se pudo actualizar la lista de entidades:',error);}
    finally{entityRefreshBusy=false;}
  }
  async function loadAccount(){
    const [state,accounts]=await Promise.all([api('stations'),user.role==='admin'?api('users'):Promise.resolve(null)]);
    if(accounts){users=accounts.users;cacheUsers();}
    sessionStorage.setItem('estaciones_config',JSON.stringify(state.stations));
    if(typeof stationsConfig!=='undefined')stationsConfig=state.stations;
    ready=true;
    if(typeof currentUserSession!=='undefined'){
      currentUserSession=user;state.stations.forEach(s=>inicializarStoreEstacion(s.id));aplicarSesionUsuario();
      cambiarVistaEstacion(user.role==='admin'?'ALL':state.stations[0]?.id||'ALL');
    }
    if(typeof initAdminPanel==='function' && user.role==='admin'){$('gate-admin-auth').classList.add('hidden');initAdminPanel();renderUsers();if(location.hash==='#usuarios')switchAdminTab('entities');}
    refreshChrome();landingButton();void refreshTickets();
  }
  function accountError(error){
    const box=dialog('No se pudieron cargar los datos','<p class="portal-error" role="alert"></p><button class="portal-primary" data-retry>Volver a cargar</button>');box.classList.add('portal-compact');
    box.querySelector('[role=alert]').textContent=error.message;
    box.querySelector('[data-retry]').onclick=()=>location.reload();
  }
  function saveStations(stations){
    if(!ready||user?.role!=='admin')return Promise.reject(new Error('Inicia sesión como administrador.'));
    const snapshot=JSON.parse(JSON.stringify(stations));
    const save=()=>api('saveStations',{stations:snapshot}).then(()=>{sessionStorage.setItem('estaciones_config',JSON.stringify(snapshot));});
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
      card.innerHTML=`<div class="portal-ticket-top"><strong>${esc(actionLabels[t.kind]||'Solicitud')}</strong><span class="portal-state state-${esc(t.status)}">${labels[t.status]||esc(t.status)}</span></div><small>${esc(t.entity_name||t.user_name)} · ${new Date(t.created_at).toLocaleString()}</small><p>${esc(t.description)}</p>`;
      if(user.role==='admin'&&['open','in_progress'].includes(t.status)){
        const actions=document.createElement('div');actions.className='portal-action-row';
        for(const [status,label] of [['resolved','Aceptar'],['rejected','Rechazar']]){const button=document.createElement('button');button.className=status==='resolved'?'portal-primary':'portal-secondary';button.textContent=label;button.onclick=()=>decideTicket(t,status);actions.append(button);}card.append(actions);
      }
      if(t.status==='approved'&&t.user_id===user.id){const button=document.createElement('button');button.className='portal-primary';button.textContent='Continuar con la acción';button.onclick=()=>continueTicket(t);card.append(button);}
      container.append(card);
    }
  }
  function continueTicket(ticket){
    const box=dialog('Continuar con la acción','<p class="portal-ticket-description">'+esc(ticket.description)+'</p><p class="portal-help">La solicitud está aprobada. Al confirmar se aplicará el cambio. '+(ticket.kind==='password'?'Después tendrás que iniciar sesión con tu nueva contraseña.':'')+'</p><p class="portal-error" role="alert"></p><button class="portal-primary" data-continue>Confirmar y aplicar</button>');box.classList.add('portal-compact');
    box.querySelector('[data-continue]').onclick=async()=>{const button=box.querySelector('[data-continue]');button.disabled=true;let applied=false;try{await api('executeTicket',{id:ticket.id});applied=true;box.close();if(ticket.kind==='password'){sessionStorage.removeItem('lora_rio_active_session');location.reload();return;}session((await api('me')).user);await loadAccount();await refreshTickets();}catch(e){if(applied)accountError(new Error('El cambio se aplicó, pero falta actualizar la vista. '+e.message));else box.querySelector('[role=alert]').textContent=e.message;}finally{button.disabled=false;}};
  }
  function decideTicket(ticket,status){
    const accept=status==='resolved';
    const box=dialog(accept?'Aceptar solicitud':'Rechazar solicitud',`<p class="portal-ticket-description">${esc(ticket.description)}</p><p class="portal-help">${accept?'Autorizarás el cambio. El usuario deberá pulsar “Continuar con la acción” para aplicarlo.':'La solicitud se cerrará sin modificar la cuenta ni la estación.'}</p><p class="portal-error" role="alert"></p><div class="portal-action-row"><button class="portal-secondary" data-cancel>Cancelar</button><button class="portal-primary" data-submit>${accept?'Aceptar solicitud':'Rechazar'}</button></div>`);box.classList.add('portal-compact');
    box.querySelector('[data-cancel]').onclick=()=>box.close();
    box.querySelector('[data-submit]').onclick=async()=>{const button=box.querySelector('[data-submit]');button.disabled=true;try{await api('updateTicket',{id:ticket.id,status});box.close();await refreshTickets();}catch(e){box.querySelector('[role=alert]').textContent=e.message;}finally{button.disabled=false;}};
  }
  async function openTickets(){
    if(!user)return;
    const box=dialog(user.role==='admin'?'Solicitudes y aprobaciones':'Mis solicitudes','<div class="portal-action-menu"></div><div data-ticket-list>Cargando solicitudes…</div>');
    if(user.role!=='admin')for(const [kind,label] of Object.entries(actionLabels)){const button=document.createElement('button');button.className='portal-secondary';button.textContent=label;button.onclick=()=>newTicket(kind);box.querySelector('.portal-action-menu').append(button);}
    await refreshTickets();renderTickets(box.querySelector('[data-ticket-list]'));
  }
  function newTicket(kind='add'){
    const stations=read('estaciones_config');
    const help={add:'El administrador revisará los datos. Si acepta, podrás pulsar “Continuar con la acción” para crearla y asignarla a tu cuenta.',modify:'El administrador revisará los nuevos datos antes de aplicarlos a esta estación.',delete:'Si se acepta, se retirará la estación y sus asignaciones. Se conservarán las mediciones históricas.',password:'Tu contraseña actual seguirá funcionando hasta que la solicitud sea aprobada y pulses “Continuar con la acción”. Después entrarás con la nueva contraseña.'};
    const fields=kind==='password'?'<label>Contraseña actual<input name="currentPassword" type="password" autocomplete="current-password" required></label><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label><label>Repetir contraseña<input name="repeatPassword" type="password" autocomplete="new-password" required></label>':`${kind!=='add'?'<label>Estación<select name="station" required>'+stations.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+' · '+esc(s.id)+'</option>').join('')+'</select></label>':''}${kind!=='delete'?'<label>Identificador<input name="id" placeholder="RIO_03" pattern="RIO_[0-9]{2}" required '+(kind==='modify'?'readonly':'')+'></label><label>Nombre<input name="name" maxlength="160" required></label><label>Altura sensor al fondo (cm)<input name="bedHeight" type="number" min="0.1" step="0.1" required></label><label>Nivel de aviso (cm)<input name="yellowAlert" type="number" min="0" step="0.1" required></label><label>Nivel de alerta (cm)<input name="redAlert" type="number" min="0.1" step="0.1" required></label>':''}`;
    const box=dialog(actionLabels[kind],`<p class="portal-ticket-description">${help[kind]}</p><form class="portal-form">${fields}<p class="portal-error" role="alert"></p><button class="portal-primary" type="submit">Enviar solicitud</button></form>`);box.classList.add('portal-compact');
    const form=box.querySelector('form');
    if(kind==='modify'){const fill=()=>{const station=stations.find(s=>s.id===form.elements.station.value);if(station)for(const key of ['id','name','bedHeight','yellowAlert','redAlert'])form.elements[key].value=station[key];};form.elements.station.onchange=fill;fill();}
    if(['modify','delete'].includes(kind)&&!stations.length){form.querySelector('button').disabled=true;form.querySelector('[role=alert]').textContent='Aún no tienes estaciones asignadas.';}
    form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button'),error=form.querySelector('[role=alert]');button.disabled=true;error.textContent='';
      try{const data=Object.fromEntries(new FormData(form));if(kind==='password'&&data.password!==data.repeatPassword)throw new Error('Las contraseñas nuevas no coinciden.');
        await api('createTicket',{kind,station:data.station,details:kind==='add'||kind==='modify'?{id:data.id,name:data.name,bedHeight:Number(data.bedHeight),yellowAlert:Number(data.yellowAlert),redAlert:Number(data.redAlert)}:undefined,password:data.password,currentPassword:data.currentPassword});form.reset();box.close();await refreshTickets();const notice=dialog('Solicitud enviada','<p class="portal-ticket-description">Tu solicitud está pendiente de aprobación. Puedes consultar su estado en Solicitudes.</p>');notice.classList.add('portal-compact');
      }catch(err){error.textContent=err.message;}finally{button.disabled=false;}
    };
  }
  function renderUsers(){
    const container=$('portal-users-list');if(!container||user?.role!=='admin')return;
    selectedUser=users.some(u=>u.id===selectedUser)?selectedUser:users[0]?.id;
    container.innerHTML='<nav class="portal-user-sidebar" aria-label="Cuentas"></nav><section class="portal-user-detail"></section>';
    const sidebar=container.querySelector('nav'),detail=container.querySelector('section');
    for(const account of users){const button=document.createElement('button');button.className='portal-user-choice';button.setAttribute('aria-pressed',String(account.id===selectedUser));button.innerHTML=`<span class="portal-avatar">${esc(account.name.slice(0,1).toUpperCase())}</span><span><strong>${esc(account.username)}</strong><small>${account.role==='admin'?'Administrador':'Usuario'} · ${account.active?'Activo':'Desactivado'}</small></span>`;button.onclick=()=>{selectedUser=account.id;renderUsers();};sidebar.append(button);}
    const account=users.find(u=>u.id===selectedUser);
    if(account){detail.innerHTML=`<div class="portal-section-heading"><div><h3>${esc(account.name)}</h3><p>@${esc(account.username)} · ${account.role==='admin'?'Administrador':'Usuario'}</p></div><div class="portal-action-row"><button class="portal-secondary" data-edit>Editar usuario y rol</button><button class="portal-secondary" data-password>Contraseña</button></div></div><p>${esc(account.entityName||'Sin entidad')}</p><h4>Estaciones asignadas</h4><div class="portal-assigned">${read('estaciones_config').filter(s=>account.assignedStations.includes(s.id)).map(s=>'<span>'+esc(s.name)+' · '+esc(s.id)+'</span>').join('')||'<p>Sin estaciones asignadas.</p>'}</div>`;
      detail.querySelector('[data-edit]').onclick=()=>editUser(account);detail.querySelector('[data-password]').onclick=()=>editPassword(account);
    }
    for(const id of ['stat-entities-count','badge-tab-entities'])if($(id))$(id).textContent=users.filter(u=>u.role==='user').length;
    if($('stat-active-users'))$('stat-active-users').textContent=users.filter(u=>u.active).length;
  }
  function editPassword(account){
    const box=dialog('Cambiar contraseña',`<p class="portal-ticket-description">Actualizarás la contraseña de @${esc(account.username)}. Sus sesiones abiertas se cerrarán al guardar.</p><form class="portal-form"><label>Nueva contraseña<input type="password" name="password" minlength="8" maxlength="256" autocomplete="new-password" required></label><label>Repetir contraseña<input type="password" name="repeat" autocomplete="new-password" required></label><p class="portal-error" role="alert"></p><button class="portal-primary">Guardar contraseña</button></form>`);box.classList.add('portal-compact');
    box.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;try{if(form.elements.password.value!==form.elements.repeat.value)throw new Error('Las contraseñas no coinciden.');await api('saveUser',{user:{...account,password:form.elements.password.value}});form.reset();box.close();if(account.id===user.id){sessionStorage.removeItem('lora_rio_active_session');location.reload();}}catch(err){form.querySelector('[role=alert]').textContent=err.message;}finally{button.disabled=false;}};
  }

  function editUser(account={}){
    if(user?.role!=='admin')return;
    const stations=read('estaciones_config');
    const box=dialog(account.id?'Editar cuenta':'Crear cuenta',`<form class="portal-form"><label>Nombre<input name="name" value="${esc(account.name)}" required maxlength="160"></label><label>Entidad<input name="entityName" value="${esc(account.entityName)}" required maxlength="160"></label><label>Usuario<input name="username" value="${esc(account.username)}" pattern="[a-zA-Z0-9._-]{3,48}" minlength="3" maxlength="48" autocomplete="off" required></label><label>Contraseña ${account.id?'(vacía para conservarla)':''}<input name="password" type="password" minlength="8" maxlength="256" autocomplete="new-password" ${account.id?'':'required'}></label><label>Rol<select name="role"><option value="user">Usuario</option><option value="admin" ${account.role==='admin'?'selected':''}>Administrador</option></select></label><label class="portal-check"><input name="active" type="checkbox" ${account.active===false?'':'checked'}> Cuenta activa</label><fieldset><legend>Estaciones asignadas</legend>${stations.map(s=>`<label class="portal-check"><input type="checkbox" name="station" value="${esc(s.id)}" ${(account.assignedStations||[]).includes(s.id)?'checked':''}>${esc(s.name)} · ${esc(s.id)}</label>`).join('')||'<p>No hay estaciones registradas.</p>'}</fieldset><p role="alert" class="portal-error"></p><button class="portal-primary">Guardar cuenta</button></form>`);
    box.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form),b=form.querySelector('button');b.disabled=true;
      try{await api('saveUser',{user:{id:account.id,name:data.get('name'),entityName:data.get('entityName'),username:data.get('username'),password:data.get('password'),role:data.get('role'),active:data.has('active'),assignedStations:data.getAll('station')}});box.close();
        if(account.id===user.id){sessionStorage.removeItem('lora_rio_active_session');location.reload();return;}
        await refreshEntityGroups();
      }catch(e){form.querySelector('[role=alert]').textContent=e.message;}finally{b.disabled=false;}
    };
  }
  async function importLegacy(){
    const legacy=legacyRead('portal_legacy_entities'),stations=legacyRead('portal_legacy_stations');
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
    try{const result=await api('me');session(result.user);hideLogin();
      if($('gate-admin-auth')&&user.role!=='admin'){location.href='dashboard_rio.html';return;}
      await loadAccount();
    }catch(e){if(e.status!==401){if(user)accountError(e);else document.querySelectorAll('[data-unified-login] [role=alert]').forEach(el=>el.textContent=e.message);}}
    setInterval(()=>{stationStatus();if(document.visibilityState!=='hidden')refreshTickets();},15000);
    window.addEventListener('focus',refreshEntityGroups);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshEntityGroups();});
    setInterval(()=>{if(document.visibilityState!=='hidden')refreshEntityGroups();},30000);
    const status=$('cloud-indicator');if(status)new MutationObserver(refreshChrome).observe(status,{attributes:true,attributeFilter:['data-connected']});
    const sensor=$('sensor-status-text');if(sensor)new MutationObserver(stationStatus).observe(sensor,{childList:true,characterData:true,subtree:true});
  }
  window.Portal={api,get user(){return user;},get ready(){return ready;},logout,showLogin,landingButton,refreshChrome,saveStations,refreshTickets,renderUsers,editUser,importLegacy,openTickets,stationStatus,newTicket};
  document.addEventListener('DOMContentLoaded',bootstrap);
})();
