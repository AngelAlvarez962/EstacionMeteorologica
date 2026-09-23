/* Shared UI for the existing local entity accounts. */
(function () {
  'use strict';
  const ENTITY_KEY = 'entidades_acceso_lora';
  const readEntities = () => { try { const x=JSON.parse(sessionStorage.getItem(ENTITY_KEY)||'[]'); return Array.isArray(x)?x:[]; } catch { return []; } };
  const session = () => { try { return JSON.parse(sessionStorage.getItem('lora_rio_active_session')||'null'); } catch { return null; } };
  const esc = value => String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function matches(ent, value) {
    return ent.credentialVersion === 1 ? ent.key === value.trim() : String(ent.key).trim().toUpperCase() === value.trim().toUpperCase();
  }
  function groups(stations, entities) {
    const combined=new Map();for(const ent of entities){const key=ent.entityName||ent.name;if(!combined.has(key))combined.set(key,{...ent,name:key,assignedStations:[]});combined.get(key).assignedStations.push(...(ent.assignedStations||[]));}entities=[...combined.values()];
    const assigned=new Set();
    const result=entities.map(ent=>{
      const ids=new Set(ent.assignedStations||[]);
      const members=stations.filter(st=>ids.has(st.id));
      members.forEach(st=>assigned.add(st.id));
      return {id:ent.id,name:ent.name,stations:members};
    });
    const loose=stations.filter(st=>!assigned.has(st.id));
    if(loose.length || !result.length) result.push({id:'unassigned',name:'Sin entidad',stations:loose});
    return result;
  }
  function groupCards(grid, stations) {
    if(session()?.type!=='admin') return;
    const cards=new Map(Array.from(grid.children).map(card=>[card.dataset.stationId,card]));
    grid.replaceChildren();
    grid.classList.add('entity-group-list');
    for(const group of groups(stations,readEntities())) {
      const section=document.createElement('section'); section.className='entity-station-section';
      const head=document.createElement('div');head.className='entity-section-heading';
      const title=document.createElement('h3');title.textContent=group.name;
      const count=document.createElement('span');count.textContent=group.stations.length+' '+(group.stations.length===1?'estación':'estaciones');
      head.append(title,count);section.append(head);
      const inner=document.createElement('div');inner.className='entity-station-grid';
      for(const st of group.stations) {
        const original=cards.get(st.id);if(!original)continue;
        const card=original.cloneNode(true);card.onclick=original.onclick;card.onkeydown=original.onkeydown;
        inner.append(card);
      }
      if(!group.stations.length){const msg=document.createElement('p');msg.className='entity-empty';msg.textContent='Esta entidad aún no tiene estaciones asignadas.';inner.append(msg);}
      section.append(inner);grid.append(section);
    }
  }
  function refresh() {
    if(typeof renderEntidadesAdmin==='function') renderEntidadesAdmin();
    if(typeof renderListaEntidades==='function') renderListaEntidades();
    if(typeof renderGridEstaciones==='function') renderGridEstaciones();
    if(typeof renderEstacionesAdmin==='function') renderEstacionesAdmin();
  }
  let dialog, selectedId, opener;
  function ensureDialog() {
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.id='entity-password-dialog';dialog.className='credential-dialog';
    dialog.innerHTML=`<form id="entity-password-form"><div class="credential-heading"><h2 id="credential-title">Cambiar contraseña</h2><button type="button" data-close aria-label="Cerrar">✕</button></div>
      <p id="credential-entity"></p><p class="credential-help">La nueva contraseña reemplazará la clave de acceso de esta entidad. Se distingue entre mayúsculas y minúsculas.</p>
      <label for="entity-password-new">Nueva contraseña</label><input id="entity-password-new" type="password" autocomplete="new-password" minlength="8" required>
      <label for="entity-password-confirm">Confirmar contraseña</label><input id="entity-password-confirm" type="password" autocomplete="new-password" minlength="8" required>
      <p id="credential-error" class="credential-error" role="alert"></p>
      <p class="credential-help">Este cambio se guarda en este navegador. Los perfiles actuales todavía no se sincronizan entre computadoras.</p>
      <div class="credential-actions"><button type="button" data-close>Cancelar</button><button type="submit" class="credential-primary">Guardar contraseña</button></div></form>`;
    dialog.setAttribute('aria-labelledby','credential-title');document.body.append(dialog);
    dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dialog.close());
    dialog.addEventListener('close',()=>{dialog.querySelector('form').reset();document.getElementById('credential-error').textContent='';opener?.focus();});
    dialog.querySelector('form').addEventListener('submit',event=>{
      event.preventDefault();const error=document.getElementById('credential-error');error.textContent='';
      if(session()?.type!=='admin'){error.textContent='Inicia sesión como administrador.';return;}
      const next=document.getElementById('entity-password-new').value;
      const confirmation=document.getElementById('entity-password-confirm').value;
      const entities=readEntities();const ent=entities.find(e=>e.id===selectedId);
      if(!ent){error.textContent='La entidad ya no existe.';return;}
      if(next.length<8 || next!==next.trim()){error.textContent='Usa al menos 8 caracteres y evita espacios al principio o al final.';return;}
      if(next!==confirmation){error.textContent='Las contraseñas no coinciden.';return;}
      if(entities.some(e=>e.id!==ent.id && String(e.key).trim().toUpperCase()===next.toUpperCase())){error.textContent='Esta contraseña ya está en uso por otra entidad.';return;}
      ent.key=next;ent.credentialVersion=1;
      try{localStorage.setItem(ENTITY_KEY,JSON.stringify(entities));}catch{error.textContent='No se pudo guardar. Comprueba el almacenamiento del navegador.';return;}
      // Never add the password to the activity log.
      if(typeof registrarActividadAdmin==='function') registrarActividadAdmin('PASSWORD_CHANGED','Cambió la contraseña de '+ent.name);
      else if(typeof registrarActividad==='function') registrarActividad('PASSWORD_CHANGED','Cambió la contraseña de '+ent.name);
      dialog.close();refresh();announce('Contraseña actualizada para '+ent.name+'.');
    });
  }
  function announce(message){let box=document.getElementById('ui-notice');if(!box){box=document.createElement('div');box.id='ui-notice';box.setAttribute('role','status');document.body.append(box);}box.textContent=message;box.hidden=false;setTimeout(()=>box.hidden=true,6000);}
  function resetPassword(id){if(session()?.type!=='admin')return;const ent=readEntities().find(e=>e.id===id);if(!ent)return;opener=document.activeElement;selectedId=id;ensureDialog();document.getElementById('credential-entity').textContent=ent.name;dialog.showModal();document.getElementById('entity-password-new').focus();}
  async function copyEntity(id){if(session()?.type!=='admin')return;const ent=readEntities().find(e=>e.id===id);if(!ent)return;try{await navigator.clipboard.writeText(ent.key);announce('Clave copiada.');}catch{copyText('Copia la clave de acceso:',ent.key);}}
  function verifyEntitySession(){const user=session();if(user?.cloud||user?.type!=='entity')return;const ent=readEntities().find(e=>e.id===user.id);if(!ent || !matches(ent,String(user.key||''))){sessionStorage.removeItem('lora_rio_active_session');location.reload();}else{user.assignedStations=ent.assignedStations||[];user.name=ent.name;sessionStorage.setItem('lora_rio_active_session',JSON.stringify(user));if(typeof currentUserSession!=='undefined')currentUserSession=user;}}
  function initToolbar(){
    const admin=document.getElementById('admin-actions-bar');if(!admin)return;
    const controls=admin.parentElement,row=controls.parentElement;
    row.classList.add('dashboard-header-layout');controls.classList.add('header-session-strip');
    const nav=document.createElement('nav');nav.className='header-icon-tools';nav.setAttribute('aria-label','Herramientas del dashboard');row.append(nav);
    nav.append(admin);['btn-sound','btn-export'].forEach(id=>{const b=document.getElementById(id);if(b)nav.append(b);});
    function labels(){nav.querySelectorAll('button,a').forEach(b=>{let label=b.textContent.trim().replace(/\s+/g,' ')||b.getAttribute('title');b.setAttribute('aria-label',label);b.dataset.tooltip=label;b.title=label;});}
    labels();
  }

  let messageQueue=Promise.resolve();
  function showMessage(message, kind, value='') {
    const task=()=>new Promise(resolve=>{
      const previous=document.activeElement;
      const box=document.createElement('dialog');box.className='credential-dialog site-message-dialog';
      box.innerHTML='<h2 id="site-message-title"></h2><p class="site-message-body"></p><div class="credential-actions"><button type="button" data-cancel>Cancelar</button><button type="button" class="credential-primary" data-accept>Confirmar</button></div>';
      box.setAttribute('aria-labelledby','site-message-title');
      box.querySelector('h2').textContent=kind==='confirm'?'Confirmar acción':kind==='copy'?'Clave de acceso':'Alerta Río & Mar';
      box.querySelector('p').textContent=message;
      if(kind==='copy'){const input=document.createElement('input');input.value=value;input.readOnly=true;input.setAttribute('aria-label','Clave para copiar');box.querySelector('p').after(input);}
      const cancel=box.querySelector('[data-cancel]'),accept=box.querySelector('[data-accept]');
      cancel.hidden=kind!=='confirm';accept.textContent=kind==='confirm'?'Confirmar':'Aceptar';
      let result=false;
      cancel.onclick=()=>box.close();accept.onclick=()=>{result=true;box.close();};
      box.addEventListener('close',()=>{box.remove();if(previous?.isConnected)previous.focus();resolve(result);},{once:true});
      document.body.append(box);box.showModal();
      if(kind==='copy'){box.querySelector('input').focus();box.querySelector('input').select();}else (kind==='confirm'?cancel:accept).focus();
    });
    const pending=messageQueue.then(task);messageQueue=pending.catch(()=>{});return pending;
  }
  function copyText(message,value){return showMessage(message,'copy',value);}
  function setCloudStatus(connected){const el=document.getElementById('cloud-indicator');if(!el)return;el.dataset.connected=String(connected);const label=connected?'Base de datos conectada':'Base de datos desconectada';el.title=label;el.setAttribute('aria-label',label);el.hidden=session()?.type!=='admin';}
  window.addEventListener('offline',()=>setCloudStatus(false));

  window.LoraUI={confirm:message=>showMessage(message,"confirm"),alert:message=>showMessage(message,"alert"),copyText,setCloudStatus,esc,matches,groups,groupCards,resetPassword,copyEntity};
  document.addEventListener('DOMContentLoaded',()=>{initToolbar();verifyEntitySession();});
  window.addEventListener('storage',event=>{if(event.key===ENTITY_KEY){verifyEntitySession();refresh();}});
  window.addEventListener('pageshow',verifyEntitySession);
})();
