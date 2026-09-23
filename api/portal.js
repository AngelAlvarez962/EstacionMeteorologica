const crypto = require('node:crypto');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const ROOT = '00000000-0000-4000-8000-000000000001';
const fail = (status, message) => Object.assign(new Error(message), {status});
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const clean = (value, max=160) => String(value || '').trim().slice(0,max);
const publicUser = u => ({id:u.id, username:u.username, name:u.name, entityName:u.entity_name, role:u.role, type:u.role==='admin'?'admin':'entity', assignedStations:u.assigned_stations||[], active:u.active, cloud:true});
async function passwordHash(password) {
  const salt=crypto.randomBytes(16).toString('hex');
  return salt+':'+(await scrypt(password,salt,64)).toString('hex');
}
async function passwordMatches(password, encoded) {
  const [salt,hash]=String(encoded).split(':');
  if(!salt||!hash)return false;
  const actual=await scrypt(password,salt,64), expected=Buffer.from(hash,'hex');
  return actual.length===expected.length && crypto.timingSafeEqual(actual,expected);
}
async function db(route, method='GET', body, prefer='return=representation') {
  const key=process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers={apikey:key,'Content-Type':'application/json',Prefer:prefer};
  if(!key.startsWith('sb_secret_'))headers.Authorization='Bearer '+key;
  const r=await fetch(process.env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/'+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!r.ok){if(r.status===409)throw fail(409,'Ese usuario ya existe.');throw fail(503,'No se pudo acceder a los datos. Verifica la configuración y el SQL del portal.');}
  const text=await r.text();return text?JSON.parse(text):null;
}
function cookie(req, value, maxAge) {
  const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'');
  return `rio_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${local?'':'; Secure'}`;
}
function stationList(items) {
  if(!Array.isArray(items)||items.length>300)throw fail(400,'Lista de estaciones inválida.');
  const ids=new Set();
  return items.map(s=>{
    if(!/^RIO_\d{2}$/.test(s.id)||ids.has(s.id))throw fail(400,'Identificador de estación inválido o repetido.');ids.add(s.id);
    const bed=Number(s.bedHeight),yellow=Number(s.yellowAlert),red=Number(s.redAlert);
    if(!clean(s.name)||![bed,yellow,red].every(Number.isFinite)||bed<=0||yellow<0||red<=yellow||red>bed)throw fail(400,'Revisa las alturas y alertas de las estaciones.');
    return {id:s.id,name:clean(s.name),bedHeight:bed,yellowAlert:yellow,redAlert:red};
  });
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try {
    if(!['GET','POST'].includes(req.method))throw fail(405,'Método no permitido.');
    const configured=Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY));
    if(req.method==='GET' && req.query?.action==='status')return res.status(200).json({configured});
    if(!configured)throw fail(503,'Falta activar el portal en Vercel. Consulta la guía de configuración.');
    if(req.method==='POST'){
      if(req.headers['sec-fetch-site']==='cross-site')throw fail(403,'Solicitud no permitida.');
      if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)throw fail(403,'Origen no permitido.');
      if(!String(req.headers['content-type']||'').includes('application/json'))throw fail(415,'Se requiere JSON.');
    }
    const body=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});
    if(JSON.stringify(body).length>100000)throw fail(413,'Solicitud demasiado grande.');
    const action=req.method==='GET'?req.query?.action:body.action;
    const rawCookie=(req.headers.cookie||'').match(/(?:^|;\s*)rio_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    if(action==='login' && req.method==='POST'){
      const username=clean(body.username,48).toLowerCase(),password=String(body.password||'');
      if(!/^[a-z0-9._-]{3,48}$/.test(username)||password.length>256)throw fail(401,'Usuario o contraseña incorrectos.');
      const ip=clean(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown',150).split(',')[0];
      for(const scope of ['ip:'+ip,'user:'+username]){
        const allowed=await db('rpc/portal_login_allowed','POST',{bucket_key:digest(scope)});
        if(!allowed)throw fail(429,'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.');
      }
      let users=await db('portal_users?username=eq.'+encodeURIComponent(username)+'&limit=1');
      const bootstrapUser=clean(process.env.PORTAL_ADMIN_USER||'admin',48).toLowerCase();
      if(!users.length && username===bootstrapUser && process.env.PORTAL_ADMIN_PASSWORD?.length>=12){
        const a=digest(password),b=digest(process.env.PORTAL_ADMIN_PASSWORD);
        if(crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b))){
          await db('portal_users?on_conflict=id','POST',{id:ROOT,username,name:'Administrador',role:'admin',password_hash:await passwordHash(password)},'resolution=ignore-duplicates,return=minimal');
          users=await db('portal_users?username=eq.'+encodeURIComponent(username)+'&limit=1');
        }
      }
      const user=users[0];
      if(!user?.active || !await passwordMatches(password,user.password_hash))throw fail(401,'Usuario o contraseña incorrectos.');
      const token=crypto.randomBytes(32).toString('hex');
      await db('portal_sessions','POST',{token_hash:digest(token),user_id:user.id,expires_at:new Date(Date.now()+28800000).toISOString()});
      res.setHeader('Set-Cookie',cookie(req,token,28800));return res.status(200).json({user:publicUser(user)});
    }
    if(action==='logout' && req.method==='POST'){
      if(rawCookie)await db('portal_sessions?token_hash=eq.'+digest(rawCookie),'DELETE');
      res.setHeader('Set-Cookie',cookie(req,'',0));return res.status(200).json({ok:true});
    }
    if(!rawCookie)throw fail(401,'Inicia sesión para continuar.');
    const sessions=await db('portal_sessions?token_hash=eq.'+digest(rawCookie)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1');
    if(!sessions[0])throw fail(401,'Tu sesión terminó. Vuelve a iniciar sesión.');
    const user=(await db('portal_users?id=eq.'+sessions[0].user_id+'&limit=1'))[0];
    if(!user?.active)throw fail(401,'Cuenta desactivada.');
    const admin=user.role==='admin';
    const requireAdmin=()=>{if(!admin)throw fail(403,'Solo el administrador puede realizar esta acción.');};
    if(action==='me')return res.status(200).json({user:publicUser(user)});
    if(action==='users'){
      requireAdmin();return res.status(200).json({users:(await db('portal_users?order=created_at.asc')).map(publicUser)});
    }
    if(action==='saveUser' && req.method==='POST'){
      requireAdmin();const input=body.user||{};
      const username=clean(input.username,48).toLowerCase();
      if(!/^[a-z0-9._-]{3,48}$/.test(username)||!clean(input.name)||!['admin','user'].includes(input.role))throw fail(400,'Revisa nombre, usuario y rol.');
      const id=input.id||crypto.randomUUID();if(!/^[a-f0-9-]{36}$/.test(id))throw fail(400,'Cuenta inválida.');
      const existing=(await db('portal_users?id=eq.'+id+'&limit=1'))[0];
      if(input.id&&!existing)throw fail(404,'La cuenta ya no existe.');
      if(id===ROOT && (input.role!=='admin'||input.active===false||username!==existing.username))throw fail(400,'La cuenta principal debe permanecer activa como administradora.');
      const assigned=Array.isArray(input.assignedStations)?[...new Set(input.assignedStations)]:[];
      if(assigned.length>300||assigned.some(x=>!/^RIO_\d{2}$/.test(x)))throw fail(400,'Estaciones inválidas.');
      const data={id,username,name:clean(input.name),entity_name:clean(input.entityName||input.name),role:input.role,active:input.active!==false,assigned_stations:assigned};
      if(input.password || !existing){if(typeof input.password!=='string'||input.password.length<8||input.password.length>256)throw fail(400,'La contraseña debe tener entre 8 y 256 caracteres.');data.password_hash=await passwordHash(input.password);}
      const saved=existing?await db('portal_users?id=eq.'+id,'PATCH',data):await db('portal_users','POST',data);
      // Permission and password changes invalidate old sessions.
      if(existing)await db('portal_sessions?user_id=eq.'+id,'DELETE');
      return res.status(200).json({user:publicUser(saved[0])});
    }
    if(action==='stations'){
      const state=(await db('portal_config?id=eq.stations&limit=1'))[0];const all=state?.value||[];
      return res.status(200).json({stations:admin?all:all.filter(s=>user.assigned_stations.includes(s.id)),initialized:Boolean(state)});
    }
    if(action==='saveStations' && req.method==='POST'){
      requireAdmin();const stations=stationList(body.stations);
      await db('portal_config?on_conflict=id','POST',{id:'stations',value:stations},'resolution=merge-duplicates,return=minimal');return res.status(200).json({ok:true});
    }
    if(action==='tickets'){
      return res.status(200).json({tickets:await db('portal_tickets?order=created_at.desc&limit=300'+(admin?'':'&user_id=eq.'+user.id))});
    }
    if(action==='createTicket' && req.method==='POST'){
      const kind=body.kind,station=clean(body.station,16),description=clean(body.description,3000);
      if(!['add','modify'].includes(kind)||description.length<10)throw fail(400,'Describe tu solicitud con al menos 10 caracteres.');
      if(kind==='modify'&&!user.assigned_stations.includes(station)&&!admin)throw fail(403,'Selecciona una estación asignada a tu cuenta.');
      const data={user_id:user.id,user_name:user.name,entity_name:user.entity_name,kind,station:kind==='modify'?station:null,description};
      return res.status(200).json({ticket:(await db('portal_tickets','POST',data))[0]});
    }
    if(action==='updateTicket' && req.method==='POST'){
      requireAdmin();if(!/^[a-f0-9-]{36}$/.test(body.id)||!['open','in_progress','resolved','rejected'].includes(body.status))throw fail(400,'Ticket o estado inválido.');
      const response=clean(body.response,3000);
      if(['resolved','rejected'].includes(body.status)&&!response)throw fail(400,'Incluye una respuesta antes de cerrar el ticket.');
      const rows=await db('portal_tickets?id=eq.'+body.id,'PATCH',{status:body.status,response,updated_at:new Date().toISOString()});
      if(!rows.length)throw fail(404,'El ticket no existe.');return res.status(200).json({ticket:rows[0]});
    }
    throw fail(404,'Acción no encontrada.');
  }catch(error){res.status(error.status||500).json({error:error.status?error.message:'No se pudo completar la solicitud.'});}
};
